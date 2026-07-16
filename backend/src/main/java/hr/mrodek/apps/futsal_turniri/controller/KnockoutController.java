package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.BracketDto;
import hr.mrodek.apps.futsal_turniri.dtos.KnockoutResultRequest;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.repository.TournamentEditorRepository;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import hr.mrodek.apps.futsal_turniri.services.KnockoutService;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.ws.rs.BadRequestException;
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
 *   GET  /tournaments/{uuid}/bracket                      - anonymous OK
 *   POST /tournaments/{uuid}/bracket/generate             - owner/admin
 *   POST /tournaments/{uuid}/bracket/matches/{id}/result  - owner/admin
 * </pre>
 *
 * <p>Reads are open. Generate / record-result require a Firebase OIDC
 * token AND the caller must be either the tournament's creator or an
 * admin. Same pattern as {@link RoundController}. Until 2026-06 these
 * writes were left open under a "OIDC temporarily disabled" comment -
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
    @Inject TournamentEditorRepository editorRepo;
    @Inject hr.mrodek.apps.futsal_turniri.realtime.LiveBroadcaster liveBroadcaster;

    /** Throws 403 if the current user is not an admin, the tournament's
     *  creator, or a granted co-editor. */
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
        return t;
    }

    /** The knockout bracket - empty rounds before it is generated. */
    @GET
    public BracketDto bracket(@PathParam("uuid") String uuid) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid)
                .orElseThrow(() -> new NotFoundException("Tournament not found"));
        return knockoutService.bracket(t.getId());
    }

    /** Teams eligible for the bracket (group qualifiers, or all teams for
     *  KNOCKOUT_ONLY) + whether the group stage is complete. Drives the
     *  manual-draw picker. Public read. */
    @GET
    @Path("/qualifiers")
    public hr.mrodek.apps.futsal_turniri.dtos.BracketQualifiersDto qualifiers(
            @PathParam("uuid") String uuid) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid)
                .orElseThrow(() -> new NotFoundException("Tournament not found"));
        boolean complete = knockoutService.isGroupStageComplete(t);
        var teams = knockoutService.bracketCandidates(t).stream()
                .map(x -> new hr.mrodek.apps.futsal_turniri.dtos.BracketQualifiersDto.Team(
                        x.getId(), x.getName()))
                .toList();
        return new hr.mrodek.apps.futsal_turniri.dtos.BracketQualifiersDto(complete, teams);
    }

    /** Persist the organizer's manual seed order (nositelji) for a
     *  KNOCKOUT_ONLY tournament, then echo back the re-ordered candidates so
     *  the auto draw is deterministic. Owner/admin. */
    @POST
    @Path("/seeds")
    @Authenticated
    @Transactional
    public hr.mrodek.apps.futsal_turniri.dtos.BracketQualifiersDto seeds(
            @PathParam("uuid") String uuid,
            hr.mrodek.apps.futsal_turniri.dtos.BracketSeedsRequest body) {
        Tournaments t = assertCanEdit(uuid);
        knockoutService.setSeeds(t, body == null ? null : body.teamIds());
        boolean complete = knockoutService.isGroupStageComplete(t);
        var teams = knockoutService.bracketCandidates(t).stream()
                .map(x -> new hr.mrodek.apps.futsal_turniri.dtos.BracketQualifiersDto.Team(
                        x.getId(), x.getName()))
                .toList();
        return new hr.mrodek.apps.futsal_turniri.dtos.BracketQualifiersDto(complete, teams);
    }

    /** Build (or rebuild) the knockout bracket from the qualifiers. Optional
     *  body {@code { byeTeamIds }} chooses who advances directly (round-one
     *  bye) when the qualifier count isn't a power of two. */
    @POST
    @Path("/generate")
    @Authenticated
    @Transactional
    public BracketDto generate(
            @PathParam("uuid") String uuid,
            hr.mrodek.apps.futsal_turniri.dtos.GenerateBracketRequest body) {
        Tournaments t = assertCanEdit(uuid);
        return knockoutService.generateBracket(
                t,
                body == null ? null : body.byeTeamIds(),
                body != null && Boolean.TRUE.equals(body.shuffleRest()));
    }

    /** Wipe the knockout bracket (all elimination matches). Owner/admin. */
    @POST
    @Path("/reset")
    @Authenticated
    @Transactional
    public BracketDto reset(@PathParam("uuid") String uuid) {
        Tournaments t = assertCanEdit(uuid);
        knockoutService.resetBracket(t);
        return knockoutService.bracket(t.getId());
    }

    /** Build (or rebuild) the bracket from organizer-supplied first-round
     *  pairings (the manual draw). */
    @POST
    @Path("/generate-manual")
    @Authenticated
    @Transactional
    public BracketDto generateManual(
            @PathParam("uuid") String uuid,
            hr.mrodek.apps.futsal_turniri.dtos.ManualBracketRequest body) {
        Tournaments t = assertCanEdit(uuid);
        return knockoutService.generateBracketManual(t, body);
    }

    /** Record a knockout match result (goals, plus penalties if level). */
    @POST
    @Path("/matches/{matchId}/result")
    @Authenticated
    @Transactional
    public BracketDto recordResult(
            @PathParam("uuid") String uuid,
            @PathParam("matchId") Long matchId,
            @Valid KnockoutResultRequest body) {
        if (body == null) throw new BadRequestException("Request body is required.");
        Tournaments t = assertCanEdit(uuid);
        knockoutService.recordResult(t.getId(), matchId, body);
        if (t.getUuid() != null) liveBroadcaster.liveUpdate(t.getUuid().toString(), matchId);
        return knockoutService.bracket(t.getId());
    }
}
