package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.model.Groups;
import hr.mrodek.apps.futsal_turniri.model.MatchEvent;
import hr.mrodek.apps.futsal_turniri.model.Matches;
import hr.mrodek.apps.futsal_turniri.model.Player;
import hr.mrodek.apps.futsal_turniri.model.Rounds;
import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.model.TournamentEditor;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.model.UserTeamPreset;
import hr.mrodek.apps.futsal_turniri.model.UserProfile;
import hr.mrodek.apps.futsal_turniri.enums.BracketFill;
import hr.mrodek.apps.futsal_turniri.enums.MatchEventType;
import hr.mrodek.apps.futsal_turniri.enums.MatchLiveMode;
import hr.mrodek.apps.futsal_turniri.enums.MatchStage;
import hr.mrodek.apps.futsal_turniri.enums.MatchStatus;
import hr.mrodek.apps.futsal_turniri.enums.RewardType;
import hr.mrodek.apps.futsal_turniri.enums.RoundStatus;
import hr.mrodek.apps.futsal_turniri.enums.ScorerScope;
import hr.mrodek.apps.futsal_turniri.enums.Surface;
import hr.mrodek.apps.futsal_turniri.enums.TournamentFormat;
import hr.mrodek.apps.futsal_turniri.enums.TournamentStatus;
import hr.mrodek.apps.futsal_turniri.services.TournamentSlugService;
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
import org.eclipse.microprofile.jwt.JsonWebToken;

