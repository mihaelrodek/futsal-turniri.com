package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.model.Matches;
import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.model.UserTeamPreset;
import hr.mrodek.apps.futsal_turniri.model.UserProfile;
import hr.mrodek.apps.futsal_turniri.enums.TournamentStatus;
import hr.mrodek.apps.futsal_turniri.repository.GroupsRepository;
import hr.mrodek.apps.futsal_turniri.repository.MatchEventRepository;
import hr.mrodek.apps.futsal_turniri.repository.MatchesRepository;
import hr.mrodek.apps.futsal_turniri.repository.PlayersRepository;
import hr.mrodek.apps.futsal_turniri.repository.RoundsRepository;
import hr.mrodek.apps.futsal_turniri.repository.TeamsRepository;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import hr.mrodek.apps.futsal_turniri.repository.UserTeamPresetRepository;
import hr.mrodek.apps.futsal_turniri.repository.UserProfileRepository;
import io.quarkus.panache.common.Sort;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.constraints.NotBlank;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Admin-only endpoints for the "Dashboard" tab on the profile page.
 *
 * <p>The dashboard lets an admin attach a tournament team to a registered
 * user retroactively - typically for legacy/organiser-added teams from
 * tournaments that finished before the player signed up. After attaching,
 * the team shows up on that user's public profile the same way a
 * self-registered team would.
 *
 * <p>Authorization is gated on the Firebase {@code role: "admin"} custom
 * claim. Set per-user via {@code scripts/set-admin.mjs}.
 *
 * <p>Why this lives in its own controller (vs. extending an existing one):
 * the admin dashboard is a distinct surface with cross-entity reads
 * (tournaments + teams + profiles + presets) that don't fit cleanly on
 * any single existing controller. Centralising the dashboard's endpoints
 * also makes it easy to audit/disable the whole admin surface at once.
 */
