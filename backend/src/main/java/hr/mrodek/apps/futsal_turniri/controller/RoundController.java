package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.ManualRoundRequest;
import hr.mrodek.apps.futsal_turniri.dtos.MatchDto;
import hr.mrodek.apps.futsal_turniri.dtos.RoundDto;
import hr.mrodek.apps.futsal_turniri.dtos.UpdateMatchRequest;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.repository.TournamentEditorRepository;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import hr.mrodek.apps.futsal_turniri.services.RoundService;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.jwt.JsonWebToken;

import java.util.List;
import java.util.UUID;

@Path("/tournaments/{uuid}/rounds")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class RoundController {

    @Inject RoundService roundService;
    @Inject TournamentsRepository tournamentsRepo;
    @Inject SecurityIdentity identity;
    @Inject JsonWebToken jwt;
    @Inject TournamentEditorRepository editorRepo;

    /** Throws 403 if the current user is not an admin, the tournament's
     *  creator, or a granted co-editor. */
    private void assertCanEdit(String idOrSlug) {
        // Accept slug or UUID - the URL the user is on may be either form
        // because tournaments now expose a pretty slug.
        Tournaments t = tournamentsRepo.findByUuidOrSlug(idOrSlug).orElse(null);
        if (t == null) throw new NotFoundException();
        boolean admin = identity != null && identity.hasRole("admin");
        if (admin) return;
        String me = jwt != null ? jwt.getSubject() : null;
        if (me == null) {
            throw new ForbiddenException("Only the creator, a granted editor or an admin can modify this tournament.");
        }
        boolean owner = me.equals(t.getCreatedByUid());
        if (!owner && !editorRepo.isEditor(t.getId(), me)) {
            throw new ForbiddenException("Only the creator, a granted editor or an admin can modify this tournament.");
        }
    }

    @GET
    public List<RoundDto> list(@PathParam("uuid") String uuid) {
        return roundService.listByTournamentUuid(uuid);
    }

    @POST
    @Path("/draw")
    @Authenticated
    @Transactional
    public RoundDto draw(@PathParam("uuid") String uuid) {
        assertCanEdit(uuid);
        return roundService.drawNextRound(uuid);
    }

    /**
     * Manual round generation - the organiser supplies the exact list of
     * pairings. Used in the late stage of a small bracket (≤ 4 active
     * teams) where the automatic random draw would produce awkward
     * pairings. Validation on the body (team belongs to tournament, not
     * eliminated, no duplicates, no self-team) lives in the service.
     */
    @POST
    @Path("/manual")
    @Authenticated
    @Transactional
    public RoundDto drawManual(@PathParam("uuid") String uuid,
                               @Valid ManualRoundRequest req) {
        assertCanEdit(uuid);
        return roundService.drawManualRound(uuid, req);
    }

    @PUT
    @Path("/{roundId}/matches/{matchId}")
    @Authenticated
    @Transactional
    public MatchDto updateMatch(
            @PathParam("uuid") String uuid,
            @PathParam("roundId") Long roundId,
            @PathParam("matchId") Long matchId,
            @Valid UpdateMatchRequest req
    ) {
        assertCanEdit(uuid);
        return roundService.updateMatchScore(uuid, roundId, matchId, req);
    }

    @DELETE
    @Path("/{roundId}/matches")
    @Authenticated
    @Transactional
    public Response resetRound(
            @PathParam("uuid") String uuid,
            @PathParam("roundId") Long roundId
    ) {
        assertCanEdit(uuid);
        roundService.hardResetRound(uuid, roundId);
        return Response.noContent().build();
    }

    @PUT
    @Path("/{roundId}/finish")
    @Authenticated
    @Transactional
    public RoundDto finishRound(
            @PathParam("uuid") String uuid,
            @PathParam("roundId") Long roundId
    ) {
        assertCanEdit(uuid);
        // IllegalStateException is mapped to 400 by the global ExceptionMapper
        return roundService.finishRound(uuid, roundId);
    }

    @PATCH
    @Path("/{roundId}/matches/{matchId}/override-score")
    @Authenticated
    @Transactional
    public RoundDto overrideScore(
            @PathParam("uuid") String uuid,
            @PathParam("roundId") Long roundId,
            @PathParam("matchId") Long matchId,
            @Valid UpdateMatchRequest req
    ) {
        assertCanEdit(uuid);
        return roundService.overrideMatchScore(uuid, roundId, matchId, req);
    }
}
