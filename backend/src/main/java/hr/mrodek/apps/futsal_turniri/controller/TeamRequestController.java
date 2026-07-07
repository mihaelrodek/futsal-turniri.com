package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.CreateTeamRequestRequest;
import hr.mrodek.apps.futsal_turniri.dtos.TeamRequestDto;
import hr.mrodek.apps.futsal_turniri.enums.TeamRequestStatus;
import hr.mrodek.apps.futsal_turniri.mappers.TeamRequestMapper;
import hr.mrodek.apps.futsal_turniri.model.TeamRequest;
import hr.mrodek.apps.futsal_turniri.repository.TeamRequestRepository;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.jwt.JsonWebToken;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * Team-finding requests. Players can post a "looking for partner" entry against
 * any upcoming tournament; other players see them and can mark themselves as matched.
 *
 * Routes:
 *   POST   /team-requests/by-tournament/{tournamentUuid}        - create
 *   GET    /team-requests                                       - list (optional ?status=open|matched)
 *   GET    /team-requests/by-tournament/{tournamentUuid}        - list for one tournament
 *   POST   /team-requests/{requestUuid}/match                   - mark as matched
 *   DELETE /team-requests/{requestUuid}                         - remove
 */
@Path("/team-requests")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class TeamRequestController {

    @Inject TeamRequestRepository repo;
    @Inject TournamentsRepository tournamentsRepo;
    @Inject TeamRequestMapper mapper;
    @Inject SecurityIdentity identity;
    @Inject JsonWebToken jwt;

    /** Throws 403 if the current user neither posted the request nor is an admin. */
    private void assertCanManage(TeamRequest r) {
        boolean admin = identity != null && identity.hasRole("admin");
        if (admin) return;
        String me = jwt != null ? jwt.getSubject() : null;
        if (me == null || !me.equals(r.getCreatedByUid())) {
            throw new ForbiddenException("Only the poster or an admin can modify this request.");
        }
    }

    /**
     * True when no Firebase ID token was presented (or it didn't verify).
     * SecurityIdentity is always injected; for anonymous traffic it's marked
     * anonymous because Quarkus OIDC is in lazy mode (proactive=false).
     */
    private boolean isAnonymous() {
        return identity == null || identity.isAnonymous();
    }

    /**
     * Strip phone numbers from list responses served to unauthenticated callers.
     * The product still wants team-finding requests visible to anonymous browsers
     * (so people can see "this tournament has 3 people looking for a partner"),
     * but exposing phone numbers without auth turned the endpoint into a
     * one-click PII scraper. Logged-in users get the full payload.
     */
    private List<TeamRequestDto> redactForAnonymous(List<TeamRequestDto> dtos) {
        if (!isAnonymous()) return dtos;
        for (TeamRequestDto d : dtos) d.setPhone(null);
        return dtos;
    }

    @POST
    @Path("/by-tournament/{tournamentUuid}")
    @Authenticated
    @Transactional
    public Response create(
            @PathParam("tournamentUuid") String tournamentIdOrSlug,
            @Valid CreateTeamRequestRequest body
    ) {
        // The path segment can be either a UUID (legacy clients) or the new
        // tournament slug - both resolve via findByUuidOrSlug.
        var t = tournamentsRepo.findByUuidOrSlug(tournamentIdOrSlug).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();

        var r = new TeamRequest();
        r.setTournament(t);
        r.setPlayerName(body.playerName().trim());
        r.setPhone(body.phone() == null || body.phone().isBlank() ? null : body.phone().trim());
        r.setNote(body.note() == null || body.note().isBlank() ? null : body.note().trim());
        r.setStatus(TeamRequestStatus.OPEN);
        r.setCreatedByUid(jwt.getSubject());

        repo.save(r);
        return Response.status(Response.Status.CREATED).entity(mapper.toDto(r)).build();
    }

    @GET
    public List<TeamRequestDto> list(@QueryParam("status") String status) {
        if (status == null || status.isBlank()) {
            return redactForAnonymous(mapper.toDtoList(repo.findAllOrderByCreatedDesc()));
        }
        try {
            TeamRequestStatus s = TeamRequestStatus.valueOf(status.toUpperCase());
            return redactForAnonymous(mapper.toDtoList(repo.findByStatus(s)));
        } catch (IllegalArgumentException ex) {
            return List.of();
        }
    }

    @GET
    @Path("/by-tournament/{tournamentUuid}")
    public Response listForTournament(@PathParam("tournamentUuid") String tournamentIdOrSlug) {
        var t = tournamentsRepo.findByUuidOrSlug(tournamentIdOrSlug).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        return Response.ok(redactForAnonymous(mapper.toDtoList(repo.findByTournament_Id(t.getId())))).build();
    }

    /**
     * Edit name/phone/note on a team-finding request. Only the original poster
     * (or an admin) may edit; tournament cannot be changed - that's a delete +
     * create flow if the user wants to switch tournaments.
     */
    @PUT
    @Path("/{requestUuid}")
    @Authenticated
    @Transactional
    public Response update(
            @PathParam("requestUuid") UUID requestUuid,
            @Valid CreateTeamRequestRequest body
    ) {
        var r = repo.findByUuid(requestUuid).orElse(null);
        if (r == null) return Response.status(Response.Status.NOT_FOUND).build();
        assertCanManage(r);

        r.setPlayerName(body.playerName().trim());
        r.setPhone(body.phone() == null || body.phone().isBlank() ? null : body.phone().trim());
        r.setNote(body.note() == null || body.note().isBlank() ? null : body.note().trim());
        r.setUpdatedAt(OffsetDateTime.now());
        return Response.ok(mapper.toDto(r)).build();
    }

    @POST
    @Path("/{requestUuid}/match")
    @Authenticated
    @Transactional
    public Response match(@PathParam("requestUuid") UUID requestUuid) {
        var r = repo.findByUuid(requestUuid).orElse(null);
        if (r == null) return Response.status(Response.Status.NOT_FOUND).build();
        assertCanManage(r);

        if (r.getStatus() != TeamRequestStatus.MATCHED) {
            r.setStatus(TeamRequestStatus.MATCHED);
            r.setUpdatedAt(OffsetDateTime.now());
        }
        return Response.ok(mapper.toDto(r)).build();
    }

    @DELETE
    @Path("/{requestUuid}")
    @Authenticated
    @Transactional
    public Response delete(@PathParam("requestUuid") UUID requestUuid) {
        var r = repo.findByUuid(requestUuid).orElse(null);
        if (r == null) return Response.status(Response.Status.NOT_FOUND).build();
        assertCanManage(r);
        repo.delete(r);
        return Response.noContent().build();
    }
}
