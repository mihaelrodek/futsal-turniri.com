package hr.mrodek.apps.futsal_turniri.services;

import com.fasterxml.jackson.databind.ObjectMapper;
import hr.mrodek.apps.futsal_turniri.model.PushSubscription;
import hr.mrodek.apps.futsal_turniri.repository.PushSubscriptionRepository;
import hr.mrodek.apps.futsal_turniri.repository.TournamentSubscriptionRepository;
import io.quarkus.runtime.StartupEvent;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import nl.martijndwars.webpush.Notification;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.security.Security;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Wraps {@code nl.martijndwars.webpush.PushService} so the rest of the app
 * can fire-and-forget notifications without touching VAPID, BouncyCastle,
 * or Base64URL details.
 *
 * <p>Lifecycle:
 * <ul>
 *   <li>On startup, registers BouncyCastle (web-push needs it for the
 *       per-message AES-GCM crypto) and constructs a singleton
 *       {@link PushService} pinned to the configured VAPID keys.</li>
 *   <li>Each {@code sendToUser(uid, payload)} call looks up every
 *       subscription that user has registered (one per device) and pushes
 *       in series — fine for the per-team-approval flow where the fan-out
 *       is small.</li>
 *   <li>On a 404 / 410 from the push service, the subscription is
 *       permanently dropped — that's the spec's way of saying "this
 *       browser uninstalled, stop sending".</li>
 * </ul>
 */
@ApplicationScoped
public class PushService {

    private static final Logger LOG = Logger.getLogger(PushService.class);

    @Inject PushSubscriptionRepository subRepo;
    @Inject TournamentSubscriptionRepository tournamentSubRepo;
    @Inject ObjectMapper objectMapper;

    // defaultValue="" so SmallRye Config doesn't bail at startup when the
    // VAPID env vars are unset (push is optional — backend boots without it
    // and /push/public-key reports ready=false).
    @ConfigProperty(name = "push.vapid.public-key", defaultValue = "")
    String vapidPublicKey;

    @ConfigProperty(name = "push.vapid.private-key", defaultValue = "")
    String vapidPrivateKey;

    @ConfigProperty(name = "push.vapid.subject", defaultValue = "mailto:noreply@nogometni-turniri.com")
    String vapidSubject;

    /** Lazily-built singleton — null until VAPID config is present. */
    private volatile nl.martijndwars.webpush.PushService webPush;

    void onStart(@Observes StartupEvent ev) {
        Security.addProvider(new org.bouncycastle.jce.provider.BouncyCastleProvider());
        if (vapidPublicKey == null || vapidPublicKey.isBlank()
                || vapidPrivateKey == null || vapidPrivateKey.isBlank()) {
            LOG.warn("Push: VAPID keys not configured — push notifications disabled.");
            return;
        }
        try {
            this.webPush = new nl.martijndwars.webpush.PushService(
                    vapidPublicKey, vapidPrivateKey, vapidSubject);
            LOG.info("Push: VAPID configured, subject=" + vapidSubject);
        } catch (Exception e) {
            LOG.error("Push: failed to initialise web-push service", e);
        }
    }

    /** Whether the service is configured and able to deliver pushes. */
    public boolean isReady() {
        return webPush != null;
    }

    /** Public VAPID key in base64url, served unauthenticated to subscribers. */
    public String publicKey() {
        return vapidPublicKey;
    }

    /**
     * Fan-out to every subscription registered by {@code userUid}. Failures
     * for individual subscriptions are logged but never thrown — the
     * approve-team flow that calls this shouldn't fail because of a flaky
     * push service.
     */
    @Transactional
    public void sendToUser(String userUid, PushPayload payload) {
        if (userUid == null || userUid.isBlank()) return;
        if (!isReady()) return;
        var subs = subRepo.findByUserUid(userUid);
        if (subs.isEmpty()) return;
        String json = serialize(payload);
        for (var sub : subs) {
            sendOne(sub, json);
        }
    }

