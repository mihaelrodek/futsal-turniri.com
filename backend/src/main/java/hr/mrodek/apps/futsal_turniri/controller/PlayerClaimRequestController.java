package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.PlayerClaimRequestDto;
import hr.mrodek.apps.futsal_turniri.dtos.PlayerClaimSuggestionDto;
import hr.mrodek.apps.futsal_turniri.enums.NotificationKind;
import hr.mrodek.apps.futsal_turniri.enums.PlayerClaimRequestStatus;
import hr.mrodek.apps.futsal_turniri.model.Player;
import hr.mrodek.apps.futsal_turniri.model.PlayerClaimRequest;
import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.model.UserProfile;
import hr.mrodek.apps.futsal_turniri.repository.PlayerClaimRequestRepository;
import hr.mrodek.apps.futsal_turniri.repository.PlayersRepository;
import hr.mrodek.apps.futsal_turniri.repository.UserProfileRepository;
import hr.mrodek.apps.futsal_turniri.services.AdminNotifier;
import hr.mrodek.apps.futsal_turniri.services.MessageService;
import hr.mrodek.apps.futsal_turniri.services.PlayerClaimRequestMapper;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.ws.rs.ClientErrorException;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.ForbiddenException;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.jwt.JsonWebToken;

import java.util.List;

/**
 * The MANUAL half of "which roster player am I": search the rosters, ask for
 * one, wait for an admin to approve it.
 *
 * <p>The automatic half lives in {@link UserMeController}
 * ({@code /player-suggestions} + {@code .../claim}) and needs no approval,
 * because it only ever links a roster row whose name folds to exactly the
 * caller's own registered name on a team nobody has claimed. Everything else
 * - a nickname on the roster, a different spelling, a team already registered
 * by a teammate - lands here, where a human decides. A wrong link would hand
 * over someone else's tournament history and team edit rights, so there is
 * deliberately no self-service path.
 *
 * Routes (all require a signed-in user):
 *   GET    /user/me/player-claim-requests            - my requests, freshest first
 *   POST   /user/me/player-claim-requests            - ask for one (comment mandatory)
 *   DELETE /user/me/player-claim-requests/{id}       - withdraw my own pending request
 *   GET    /user/me/claimable-players?q=             - roster search for the dialog
 */
