package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.CareerStatsDto;
import hr.mrodek.apps.futsal_turniri.dtos.MyTournamentParticipationDto;
import hr.mrodek.apps.futsal_turniri.dtos.TeamMatchHistoryDto;
import hr.mrodek.apps.futsal_turniri.dtos.PublicProfileDto;
import hr.mrodek.apps.futsal_turniri.enums.MatchStatus;
import hr.mrodek.apps.futsal_turniri.model.Matches;
import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.model.UserTeamPreset;
import hr.mrodek.apps.futsal_turniri.repository.MatchesRepository;
import hr.mrodek.apps.futsal_turniri.repository.TeamsRepository;
import hr.mrodek.apps.futsal_turniri.repository.UserTeamPresetRepository;
import hr.mrodek.apps.futsal_turniri.repository.UserProfileRepository;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.jwt.JsonWebToken;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Anonymous-readable profile pages. Anyone can hit these — there is no
 * {@code @Authenticated} on the class — because the product decision is
 * that profile *pages* are publicly visible (so people can share a link to
 * their tournament history).
 *
 * <p>Phone numbers, however, are redacted for unauthenticated callers so the
 * endpoint can't be used as an anonymous PII scraper. Logged-in users see
 * the full profile.
 *
 * Routes:
 *   GET /public/users/{slug}                              — profile + teams + tournaments
 *   GET /public/users/{slug}/teams/{teamId}/matches       — match-by-match history for one team
 */
