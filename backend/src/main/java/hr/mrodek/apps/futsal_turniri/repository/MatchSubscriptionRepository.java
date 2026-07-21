package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.MatchSubscription;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.List;
import java.util.Optional;

/**
 * CRUD helpers for the per-match push opt-in table. The
 * {@code (user_uid, match_id)} pair is unique, so the find-by-pair lookup is
 * either zero or one row; the by-match listing is what {@code PushService}
 * uses to fan out the "match is starting" notification.
 */
@ApplicationScoped
public class MatchSubscriptionRepository implements AppRepository<MatchSubscription, Long> {

    public Optional<MatchSubscription> findByUserUidAndMatchId(String userUid, Long matchId) {
        if (userUid == null || userUid.isBlank() || matchId == null) return Optional.empty();
        return find("userUid = ?1 and match.id = ?2", userUid, matchId).firstResultOptional();
    }

    /** Every user that has opted into a match's push fan-out. */
    public List<MatchSubscription> findByMatchId(Long matchId) {
        if (matchId == null) return List.of();
        return list("match.id", matchId);
    }

    public void deleteByUserUidAndMatchId(String userUid, Long matchId) {
        if (userUid == null || userUid.isBlank() || matchId == null) return;
        delete("userUid = ?1 and match.id = ?2", userUid, matchId);
    }

    /* ── Anonymous follows: keyed by the browser's push endpoint ──────────── */

    public Optional<MatchSubscription> findByEndpointAndMatchId(String endpoint, Long matchId) {
        if (endpoint == null || endpoint.isBlank() || matchId == null) return Optional.empty();
        return find("pushEndpoint = ?1 and match.id = ?2", endpoint, matchId).firstResultOptional();
    }

    public void deleteByEndpointAndMatchId(String endpoint, Long matchId) {
        if (endpoint == null || endpoint.isBlank() || matchId == null) return;
        delete("pushEndpoint = ?1 and match.id = ?2", endpoint, matchId);
    }
}
