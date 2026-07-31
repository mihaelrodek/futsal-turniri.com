package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.enums.PlayerClaimRequestStatus;
import hr.mrodek.apps.futsal_turniri.model.PlayerClaimRequest;
import io.quarkus.panache.common.Sort;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.Comparator;
import java.util.List;

@ApplicationScoped
public class PlayerClaimRequestRepository implements AppRepository<PlayerClaimRequest, Long> {

    /** Everything one user ever requested, freshest first. */
    public List<PlayerClaimRequest> findByUserUid(String uid) {
        return list("userUid = ?1", Sort.by("createdAt").descending(), uid);
    }

    /** Guard against the same person queueing the same roster row twice. */
    public boolean existsPending(String uid, Long playerId) {
        return count("userUid = ?1 and player.id = ?2 and status = ?3",
                uid, playerId, PlayerClaimRequestStatus.PENDING) > 0;
    }

    /**
     * Admin inbox - pending first (that's the actionable queue), then the
     * decided ones, each group freshest first. The pending-first grouping is
     * applied in Java rather than as an HQL {@code case} over an enum path,
     * which keeps the query trivially portable.
     */
    public List<PlayerClaimRequest> findAllForAdmin() {
        return list("from PlayerClaimRequest").stream()
                .sorted(Comparator
                        .comparing((PlayerClaimRequest r) -> r.getStatus() == PlayerClaimRequestStatus.PENDING ? 0 : 1)
                        .thenComparing(PlayerClaimRequest::getCreatedAt, Comparator.reverseOrder()))
                .toList();
    }

    public long countPending() {
        return count("status", PlayerClaimRequestStatus.PENDING);
    }
}
