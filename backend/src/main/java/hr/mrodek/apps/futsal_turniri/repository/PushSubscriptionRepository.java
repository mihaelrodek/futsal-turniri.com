package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.PushSubscription;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.List;
import java.util.Optional;

@ApplicationScoped
public class PushSubscriptionRepository implements AppRepository<PushSubscription, Long> {

    public List<PushSubscription> findByUserUid(String uid) {
        if (uid == null || uid.isBlank()) return List.of();
        return list("userUid", uid);
    }

    public Optional<PushSubscription> findByEndpoint(String endpoint) {
        if (endpoint == null || endpoint.isBlank()) return Optional.empty();
        return find("endpoint", endpoint).firstResultOptional();
    }

    public void deleteByEndpoint(String endpoint) {
        if (endpoint == null || endpoint.isBlank()) return;
        delete("endpoint", endpoint);
    }

    /**
     * Anonymous-scoped delete: only drops the subscription if it is an
     * ANONYMOUS row ({@code userUid IS NULL}). Used by the public unsubscribe
     * endpoint for not-logged-in callers so a leaked endpoint URL can't be used
     * to detach a real user's push delivery (mirrors
     * {@link #deleteByUserUidAndEndpoint} for the logged-in case).
     */
    public void deleteAnonByEndpoint(String endpoint) {
        if (endpoint == null || endpoint.isBlank()) return;
        delete("endpoint = ?1 and userUid is null", endpoint);
    }

    /**
     * Owner-scoped delete: only drops the subscription if the row's
     * {@code userUid} matches the caller. Used by the public unsubscribe
     * endpoint so a leaked endpoint URL alone can't be used to detach
     * another user's push delivery.
     */
    public void deleteByUserUidAndEndpoint(String userUid, String endpoint) {
        if (userUid == null || userUid.isBlank()) return;
        if (endpoint == null || endpoint.isBlank()) return;
        delete("userUid = ?1 and endpoint = ?2", userUid, endpoint);
    }
}
