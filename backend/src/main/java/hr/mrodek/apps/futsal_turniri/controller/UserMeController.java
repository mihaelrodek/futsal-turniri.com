package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.MyTournamentParticipationDto;
import hr.mrodek.apps.futsal_turniri.dtos.PlayerClaimSuggestionDto;
import hr.mrodek.apps.futsal_turniri.dtos.RegisterProfileRequest;
import hr.mrodek.apps.futsal_turniri.dtos.SyncProfileRequest;
import hr.mrodek.apps.futsal_turniri.dtos.UserProfileDto;
import hr.mrodek.apps.futsal_turniri.model.Player;
import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.model.Resources;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.model.UserTeamPreset;
import hr.mrodek.apps.futsal_turniri.model.UserProfile;
import hr.mrodek.apps.futsal_turniri.repository.PlayersRepository;
import hr.mrodek.apps.futsal_turniri.repository.TeamsRepository;
import hr.mrodek.apps.futsal_turniri.repository.UserTeamPresetRepository;
import hr.mrodek.apps.futsal_turniri.repository.UserProfileRepository;
import hr.mrodek.apps.futsal_turniri.services.MessageService;
import hr.mrodek.apps.futsal_turniri.services.PersonNameFolder;
import hr.mrodek.apps.futsal_turniri.services.PlayerClaimRequestMapper;
import hr.mrodek.apps.futsal_turniri.services.SlugService;
import hr.mrodek.apps.futsal_turniri.services.StorageService;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.ClientErrorException;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.jboss.resteasy.reactive.RestForm;
import org.jboss.resteasy.reactive.multipart.FileUpload;

import java.util.List;

/**
 * Read-only endpoints scoped to the currently signed-in user.
 * Enforces auth at the class level - every operation pulls the UID from
 * the verified JWT so a user can never look at someone else's data.
 */
