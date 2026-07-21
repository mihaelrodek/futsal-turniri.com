package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.TournamentSubscription;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.List;
import java.util.Optional;

/**
 * CRUD helpers for the per-tournament push opt-in table. The
 * {@code (user_uid, tournament_id)} pair is unique, so the find-by-pair
 * lookup is either zero or one row; the by-tournament listing is what
 * PushService uses when fanning out a goal/half/finish notification.
 */
@ApplicationScoped
public class TournamentSubscriptionRepository implements AppRepository<TournamentSubscription, Long> {

    public Optional<TournamentSubscription> findByUserUidAndTournamentId(String userUid, Long tournamentId) {
        if (userUid == null || userUid.isBlank() || tournamentId == null) return Optional.empty();
        return find("userUid = ?1 and tournament.id = ?2", userUid, tournamentId).firstResultOptional();
    }

    /**
     * Every user that has opted into a tournament's push fan-out.
     * Used by {@code PushService.sendToTournamentSubscribers} to resolve
     * the recipient list before looking up per-device push endpoints.
     */
    public List<TournamentSubscription> findByTournamentId(Long tournamentId) {
        if (tournamentId == null) return List.of();
        return list("tournament.id", tournamentId);
    }

    public void deleteByUserUidAndTournamentId(String userUid, Long tournamentId) {
        if (userUid == null || userUid.isBlank() || tournamentId == null) return;
        delete("userUid = ?1 and tournament.id = ?2", userUid, tournamentId);
    }

    /* ── Anonymous follows: keyed by the browser's push endpoint ──────────── */

    public Optional<TournamentSubscription> findByEndpointAndTournamentId(String endpoint, Long tournamentId) {
        if (endpoint == null || endpoint.isBlank() || tournamentId == null) return Optional.empty();
        return find("pushEndpoint = ?1 and tournament.id = ?2", endpoint, tournamentId).firstResultOptional();
    }

    public void deleteByEndpointAndTournamentId(String endpoint, Long tournamentId) {
        if (endpoint == null || endpoint.isBlank() || tournamentId == null) return;
        delete("pushEndpoint = ?1 and tournament.id = ?2", endpoint, tournamentId);
    }
}