import java.math.BigDecimal;
import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.HashMap;
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
    @Inject TournamentSlugService tournamentSlugService;
    @Inject JsonWebToken jwt;

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

    /* ──────────────────────────────────────────────────────────────────
     * Deletion requests (two-step delete). An organizer's "Obriši" only
     * ARCHIVES the tournament (archived_at + reason + requester); final
     * deletion is this admin surface's call. Confirm = flip the existing
     * is_deleted soft-delete flag + stamp deleted_at (never a hard DELETE);
     * restore = clear the request fields so the tournament is public again.
     * ────────────────────────────────────────────────────────────────── */

    /** Pending deletion requests, newest first. Already-confirmed rows are
     *  excluded automatically by the entity's {@code @Where} soft-delete. */
    @GET
    @Path("/tournaments/delete-requests")
    public Response listDeleteRequests() {
        List<DeleteRequestDto> dtos = tournamentsRepo.findPendingDeleteRequests().stream()
                .map(t -> new DeleteRequestDto(
                        t.getId(),
                        t.getUuid() != null ? t.getUuid().toString() : null,
                        t.getSlug(),
                        t.getName(),
                        t.getDeleteRequestedByUid(),
                        t.getDeleteRequestedByName(),
                        t.getDeleteReason(),
                        t.getArchivedAt()))
                .toList();
        return Response.ok(dtos).build();
    }

    /** Finalize a pending deletion request - soft delete, never a hard one. */
    @POST
    @Path("/tournaments/{uuid}/delete-confirm")
    @Transactional
    public Response confirmDelete(@PathParam("uuid") String uuid) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) {
            return Response.status(Response.Status.NOT_FOUND)
                    .entity("TOURNAMENT_NOT_FOUND").build();
        }
        OffsetDateTime now = OffsetDateTime.now();
        // Direct admin confirm on a non-archived tournament still archives it
        // first, so archived_at always brackets the deletion timeline.
        if (t.getArchivedAt() == null) t.setArchivedAt(now);
        t.setDeleted(true);
        t.setDeletedAt(now);
        t.setFeaturedAt(null);
        tournamentsRepo.persist(t);
        return Response.noContent().build();
    }

    /** Reject a deletion request: clears archived_at + the request fields,
     *  so the tournament reappears in the public listings ("Vrati"). */
    @POST
    @Path("/tournaments/{uuid}/delete-restore")
    @Transactional
    public Response restoreFromDeleteRequest(@PathParam("uuid") String uuid) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) {
            return Response.status(Response.Status.NOT_FOUND)
                    .entity("TOURNAMENT_NOT_FOUND").build();
        }
        t.setArchivedAt(null);
        t.setDeleteReason(null);
        t.setDeleteRequestedByUid(null);
        t.setDeleteRequestedByName(null);
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
                pm.put("goalkeeper", p.isGoalkeeper());
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
            m.put("knockoutCode", mt.getKnockoutCode());
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
                em.put("penalty", ev.isPenalty());
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
        m.put("surface", t.getSurface() != null ? t.getSurface().name() : null);
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

    /** ──────────────────────────────────────────────────────────────────
     * Import a tournament from the JSON produced by
     * {@link #exportTournament} - the exact inverse: a round trip
     * (export → import) yields an equivalent tournament under a NEW
     * identity.
     *
     * <p>Rules:
     *   - ALWAYS creates a new tournament. The file's id/uuid/slug are
     *     informational only - a fresh uuid is generated ({@code @PrePersist})
     *     and a fresh unique slug is derived from name + startAt, so importing
     *     the same file twice yields two independent tournaments and never
     *     overwrites an existing one.
     *   - The importing admin becomes owner ({@code createdByUid/Name}).
     *   - Every FK in the file (group/team/player/round/match ids) is
     *     remapped in memory: old id → freshly persisted entity. A reference
     *     to an id that isn't in the file is a 400.
     *   - Two-phase: the whole tree is parsed/validated and persisted inside
     *     ONE transaction; any 400 thrown mid-way rolls everything back, so a
     *     half-imported tournament can never remain.
     *   - Non-recreatable bits are skipped with a warning in the response:
     *     the poster resource (binary lives in MinIO, not in the JSON) and
     *     editor grants whose user doesn't exist in this database.
     *     {@code featuredAt} is deliberately dropped (admin curation, and two
     *     "featured" copies would fight over the daily hero); created/updated
     *     timestamps are re-stamped by Hibernate.
     *   - Matches are inserted in the file's order (export sorts by old id),
     *     so relative id order - which the frontend's knockout-code
     *     derivation ({@code indexInStage}) depends on - is preserved.
     * ──────────────────────────────────────────────────────────────── */
    @POST
    @Path("/tournaments/import")
    @Transactional
    public Response importTournament(Map<String, Object> body) {
        if (body == null || body.isEmpty()) {
            throw badImport("Neispravan uvoz: JSON je prazan.");
        }
        List<String> warnings = new ArrayList<>();

        /* ── tournament scalar fields ── */
        Map<String, Object> tj = impObj(body.get("tournament"), "tournament");
        String name = impString(tj, "name");
        if (name == null || name.isBlank()) {
            throw badImport("Neispravan uvoz: 'tournament.name' nedostaje.");
        }

        Tournaments t = new Tournaments();
        t.setName(name.trim());
        t.setLocation(impString(tj, "location"));
        t.setDetails(impString(tj, "details"));
        t.setStartAt(impTime(tj, "startAt", "tournament.startAt"));
        TournamentStatus status = impEnum(TournamentStatus.class, tj, "status", "tournament.status");
        t.setStatus(status != null ? status : TournamentStatus.DRAFT);
        t.setMaxTeams(impInt(tj, "maxTeams", "tournament.maxTeams"));
        TournamentFormat format = impEnum(TournamentFormat.class, tj, "format", "tournament.format");
        t.setFormat(format != null ? format : TournamentFormat.GROUPS_KNOCKOUT);
        t.setGroupCount(impInt(tj, "groupCount", "tournament.groupCount"));
        t.setAdvancePerGroup(impInt(tj, "advancePerGroup", "tournament.advancePerGroup"));
        Integer bestThird = impInt(tj, "bestThirdCount", "tournament.bestThirdCount");
        t.setBestThirdCount(bestThird != null ? bestThird : 0);
        t.setBracketFill(impEnum(BracketFill.class, tj, "bracketFill", "tournament.bracketFill"));
        t.setBracketConfirmedAt(impTime(tj, "bracketConfirmedAt", "tournament.bracketConfirmedAt"));
        t.setHalfCount(impInt(tj, "halfCount", "tournament.halfCount"));
        t.setHalfLengthMin(impInt(tj, "halfLengthMin", "tournament.halfLengthMin"));
        t.setHalftimeBreakMin(impInt(tj, "halftimeBreakMin", "tournament.halftimeBreakMin"));
        t.setKoHalfLengthMin(impInt(tj, "koHalfLengthMin", "tournament.koHalfLengthMin"));
        t.setKoHalftimeBreakMin(impInt(tj, "koHalftimeBreakMin", "tournament.koHalftimeBreakMin"));
        t.setBreakBetweenMatchesMin(impInt(tj, "breakBetweenMatchesMin", "tournament.breakBetweenMatchesMin"));
        t.setKoBreakBetweenMatchesMin(impInt(tj, "koBreakBetweenMatchesMin", "tournament.koBreakBetweenMatchesMin"));
        t.setBufferMin(impInt(tj, "bufferMin", "tournament.bufferMin"));
        BigDecimal entryPrice = impDecimal(tj, "entryPrice", "tournament.entryPrice");
        t.setEntryPrice(entryPrice != null ? entryPrice : BigDecimal.ZERO);
        t.setContactName(impString(tj, "contactName"));
        t.setContactPhone(impString(tj, "contactPhone"));
        t.setGameSystem(impString(tj, "gameSystem"));
        Surface surface = impEnum(Surface.class, tj, "surface", "tournament.surface");
        t.setSurface(surface != null ? surface : Surface.ASFALT);
        t.setWebsiteUrl(impString(tj, "websiteUrl"));
        t.setOrganizerName(impString(tj, "organizerName"));
        t.setRewardType(impEnum(RewardType.class, tj, "rewardType", "tournament.rewardType"));
        t.setRewardFirst(impDecimal(tj, "rewardFirst", "tournament.rewardFirst"));
        t.setRewardFirstNote(impString(tj, "rewardFirstNote"));
        t.setRewardSecond(impDecimal(tj, "rewardSecond", "tournament.rewardSecond"));
        t.setRewardSecondNote(impString(tj, "rewardSecondNote"));
        t.setRewardThird(impDecimal(tj, "rewardThird", "tournament.rewardThird"));
        t.setRewardThirdNote(impString(tj, "rewardThirdNote"));
        t.setRewardFourth(impDecimal(tj, "rewardFourth", "tournament.rewardFourth"));
        t.setRewardFourthNote(impString(tj, "rewardFourthNote"));
        t.setWinnerName(impString(tj, "winnerName"));
        t.setSecondPlaceName(impString(tj, "secondPlaceName"));
        t.setThirdPlaceName(impString(tj, "thirdPlaceName"));
        t.setBestGoalkeeperName(impString(tj, "bestGoalkeeperName"));
        t.setBestPlayerName(impString(tj, "bestPlayerName"));
        t.setBestScorerName(impString(tj, "bestScorerName"));
        t.setLatitude(impDouble(tj, "latitude", "tournament.latitude"));
        t.setLongitude(impDouble(tj, "longitude", "tournament.longitude"));
        t.setGeocodedAt(impTime(tj, "geocodedAt", "tournament.geocodedAt"));
        Boolean hidden = impBool(tj, "hidden", "tournament.hidden");
        t.setHidden(Boolean.TRUE.equals(hidden));
        ScorerScope scorerScope = impEnum(ScorerScope.class, tj, "scorerScope", "tournament.scorerScope");
        t.setScorerScope(scorerScope != null ? scorerScope : ScorerScope.KNOCKOUT);
        // featuredAt deliberately NOT copied - admin curation, not tournament data.

        // The poster lives as a binary in MinIO under a Resources row of the
        // SOURCE database - a bare id in the JSON can't recreate it here.
        if (tj.get("posterResourceId") != null) {
            warnings.add("Plakat turnira nije prenesen - slika se ne može rekreirati iz JSON-a.");
        }

        // The importing admin becomes the owner; ownership can be handed to
        // the real organiser afterwards via the existing transfer action.
        String adminUid = jwt != null ? jwt.getSubject() : null;
        t.setCreatedByUid(adminUid);
        t.setCreatedByName(adminDisplayNameFromJwt());

        // Fresh unique slug from name + startAt; uuid comes from @PrePersist.
        t.setSlug(tournamentSlugService.generateUnique(t, null));
        tournamentsRepo.persist(t);

        /* ── groups ── */
        Map<Long, Groups> groupByOldId = new HashMap<>();
        int groupCount = 0;
        for (Object o : impList(body, "groups")) {
            Map<String, Object> gm = impObj(o, "groups[" + groupCount + "]");
            String gName = impString(gm, "name");
            if (gName == null || gName.isBlank()) {
                throw badImport("Neispravan uvoz: 'groups[" + groupCount + "].name' nedostaje.");
            }
            Groups g = new Groups();
            g.setTournament(t);
            g.setName(gName.trim());
            Integer ordinal = impInt(gm, "ordinal", "groups[" + groupCount + "].ordinal");
            g.setOrdinal(ordinal != null ? ordinal : groupCount);
            g.setAdvanceCount(impInt(gm, "advanceCount", "groups[" + groupCount + "].advanceCount"));
            groupsRepo.persist(g);
            Long oldId = impLong(gm, "id", "groups[" + groupCount + "].id");
            if (oldId != null) groupByOldId.put(oldId, g);
            groupCount++;
        }

        /* ── teams + rosters ── */
        Map<Long, Teams> teamByOldId = new HashMap<>();
        Map<Long, Player> playerByOldId = new HashMap<>();
        int teamCount = 0, playerCount = 0;
        for (Object o : impList(body, "teams")) {
            Map<String, Object> tm = impObj(o, "teams[" + teamCount + "]");
            String teamName = impString(tm, "name");
            if (teamName == null || teamName.isBlank()) {
                throw badImport("Neispravan uvoz: 'teams[" + teamCount + "].name' nedostaje.");
            }
            Teams team = new Teams();
            team.setTournament(t);
            team.setName(teamName.trim());
            Long oldGroupId = impLong(tm, "groupId", "teams[" + teamCount + "].groupId");
            if (oldGroupId != null) {
                Groups g = groupByOldId.get(oldGroupId);
                if (g == null) {
                    throw badImport("Neispravan uvoz: ekipa „" + teamName
                            + "“ referencira nepoznatu grupu (id " + oldGroupId + ").");
                }
                team.setGroup(g);
            }
            team.setDrawPosition(impInt(tm, "drawPosition", "teams[" + teamCount + "].drawPosition"));
            team.setManualRank(impInt(tm, "manualRank", "teams[" + teamCount + "].manualRank"));
            team.setJerseyColor(impString(tm, "jerseyColor"));
            team.setShortsColor(impString(tm, "shortsColor"));
            team.setEliminated(Boolean.TRUE.equals(impBool(tm, "eliminated", "teams[" + teamCount + "].eliminated")));
            team.setPendingApproval(Boolean.TRUE.equals(impBool(tm, "pendingApproval", "teams[" + teamCount + "].pendingApproval")));
            team.setSubmittedByUid(impString(tm, "submittedByUid"));
            team.setCoSubmittedByUid(impString(tm, "coSubmittedByUid"));
            // Fresh token - the source database's claim links must not work here.
            team.setClaimToken(generateClaimToken());
            teamsRepo.persist(team);
            Long oldTeamId = impLong(tm, "id", "teams[" + teamCount + "].id");
            if (oldTeamId != null) teamByOldId.put(oldTeamId, team);

            int pi = 0;
            for (Object po : impList(tm, "players")) {
                Map<String, Object> pm = impObj(po, "teams[" + teamCount + "].players[" + pi + "]");
                String pName = impString(pm, "name");
                if (pName == null || pName.isBlank()) {
                    throw badImport("Neispravan uvoz: 'teams[" + teamCount + "].players[" + pi + "].name' nedostaje.");
                }
                Player p = new Player();
                p.setTeam(team);
                p.setName(pName.trim());
                p.setNumber(impInt(pm, "number", "players.number"));
                p.setCaptain(Boolean.TRUE.equals(impBool(pm, "captain", "players.captain")));
                // Absent in a dump taken before the flag existed - defaults to false.
                p.setGoalkeeper(Boolean.TRUE.equals(impBool(pm, "goalkeeper", "players.goalkeeper")));
                p.setSortOrder(impInt(pm, "sortOrder", "players.sortOrder"));
                playersRepo.persist(p);
                Long oldPlayerId = impLong(pm, "id", "players.id");
                if (oldPlayerId != null) playerByOldId.put(oldPlayerId, p);
                pi++;
                playerCount++;
            }
            teamCount++;
        }

        /* ── rounds ── */
        Map<Long, Rounds> roundByOldId = new HashMap<>();
        int roundCount = 0;
        for (Object o : impList(body, "rounds")) {
            Map<String, Object> rm = impObj(o, "rounds[" + roundCount + "]");
            Integer number = impInt(rm, "number", "rounds[" + roundCount + "].number");
            if (number == null) {
                throw badImport("Neispravan uvoz: 'rounds[" + roundCount + "].number' nedostaje.");
            }
            Rounds r = new Rounds();
            r.setTournament(t);
            r.setNumber(number);
            RoundStatus rs = impEnum(RoundStatus.class, rm, "status", "rounds[" + roundCount + "].status");
            r.setStatus(rs != null ? rs : RoundStatus.IN_PROGRESS);
            r.setLockedAt(impTime(rm, "lockedAt", "rounds[" + roundCount + "].lockedAt"));
            r.setCompletedAt(impTime(rm, "completedAt", "rounds[" + roundCount + "].completedAt"));
            roundsRepo.persist(r);
            Long oldId = impLong(rm, "id", "rounds[" + roundCount + "].id");
            if (oldId != null) roundByOldId.put(oldId, r);
            roundCount++;
        }

        /* ── matches, pass 1: everything except the nextMatch link ──
           nextMatchId may point FORWARD to a match that appears later in the
           file, so the bracket linkage is resolved in a second pass once
           every match exists in the old-id map. Insertion follows the file
           order (export sorts by old id) so relative id order - which the
           frontend's knockout-code derivation depends on - is preserved. */
        Map<Long, Matches> matchByOldId = new HashMap<>();
        Map<Matches, Long> pendingNextByMatch = new LinkedHashMap<>();
        int matchCount = 0, eventCount = 0;
        for (Object o : impList(body, "matches")) {
            String ctx = "matches[" + matchCount + "]";
            Map<String, Object> mm = impObj(o, ctx);
            Matches match = new Matches();
            match.setTournament(t);

            Long oldRoundId = impLong(mm, "roundId", ctx + ".roundId");
            Rounds round = oldRoundId != null ? roundByOldId.get(oldRoundId) : null;
            if (round == null) {
                throw badImport("Neispravan uvoz: " + ctx + " referencira nepoznato kolo (id " + oldRoundId + ").");
            }
            match.setRound(round);

            MatchStage stage = impEnum(MatchStage.class, mm, "stage", ctx + ".stage");
            match.setStage(stage != null ? stage : MatchStage.GROUP);
            match.setKnockoutCode(impString(mm, "knockoutCode"));

            Long oldGroupId = impLong(mm, "groupId", ctx + ".groupId");
            if (oldGroupId != null) {
                Groups g = groupByOldId.get(oldGroupId);
                if (g == null) {
                    throw badImport("Neispravan uvoz: " + ctx + " referencira nepoznatu grupu (id " + oldGroupId + ").");
                }
                match.setGroup(g);
            }

            match.setTableNo(impInt(mm, "tableNo", ctx + ".tableNo"));
            match.setKickoffAt(impTime(mm, "kickoffAt", ctx + ".kickoffAt"));
            match.setTeam1(resolveTeamRef(teamByOldId, impLong(mm, "team1Id", ctx + ".team1Id"), ctx + ".team1Id"));
            match.setTeam2(resolveTeamRef(teamByOldId, impLong(mm, "team2Id", ctx + ".team2Id"), ctx + ".team2Id"));
            match.setScore1(impInt(mm, "score1", ctx + ".score1"));
            match.setScore2(impInt(mm, "score2", ctx + ".score2"));
            match.setPenalties1(impInt(mm, "penalties1", ctx + ".penalties1"));
            match.setPenalties2(impInt(mm, "penalties2", ctx + ".penalties2"));
            match.setWinnerTeam(resolveTeamRef(teamByOldId, impLong(mm, "winnerTeamId", ctx + ".winnerTeamId"), ctx + ".winnerTeamId"));
            match.setNextSlot(impInt(mm, "nextSlot", ctx + ".nextSlot"));
            match.setSlot1Source(impString(mm, "slot1Source"));
            match.setSlot2Source(impString(mm, "slot2Source"));
            match.setFouls1First(impInt(mm, "fouls1First", ctx + ".fouls1First"));
            match.setFouls1Second(impInt(mm, "fouls1Second", ctx + ".fouls1Second"));
            match.setFouls2First(impInt(mm, "fouls2First", ctx + ".fouls2First"));
            match.setFouls2Second(impInt(mm, "fouls2Second", ctx + ".fouls2Second"));
            MatchStatus ms = impEnum(MatchStatus.class, mm, "status", ctx + ".status");
            match.setStatus(ms != null ? ms : MatchStatus.SCHEDULED);
            match.setLiveMode(impEnum(MatchLiveMode.class, mm, "liveMode", ctx + ".liveMode"));
            match.setLiveStartedAt(impTime(mm, "liveStartedAt", ctx + ".liveStartedAt"));
            match.setFirstHalfEndedAt(impTime(mm, "firstHalfEndedAt", ctx + ".firstHalfEndedAt"));
            match.setSecondHalfStartedAt(impTime(mm, "secondHalfStartedAt", ctx + ".secondHalfStartedAt"));
            match.setLivePausedAt(impTime(mm, "livePausedAt", ctx + ".livePausedAt"));
            matchesRepo.persist(match);

            Long oldMatchId = impLong(mm, "id", ctx + ".id");
            if (oldMatchId != null) matchByOldId.put(oldMatchId, match);
            Long oldNextId = impLong(mm, "nextMatchId", ctx + ".nextMatchId");
            if (oldNextId != null) pendingNextByMatch.put(match, oldNextId);

            /* ── events of this match ── */
            int ei = 0;
            for (Object eo : impList(mm, "events")) {
                String ectx = ctx + ".events[" + ei + "]";
                Map<String, Object> em = impObj(eo, ectx);
                MatchEventType type = impEnum(MatchEventType.class, em, "type", ectx + ".type");
                if (type == null) {
                    throw badImport("Neispravan uvoz: '" + ectx + ".type' nedostaje.");
                }
                Integer minute = impInt(em, "minute", ectx + ".minute");
                if (minute == null) {
                    throw badImport("Neispravan uvoz: '" + ectx + ".minute' nedostaje.");
                }
                MatchEvent ev = new MatchEvent();
                ev.setMatch(match);
                ev.setType(type);
                ev.setMinute(minute);
                Long oldPlayerId = impLong(em, "playerId", ectx + ".playerId");
                if (oldPlayerId != null) {
                    Player p = playerByOldId.get(oldPlayerId);
                    if (p == null) {
                        throw badImport("Neispravan uvoz: " + ectx + " referencira nepoznatog igrača (id " + oldPlayerId + ").");
                    }
                    ev.setPlayer(p);
                } else {
                    // Export writes teamId for every event (derived from the
                    // player when one is set); the entity contract stores the
                    // explicit team ONLY for unattributed events.
                    Long oldTeamId = impLong(em, "teamId", ectx + ".teamId");
                    ev.setTeam(resolveTeamRef(teamByOldId, oldTeamId, ectx + ".teamId"));
                }
                Long oldAssistId = impLong(em, "assistPlayerId", ectx + ".assistPlayerId");
                if (oldAssistId != null) {
                    Player ap = playerByOldId.get(oldAssistId);
                    if (ap == null) {
                        throw badImport("Neispravan uvoz: " + ectx + " referencira nepoznatog asistenta (id " + oldAssistId + ").");
                    }
                    ev.setAssistPlayer(ap);
                }
                // Absent in files exported before the in-game-penalty flag
                // existed - default false, exactly what those rows had.
                ev.setPenalty(Boolean.TRUE.equals(impBool(em, "penalty", ectx + ".penalty")));
                matchEventRepo.persist(ev);
                ei++;
                eventCount++;
            }
            matchCount++;
        }

        /* ── matches, pass 2: bracket linkage ── */
        for (Map.Entry<Matches, Long> e : pendingNextByMatch.entrySet()) {
            Matches next = matchByOldId.get(e.getValue());
            if (next == null) {
                throw badImport("Neispravan uvoz: utakmica referencira nepoznatu sljedeću utakmicu (id " + e.getValue() + ").");
            }
            e.getKey().setNextMatch(next);
        }

        /* ── editor grants - only for users that exist in THIS database ── */
        int editorCount = 0;
        int edIdx = 0;
        for (Object o : impList(body, "editors")) {
            Map<String, Object> em = impObj(o, "editors[" + edIdx + "]");
            edIdx++;
            String uid = impString(em, "userUid");
            if (uid == null || uid.isBlank() || uid.equals(adminUid)) continue;
            if (profileRepo.findByUid(uid).isPresent()) {
                if (!editorRepo.isEditor(t.getId(), uid)) {
                    editorRepo.persist(new TournamentEditor(t, uid));
                    editorCount++;
                }
            } else {
                String label = impString(em, "displayName");
                warnings.add("Urednik " + (label != null && !label.isBlank() ? "„" + label + "“" : uid)
                        + " nije prenesen - korisnik ne postoji u ovoj bazi.");
            }
        }

        Map<String, Integer> counts = new LinkedHashMap<>();
        counts.put("groups", groupCount);
        counts.put("teams", teamCount);
        counts.put("players", playerCount);
        counts.put("rounds", roundCount);
        counts.put("matches", matchCount);
        counts.put("events", eventCount);
        counts.put("editors", editorCount);

        return Response.status(Response.Status.CREATED)
                .entity(new ImportTournamentResponse(
                        true,
                        t.getId(),
                        t.getUuid() != null ? t.getUuid().toString() : null,
                        t.getSlug(),
                        t.getName(),
                        warnings,
                        counts))
                .build();
    }

    /* ─────────────────── import parsing helpers ───────────────────
       The export payload is consumed as a raw Map tree (never bound to the
       entities - the relations are recursive and every FK must be remapped),
       so each scalar goes through one of these defensive converters. A type
       mismatch or unparseable value throws a 400 naming the exact field;
       @Transactional then rolls the whole import back. */

    /** 400 with a plain-text Croatian message - shown verbatim in the admin UI toast. */
    private static WebApplicationException badImport(String message) {
        return new WebApplicationException(
                Response.status(Response.Status.BAD_REQUEST)
                        .type(MediaType.TEXT_PLAIN)
                        .entity(message)
                        .build());
    }

    @SuppressWarnings("unchecked")
    private static Map<String, Object> impObj(Object v, String what) {
        if (!(v instanceof Map)) {
            throw badImport("Neispravan uvoz: sekcija '" + what + "' nedostaje ili nije objekt.");
        }
        return (Map<String, Object>) v;
    }

    /** Section list: absent → empty; present but not a list → 400. */
    private static List<?> impList(Map<String, Object> m, String key) {
        Object v = m.get(key);
        if (v == null) return List.of();
        if (!(v instanceof List<?> list)) {
            throw badImport("Neispravan uvoz: sekcija '" + key + "' nije lista.");
        }
        return list;
    }

    private static String impString(Map<String, Object> m, String key) {
        Object v = m.get(key);
        if (v == null) return null;
        if (v instanceof String s) return s;
        throw badImport("Neispravan uvoz: polje '" + key + "' nije tekst.");
    }

    private static Long impLong(Map<String, Object> m, String key, String ctx) {
        Object v = m.get(key);
        if (v == null) return null;
        if (v instanceof Number n) return n.longValue();
        throw badImport("Neispravan uvoz: polje '" + ctx + "' nije broj.");
    }

    private static Integer impInt(Map<String, Object> m, String key, String ctx) {
        Object v = m.get(key);
        if (v == null) return null;
        if (v instanceof Number n) return n.intValue();
        throw badImport("Neispravan uvoz: polje '" + ctx + "' nije broj.");
    }

    private static Double impDouble(Map<String, Object> m, String key, String ctx) {
        Object v = m.get(key);
        if (v == null) return null;
        if (v instanceof Number n) return n.doubleValue();
        throw badImport("Neispravan uvoz: polje '" + ctx + "' nije broj.");
    }

    private static BigDecimal impDecimal(Map<String, Object> m, String key, String ctx) {
        Object v = m.get(key);
        if (v == null) return null;
        if (v instanceof BigDecimal bd) return bd;
        if (v instanceof Number || v instanceof String) {
            try {
                return new BigDecimal(v.toString());
            } catch (NumberFormatException ignored) {
                // falls through to the 400 below
            }
        }
        throw badImport("Neispravan uvoz: polje '" + ctx + "' nije ispravan iznos.");
    }

    private static Boolean impBool(Map<String, Object> m, String key, String ctx) {
        Object v = m.get(key);
        if (v == null) return null;
        if (v instanceof Boolean b) return b;
        throw badImport("Neispravan uvoz: polje '" + ctx + "' nije true/false.");
    }

    private static OffsetDateTime impTime(Map<String, Object> m, String key, String ctx) {
        Object v = m.get(key);
        if (v == null) return null;
        if (v instanceof String s && !s.isBlank()) {
            try {
                return OffsetDateTime.parse(s);
            } catch (DateTimeParseException ignored) {
                // falls through to the 400 below
            }
        }
        throw badImport("Neispravan uvoz: polje '" + ctx + "' nije ispravan datum/vrijeme.");
    }

    private static <E extends Enum<E>> E impEnum(Class<E> type, Map<String, Object> m, String key, String ctx) {
        String s = impString(m, key);
        if (s == null || s.isBlank()) return null;
        try {
            return Enum.valueOf(type, s.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw badImport("Neispravan uvoz: polje '" + ctx + "' ima nepoznatu vrijednost '" + s + "'.");
        }
    }

    /** Old team id → new entity; null id → null; unknown id → 400. */
    private static Teams resolveTeamRef(Map<Long, Teams> teamByOldId, Long oldId, String ctx) {
        if (oldId == null) return null;
        Teams team = teamByOldId.get(oldId);
        if (team == null) {
            throw badImport("Neispravan uvoz: " + ctx + " referencira nepoznatu ekipu (id " + oldId + ").");
        }
        return team;
    }

    /** Importing admin's display name from the verified ID token - the
     *  {@code name} claim, falling back to {@code email}, else null.
     *  Mirrors TournamentController.stampCreator. */
    private String adminDisplayNameFromJwt() {
        if (jwt == null || jwt.getRawToken() == null) return null;
        Object name = jwt.getClaim("name");
        if (name != null) return name.toString();
        Object email = jwt.getClaim("email");
        return email != null ? email.toString() : null;
    }

    /** Result of a successful import: the new tournament's identity, what was
     *  created, and human-readable warnings for skipped bits (poster, missing
     *  editor users). */
    public record ImportTournamentResponse(boolean imported, Long tournamentId,
                                           String uuid, String slug, String name,
                                           List<String> warnings,
                                           Map<String, Integer> counts) {}

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

    /** One pending deletion request row for the admin dashboard. */
    public record DeleteRequestDto(Long tournamentId, String uuid, String slug,
                                   String name, String requestedByUid,
                                   String requestedByName, String reason,
                                   OffsetDateTime requestedAt) {}
}