@Path("/public/users")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class PublicProfileController {

    @Inject UserProfileRepository profileRepo;
    @Inject UserTeamPresetRepository presetRepo;
    @Inject TeamsRepository teamRepo;
    @Inject MatchesRepository matchRepo;
    @Inject SecurityIdentity identity;
    @Inject JsonWebToken jwt;

    /**
     * True when no Firebase ID token was presented (or it didn't verify).
     *
     * We check {@code jwt.getSubject()} instead of
     * {@code identity.isAnonymous()} because Quarkus OIDC runs in
     * non-proactive mode (proactive=false) — under that setting,
     * SecurityIdentity stays anonymous on endpoints without
     * {@code @Authenticated} even when a valid bearer token is in the
     * request. Injecting JsonWebToken and reading the subject DOES force
     * verification, so this is the reliable signal.
     */
    private boolean isAnonymous() {
        return jwt == null || jwt.getSubject() == null || jwt.getSubject().isBlank();
    }

    @GET
    @Path("/{slug}")
    public PublicProfileDto getBySlug(@PathParam("slug") String slug) {
        var profile = profileRepo.findBySlug(slug)
                .orElseThrow(() -> new NotFoundException("Profil nije pronađen: " + slug));

        String uid = profile.getUserUid();

        // Load every preset the profile owner is a party to — primary OR
        // co-owner — across BOTH active and archived rows. We need the
        // archived set to filter participations, the active+claimed set
        // to attach partner info to each team summary, and the legacy
        // by-name list for the participations query fallback.
        var ownedPresets = presetRepo.list(
                "userUid = ?1 or coOwnerUid = ?1",
                uid
        );

        // Archived names — hidden from EVERYONE (owner + visitors).
        // Once both owners agreed to archive, the team is "gone" from
        // public-facing UI even though the underlying Teams rows stay
        // for tournament-side history.
        Set<String> archivedLowered = new HashSet<>();
        // Hidden names — only filtered for non-owner viewers.
        Set<String> hiddenLowered = new HashSet<>();
        // Map of name → partner profile, used to enrich TeamSummary so
        // the UI can show a clickable "Partner: X" on each chip.
        Map<String, hr.mrodek.apps.futsal_turniri.model.UserProfile> partnerByName = new HashMap<>();

        for (var pp : ownedPresets) {
            if (pp.getName() == null) continue;
            String key = pp.getName().trim().toLowerCase(Locale.ROOT);
            if (pp.isArchived()) {
                archivedLowered.add(key);
                continue;
            }
            if (pp.isHidden()) hiddenLowered.add(key);
            // Active + claimed → resolve the OTHER owner from the
            // profile-owner's perspective and stash for later lookup.
            String partnerUid = null;
            if (uid.equals(pp.getUserUid())) {
                partnerUid = pp.getCoOwnerUid();
            } else if (uid.equals(pp.getCoOwnerUid())) {
                partnerUid = pp.getUserUid();
            }
            if (partnerUid != null && !partnerUid.isBlank()) {
                profileRepo.findByUid(partnerUid).ifPresent(pr -> partnerByName.put(key, pr));
            }
        }

        // Determine viewer identity. Owner-of-this-profile sees hidden
        // teams (just not the archived ones); anonymous + everyone else
        // gets both hidden + archived filtering.
        String viewerUid = (jwt != null) ? jwt.getSubject() : null;
        boolean viewerIsOwner = viewerUid != null && viewerUid.equals(uid);

        // Preset names list for the legacy by-name participation fallback,
        // skipping archived ones (no point pulling teams that we'll
        // immediately filter back out).
        List<String> presetNames = ownedPresets.stream()
                .filter(pp -> !pp.isArchived())
                .map(UserTeamPreset::getName)
                .toList();

        var participations = teamRepo.findMyParticipations(uid, presetNames);

        var participationDtos = participations.stream()
                .map(PublicProfileController::toParticipationDto)
                .filter(p -> {
                    if (p.teamName() == null) return true;
                    String key = p.teamName().trim().toLowerCase(Locale.ROOT);
                    // Archived → drop for everyone.
                    if (archivedLowered.contains(key)) return false;
                    // Hidden → drop for non-owner viewers only.
                    if (!viewerIsOwner && hiddenLowered.contains(key)) return false;
                    return true;
                })
                .toList();

        // Build team summary by collapsing on lower-cased trimmed name and
        // counting tournaments + wins per group. Attach partner info
        // (the OTHER owner) when the name matches an active claimed preset.
        Map<String, int[]> agg = new LinkedHashMap<>();
        Map<String, String> prettyName = new LinkedHashMap<>();
        for (var p : participationDtos) {
            String key = p.teamName() == null ? "" : p.teamName().trim().toLowerCase(Locale.ROOT);
            if (key.isEmpty()) continue;
            prettyName.putIfAbsent(key, p.teamName().trim());
            int[] cur = agg.computeIfAbsent(key, k -> new int[]{0, 0});
            cur[0] += 1;
            if (p.isWinner()) cur[1] += 1;
        }

        var teams = new ArrayList<PublicProfileDto.TeamSummary>(agg.size());
        for (var e : agg.entrySet()) {
            var partner = partnerByName.get(e.getKey());
            teams.add(new PublicProfileDto.TeamSummary(
                    prettyName.get(e.getKey()),
                    e.getValue()[0],
                    e.getValue()[1],
                    partner == null ? null : partner.getSlug(),
                    partner == null ? null : partner.getDisplayName()
            ));
        }
        // Most-played team first so the UI default selection is the strongest signal.
        teams.sort((a, b) -> Integer.compare(b.tournamentCount(), a.tournamentCount()));

        // Phone is hidden from anonymous callers so this endpoint can't be
        // used as a one-click PII scraper. Logged-in users get the real
        // value; anonymous callers see nulls AND a hasPhone=true flag so the
        // SPA can render a blurred placeholder that links to /login.
        boolean anon = isAnonymous();
        boolean hasPhone = profile.getPhone() != null && !profile.getPhone().isBlank();
        String phoneCountry = anon ? null : profile.getPhoneCountry();
        String phone = anon ? null : profile.getPhone();

        // Avatar — proxied URL pattern, same as posters. Public per product
        // decision (the page itself is anonymous-readable). Touching the
        // lazy association requires an active transaction; the surrounding
        // request scope provides one.
        String avatarUrl = null;
        if (profile.getAvatar() != null && profile.getAvatar().getId() != null) {
            avatarUrl = "/api/resources/" + profile.getAvatar().getId() + "/image";
        }

        return new PublicProfileDto(
                profile.getSlug(),
                profile.getDisplayName(),
                phoneCountry,
                phone,
                hasPhone,
                avatarUrl,
                teams,
                participationDtos
        );
    }

    @GET
    @Path("/{slug}/teams/{teamId}/matches")
    public TeamMatchHistoryDto getTeamMatches(
            @PathParam("slug") String slug,
            @PathParam("teamId") Long teamId
    ) {
        var profile = profileRepo.findBySlug(slug)
                .orElseThrow(() -> new NotFoundException("Profil nije pronađen: " + slug));

        var team = teamRepo.findByIdOptional(teamId)
                .orElseThrow(() -> new NotFoundException("Par nije pronađen: " + teamId));

        // Make sure this team actually belongs to that profile — either by uid
        // or by preset-name fallback. Prevents anyone from drilling into other
        // people's teams by guessing teamId via someone else's slug.
        boolean ownsByUid = team.getSubmittedByUid() != null
                && team.getSubmittedByUid().equals(profile.getUserUid());
        boolean ownsByPreset = false;
        if (!ownsByUid && team.getSubmittedByUid() == null) {
            String teamName = team.getName() == null ? "" : team.getName().trim().toLowerCase(Locale.ROOT);
            ownsByPreset = presetRepo.findByUserUid(profile.getUserUid()).stream()
                    .map(UserTeamPreset::getName)
                    .anyMatch(n -> n != null && n.trim().toLowerCase(Locale.ROOT).equals(teamName));
        }
        if (!ownsByUid && !ownsByPreset) {
            // Treat as missing — same shape as a wrong slug so we don't leak
            // existence-by-id.
            throw new NotFoundException("Par nije pronađen za ovaj profil.");
        }

        Tournaments t = team.getTournament();
        var rows = new ArrayList<TeamMatchHistoryDto.Row>();
        for (Matches m : matchRepo.findByTeamId(team.getId())) {
            boolean isTeam1 = m.getTeam1() != null && m.getTeam1().getId().equals(team.getId());
            Teams opponent = isTeam1 ? m.getTeam2() : m.getTeam1();
            Integer ourScore  = isTeam1 ? m.getScore1() : m.getScore2();
            Integer oppScore  = isTeam1 ? m.getScore2() : m.getScore1();
            Boolean won = null;
            if (m.getWinnerTeam() != null) {
                won = m.getWinnerTeam().getId().equals(team.getId());
            }
            boolean isBye = opponent == null;

            rows.add(new TeamMatchHistoryDto.Row(
                    m.getRound() == null ? null : m.getRound().getNumber(),
                    m.getTableNo(),
                    opponent == null ? null : opponent.getName(),
                    ourScore,
                    oppScore,
                    m.getStatus() == null ? null : m.getStatus().name(),
                    won,
                    isBye
            ));
        }

        return new TeamMatchHistoryDto(
                team.getId(),
                team.getName(),
                t == null ? null : t.getName(),
                rows
        );
    }

    /**
     * Aggregate career stats — totals across every team this profile owns.
     *
     * <p>The endpoint runs the same ownership/archive/hide filtering as
     * {@link #getBySlug(String)} so the numbers shown on a profile match
     * what's visible in the tournament list above them. Only FINISHED
     * matches contribute to W/D/L and goal counters.
     */
    @GET
    @Path("/{slug}/career")
    public CareerStatsDto getCareer(@PathParam("slug") String slug) {
        var profile = profileRepo.findBySlug(slug)
                .orElseThrow(() -> new NotFoundException("Profil nije pronađen: " + slug));

        String uid = profile.getUserUid();

        // Mirror the archive filter from getBySlug — archived teams don't
        // belong in stats either.
        var ownedPresets = presetRepo.list("userUid = ?1 or coOwnerUid = ?1", uid);
        Set<String> archivedLowered = new HashSet<>();
        for (var pp : ownedPresets) {
            if (pp.getName() == null) continue;
            if (pp.isArchived()) {
                archivedLowered.add(pp.getName().trim().toLowerCase(Locale.ROOT));
            }
        }
        List<String> presetNames = ownedPresets.stream()
                .filter(pp -> !pp.isArchived())
                .map(UserTeamPreset::getName)
                .toList();

        var participations = teamRepo.findMyParticipations(uid, presetNames).stream()
                .filter(p -> {
                    if (p.getName() == null) return true;
                    return !archivedLowered.contains(p.getName().trim().toLowerCase(Locale.ROOT));
                })
                .toList();

        int tournamentsPlayed = 0;
        int tournamentsWon = 0;
        int matchesPlayed = 0;
        int matchesWon = 0;
        int matchesDrawn = 0;
        int matchesLost = 0;
        int goalsFor = 0;
        int goalsAgainst = 0;

        // Top-team aggregation — by normalized name.
        Map<String, int[]> teamPlays = new HashMap<>();
        Map<String, String> teamPretty = new HashMap<>();

        // Recent — collect (Teams ref, Tournament) so we can re-sort by date.
        record Recent(Teams team, Tournaments tournament) {}
        List<Recent> recents = new ArrayList<>();

        for (Teams t : participations) {
            Tournaments tour = t.getTournament();
            if (tour == null) continue;
            tournamentsPlayed++;

            // Track top team.
            if (t.getName() != null && !t.getName().isBlank()) {
                String key = t.getName().trim().toLowerCase(Locale.ROOT);
                teamPretty.putIfAbsent(key, t.getName().trim());
                int[] cur = teamPlays.computeIfAbsent(key, k -> new int[]{0});
                cur[0]++;
            }

            // Did this team win the tournament?
            if (tour.getWinnerName() != null
                    && t.getName() != null
                    && tour.getWinnerName().trim().equalsIgnoreCase(t.getName().trim())) {
                tournamentsWon++;
            }

            recents.add(new Recent(t, tour));

            // Match-level aggregation. Skip non-FINISHED to avoid skewing
            // goals-per-tournament with mid-tournament rows.
            for (Matches m : matchRepo.findByTeamId(t.getId())) {
                if (m.getStatus() != MatchStatus.FINISHED) continue;
                boolean isTeam1 = m.getTeam1() != null && m.getTeam1().getId().equals(t.getId());
                Integer ourScore = isTeam1 ? m.getScore1() : m.getScore2();
                Integer oppScore = isTeam1 ? m.getScore2() : m.getScore1();
                if (ourScore == null || oppScore == null) continue;

                matchesPlayed++;
                goalsFor += ourScore;
                goalsAgainst += oppScore;

                if (m.getWinnerTeam() == null) {
                    if (ourScore.equals(oppScore)) matchesDrawn++;
                } else if (m.getWinnerTeam().getId().equals(t.getId())) {
                    matchesWon++;
                } else {
                    matchesLost++;
                }
            }
        }

        // Top team (by tournaments played).
        String topTeamName = null;
        int topCount = -1;
        for (var e : teamPlays.entrySet()) {
            if (e.getValue()[0] > topCount) {
                topCount = e.getValue()[0];
                topTeamName = teamPretty.get(e.getKey());
            }
        }

        // 6 most recent tournaments. Freshest first by startAt — fall
        // back to id-stable order when startAt is null.
        recents.sort((a, b) -> {
            var aT = a.tournament().getStartAt();
            var bT = b.tournament().getStartAt();
            if (aT == null && bT == null) return 0;
            if (aT == null) return 1;
            if (bT == null) return -1;
            return bT.compareTo(aT);
        });
        List<CareerStatsDto.RecentTournament> recentDtos = new ArrayList<>();
        for (Recent r : recents.stream().limit(6).toList()) {
            String result;
            boolean isWinner = r.tournament().getWinnerName() != null
                    && r.team().getName() != null
                    && r.tournament().getWinnerName().trim()
                            .equalsIgnoreCase(r.team().getName().trim());
            if (isWinner) result = "Pobjeda";
            else if (r.team().isEliminated()) result = "Eliminacija";
            else result = "Sudjelovanje";
            recentDtos.add(new CareerStatsDto.RecentTournament(
                    r.tournament().getName(),
                    r.tournament().getSlug(),
                    r.team().getName(),
                    r.tournament().getStartAt(),
                    result
            ));
        }

        return new CareerStatsDto(
                tournamentsPlayed,
                tournamentsWon,
                matchesPlayed,
                matchesWon,
                matchesDrawn,
                matchesLost,
                goalsFor,
                goalsAgainst,
                topTeamName,
                recentDtos
        );
    }

    private static MyTournamentParticipationDto toParticipationDto(Teams p) {
        Tournaments t = p.getTournament();
        boolean isWinner =
                t.getWinnerName() != null
                        && p.getName() != null
                        && t.getWinnerName().trim().equalsIgnoreCase(p.getName().trim());
        return new MyTournamentParticipationDto(
                t.getUuid(),
                t.getSlug(),
                t.getName(),
                t.getLocation(),
                t.getStartAt(),
                t.getStatus() == null ? null : t.getStatus().name(),
                t.getWinnerName(),
                p.getId(),
                p.getName(),
                p.isPendingApproval(),
                p.isEliminated(),
                isWinner
        );
    }
}