    /**
     * Fan-out for tournament-scoped live events (goals, second half,
     * finished matches). Resolves every user that opted into the
     * tournament's bell, then walks each user's per-device push
     * subscriptions and sends one notification per device.
     *
     * <p>One subscriber's failure (bad endpoint, expired browser sub,
     * network blip) MUST NOT abort the rest of the fan-out — wraps each
     * per-device send in the same try/catch path that {@link #sendOne}
     * already uses, so a single 410 only kills its own subscription.
     */
    @Transactional
    public void sendToTournamentSubscribers(Long tournamentId, String title, String body, String url) {
        if (tournamentId == null) return;
        if (!isReady()) return;
        var tournamentSubs = tournamentSubRepo.findByTournamentId(tournamentId);
        if (tournamentSubs.isEmpty()) return;

        String json = serialize(new PushPayload(title, body, url));
        for (var ts : tournamentSubs) {
            String uid = ts.getUserUid();
            if (uid == null || uid.isBlank()) continue;
            try {
                var deviceSubs = subRepo.findByUserUid(uid);
                for (var deviceSub : deviceSubs) {
                    // sendOne already swallows per-device failures and
                    // logs them — wrapping here is belt-and-braces
                    // against an unexpected throw escaping the inner
                    // catch.
                    try {
                        sendOne(deviceSub, json);
                    } catch (Exception inner) {
                        LOG.warnf(inner,
                                "Push: tournament fan-out failed for subscription %d (uid=%s)",
                                deviceSub.getId(), uid);
                    }
                }
            } catch (Exception outer) {
                LOG.warnf(outer,
                        "Push: tournament fan-out failed for uid=%s tournament=%d",
                        uid, tournamentId);
            }
        }
    }

    private void sendOne(PushSubscription sub, String payloadJson) {
        try {
            var notification = new Notification(
                    sub.getEndpoint(),
                    decodePublicKey(sub.getP256dh()),
                    Base64.getUrlDecoder().decode(padBase64(sub.getAuth())),
                    payloadJson.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            var response = webPush.send(notification);
            int code = response.getStatusLine().getStatusCode();
            if (code >= 200 && code < 300) {
                sub.setLastSeenAt(OffsetDateTime.now());
                subRepo.persist(sub);
            } else if (code == 404 || code == 410) {
                // Subscription has expired / app uninstalled. Drop it.
                LOG.infof("Push: dropping expired subscription %d (HTTP %d)", sub.getId(), code);
                subRepo.deleteByEndpoint(sub.getEndpoint());
            } else {
                LOG.warnf("Push: unexpected response HTTP %d for sub %d", code, sub.getId());
            }
        } catch (Exception e) {
            LOG.warnf(e, "Push: send failed for subscription %d", sub.getId());
        }
    }

    private java.security.PublicKey decodePublicKey(String b64url) throws Exception {
        byte[] raw = Base64.getUrlDecoder().decode(padBase64(b64url));
        var params = org.bouncycastle.jce.ECNamedCurveTable.getParameterSpec("secp256r1");
        var pubPoint = params.getCurve().decodePoint(raw);
        var spec = new org.bouncycastle.jce.spec.ECPublicKeySpec(pubPoint, params);
        var kf = java.security.KeyFactory.getInstance("ECDH", "BC");
        return kf.generatePublic(spec);
    }

    private static String padBase64(String s) {
        int pad = (4 - (s.length() % 4)) % 4;
        return pad == 0 ? s : s + "=".repeat(pad);
    }

    private String serialize(PushPayload payload) {
        try {
            return objectMapper.writeValueAsString(toMap(payload));
        } catch (Exception e) {
            throw new RuntimeException("Push: failed to serialise payload", e);
        }
    }

    private Map<String, Object> toMap(PushPayload payload) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("title", payload.title());
        m.put("body", payload.body());
        Optional.ofNullable(payload.url()).ifPresent(u -> m.put("url", u));
        Optional.ofNullable(payload.icon()).ifPresent(u -> m.put("icon", u));
        Optional.ofNullable(payload.tag()).ifPresent(t -> m.put("tag", t));
        return m;
    }

    /**
     * Wire shape of a single push. The frontend service worker reads these
     * three fields from {@code event.data.json()} and forwards them to
     * {@code showNotification}; {@code url} is stamped onto the notification's
     * data so {@code notificationclick} can open the right page.
     */
    public record PushPayload(
            String title,
            String body,
            String url,
            String icon,
            String tag
    ) {
        public PushPayload(String title, String body, String url) {
            this(title, body, url, "/futsal-turniri-symbol.png", null);
        }
    }
}
