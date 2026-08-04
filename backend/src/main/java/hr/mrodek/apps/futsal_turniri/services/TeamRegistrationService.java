package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.dtos.TeamRegistrationRequest;
import hr.mrodek.apps.futsal_turniri.enums.TournamentStatus;
import hr.mrodek.apps.futsal_turniri.model.Player;
import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.model.TournamentRegistrationLink;
import hr.mrodek.apps.futsal_turniri.repository.PlayersRepository;
import hr.mrodek.apps.futsal_turniri.repository.TeamsRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.ws.rs.ClientErrorException;
import jakarta.ws.rs.core.Response;

import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Turns one filled-in registration form into a PENDING team with its roster.
 *
 * <p>Shared by the two doors into the same flow - the signed-in
 * self-registration and the public link - so a submission is identical however
 * it arrived. Keeping this in one place is what stops the two paths from
 * drifting on the parts that matter: the duplicate-name rule, the
 * one-captain-per-team rule, and above all that the team is created
 * {@code pendingApproval = true} and therefore invisible until an organizer
 * says otherwise.
 *
 * <p>Every method here runs inside the CALLER's transaction and on the
 * caller's request thread - it persists entities and reads lazy associations.
 */
@ApplicationScoped
public class TeamRegistrationService {

    /** Roster lines accepted from one form. Well above a futsal squad; this is
     *  a guard against a scripted POST, not a rule about team size. */
    private static final int MAX_PLAYERS = 40;

    @Inject TeamsRepository teamRepo;
    @Inject PlayersRepository playerRepo;

    private static Response conflict(String code) {
        return Response.status(Response.Status.CONFLICT).entity(code).build();
    }

    /** Same opaque team-share token the organizer-side flow mints. */
    private static String generateClaimToken() {
        byte[] buf = new byte[24];
        new SecureRandom().nextBytes(buf);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(buf);
    }

    /** Lowercase {@code #rrggbb}, or null for anything else. Silently ignores
     *  a malformed colour rather than failing the whole registration - a kit
     *  colour is not worth losing a roster over. */
    private static String normalizeColor(String raw) {
        if (raw == null) return null;
        String c = raw.trim();
        return c.matches("#[0-9a-fA-F]{6}") ? c.toLowerCase(Locale.ROOT) : null;
    }

    private static String trimToNull(String s, int max) {
        if (s == null) return null;
        String v = s.trim();
        if (v.isEmpty()) return null;
        return v.length() > max ? v.substring(0, max) : v;
    }

    /**
     * A tournament stops accepting registrations once it is under way. Checked
     * by both callers before anything is written.
     *
     * @return the conflict code, or null when registration is open
     */
    public String closedReason(Tournaments t) {
        if (t.getStatus() == TournamentStatus.STARTED || t.getStatus() == TournamentStatus.FINISHED) {
            return "TOURNAMENT_ALREADY_STARTED";
        }
        if (t.getArchivedAt() != null) return "TOURNAMENT_ALREADY_STARTED";
        return null;
    }

    /**
     * Creates the pending team + its roster.
     *
     * @param submittedByUid Firebase UID when a signed-in user registered,
     *                       else null (public link)
     * @param link           the link the form came through, or null
     * @throws ClientErrorException 409 {@code DUPLICATE_TEAM} when the name is
     *         already taken in this tournament - by any team, pending or not,
     *         so two entries never collide on one display name
     */
    public Teams register(Tournaments tournament,
                          TeamRegistrationRequest body,
                          String submittedByUid,
                          TournamentRegistrationLink link) {

        String teamName = body.teamName().trim();

        boolean nameTaken = teamRepo.findByTournament_Id(tournament.getId()).stream()
                .anyMatch(existing -> existing.getName() != null
                        && existing.getName().equalsIgnoreCase(teamName));
        if (nameTaken) throw new ClientErrorException(conflict("DUPLICATE_TEAM"));

        Teams team = new Teams();
        team.setTournament(tournament);
        team.setName(teamName);
        team.setEliminated(false);
        // THE gate. Nothing about a registration is public until an organizer
        // flips this - see Teams#pendingApproval and the approve endpoint.
        team.setPendingApproval(true);
        team.setSubmittedByUid(submittedByUid);
        team.setClaimToken(generateClaimToken());
        team.setJerseyColor(normalizeColor(body.jerseyColor()));
        team.setShortsColor(normalizeColor(body.shortsColor()));
        team.setRegisteredByName(trimToNull(body.contactName(), 200));
        team.setRegisteredContact(trimToNull(body.contact(), 200));
        team.setRegistrationNote(trimToNull(body.note(), 1000));
        team.setRegistrationLink(link);
        teamRepo.save(team);

        addRoster(team, body.players());
        return team;
    }

    /**
     * Persists the roster lines. Blank names are DROPPED, not rejected: a form
     * whose last few rows were left empty is the normal case.
     *
     * <p>At most one captain survives - the first one ticked wins, mirroring
     * the one-per-team rule the roster editor enforces. Goalkeepers are not
     * capped: a squad may list a backup keeper.
     */
    private void addRoster(Teams team, List<TeamRegistrationRequest.RegistrationPlayer> rows) {
        if (rows == null || rows.isEmpty()) return;

        boolean captainTaken = false;
        int order = 0;
        for (var row : rows) {
            if (order >= MAX_PLAYERS) break;
            String name = trimToNull(row.name(), 200);
            if (name == null) continue;

            Player p = new Player();
            p.setTeam(team);
            // Roster names are stored upper-case everywhere else in the app
            // (see TournamentController#normalizePlayerName); a registration
            // must not introduce a second convention.
            p.setName(name.toUpperCase(Locale.ROOT));
            p.setNumber(row.number());
            p.setGoalkeeper(Boolean.TRUE.equals(row.goalkeeper()));
            boolean wantsCaptain = Boolean.TRUE.equals(row.captain());
            p.setCaptain(wantsCaptain && !captainTaken);
            if (wantsCaptain) captainTaken = true;
            p.setSortOrder(order++);
            playerRepo.save(p);
        }
    }

    /** Small summary of what a submission contained, for the response body. */
    public Map<String, Object> summary(Teams team, int playerCount) {
        return Map.of(
                "teamName", team.getName(),
                "pending", true,
                "playerCount", playerCount);
    }
}
