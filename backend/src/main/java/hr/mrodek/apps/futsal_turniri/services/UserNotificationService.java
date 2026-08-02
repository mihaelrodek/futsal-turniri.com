package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.enums.NotificationKind;
import hr.mrodek.apps.futsal_turniri.model.UserNotification;
import hr.mrodek.apps.futsal_turniri.repository.UserNotificationRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;

import java.time.OffsetDateTime;
import java.util.Collection;
import java.util.LinkedHashSet;

/**
 * Write side of the "Obavijesti" inbox - one row per recipient UID per push
 * event. Called only from {@link PushService}, right where the fan-out has
 * already resolved who is being notified.
 *
 * <h2>Threading / transactions - why this is a separate bean</h2>
 * <ul>
 *   <li><b>There is no off-thread dispatch to worry about.</b> Every
 *       {@code PushService.sendTo*} method is {@code @Transactional} and runs
 *       synchronously on the caller's thread (the web-push HTTP call is made
 *       inline in {@code sendOne}); nothing is handed to an executor. So the
 *       insert always happens on a thread that has a persistence context -
 *       unlike the SpectoStream dispatcher, which does run on its own thread
 *       and is why plain values are the house rule for anything crossing a
 *       thread boundary.</li>
 *   <li><b>Nothing lazy is touched here anyway.</b> The entity stores match /
 *       tournament as plain id columns and every string arrives already
 *       resolved by the caller, so this method can never trigger a lazy load
 *       and can never blow up with a no-session error.</li>
 *   <li><b>{@code REQUIRES_NEW} is the point of the separate bean.</b> The
 *       caller (a goal write, a match finish, a team approval) is inside its
 *       own transaction. If the history insert failed while joined to that
 *       transaction it would mark it rollback-only, and a caught-and-logged
 *       exception would then silently destroy the real work at commit time.
 *       A suspended, independent transaction contains the damage: a failed
 *       insert rolls back only itself, and {@link PushService} logs it at
 *       WARN. History must never be able to break a push - let alone the
 *       write the push was announcing.</li>
 *   <li>The flip side of {@code REQUIRES_NEW} is that the row survives even
 *       if the caller's own transaction later rolls back. That is the correct
 *       reading: the push was physically delivered by then, so the inbox
 *       showing it matches what the user's device actually received.</li>
 * </ul>
 */
@ApplicationScoped
public class UserNotificationService {

    /** Column is varchar(255); longer titles are truncated rather than rejected. */
    private static final int MAX_TITLE = 255;

    /** Deep link column width. */
    private static final int MAX_URL = 512;

    @Inject UserNotificationRepository repo;

    /**
     * Persist one row per distinct recipient UID.
     *
     * <p>Blank/duplicate UIDs are dropped, so a caller may pass its raw
     * subscriber collection without pre-cleaning it. An empty recipient set is
     * a no-op (an anonymous-only fan-out has nobody to file history for).
     *
     * <p>Deliberately NOT swallowing exceptions: the {@code REQUIRES_NEW}
     * transaction has to see the failure to roll itself back, and
     * {@link PushService} does the catching + WARN logging one frame up.
     */
    @Transactional(Transactional.TxType.REQUIRES_NEW)
    public void record(Collection<String> userUids,
                       NotificationKind kind,
                       String title,
                       String body,
                       String url,
                       Long matchId,
                       Long tournamentId) {
        if (userUids == null || userUids.isEmpty()) return;
        if (title == null || title.isBlank()) return;

        var distinct = new LinkedHashSet<String>();
        for (String uid : userUids) {
            if (uid != null && !uid.isBlank()) distinct.add(uid);
        }
        if (distinct.isEmpty()) return;

        OffsetDateTime now = OffsetDateTime.now();
        for (String uid : distinct) {
            var n = new UserNotification();
            n.setUserUid(uid);
            n.setKind(kind == null ? NotificationKind.GENERIC : kind);
            n.setTitle(clip(title, MAX_TITLE));
            // body is NOT NULL in the DB but a push may legitimately carry an
            // empty one (title-only notification) - store "" rather than null.
            n.setBody(body == null ? "" : body);
            n.setUrl(clip(url, MAX_URL));
            n.setMatchId(matchId);
            n.setTournamentId(tournamentId);
            n.setCreatedAt(now);
            repo.persist(n);
        }
    }

    private static String clip(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }
}
