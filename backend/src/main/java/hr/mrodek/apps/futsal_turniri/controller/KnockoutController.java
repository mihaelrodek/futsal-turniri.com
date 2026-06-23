package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.BracketDto;
import hr.mrodek.apps.futsal_turniri.dtos.KnockoutResultRequest;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import hr.mrodek.apps.futsal_turniri.services.KnockoutService;
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

/**
 * Knockout-bracket endpoints for a tournament (Phase E3).
 *
 * <pre>
 *   GET  /tournaments/{uuid}/bracket                      — anonymous OK
 *   POST /tournaments/{uuid}/bracket/generate             — owner/admin
 *   POST /tournaments/{uuid}/bracket/matches/{id}/result  — owner/admin
 * </pre>
 *
 * <p>Reads are open. Generate / record-result require a Firebase OIDC
 * token AND the caller must be either the tournament's creator or an
 * admin. Same pattern as {@link RoundController}. Until 2026-06 these
 * writes were left open under a "OIDC temporarily disabled" comment —
 * a security audit flagged it as the highest-blast-radius gap in the
 * codebase (anyone could wipe brackets / alter scores for any
 * tournament), so the gate is now enforced.
 */
@Path("/tournaments/{uuid}/bracket")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class KnockoutController {

    @Inject TournamentsRepository tournamentsRepo;
    @Inject KnockoutService knockoutService;
    @Inject SecurityIdentity identity;
    @Inject JsonWebToken jwt;

    /** Throws 403 if the current user is neither the tournament's creator
     *  nor an admin. */
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

    /** The knockout bracket — empty rounds before it is generated. */
    @GET
    public BracketDto bracket(@PathParam("uuid") String uuid) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid)
                .orElseThrow(() -> new NotFoundException("Tournament not found"));
        return knockoutService.bracket(t.getId());
    }

    /** Build (or rebuild) the knockout bracket from the qualifiers. */
    @POST
    @Path("/generate")
    @Authenticated
    @Transactional
    public BracketDto generate(@PathParam("uuid") String uuid) {
        Tournaments t = assertCanEdit(uuid);
        return knockoutService.generateBracket(t);
    }

    /** Record a knockout match result (goals, plus penalties if level). */
    @POST
    @Path("/matches/{matchId}/result")
    @Authenticated
    @Transactional
    public BracketDto recordResult(
            @PathParam("uuid") String uuid,
            @PathParam("matchId") Long matchId,
            KnockoutResultRequest body) {
        Tournaments t = assertCanEdit(uuid);
        knockoutService.recordResult(matchId, body);
        return knockoutService.bracket(t.getId());
    }
}
