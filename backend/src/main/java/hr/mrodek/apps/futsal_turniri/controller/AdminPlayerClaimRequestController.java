package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.PlayerClaimRequestDto;
import hr.mrodek.apps.futsal_turniri.enums.PlayerClaimRequestStatus;
import hr.mrodek.apps.futsal_turniri.model.Player;
import hr.mrodek.apps.futsal_turniri.model.PlayerClaimRequest;
import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.repository.PlayerClaimRequestRepository;
import hr.mrodek.apps.futsal_turniri.repository.PlayersRepository;
import hr.mrodek.apps.futsal_turniri.repository.TeamsRepository;
import hr.mrodek.apps.futsal_turniri.services.PlayerClaimRequestMapper;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.ClientErrorException;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.jwt.JsonWebToken;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * Admin inbox for manual player-claim requests (see
 * {@link PlayerClaimRequestController} for why they exist at all).
 *
 * <p>Approving performs exactly the mutation the automatic self-claim does -
 * the requester lands in the team's {@code coSubmittedByUid} slot - so a
 * request approved here and a name that auto-matched end up in identical
 * states. Nothing else about the roster row is touched.
 *
 * Routes:
 *   GET  /admin/player-claim-requests                - pending first, then decided
 *   POST /admin/player-claim-requests/{id}/approve   - link + mark APPROVED
 *   POST /admin/player-claim-requests/{id}/reject    - mark REJECTED (note optional)
 */
@Path("/admin/player-claim-requests")
@RolesAllowed("admin")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class AdminPlayerClaimRequestController {

    @Inject PlayerClaimRequestRepository requestRepo;
    @Inject TeamsRepository teamRepo;
    @Inject PlayersRepository playersRepo;
    @Inject PlayerClaimRequestMapper mapper;
    @Inject JsonWebToken jwt;

    @GET
    @Transactional
    public List<PlayerClaimRequestDto> list() {
        return requestRepo.findAllForAdmin().stream()
                .map(r -> mapper.toDto(r, true))
                .toList();
    }

    /**
     * Conflict states:
     *   - not pending anymore              → 409 NOT_PENDING
     *   - roster row deleted meanwhile     → 409 PLAYER_GONE
     *   - co-owner slot taken meanwhile    → 409 ALREADY_CLAIMED
     */
    @POST
    @Path("/{id}/approve")
    @Transactional
    public PlayerClaimRequestDto approve(@PathParam("id") Long id, DecisionRequest body) {
        var req = requestRepo.findByIdOptional(id)
                .orElseThrow(() -> new NotFoundException("Zahtjev nije pronađen."));
        if (req.getStatus() != PlayerClaimRequestStatus.PENDING) {
            throw new ClientErrorException("NOT_PENDING", 409);
        }

        Player player = req.getPlayer();
        Teams team = player == null ? null : player.getTeam();
        if (team == null) throw new ClientErrorException("PLAYER_GONE", 409);

        String uid = req.getUserUid();

        // The identity link is the part that actually makes the appearance
        // show on the profile - it works per roster row, so a whole team of
        // registered players can each be linked.
        player.setClaimedByUid(uid);
        playersRepo.persist(player);

        // The co-owner slot (edit rights) is a bonus, and only when it's free -
        // a taken slot must never be stolen, and it isn't needed for the
        // appearance to show up.
        boolean alreadyMine = uid.equals(team.getSubmittedByUid()) || uid.equals(team.getCoSubmittedByUid());
        if (!alreadyMine && team.getCoSubmittedByUid() == null) {
            team.setCoSubmittedByUid(uid);
            teamRepo.persist(team);
        }

        decide(req, PlayerClaimRequestStatus.APPROVED, body);
        return mapper.toDto(req, true);
    }

    @POST
    @Path("/{id}/reject")
    @Transactional
    public PlayerClaimRequestDto reject(@PathParam("id") Long id, DecisionRequest body) {
        var req = requestRepo.findByIdOptional(id)
                .orElseThrow(() -> new NotFoundException("Zahtjev nije pronađen."));
        if (req.getStatus() != PlayerClaimRequestStatus.PENDING) {
            throw new ClientErrorException("NOT_PENDING", 409);
        }
        decide(req, PlayerClaimRequestStatus.REJECTED, body);
        return mapper.toDto(req, true);
    }

    private void decide(PlayerClaimRequest req, PlayerClaimRequestStatus status, DecisionRequest body) {
        req.setStatus(status);
        req.setDecidedByUid(jwt.getSubject());
        req.setDecidedAt(OffsetDateTime.now());
        if (body != null && body.note() != null && !body.note().isBlank()) {
            req.setAdminNote(body.note().trim());
        }
        requestRepo.persist(req);
    }

    /** Optional note the requester sees next to the decision. */
    public record DecisionRequest(String note) {}
}
