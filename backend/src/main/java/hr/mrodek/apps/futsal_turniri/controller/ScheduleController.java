package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.ReorderScheduleRequest;
import hr.mrodek.apps.futsal_turniri.dtos.ScheduleConfigRequest;
import hr.mrodek.apps.futsal_turniri.dtos.ScheduleDto;
import hr.mrodek.apps.futsal_turniri.dtos.UpdateKickoffRequest;
import hr.mrodek.apps.futsal_turniri.enums.TournamentStatus;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.repository.TournamentEditorRepository;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import hr.mrodek.apps.futsal_turniri.services.SchedulingService;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.ForbiddenException;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.PATCH;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.jwt.JsonWebToken;

/**
 * Match-scheduling endpoints for a tournament (Phase E4).
 *
 * <pre>
 *   GET   /tournaments/{uuid}/schedule                    - anonymous OK
 *   POST  /tournaments/{uuid}/schedule/generate           - owner/admin
 *   PATCH /tournaments/{uuid}/schedule/matches/{matchId}  - owner/admin
 * </pre>
 *
 * <p>Reads are public. Generate / kickoff-override require a Firebase
 * OIDC token AND the caller must be the tournament's creator or an
 * admin. Until 2026-06 these writes were left open under a "OIDC
 * temporarily disabled" comment - a security audit flagged the gap so
 * the gate is now enforced.
 */
@Path("/tournaments/{uuid}/schedule")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class ScheduleController {

    @Inject TournamentsRepository tournamentsRepo;
    @Inject SchedulingService schedulingService;
    @Inject SecurityIdentity identity;
    @Inject JsonWebToken jwt;
    @Inject TournamentEditorRepository editorRepo;

    /** Throws 403 if the current user is not an admin, the tournament's
     *  creator, or a granted co-editor.
     *
     *  <p>Additionally, once the tournament is {@link TournamentStatus#FINISHED}
     *  this choke point rejects every write with 409 {@code TOURNAMENT_FINISHED}
     *  - all schedule writes are pre-finish operations, so a blanket block is
     *  correct. Admins bypass the lock (they returned early above) so an
     *  administrator can still unlock and fix a finished tournament. */
    private Tournaments assertCanEdit(String idOrSlug) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(idOrSlug).orElse(null);
        if (t == null) throw new NotFoundException();
        boolean admin = identity != null && identity.hasRole("admin");
        if (admin) return t;
        String me = jwt != null ? jwt.getSubject() : null;
        if (me == null) {
            throw new ForbiddenException("Only the creator, a granted editor or an admin can modify this tournament.");
        }
        boolean owner = me.equals(t.getCreatedByUid());
        if (!owner && !editorRepo.isEditor(t.getId(), me)) {
            throw new ForbiddenException("Only the creator, a granted editor or an admin can modify this tournament.");
        }
        // Finished tournaments are locked for everyone but admins (bypassed above).
        if (t.getStatus() == TournamentStatus.FINISHED) {
            throw new WebApplicationException(
                    Response.status(Response.Status.CONFLICT).entity("TOURNAMENT_FINISHED").build());
        }
        return t;
    }

    /** The schedule - config + every match in play order with its kickoff. */
    @GET
    public ScheduleDto schedule(@PathParam("uuid") String uuid) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid)
                .orElseThrow(() -> new NotFoundException("Tournament not found"));
        return schedulingService.schedule(t);
    }

    /** Store the match-format config and lay out all kickoff times. */
    @POST
    @Path("/generate")
    @Authenticated
    @Transactional
    public ScheduleDto generate(@PathParam("uuid") String uuid, ScheduleConfigRequest body) {
        Tournaments t = assertCanEdit(uuid);
        schedulingService.generateSchedule(t, body);
        return schedulingService.schedule(t);
    }

    /** Predicted total match count (group + knockout), so the multi-day
     *  generate UI can show how many matches remain to schedule. Public read. */
    @GET
    @Path("/plan-info")
    public hr.mrodek.apps.futsal_turniri.dtos.SchedulePlanInfoDto planInfo(
            @PathParam("uuid") String uuid) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid)
                .orElseThrow(() -> new NotFoundException("Tournament not found"));
        return schedulingService.planInfo(t);
    }

    /** Compute (but do NOT persist) the multi-day schedule for the given day
     *  plan - the "Skiciraj" preview the organizer confirms before generating. */
    @POST
    @Path("/preview")
    @Authenticated
    public hr.mrodek.apps.futsal_turniri.dtos.SchedulePreviewDto preview(
            @PathParam("uuid") String uuid,
            hr.mrodek.apps.futsal_turniri.dtos.SchedulePlanRequest body) {
        Tournaments t = assertCanEdit(uuid);
        return schedulingService.previewMultiDay(t, body);
    }

    /** Actually generate the multi-day schedule from the confirmed day plan
     *  ("Potvrdi"): group fixtures + knockout placeholders + kickoff times. */
    @POST
    @Path("/generate-multiday")
    @Authenticated
    @Transactional
    public ScheduleDto generateMultiDay(
            @PathParam("uuid") String uuid,
            hr.mrodek.apps.futsal_turniri.dtos.SchedulePlanRequest body) {
        Tournaments t = assertCanEdit(uuid);
        schedulingService.generateMultiDay(t, body);
        return schedulingService.schedule(t);
    }

    /**
     * Fill in kickoff times for matches that don't have one yet (e.g. knockout
     * matches created after the group schedule), continuing after the last
     * scheduled match - without disturbing existing times. Re-confirm the
     * schedule once the knockout bracket is drawn.
     */
    @POST
    @Path("/confirm")
    @Authenticated
    @Transactional
    public ScheduleDto confirm(@PathParam("uuid") String uuid) {
        Tournaments t = assertCanEdit(uuid);
        schedulingService.confirmSchedule(t);
        return schedulingService.schedule(t);
    }

    /** Reorder the schedule (drag-and-drop) - keep the time slots, reassign
     *  them to the matches in the supplied new order. Owner/admin. */
    @POST
    @Path("/reorder")
    @Authenticated
    @Transactional
    public ScheduleDto reorder(@PathParam("uuid") String uuid, ReorderScheduleRequest body) {
        Tournaments t = assertCanEdit(uuid);
        schedulingService.reorderSchedule(t, body == null ? null : body.matchIds());
        return schedulingService.schedule(t);
    }

    /** Clear the laid-out schedule - wipe every kickoff time. Fixtures stay;
     *  only the slots are removed so the organizer can start over. Owner/admin. */
    @POST
    @Path("/clear")
    @Authenticated
    @Transactional
    public ScheduleDto clear(@PathParam("uuid") String uuid) {
        Tournaments t = assertCanEdit(uuid);
        schedulingService.clearSchedule(t);
        return schedulingService.schedule(t);
    }

    /** Override the kickoff time of a single match. */
    @PATCH
    @Path("/matches/{matchId}")
    @Authenticated
    @Transactional
    public ScheduleDto updateKickoff(
            @PathParam("uuid") String uuid,
            @PathParam("matchId") Long matchId,
            UpdateKickoffRequest body) {
        Tournaments t = assertCanEdit(uuid);
        schedulingService.updateKickoff(t.getId(), matchId, body.kickoffAt());
        return schedulingService.schedule(t);
    }
}