@Path("/admin")
@RolesAllowed("admin")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class AdminController {

    @Inject TournamentsRepository tournamentsRepo;
    @Inject TeamsRepository teamsRepo;
    @Inject UserProfileRepository profileRepo;
    @Inject UserTeamPresetRepository presetRepo;
    @Inject hr.mrodek.apps.futsal_turniri.repository.TournamentEditorRepository editorRepo;
    @Inject GroupsRepository groupsRepo;
    @Inject RoundsRepository roundsRepo;
    @Inject MatchesRepository matchesRepo;
    @Inject MatchEventRepository matchEventRepo;
    @Inject PlayersRepository playersRepo;

    /** Cap on user-search results - see UserProfileRepository.searchByDisplayName. */
    private static final int USER_SEARCH_LIMIT = 25;

    /** ──────────────────────────────────────────────────────────────────
     * Tournament list for the picker. Returns every non-deleted
     * tournament (the {@code @Where} clause on the entity filters
     * deleted rows automatically), newest first, with just the fields
     * the dashboard's dropdown needs.
     * ──────────────────────────────────────────────────────────────── */
    @GET
    @Path("/tournaments")
    public Response listTournaments() {
        List<AdminTournamentDto> dtos = tournamentsRepo
                .listAll(Sort.by("startAt").descending().and("id").descending())
                .stream()
                .map(t -> new AdminTournamentDto(
                        t.getId(),
                        t.getUuid() != null ? t.getUuid().toString() : null,
                        t.getSlug(),
                        t.getName(),
                        t.getLocation(),
                        t.getStartAt(),
                        t.getStatus() != null ? t.getStatus().name() : null,
                        t.getCreatedByUid(),
                        t.getCreatedByName(),
                        t.isHidden()))
                .toList();
        return Response.ok(dtos).build();
    }

    /** ──────────────────────────────────────────────────────────────────
     * Unclaimed teams for the selected tournament. "Unclaimed" =
     * neither submittedByUid nor coSubmittedByUid is set. Pending
     * self-registrations are excluded - they need to be approved or
     * rejected by the organiser through the normal flow.
     * ──────────────────────────────────────────────────────────────── */
    @GET
    @Path("/tournaments/{tournamentId}/teams")
    public Response listUnclaimedTeams(@PathParam("tournamentId") Long tournamentId) {
        if (tournamentsRepo.findByIdOptional(tournamentId).isEmpty()) {
            return Response.status(Response.Status.NOT_FOUND).build();
        }
        List<AdminTeamDto> dtos = teamsRepo.findUnclaimedByTournamentId(tournamentId)
                .stream()
                .sorted((a, b) -> {
                    // Stable order: name ascending. Helps a long list stay
                    // visually consistent across reloads after attachments.
                    String an = a.getName() != null ? a.getName() : "";
                    String bn = b.getName() != null ? b.getName() : "";
                    return an.compareToIgnoreCase(bn);
                })
                .map(p -> new AdminTeamDto(p.getId(), p.getName(), p.isEliminated()))
                .toList();
        return Response.ok(dtos).build();
    }

    /** ──────────────────────────────────────────────────────────────────
     * User search by displayName for the attach-target picker.
     * Empty/blank query returns the first {@code USER_SEARCH_LIMIT}
     * users alphabetically so the dropdown isn't empty before the
     * admin types.
     * ──────────────────────────────────────────────────────────────── */
    @GET
    @Path("/users")
    public Response searchUsers(@QueryParam("q") String query) {
        List<AdminUserDto> dtos = profileRepo
                .searchByDisplayName(query, USER_SEARCH_LIMIT)
                .stream()
                .map(p -> new AdminUserDto(p.getUserUid(), p.getDisplayName(), p.getSlug()))
                .toList();
        return Response.ok(dtos).build();
    }

    /** ──────────────────────────────────────────────────────────────────
     * Full list of all registered users, alphabetically. Backs the
     * admin "Popis igrača" tab - distinct from {@link #searchUsers}
     * (which caps at {@link #USER_SEARCH_LIMIT} for the dropdown
     * picker) because here we want every profile, not the top-N
     * search hits.
     * ──────────────────────────────────────────────────────────────── */
    @GET
    @Path("/users/all")
    public Response listAllUsers() {
        List<AdminUserDto> dtos = profileRepo.listAllByDisplayName()
                .stream()
                .map(p -> new AdminUserDto(p.getUserUid(), p.getDisplayName(), p.getSlug()))
                .toList();
        return Response.ok(dtos).build();
    }

    /** ──────────────────────────────────────────────────────────────────
     * Attach a team to a user. Two side-effects (both wrapped in a
     * single transaction so a half-attached team never persists):
     *
     *   1. {@code team.submittedByUid = userUid} - this single field is
     *      what {@code findMyParticipations} matches on, so the team
     *      starts appearing on the target user's profile immediately.
     *   2. If the user doesn't already have a {@code UserTeamPreset}
     *      with the same name, we create one (with a stable claim
     *      token, like the self-register path). Reason: tournaments
     *      with the same team name in the future will then auto-claim
     *      to this user via the preset-name fallback in
     *      {@link hr.mrodek.apps.futsal_turniri.repository.TeamsRepository#findMyParticipations}.
     *
     * Refuses to attach when the team is already claimed (either
     * submitter slot filled) - the UI filters those out, but a parallel
     * request could race in, so we re-check here as well.
     * ──────────────────────────────────────────────────────────────── */
    @POST
    @Path("/teams/{teamId}/attach")
    @Transactional
    public Response attachTeam(@PathParam("teamId") Long teamId,
                               AttachTeamRequest body) {
        if (body == null || body.userUid() == null || body.userUid().isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("USER_UID_REQUIRED").build();
        }
        Teams team = teamsRepo.findById(teamId);
        if (team == null) return Response.status(Response.Status.NOT_FOUND).build();

        // Defensive - the UI hides claimed teams but a parallel admin
        // attaching at the same time would otherwise silently overwrite.
        if (team.getSubmittedByUid() != null || team.getCoSubmittedByUid() != null) {
            return Response.status(Response.Status.CONFLICT)
                    .entity("ALREADY_CLAIMED").build();
        }

        UserProfile target = profileRepo.findByUid(body.userUid()).orElse(null);
        if (target == null) {
            return Response.status(Response.Status.NOT_FOUND)
                    .entity("USER_NOT_FOUND").build();
        }

        // 1. Direct ownership flag.
        team.setSubmittedByUid(target.getUserUid());
        teamsRepo.persist(team);

        // 2. Auto-create a matching preset so future tournaments with
        //    the same team name auto-link to this user. Skip if one
        //    already exists (case-insensitive name match).
        String teamName = team.getName() != null ? team.getName().trim() : null;
        boolean createdPreset = false;
        if (teamName != null && !teamName.isEmpty()) {
            var existing = presetRepo.findByUserUidAndNameIgnoreCase(
                    target.getUserUid(), teamName);
            if (existing.isEmpty()) {
                UserTeamPreset preset = new UserTeamPreset();
                preset.setUserUid(target.getUserUid());
                preset.setName(teamName);
                preset.setHidden(false);
                preset.setClaimToken(generateClaimToken());
                preset.setArchived(false);
                presetRepo.persist(preset);
                createdPreset = true;
            }
        }

        return Response.ok(new AttachTeamResponse(
                team.getId(), target.getUserUid(),
                target.getDisplayName(), createdPreset)).build();
    }

    /** ──────────────────────────────────────────────────────────────────
     * Transfer tournament ownership to another registered user. Used
     * when an admin pre-creates a tournament on behalf of an organiser
     * (e.g. before the organiser has signed up, or for legacy imports)
     * and later wants to hand it over so the real organiser can manage
     * teams, edit details, finish rounds, etc.
     *
     * <p>Two fields are updated on the tournament:
     *   - {@code createdByUid} - drives all owner-only authorisation
     *     checks ({@code canEditTournament}, team-management endpoints,
     *     the "Uredi" / "Završi turnir" / "Manualno generiraj kolo" UI
     *     gates). After this call the target user is treated exactly as
     *     if they had created the tournament themselves.
     *   - {@code createdByName} - copied from the target's UserProfile
     *     displayName so all "created by" labels in the UI match the
     *     new owner without us having to look up the profile every time
     *     the tournament is rendered.
     *
     * <p>Idempotent - transferring to the same user again is a no-op
     * (returns 200 with the same payload). We don't reject transfers
     * across status (DRAFT / PUBLISHED / FINISHED) because legacy
     * imports often arrive as FINISHED and the whole point of transfer
     * is to backfill ownership for them too.
     * ──────────────────────────────────────────────────────────────── */
    @POST
    @Path("/tournaments/{tournamentId}/transfer")
    @Transactional
    public Response transferTournament(@PathParam("tournamentId") Long tournamentId,
                                       TransferTournamentRequest body) {
        if (body == null || body.userUid() == null || body.userUid().isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("USER_UID_REQUIRED").build();
        }
        Tournaments tournament = tournamentsRepo.findById(tournamentId);
        if (tournament == null) {
            return Response.status(Response.Status.NOT_FOUND)
                    .entity("TOURNAMENT_NOT_FOUND").build();
        }

        UserProfile target = profileRepo.findByUid(body.userUid()).orElse(null);
        if (target == null) {
            return Response.status(Response.Status.NOT_FOUND)
                    .entity("USER_NOT_FOUND").build();
        }

        tournament.setCreatedByUid(target.getUserUid());
        tournament.setCreatedByName(target.getDisplayName());
        tournamentsRepo.persist(tournament);

        return Response.ok(new TransferTournamentResponse(
                tournament.getId(),
                target.getUserUid(),
                target.getDisplayName())).build();
    }

    /* ──────────────────────────────────────────────────────────────────
     * Tournament editors (co-owners): grant management rights on a single
     * tournament to registered users WITHOUT transferring ownership. The
     * creator stays the owner; each editor additionally passes assertCanEdit
     * (edit details, teams, schedule, run the Zapisnik, …). Many allowed.
     * ────────────────────────────────────────────────────────────────── */

    /** Current editors of a tournament (with profile display info). */
    @GET
    @Path("/tournaments/{tournamentId}/editors")
    public Response listEditors(@PathParam("tournamentId") Long tournamentId) {
        Tournaments tournament = tournamentsRepo.findById(tournamentId);
        if (tournament == null) {
            return Response.status(Response.Status.NOT_FOUND).entity("TOURNAMENT_NOT_FOUND").build();
        }
        List<AdminUserDto> dtos = editorRepo.findByTournament_Id(tournamentId).stream()
                .map(e -> {
                    UserProfile p = profileRepo.findByUid(e.getUserUid()).orElse(null);
                    return new AdminUserDto(
                            e.getUserUid(),
                            p == null ? null : p.getDisplayName(),
                            p == null ? null : p.getSlug());
                })
                .toList();
        return Response.ok(dtos).build();
    }

    /** Grant editor rights to a user. Idempotent (re-granting is a no-op). */
    @POST
    @Path("/tournaments/{tournamentId}/editors")
    @Transactional
    public Response addEditor(@PathParam("tournamentId") Long tournamentId,
                              TransferTournamentRequest body) {
        if (body == null || body.userUid() == null || body.userUid().isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST).entity("USER_UID_REQUIRED").build();
        }
        Tournaments tournament = tournamentsRepo.findById(tournamentId);
        if (tournament == null) {
            return Response.status(Response.Status.NOT_FOUND).entity("TOURNAMENT_NOT_FOUND").build();
        }
        UserProfile target = profileRepo.findByUid(body.userUid()).orElse(null);
        if (target == null) {
            return Response.status(Response.Status.NOT_FOUND).entity("USER_NOT_FOUND").build();
        }
        if (!editorRepo.isEditor(tournamentId, target.getUserUid())) {
            editorRepo.persist(new hr.mrodek.apps.futsal_turniri.model.TournamentEditor(tournament, target.getUserUid()));
        }
        return Response.ok(new AdminUserDto(
                target.getUserUid(), target.getDisplayName(), target.getSlug())).build();
    }

    /** Revoke a user's editor rights. Idempotent. */
    @DELETE
    @Path("/tournaments/{tournamentId}/editors/{userUid}")
    @Transactional
    public Response removeEditor(@PathParam("tournamentId") Long tournamentId,
                                 @PathParam("userUid") String userUid) {
        editorRepo.removeByTournamentAndUid(tournamentId, userUid);
        return Response.noContent().build();
    }

    /** ──────────────────────────────────────────────────────────────────
     * Feature a tournament as the "tournament of the day" - surfaces it
     * in the daily hero on /uzivo. Idempotent: calling it on an already-
     * featured tournament just refreshes the timestamp (effectively
     * "bumping" it back to the top of any future ordering decisions).
     *
     * <p>Selection rule on the public lookup is "most-recently featured
     * row that hasn't finished yet". So clearing the feature is a DELETE
     * on the same URL - see {@link #unfeatureTournament}.
     * ──────────────────────────────────────────────────────────────── */
    @POST
    @Path("/tournaments/{uuid}/feature")
    @Transactional
    public Response featureTournament(@PathParam("uuid") String uuid) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) {
            return Response.status(Response.Status.NOT_FOUND)
                    .entity("TOURNAMENT_NOT_FOUND").build();
        }
        t.setFeaturedAt(OffsetDateTime.now());
        tournamentsRepo.persist(t);
        return Response.ok(new FeatureTournamentResponse(
                t.getId(),
                t.getUuid() != null ? t.getUuid().toString() : null,
                t.getFeaturedAt())).build();
    }

    /** Inverse of {@link #featureTournament} - clears the feature flag. */
    @DELETE
    @Path("/tournaments/{uuid}/feature")
    @Transactional
    public Response unfeatureTournament(@PathParam("uuid") String uuid) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) {
            return Response.status(Response.Status.NOT_FOUND)
                    .entity("TOURNAMENT_NOT_FOUND").build();
        }
        t.setFeaturedAt(null);
        tournamentsRepo.persist(t);
        return Response.noContent().build();
    }

    /**
     * Mark a tournament as "not publicly visible". While hidden it vanishes
     * from every public read (lists, details, sitemap, live, previews) -
     * only its creator and admins still see it (greyed out in the SPA) and
     * can open/edit it. Works for upcoming AND finished tournaments.
     * Reversible - see {@link #unhideTournament}.
     */
    @POST
    @Path("/tournaments/{uuid}/hidden")
    @Transactional
    public Response hideTournament(@PathParam("uuid") String uuid) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) {
            return Response.status(Response.Status.NOT_FOUND)
                    .entity("TOURNAMENT_NOT_FOUND").build();
        }
        t.setHidden(true);
        // A hidden tournament can't stay the public daily highlight.
        t.setFeaturedAt(null);
        tournamentsRepo.persist(t);
        return Response.noContent().build();
    }

    /** Inverse of {@link #hideTournament} - makes the tournament public again. */
    @DELETE
    @Path("/tournaments/{uuid}/hidden")
    @Transactional
    public Response unhideTournament(@PathParam("uuid") String uuid) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) {
            return Response.status(Response.Status.NOT_FOUND)
                    .entity("TOURNAMENT_NOT_FOUND").build();
        }
        t.setHidden(false);
        tournamentsRepo.persist(t);
        return Response.noContent().build();
    }

    /** ──────────────────────────────────────────────────────────────────
     * Admin raw status override. Differs from {@code /tournaments/{uuid}/start}
     * which gates on business rules (INSUFFICIENT_TEAMS, etc.) - this
     * bypasses every rule and writes the requested status verbatim.
     * Use only from the admin dashboard for legacy / stuck tournaments
     * where the normal flow can't recover.
     *
     * <p>Accepts: {@code DRAFT}, {@code STARTED}, {@code FINISHED}.
     * Returns 400 for anything else. Does NOT touch winner / podium
     * fields - those have their own dedicated endpoints.
     * ──────────────────────────────────────────────────────────────── */
    @POST
    @Path("/tournaments/{uuid}/status")
    @Transactional
    public Response setStatus(@PathParam("uuid") String uuid, SetStatusRequest body) {
        if (body == null || body.status() == null || body.status().isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("STATUS_REQUIRED").build();
        }
        final TournamentStatus next;
        try {
            next = TournamentStatus.valueOf(body.status().toUpperCase());
        } catch (IllegalArgumentException e) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("INVALID_STATUS").build();
        }
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) {
            return Response.status(Response.Status.NOT_FOUND)
                    .entity("TOURNAMENT_NOT_FOUND").build();
        }
        t.setStatus(next);
        tournamentsRepo.persist(t);
        return Response.ok(new SetStatusResponse(
                t.getId(),
                t.getUuid() != null ? t.getUuid().toString() : null,
                next.name())).build();
    }

    /** ──────────────────────────────────────────────────────────────────
     * Full JSON dump of ONE tournament - every row that belongs to it:
     * the tournament itself (all scalar fields), editor grants, groups,
     * teams with kit colours and full rosters, rounds, and matches with
     * their complete live state (scores, penalties, fouls, half
     * timestamps) and event timeline (goal / card / penalty minutes).
     * Read-only; downloaded from the admin dashboard as a .json file.
     *
     * <p>Deliberately NOT a Jackson dump of the entities - every relation
     * is LAZY and several are recursive (match → nextMatch), so the tree
     * is hand-built from explicit fields: FK ids everywhere, plus
     * denormalised team/player names where they help a human reader.
     * Claim tokens are the one thing left out on purpose - they are
     * live capability URLs (/claim-team/{token}), not tournament data.
     * ──────────────────────────────────────────────────────────────── */
    @GET
    @Path("/tournaments/{uuid}/export")
    @Transactional // keeps the Hibernate session open for the lazy name reads
    public Response exportTournament(@PathParam("uuid") String uuid) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) {
            return Response.status(Response.Status.NOT_FOUND)
                    .entity("TOURNAMENT_NOT_FOUND").build();
        }
        Long tid = t.getId();

        Map<String, Object> root = new LinkedHashMap<>();
        root.put("exportedAt", OffsetDateTime.now());
        root.put("tournament", exportTournamentFields(t));

        root.put("editors", editorRepo.findByTournament_Id(tid).stream().map(e -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("userUid", e.getUserUid());
            m.put("displayName", profileRepo.findByUid(e.getUserUid())
                    .map(UserProfile::getDisplayName).orElse(null));
            m.put("createdAt", e.getCreatedAt());
            return m;
        }).toList());

        root.put("groups", groupsRepo.findByTournamentIdOrderByOrdinal(tid).stream().map(g -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", g.getId());
            m.put("name", g.getName());
            m.put("ordinal", g.getOrdinal());
            m.put("advanceCount", g.getAdvanceCount());
            return m;
        }).toList());

        List<Teams> teams = teamsRepo.findByTournament_Id(tid);
        teams.sort(Comparator.comparing(Teams::getId));
        root.put("teams", teams.stream().map(team -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", team.getId());
            m.put("name", team.getName());
            m.put("groupId", team.getGroup() != null ? team.getGroup().getId() : null);
            m.put("drawPosition", team.getDrawPosition());
            m.put("manualRank", team.getManualRank());
            m.put("jerseyColor", team.getJerseyColor());
            m.put("shortsColor", team.getShortsColor());
            m.put("eliminated", team.isEliminated());
            m.put("pendingApproval", team.isPendingApproval());
            m.put("submittedByUid", team.getSubmittedByUid());
            m.put("coSubmittedByUid", team.getCoSubmittedByUid());
            m.put("createdAt", team.getCreatedAt());
            m.put("players", playersRepo.findByTeam_Id(team.getId()).stream().map(p -> {
                Map<String, Object> pm = new LinkedHashMap<>();
                pm.put("id", p.getId());
                pm.put("name", p.getName());
                pm.put("number", p.getNumber());
                pm.put("captain", p.isCaptain());
                pm.put("sortOrder", p.getSortOrder());
                return pm;
            }).toList());
            return m;
        }).toList());

        root.put("rounds", roundsRepo.findByTournament_IdOrderByNumberAsc(tid).stream().map(r -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r.getId());
            m.put("number", r.getNumber());
            m.put("status", r.getStatus() != null ? r.getStatus().name() : null);
            m.put("createdAt", r.getCreatedAt());
            m.put("lockedAt", r.getLockedAt());
            m.put("completedAt", r.getCompletedAt());
            return m;
        }).toList());

        List<Matches> matches = matchesRepo.findByTournament_Id(tid);
        matches.sort(Comparator.comparing(Matches::getId));
        root.put("matches", matches.stream().map(mt -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", mt.getId());
            m.put("roundId", mt.getRound() != null ? mt.getRound().getId() : null);
            m.put("stage", mt.getStage() != null ? mt.getStage().name() : null);
            m.put("groupId", mt.getGroup() != null ? mt.getGroup().getId() : null);
            m.put("tableNo", mt.getTableNo());
            m.put("kickoffAt", mt.getKickoffAt());
            m.put("team1Id", mt.getTeam1() != null ? mt.getTeam1().getId() : null);
            m.put("team1Name", mt.getTeam1() != null ? mt.getTeam1().getName() : null);
            m.put("team2Id", mt.getTeam2() != null ? mt.getTeam2().getId() : null);
            m.put("team2Name", mt.getTeam2() != null ? mt.getTeam2().getName() : null);
            m.put("score1", mt.getScore1());
            m.put("score2", mt.getScore2());
            m.put("penalties1", mt.getPenalties1());
            m.put("penalties2", mt.getPenalties2());
            m.put("winnerTeamId", mt.getWinnerTeam() != null ? mt.getWinnerTeam().getId() : null);
            m.put("nextMatchId", mt.getNextMatch() != null ? mt.getNextMatch().getId() : null);
            m.put("nextSlot", mt.getNextSlot());
            m.put("slot1Source", mt.getSlot1Source());
            m.put("slot2Source", mt.getSlot2Source());
            m.put("fouls1First", mt.getFouls1First());
            m.put("fouls1Second", mt.getFouls1Second());
            m.put("fouls2First", mt.getFouls2First());
            m.put("fouls2Second", mt.getFouls2Second());
            m.put("status", mt.getStatus() != null ? mt.getStatus().name() : null);
            m.put("liveMode", mt.getLiveMode() != null ? mt.getLiveMode().name() : null);
            m.put("liveStartedAt", mt.getLiveStartedAt());
            m.put("firstHalfEndedAt", mt.getFirstHalfEndedAt());
            m.put("secondHalfStartedAt", mt.getSecondHalfStartedAt());
            m.put("livePausedAt", mt.getLivePausedAt());
            m.put("events", matchEventRepo.findByMatch_IdOrdered(mt.getId()).stream().map(ev -> {
                Map<String, Object> em = new LinkedHashMap<>();
                em.put("id", ev.getId());
                em.put("type", ev.getType() != null ? ev.getType().name() : null);
                em.put("minute", ev.getMinute());
                em.put("playerId", ev.getPlayer() != null ? ev.getPlayer().getId() : null);
                em.put("playerName", ev.getPlayer() != null ? ev.getPlayer().getName() : null);
                // Team of the event: derived from the player when present,
                // otherwise the explicit team column (unattributed events).
                em.put("teamId", ev.getPlayer() != null
                        ? (ev.getPlayer().getTeam() != null ? ev.getPlayer().getTeam().getId() : null)
                        : (ev.getTeam() != null ? ev.getTeam().getId() : null));
                em.put("assistPlayerId", ev.getAssistPlayer() != null ? ev.getAssistPlayer().getId() : null);
                em.put("assistPlayerName", ev.getAssistPlayer() != null ? ev.getAssistPlayer().getName() : null);
                em.put("createdAt", ev.getCreatedAt());
                return em;
            }).toList());
            return m;
        }).toList());

        String fname = "turnir-" + (t.getSlug() != null ? t.getSlug() : t.getUuid()) + ".json";
        return Response.ok(root)
                .header("Content-Disposition", "attachment; filename=\"" + fname + "\"")
                .build();
    }

    /** Every scalar column of {@link Tournaments}, in declaration order. */
    private static Map<String, Object> exportTournamentFields(Tournaments t) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", t.getId());
        m.put("uuid", t.getUuid() != null ? t.getUuid().toString() : null);
        m.put("slug", t.getSlug());
        m.put("name", t.getName());
        m.put("location", t.getLocation());
        m.put("details", t.getDetails());
        m.put("startAt", t.getStartAt());
        m.put("status", t.getStatus() != null ? t.getStatus().name() : null);
        m.put("maxTeams", t.getMaxTeams());
        m.put("format", t.getFormat() != null ? t.getFormat().name() : null);
        m.put("groupCount", t.getGroupCount());
        m.put("advancePerGroup", t.getAdvancePerGroup());
        m.put("bestThirdCount", t.getBestThirdCount());
        m.put("bracketFill", t.getBracketFill() != null ? t.getBracketFill().name() : null);
        m.put("bracketConfirmedAt", t.getBracketConfirmedAt());
        m.put("halfCount", t.getHalfCount());
        m.put("halfLengthMin", t.getHalfLengthMin());
        m.put("halftimeBreakMin", t.getHalftimeBreakMin());
        m.put("koHalfLengthMin", t.getKoHalfLengthMin());
        m.put("koHalftimeBreakMin", t.getKoHalftimeBreakMin());
        m.put("breakBetweenMatchesMin", t.getBreakBetweenMatchesMin());
        m.put("koBreakBetweenMatchesMin", t.getKoBreakBetweenMatchesMin());
        m.put("bufferMin", t.getBufferMin());
        m.put("entryPrice", t.getEntryPrice());
        m.put("contactName", t.getContactName());
        m.put("contactPhone", t.getContactPhone());
        m.put("gameSystem", t.getGameSystem());
        m.put("websiteUrl", t.getWebsiteUrl());
        m.put("organizerName", t.getOrganizerName());
        m.put("rewardType", t.getRewardType() != null ? t.getRewardType().name() : null);
        m.put("rewardFirst", t.getRewardFirst());
        m.put("rewardFirstNote", t.getRewardFirstNote());
        m.put("rewardSecond", t.getRewardSecond());
        m.put("rewardSecondNote", t.getRewardSecondNote());
        m.put("rewardThird", t.getRewardThird());
        m.put("rewardThirdNote", t.getRewardThirdNote());
        m.put("rewardFourth", t.getRewardFourth());
        m.put("rewardFourthNote", t.getRewardFourthNote());
        m.put("posterResourceId", t.getResource() != null ? t.getResource().getId() : null);
        m.put("createdAt", t.getCreatedAt());
        m.put("updatedAt", t.getUpdatedAt());
        m.put("winnerName", t.getWinnerName());
        m.put("secondPlaceName", t.getSecondPlaceName());
        m.put("thirdPlaceName", t.getThirdPlaceName());
        m.put("bestGoalkeeperName", t.getBestGoalkeeperName());
        m.put("bestPlayerName", t.getBestPlayerName());
        m.put("bestScorerName", t.getBestScorerName());
        m.put("createdByUid", t.getCreatedByUid());
        m.put("createdByName", t.getCreatedByName());
        m.put("latitude", t.getLatitude());
        m.put("longitude", t.getLongitude());
        m.put("geocodedAt", t.getGeocodedAt());
        m.put("hidden", t.isHidden());
        m.put("scorerScope", t.getScorerScope() != null ? t.getScorerScope().name() : null);
        m.put("featuredAt", t.getFeaturedAt());
        return m;
    }

    /* ─────────────────── helpers + DTOs ─────────────────── */

    /**
     * 32-byte URL-safe random token. Matches the format used elsewhere
     * (UserTeamPresetController, team self-register) so claim links
     * generated through the admin path are indistinguishable from
     * organic ones.
     */
    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static String generateClaimToken() {
        byte[] buf = new byte[24];
        SECURE_RANDOM.nextBytes(buf);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(buf);
    }

    public record AdminTournamentDto(Long id, String uuid, String slug,
                                     String name, String location,
                                     OffsetDateTime startAt, String status,
                                     String createdByUid, String createdByName,
                                     boolean hidden) {}

    public record AdminTeamDto(Long id, String name, boolean eliminated) {}

    public record AdminUserDto(String userUid, String displayName, String slug) {}

    public record AttachTeamRequest(@NotBlank String userUid) {}

    public record AttachTeamResponse(Long teamId, String userUid,
                                     String displayName, boolean createdPreset) {}

    public record TransferTournamentRequest(@NotBlank String userUid) {}

    public record TransferTournamentResponse(Long tournamentId, String userUid,
                                             String displayName) {}

    public record FeatureTournamentResponse(Long tournamentId, String uuid,
                                            OffsetDateTime featuredAt) {}

    public record SetStatusRequest(@NotBlank String status) {}
    public record SetStatusResponse(Long tournamentId, String uuid, String status) {}
}
