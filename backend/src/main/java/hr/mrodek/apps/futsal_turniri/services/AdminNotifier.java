package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.enums.NotificationKind;
import hr.mrodek.apps.futsal_turniri.repository.UserProfileRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.jboss.logging.Logger;

import java.util.List;

/**
 * Fans ONE admin-facing item (a new recording request, a camera/quote inquiry,
 * a player-claim request) into every platform admin's "Obavijesti" inbox.
 *
 * <p>Until now the only "tell an admin" channel was a single e-mail address in
 * {@code app_settings.recording_notify_email} - one mailbox, no in-app trace.
 * This is the second channel and runs alongside it, not instead of it: both
 * fire from the same call sites.
 *
 * <h2>How admins are found</h2>
 * There is no admin table. {@code admin} is a Firebase custom claim, and the
 * only durable trace of it is {@code user_profiles.admin}, mirrored from the
 * verified token on every {@code /user/me/sync}.
 * {@link UserProfileRepository#findAdminUids()} reads that in ONE projection
 * query - never a per-row lookup, since this runs on public form submits.
 *
 * <p><b>SECURITY.</b> The mirrored column is an ADDRESS BOOK and nothing else.
 * It is read here to decide who receives a message; it is never read anywhere
 * to decide what someone may do. Authorization is unchanged and stays on
 * {@code @RolesAllowed("admin")} against the JWT, so a stale row (role revoked
 * since the admin last logged in) or a tampered one can at worst misroute a
 * notification - it cannot grant access to anything.
 *
 * <h2>Fire-and-forget</h2>
 * Every failure is caught and logged at WARN. A submit by a user must never
 * fail, roll back or 500 because the admin inbox could not be written - the
 * notification is a side-effect of the request, not part of it.
 *
 * <p>Delivery goes through {@link PushService#sendToUser(String,
 * PushService.PushPayload, NotificationKind)}, which files the inbox row via
 * the {@code REQUIRES_NEW} {@link UserNotificationService} BEFORE any push
 * readiness check. Two consequences that are both wanted here:
 * <ul>
 *   <li>The inbox row is written even when VAPID isn't configured or the admin
 *       has never enabled push on any device - the item still shows up in the
 *       console.</li>
 *   <li>{@code REQUIRES_NEW} keeps a failed insert from marking the caller's
 *       transaction rollback-only, which is exactly why it must not be
 *       "simplified" into the caller's transaction: the user's request row is
 *       the real work and has to commit regardless.</li>
 * </ul>
 * The accompanying web push is safe to send here because
 * {@code sendToUser} is the TRANSACTIONAL path - it does not consult
 * {@code promoPush}, which gates broadcast/marketing fan-outs only. An admin
 * queue item is not marketing, so no promo preference is involved or bypassed.
 *
 * <h2>Grouping</h2>
 * These items carry no {@code matchId} / {@code tournamentId} - they are not
 * match events - so the inbox groups them under {@code other}, which is the
 * intended reading. Each one instead carries a deep link into the matching
 * {@code /admin} module.
 */
@ApplicationScoped
public class AdminNotifier {

    private static final Logger LOG = Logger.getLogger(AdminNotifier.class);

    @Inject UserProfileRepository profiles;
    @Inject PushService push;

    /** Fan a single admin-facing item into every admin's inbox. */
    public void notifyAdmins(NotificationKind kind, String title, String body, String url) {
        if (title == null || title.isBlank()) return;
        try {
            List<String> uids = profiles.findAdminUids();
            if (uids.isEmpty()) return;
            var payload = new PushService.PushPayload(title, body == null ? "" : body, url);
            for (String uid : uids) {
                if (uid == null || uid.isBlank()) continue;
                push.sendToUser(uid, payload, kind == null ? NotificationKind.ADMIN_REQUEST : kind);
            }
        } catch (Exception e) {
            // Never propagate: the user's submit already succeeded.
            LOG.warnf(e, "AdminNotifier: failed to notify admins (kind=%s, title=%s)", kind, title);
        }
    }
}
