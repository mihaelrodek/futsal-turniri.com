package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.UserNotification;
import io.quarkus.panache.common.Sort;
import jakarta.enterprise.context.ApplicationScoped;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.List;

/**
 * Reads/updates for the "Obavijesti" inbox. Every method is scoped to ONE
 * Firebase UID by construction - there is deliberately no "find all" here,
 * because the only consumer is the signed-in user's own inbox and the uid
 * filter must never be something a caller can forget.
 */
@ApplicationScoped
public class UserNotificationRepository implements AppRepository<UserNotification, Long> {

    /**
     * The user's newest {@code limit} notifications. Ties on {@code createdAt}
     * (a fan-out writes many rows in the same millisecond) break on id, so the
     * order is total and the inbox never shuffles between two calls.
     */
    public List<UserNotification> findRecentByUserUid(String uid, int limit) {
        if (uid == null || uid.isBlank()) return List.of();
        return find("userUid = ?1", Sort.descending("createdAt", "id"), uid)
                .page(0, limit)
                .list();
    }

    public long countUnread(String uid) {
        if (uid == null || uid.isBlank()) return 0;
        return count("userUid = ?1 and readAt is null", uid);
    }

    /**
     * Stamp {@code read_at} on the caller's unread rows. The uid lives INSIDE
     * the update predicate, so passing someone else's ids can only ever match
     * zero rows - there is no load-then-check window to get wrong.
     *
     * @param ids the rows to mark; null/empty means "all of this user's unread"
     * @return how many rows were actually marked
     */
    public long markRead(String uid, Collection<Long> ids) {
        if (uid == null || uid.isBlank()) return 0;
        OffsetDateTime now = OffsetDateTime.now();
        if (ids == null || ids.isEmpty()) {
            return update("readAt = ?1 where userUid = ?2 and readAt is null", now, uid);
        }
        return update("readAt = ?1 where userUid = ?2 and readAt is null and id in ?3", now, uid, ids);
    }
}