@Path("/user/me")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class UserMeController {

    @Inject TeamsRepository teamRepo;
    @Inject PlayersRepository playersRepo;
    @Inject UserTeamPresetRepository presetRepo;
    @Inject UserProfileRepository profileRepo;
    @Inject SlugService slugService;
    @Inject StorageService storageService;
    @Inject MessageService messages;
    @Inject PlayerClaimRequestMapper claimMapper;
    @Inject JsonWebToken jwt;

    @GET
    @Path("/tournaments")
    public List<MyTournamentParticipationDto> myTournaments() {
        String uid = jwt.getSubject();
        // Pass the user's saved team-name presets so we also catch tournaments
        // where the team was added via the organizer flow with a known name.
        var presetNames = presetRepo.findByUserUid(uid).stream()
                .map(UserTeamPreset::getName)
                .toList();
        return teamRepo.findMyParticipations(uid, presetNames).stream()
                .map(this::toDto)
                .toList();
    }

    /**
     * "Moji pari" list on the profile's Predlošci tab. Returns every team
     * the viewer is linked to - as primary submitter (so they can copy
     * the share link) or as the claimed co-owner. Each row carries enough
     * context to render without N+1: tournament name/date, both submitters'
     * display info, and the claim token IF the viewer is the primary.
     */
    @GET
    @Path("/teams")
    @Transactional
    public List<hr.mrodek.apps.futsal_turniri.dtos.MyTeamDto> myTeams() {
        String uid = jwt.getSubject();
        // Reuse findMyParticipations to capture both primary + co-owned
        // teams. Preset-name fallback is left empty here: the share-link
        // flow only makes sense for actually-persisted Teams rows where
        // we know who submitted them; legacy-by-name matches don't carry
        // a UID and so can't be shared.
        var teams = teamRepo.findMyParticipations(uid, java.util.List.of());

        // Bulk-load both submitters' UserProfiles for the row enrichment.
        var profileUids = new java.util.HashSet<String>();
        for (var p : teams) {
            if (p.getSubmittedByUid() != null) profileUids.add(p.getSubmittedByUid());
            if (p.getCoSubmittedByUid() != null) profileUids.add(p.getCoSubmittedByUid());
        }
        var profilesByUid = profileRepo.findByUids(profileUids);

        var out = new java.util.ArrayList<hr.mrodek.apps.futsal_turniri.dtos.MyTeamDto>(teams.size());
        for (Teams p : teams) {
            boolean isPrimary = uid != null && uid.equals(p.getSubmittedByUid());
            var primaryProfile = p.getSubmittedByUid() != null
                    ? profilesByUid.get(p.getSubmittedByUid())
                    : null;
            var coProfile = p.getCoSubmittedByUid() != null
                    ? profilesByUid.get(p.getCoSubmittedByUid())
                    : null;
            var t = p.getTournament();
            String ref = t.getSlug() != null && !t.getSlug().isBlank()
                    ? t.getSlug()
                    : (t.getUuid() != null ? t.getUuid().toString() : null);
            out.add(new hr.mrodek.apps.futsal_turniri.dtos.MyTeamDto(
                    p.getId(),
                    p.getName(),
                    t.getId(),
                    t.getName(),
                    ref,
                    t.getStartAt(),
                    isPrimary,
                    p.isPendingApproval(),
                    primaryProfile != null ? primaryProfile.getDisplayName() : null,
                    primaryProfile != null ? primaryProfile.getSlug() : null,
                    coProfile != null ? coProfile.getDisplayName() : null,
                    coProfile != null ? coProfile.getSlug() : null,
                    isPrimary ? p.getClaimToken() : null
            ));
        }
        return out;
    }

    /** Cap on "je li ovo ti?" suggestions - a short list, not a search page. */
    private static final int PLAYER_SUGGESTION_LIMIT = 5;

    /**
     * "Je li ovo ti?" - roster players across all tournaments whose full
     * name matches the signed-in user's registered first+last name
     * (case- and diacritics-insensitively) and whose team nobody has
     * claimed yet. Backs the suggestion card on the owner's Turniri tab.
     *
     * <p>Returns an empty list when the user hasn't set both name parts -
     * a no-name spectator account has nothing to match on.
     */
    @GET
    @Path("/player-suggestions")
    @Transactional
    public List<PlayerClaimSuggestionDto> playerSuggestions() {
        var profile = profileRepo.findByUid(jwt.getSubject()).orElse(null);
        String needle = suggestionNeedle(profile);
        if (needle == null) return List.of();
        return playersRepo.findUnclaimedByFoldedName(needle, PLAYER_SUGGESTION_LIMIT).stream()
                .map(claimMapper::toSuggestionDto)
                .toList();
    }

    /**
     * "To sam ja" - self-claim the team a suggested roster player belongs
     * to. Performs the SAME mutation the token-claim flow does
     * ({@link TeamClaimController}: set {@code coSubmittedByUid}, the
     * "equal participant" slot), but authorised by a server-side re-check
     * of the suggestion rule instead of token possession: the caller's
     * registered first+last name must fold-match the roster name AND the
     * team must still be unclaimed. The client-sent player id is never
     * trusted on its own.
     *
     * Conflict states:
     *   - profile has no first/last name        → 409 NAME_NOT_SET
     *   - name no longer matches the player     → 409 NAME_MISMATCH
     *   - team claimed by someone else meanwhile → 409 ALREADY_CLAIMED
     *   - viewer already holds either slot       → no-op, 200
     */
    @POST
    @Path("/player-suggestions/{playerId}/claim")
    @Transactional
    public PlayerSuggestionClaimResultDto claimPlayerSuggestion(@PathParam("playerId") Long playerId) {
        String uid = jwt.getSubject();
        var profile = profileRepo.findByUid(uid).orElse(null);
        String needle = suggestionNeedle(profile);
        if (needle == null) throw new ClientErrorException("NAME_NOT_SET", 409);

        Player player = playersRepo.findByIdOptional(playerId).orElse(null);
        if (player == null || player.isDemo()) throw new NotFoundException("Igrač nije pronađen.");

        Teams team = player.getTeam();
        Tournaments tournament = team.getTournament();
        if (team.isDemo() || team.isPendingApproval()
                || (tournament != null && tournament.isHidden())) {
            throw new NotFoundException("Igrač nije pronađen.");
        }

        if (!needle.equals(PersonNameFolder.fold(player.getName()))) {
            throw new ClientErrorException("NAME_MISMATCH", 409);
        }

        // Idempotent when the viewer already holds either submitter slot.
        if (uid.equals(team.getSubmittedByUid()) || uid.equals(team.getCoSubmittedByUid())) {
            return new PlayerSuggestionClaimResultDto(true, team.getId(), team.getName());
        }
        if (team.getSubmittedByUid() != null || team.getCoSubmittedByUid() != null) {
            throw new ClientErrorException("ALREADY_CLAIMED", 409);
        }

        team.setCoSubmittedByUid(uid);
        teamRepo.persist(team);
        return new PlayerSuggestionClaimResultDto(true, team.getId(), team.getName());
    }

    public record PlayerSuggestionClaimResultDto(boolean claimed, Long teamId, String teamName) {}

    @GET
    @Path("/profile")
    @Transactional   // touch the lazy avatar relation
    public UserProfileDto getProfile() {
        var p = profileRepo.findByUid(jwt.getSubject()).orElse(null);
        if (p == null) return new UserProfileDto(null, null, null, null, null, null, null, null, null);
        return toDto(p);
    }

    @PUT
    @Path("/profile")
    @Transactional
    public UserProfileDto updateProfile(@Valid UserProfileDto body) {
        String uid = jwt.getSubject();
        var existing = profileRepo.findByUid(uid).orElse(null);
        if (existing == null) {
            existing = new UserProfile();
            existing.setUserUid(uid);
        }
        // Theme: accept "light" or "dark" on ANY request (the color-mode toggle
        // sends ONLY colorMode). Ignore anything else (defensive vs stale clients).
        if (body.colorMode() != null) {
            String cm = body.colorMode().trim().toLowerCase();
            if ("light".equals(cm) || "dark".equals(cm)) {
                existing.setColorMode(cm);
            }
        }

        // Language: same standalone-field pattern as colorMode above - the
        // navbar language picker sends ONLY this field, and it must never be
        // wiped by an unrelated profile-settings save that omits it.
        if (body.language() != null) {
            String lang = body.language().trim().toLowerCase();
            if ("hr".equals(lang) || "en".equals(lang) || "sl".equals(lang)) {
                existing.setLanguage(lang);
            }
        }

        // A colorMode-only request (the theme toggle) must NOT wipe the fields it
        // doesn't carry. Only apply phone / name / username for a genuine profile
        // settings save (which always sends the name fields).
        boolean profileSave = body.phoneCountry() != null || body.phone() != null
                || body.firstName() != null || body.lastName() != null
                || (body.slug() != null && !body.slug().isBlank());
        if (profileSave) {
            existing.setPhoneCountry(blank(body.phoneCountry()));
            existing.setPhone(blank(body.phone()));
            // body.avatarUrl is intentionally ignored - avatars are managed via
            // the dedicated /avatar endpoints, not via PUT /profile.

            String first = blank(body.firstName());
            String last = blank(body.lastName());
            if (first != null || last != null) {
                existing.setFirstName(first);
                existing.setLastName(last);
                String dn = buildDisplayName(first, last);
                if (dn != null) existing.setDisplayName(dn);
            }

            // Username change - the DTO's `slug` field carries the desired
            // username. Normalized + unique (excluding self); changing it moves
            // the public /profil/{slug} URL, which the SPA handles by navigating.
            if (body.slug() != null && !body.slug().isBlank()) {
                String norm = slugService.normalizeUsername(body.slug());
                if (norm == null || norm.length() < SlugService.MIN_USERNAME_LENGTH) {
                    throw new BadRequestException(
                            messages.t("user.error.usernameTooShort", SlugService.MIN_USERNAME_LENGTH));
                }
                if (!norm.equals(existing.getSlug())) {
                    if (!slugService.isUsernameAvailable(norm, uid)) {
                        throw new ClientErrorException(messages.t("user.error.usernameTaken"), Response.Status.CONFLICT);
                    }
                    existing.setSlug(norm);
                }
            }
        }

        profileRepo.persist(existing);
        return toDto(existing);
    }

    /**
     * Called by the frontend on every login. Persists the Firebase displayName
     * we just got from the SDK and ensures a unique slug exists for the public
     * /profile/{slug} URL.
     *
     * Idempotent - calling repeatedly with the same name keeps the same slug.
     * We never auto-rotate the slug if displayName changes; users link-share
     * their profile, and silently shifting the URL would be worse than a
     * slightly stale one. Anyone who really wants a fresh slug can ask.
     */
    @POST
    @Path("/sync")
    @Transactional
    public UserProfileDto syncProfile(@Valid SyncProfileRequest body) {
        String uid = jwt.getSubject();
        String displayName = body == null ? null : blank(body.displayName());
        var profile = slugService.ensureProfile(uid, displayName);
        // Mirror the email from the Firebase ID token so we can send tournament
        // notifications. Managed entity → the setter flushes in this @Transactional.
        Object emailClaim = jwt.getClaim("email");
        if (emailClaim != null) {
            String email = blank(emailClaim.toString());
            if (email != null) profile.setEmail(email);
        }
        // ensureProfile returns the persisted entity with the slug guaranteed.
        return toDto(profile);
    }

    /**
     * Complete registration: set the user's chosen username (stored as the
     * slug) + first/last name. Called by the SPA right after the Firebase
     * sign-up. The username is normalized server-side and must be unique
     * (409 if taken). Idempotent for the same user re-saving their own name.
     */
    @POST
    @Path("/register-profile")
    @Transactional
    public UserProfileDto registerProfile(@Valid RegisterProfileRequest body) {
        if (body == null) throw new BadRequestException("Request body is required.");
        String uid = jwt.getSubject();
        String first = blank(body.firstName());
        String last = blank(body.lastName());

        // Chosen username → normalized slug form; fall back to first-last.
        String desired = (body.username() != null && !body.username().isBlank())
                ? slugService.normalizeUsername(body.username())
                : slugService.defaultUsername(first, last);
        if (desired == null || desired.length() < SlugService.MIN_USERNAME_LENGTH) {
            throw new BadRequestException(
                    messages.t("user.error.usernameTooShort", SlugService.MIN_USERNAME_LENGTH));
        }
        if (!slugService.isUsernameAvailable(desired, uid)) {
            throw new ClientErrorException(messages.t("user.error.usernameTaken"), Response.Status.CONFLICT);
        }

        // ensureProfile creates the row (+ an auto-slug we immediately override).
        var profile = slugService.ensureProfile(uid, buildDisplayName(first, last));
        profile.setFirstName(first);
        profile.setLastName(last);
        profile.setSlug(desired);
        Object emailClaim = jwt.getClaim("email");
        if (emailClaim != null) {
            String email = blank(emailClaim.toString());
            if (email != null) profile.setEmail(email);
        }
        profileRepo.persist(profile);
        return toDto(profile);
    }

    /**
     * Upload (or replace) the current user's avatar. Multipart form with a
     * single {@code avatar} part. The previous avatar's resource row is
     * unlinked but not deleted from MinIO - a future cleanup job can sweep
     * orphans by querying for resources with no FK referrers.
     */
    @POST
    @Path("/avatar")
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Transactional
    public UserProfileDto uploadAvatar(@RestForm("avatar") FileUpload avatar) {
        if (avatar == null || avatar.size() == 0) {
            throw new BadRequestException("Missing 'avatar' part");
        }
        String uid = jwt.getSubject();
        var profile = profileRepo.findByUid(uid).orElse(null);
        if (profile == null) {
            // First-time uploaders may not have an entity yet - make one.
            profile = new UserProfile();
            profile.setUserUid(uid);
        }
        Resources newResource = storageService.uploadAvatar(avatar);
        profile.setAvatar(newResource);
        profileRepo.persist(profile);
        return toDto(profile);
    }

    /** Remove the avatar from the current user's profile (FK set to NULL). */
    @DELETE
    @Path("/avatar")
    @Transactional
    public UserProfileDto deleteAvatar() {
        String uid = jwt.getSubject();
        var profile = profileRepo.findByUid(uid).orElse(null);
        if (profile == null) return new UserProfileDto(null, null, null, null, null);
        profile.setAvatar(null);
        profileRepo.persist(profile);
        return toDto(profile);
    }

    private static String blank(String s) {
        return (s == null || s.isBlank()) ? null : s.trim();
    }

    /**
     * The folded "ime prezime" needle for player suggestions, or null when
     * there's nothing safe to match on.
     *
     * <p>Prefers the separate first/last fields; falls back to the display
     * name for social-login accounts that never filled them in, as long as it
     * has at least two words (see
     * {@link PersonNameFolder#needleFromDisplayName(String)}).
     */
    static String suggestionNeedle(UserProfile profile) {
        if (profile == null) return null;
        String needle = PersonNameFolder.needle(profile.getFirstName(), profile.getLastName());
        if (needle != null) return needle;
        return PersonNameFolder.needleFromDisplayName(profile.getDisplayName());
    }


    /** "First Last" from the two parts, trimmed; null when both are blank. */
    private static String buildDisplayName(String first, String last) {
        String combined = ((first == null ? "" : first) + " "
                + (last == null ? "" : last)).trim();
        return combined.isBlank() ? null : combined;
    }

    /**
     * Build a UserProfileDto from an entity. Computes the proxied avatar URL
     * from the joined Resources row id; same pattern TournamentMapper uses
     * for posters. Caller must run inside an active transaction so the lazy
     * {@code avatar} association can be resolved.
     */
    private static UserProfileDto toDto(UserProfile p) {
        String avatarUrl = null;
        Resources av = p.getAvatar();
        if (av != null && av.getId() != null) {
            avatarUrl = "/api/resources/" + av.getId() + "/image";
        }
        return new UserProfileDto(
                p.getPhoneCountry(),
                p.getPhone(),
                p.getDisplayName(),
                p.getSlug(),
                avatarUrl,
                p.getColorMode(),
                p.getFirstName(),
                p.getLastName(),
                p.getLanguage());
    }

    private MyTournamentParticipationDto toDto(Teams p) {
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
