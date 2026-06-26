package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.DrawRequest;
import hr.mrodek.apps.futsal_turniri.dtos.GroupDto;
import hr.mrodek.apps.futsal_turniri.dtos.GroupReorderRequest;
import hr.mrodek.apps.futsal_turniri.dtos.GroupResultRequest;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import hr.mrodek.apps.futsal_turniri.services.GroupStageService;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.ForbiddenException;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.jwt.JsonWebToken;

import java.util.List;

/**
 * Group-stage endpoints for a tournament (Phase E2).
 *
 * <pre>
 *   GET  /tournaments/{uuid}/groups                      — group tables (live)
 *   POST /tournaments/{uuid}/groups/draw                 — owner/admin only
 *   POST /tournaments/{uuid}/groups/matches/{id}/result  — owner/admin only
 * </pre>
 *
 * <p>Reads are public so anonymous viewers see standings. Every write
 * requires a Firebase OIDC token AND the caller must be either the
 * tournament's creator or an admin — same pattern as
 * {@link RoundController}. Until 2026-06 these writes were left open
 * "because Firebase OIDC is temporarily disabled"; OIDC has been on for
 * a while now so this was an active access-control gap.
 */
@Path("/tournaments/{uuid}/groups")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class GroupController {

    @Inject TournamentsRepository tournamentsRepo;
    @Inject GroupStageService groupStageService;
    @Inject SecurityIdentity identity;
    @Inject JsonWebToken jwt;
    @Inject hr.mrodek.apps.futsal_turniri.realtime.LiveBroadcaster liveBroadcaster;

    /** Throws 403 if the current user is neither the tournament's creator
     *  nor an admin. Mirrors {@link RoundController#assertCanEdit}. */
    private Tournaments assertCanEdit(String idOrSlug) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(idOrSlug).orElse(null);
        if (t == null) throw new NotFoundException();
        boolean admin = identity != null && identity.hasRole("admin");
        if (admin) return t;
        String me = jwt != null ? jwt.getSubject() : null;
        boolean owner = me != null && me.equals(t.getCreatedByUid());
        if (!owner) {
            throw new ForbiddenException("Only the creator or an admin can modify this tournament.");
        }
        return t;
    }

    /** Live group tables for the tournament. Empty list before the draw. */
    @GET
    public List<GroupDto> listGroups(@PathParam("uuid") String uuid) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid)
                .orElseThrow(() -> new NotFoundException("Tournament not found"));
        return groupStageService.standings(t.getId());
    }

    /** Draw teams into groups and generate the round-robin fixtures. */
    @POST
    @Path("/draw")
    @Authenticated
    @Transactional
    public List<GroupDto> draw(@PathParam("uuid") String uuid, DrawRequest body) {
        Tournaments t = assertCanEdit(uuid);
        groupStageService.draw(t, body);
        return groupStageService.standings(t.getId());
    }

    /** Wipe the group stage (all group matches + the draw). Owner/admin. */
    @POST
    @Path("/reset")
    @Authenticated
    @Transactional
    public List<GroupDto> reset(@PathParam("uuid") String uuid) {
        Tournaments t = assertCanEdit(uuid);
        groupStageService.resetGroups(t);
        return groupStageService.standings(t.getId());
    }

    /** Record a group-match result (a draw is allowed). */
    @POST
    @Path("/matches/{matchId}/result")
    @Authenticated
    @Transactional
    public List<GroupDto> recordResult(
            @PathParam("uuid") String uuid,
            @PathParam("matchId") Long matchId,
            GroupResultRequest body) {
        Tournaments t = assertCanEdit(uuid);
        groupStageService.recordGroupResult(matchId, body.score1(), body.score2());
        if (t.getUuid() != null) liveBroadcaster.liveUpdate(t.getUuid().toString(), matchId);
        return groupStageService.standings(t.getId());
    }

    /** Manually reorder a finished group's standings (tiebreaker override). */
    @POST
    @Path("/{groupId}/reorder")
    @Authenticated
    @Transactional
    public List<GroupDto> reorder(
            @PathParam("uuid") String uuid,
            @PathParam("groupId") Long groupId,
            GroupReorderRequest body) {
        Tournaments t = assertCanEdit(uuid);
        groupStageService.reorderGroup(groupId, body.teamIds());
        return groupStageService.standings(t.getId());
    }
}
