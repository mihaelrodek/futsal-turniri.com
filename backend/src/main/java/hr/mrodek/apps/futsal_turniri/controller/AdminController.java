package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.model.UserTeamPreset;
import hr.mrodek.apps.futsal_turniri.model.UserProfile;
import hr.mrodek.apps.futsal_turniri.enums.TournamentStatus;
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
import java.util.List;

/**
 * Admin-only endpoints for the "Dashboard" tab on the profile page.
 *
 * <p>The dashboard lets an admin attach a tournament team to a registered
 * user retroactively — typically for legacy/organiser-added teams from
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

    /** Cap on user-search results — see UserProfileRepository.searchByDisplayName. */
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
                        t.getCreatedByName()))
                .toList();
        return Response.ok(dtos).build();
    }

    /** ──────────────────────────────────────────────────────────────────
     * Unclaimed teams for the selected tournament. "Unclaimed" =
     * neither submittedByUid nor coSubmittedByUid is set. Pending
     * self-registrations are excluded — they need to be approved or
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
     * admin "Popis igrača" tab — distinct from {@link #searchUsers}
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
     *   1. {@code team.submittedByUid = userUid} — this single field is
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
     * submitter slot filled) — the UI filters those out, but a parallel
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

        // Defensive — the UI hides claimed teams but a parallel admin
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
     *   - {@code createdByUid} — drives all owner-only authorisation
     *     checks ({@code canEditTournament}, team-management endpoints,
     *     the "Uredi" / "Završi turnir" / "Manualno generiraj kolo" UI
     *     gates). After this call the target user is treated exactly as
     *     if they had created the tournament themselves.
     *   - {@code createdByName} — copied from the target's UserProfile
     *     displayName so all "created by" labels in the UI match the
     *     new owner without us having to look up the profile every time
     *     the tournament is rendered.
     *
     * <p>Idempotent — transferring to the same user again is a no-op
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

    /** ──────────────────────────────────────────────────────────────────
     * Feature a tournament as the "tournament of the day" — surfaces it
     * in the daily hero on /uzivo. Idempotent: calling it on an already-
     * featured tournament just refreshes the timestamp (effectively
     * "bumping" it back to the top of any future ordering decisions).
     *
     * <p>Selection rule on the public lookup is "most-recently featured
     * row that hasn't finished yet". So clearing the feature is a DELETE
     * on the same URL — see {@link #unfeatureTournament}.
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

    /** Inverse of {@link #featureTournament} — clears the feature flag. */
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
     * from every public read (lists, details, sitemap, live, previews) —
     * only its creator and admins still see it (greyed out in the SPA) and
     * can open/edit it. Works for upcoming AND finished tournaments.
     * Reversible — see {@link #unhideTournament}.
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

    /** Inverse of {@link #hideTournament} — makes the tournament public again. */
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
     * which gates on business rules (INSUFFICIENT_TEAMS, etc.) — this
     * bypasses every rule and writes the requested status verbatim.
     * Use only from the admin dashboard for legacy / stuck tournaments
     * where the normal flow can't recover.
     *
     * <p>Accepts: {@code DRAFT}, {@code STARTED}, {@code FINISHED}.
     * Returns 400 for anything else. Does NOT touch winner / podium
     * fields — those have their own dedicated endpoints.
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
                                     String createdByUid, String createdByName) {}

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