@Path("/user/me")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class PlayerClaimRequestController {

    /** The dialog is a picker, not a browse page - keep the list short. */
    private static final int SEARCH_LIMIT = 20;

    /** Stops one account from queueing an unbounded pile for the admin. */
    private static final int MAX_OPEN_REQUESTS = 5;

    /** Same short cap the "je li ovo ti?" prompt has always used. */
    private static final int SUGGESTION_LIMIT = 5;

    @Inject PlayerClaimRequestRepository requestRepo;
    @Inject PlayersRepository playersRepo;
    @Inject PlayerClaimRequestMapper mapper;
    @Inject UserProfileRepository profileRepo;
    @Inject AdminNotifier adminNotifier;
    @Inject MessageService messages;
    @Inject JsonWebToken jwt;

    @GET
    @Path("/player-claim-requests")
    @Transactional
    public List<PlayerClaimRequestDto> myRequests() {
        return requestRepo.findByUserUid(jwt.getSubject()).stream()
                .map(r -> mapper.toDto(r, false))
                .toList();
    }

    /**
     * Everything the SPA needs to decide what to offer: the exact-name
     * matches (empty when there are none, or when the person opted out) plus
     * the opt-out flag itself. One call, because both the app-level first-run
     * prompt and the profile page ask exactly this question.
     */
    @GET
    @Path("/player-claim-state")
    @Transactional
    public PlayerClaimStateDto claimState() {
        var profile = profileRepo.findByUid(jwt.getSubject()).orElse(null);
        boolean optedOut = profile != null && profile.isPlayerClaimOptOut();
        List<PlayerClaimSuggestionDto> suggestions = optedOut
                ? List.of()
                : suggestions(profile);
        return new PlayerClaimStateDto(optedOut, suggestions);
    }

    /**
     * "Nisam igrač" - stop offering the automatic prompt, for good and on
     * every device. Deliberately does NOT close the manual path: the user can
     * still open the request dialog themselves at any time, and DELETE here
     * puts them back in the automatic flow.
     */
    @POST
    @Path("/player-claim-opt-out")
    @Transactional
    public PlayerClaimStateDto optOut() {
        return setOptOut(true);
    }

    @DELETE
    @Path("/player-claim-opt-out")
    @Transactional
    public PlayerClaimStateDto cancelOptOut() {
        return setOptOut(false);
    }

    private PlayerClaimStateDto setOptOut(boolean value) {
        var profile = profileRepo.findByUid(jwt.getSubject())
                .orElseThrow(() -> new NotFoundException("Profil nije pronađen."));
        profile.setPlayerClaimOptOut(value);
        profileRepo.persist(profile);
        return new PlayerClaimStateDto(value, value ? List.of() : suggestions(profile));
    }

    private List<PlayerClaimSuggestionDto> suggestions(UserProfile profile) {
        String needle = UserMeController.suggestionNeedle(profile);
        if (needle == null) return List.of();
        return playersRepo.findUnclaimedByFoldedName(needle, SUGGESTION_LIMIT).stream()
                .map(mapper::toSuggestionDto)
                .toList();
    }

    public record PlayerClaimStateDto(boolean optedOut, List<PlayerClaimSuggestionDto> suggestions) {}

    @GET
    @Path("/claimable-players")
    @Transactional
    public List<PlayerClaimSuggestionDto> searchClaimable(@QueryParam("q") String q) {
        if (q == null || q.trim().length() < 2) return List.of();
        return playersRepo.searchClaimableByName(q, SEARCH_LIMIT).stream()
                .map(mapper::toSuggestionDto)
                .toList();
    }

    /**
     * Ask to be linked to a roster player.
     *
     * Conflict states:
     *   - blank comment                          → 400 (bean validation)
     *   - already queued for this player         → 409 ALREADY_REQUESTED
     *   - too many of my requests still open     → 409 TOO_MANY_OPEN
     *   - team's co-owner slot taken meanwhile   → 409 ALREADY_CLAIMED
     */
    @POST
    @Path("/player-claim-requests")
    @Transactional
    public PlayerClaimRequestDto create(@Valid CreateRequest body) {
        String uid = jwt.getSubject();

        Player player = playersRepo.findByIdOptional(body.playerId()).orElse(null);
        if (player == null || player.isDemo()) throw new NotFoundException("Igrač nije pronađen.");

        Teams team = player.getTeam();
        Tournaments tournament = team == null ? null : team.getTournament();
        if (team == null || team.isDemo() || team.isPendingApproval()
                || (tournament != null && tournament.isHidden())) {
            throw new NotFoundException("Igrač nije pronađen.");
        }
        if (uid.equals(team.getSubmittedByUid()) || uid.equals(team.getCoSubmittedByUid())) {
            throw new ClientErrorException("ALREADY_CLAIMED", 409);
        }
        if (team.getCoSubmittedByUid() != null) {
            throw new ClientErrorException("ALREADY_CLAIMED", 409);
        }
        if (requestRepo.existsPending(uid, player.getId())) {
            throw new ClientErrorException("ALREADY_REQUESTED", 409);
        }
        long open = requestRepo.findByUserUid(uid).stream()
                .filter(r -> r.getStatus() == PlayerClaimRequestStatus.PENDING)
                .count();
        if (open >= MAX_OPEN_REQUESTS) throw new ClientErrorException("TOO_MANY_OPEN", 409);

        var req = new PlayerClaimRequest();
        req.setUserUid(uid);
        req.setPlayer(player);
        req.setPlayerName(player.getName());
        req.setTeamName(team.getName());
        req.setTournamentName(tournament == null ? null : tournament.getName());
        req.setComment(body.comment().trim());
        req.setStatus(PlayerClaimRequestStatus.PENDING);
        requestRepo.persist(req);

        notifyAdminInbox(uid, player.getName(), team.getName());

        return mapper.toDto(req, false);
    }

    /**
     * Tell every admin a claim is waiting for a human decision - this queue had
     * no notification at all, only the badge on the admin console.
     *
     * <p>Every label is resolved HERE, on the request thread with the entities
     * still attached; {@link AdminNotifier} only ever sees plain strings.
     * Fire-and-forget: it swallows its own failures, so a broken inbox write
     * can never fail the user's request.
     */
    private void notifyAdminInbox(String uid, String playerName, String teamName) {
        adminNotifier.notifyAdmins(
                NotificationKind.ADMIN_REQUEST,
                messages.t("notifications.admin.playerClaim.title"),
                messages.t("notifications.admin.playerClaim.body",
                        requesterLabel(uid), playerName, teamName),
                "/admin/zahtjevi-igraci");
    }

    /** Best available human label for the requester: their display name, else
     *  "ime prezime", else the raw UID (never blank - an admin has to be able
     *  to tell two pending claims apart). */
    private String requesterLabel(String uid) {
        var profile = profileRepo.findByUid(uid).orElse(null);
        if (profile != null) {
            String display = profile.getDisplayName();
            if (display != null && !display.isBlank()) return display.trim();
            String full = ((profile.getFirstName() == null ? "" : profile.getFirstName()) + " "
                    + (profile.getLastName() == null ? "" : profile.getLastName())).trim();
            if (!full.isEmpty()) return full;
        }
        return uid;
    }

    /** Withdraw a request that hasn't been decided yet. */
    @DELETE
    @Path("/player-claim-requests/{id}")
    @Transactional
    public PlayerClaimRequestDto cancel(@PathParam("id") Long id) {
        var req = requestRepo.findByIdOptional(id)
                .orElseThrow(() -> new NotFoundException("Zahtjev nije pronađen."));
        if (!req.getUserUid().equals(jwt.getSubject())) {
            throw new ForbiddenException("Nije tvoj zahtjev.");
        }
        if (req.getStatus() == PlayerClaimRequestStatus.PENDING) {
            req.setStatus(PlayerClaimRequestStatus.CANCELLED);
            requestRepo.persist(req);
        }
        return mapper.toDto(req, false);
    }

    public record CreateRequest(
            @NotNull Long playerId,
            @NotBlank String comment
    ) {}
}
