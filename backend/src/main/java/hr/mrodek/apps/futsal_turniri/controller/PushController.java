package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.model.PushSubscription;
import hr.mrodek.apps.futsal_turniri.repository.PushSubscriptionRepository;
import hr.mrodek.apps.futsal_turniri.services.PushService;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.jwt.JsonWebToken;

import java.time.OffsetDateTime;
import java.util.Map;

/**
 * Subscription management for browser Web Push.
 *
 * <ul>
 *   <li>{@code GET /push/public-key} - unauthenticated. Frontend needs the
 *       VAPID public key BEFORE the user has decided whether to subscribe,
 *       so it can be passed to {@code pushManager.subscribe()}. Public
 *       knowledge by design - the private half stays on the server.</li>
 *   <li>{@code POST /push/subscribe} - OPTIONAL identity. Upserts a
 *       subscription for the calling Firebase UID when a bearer token is
 *       present, or an ANONYMOUS subscription ({@code user_uid = NULL}) when
 *       none is. Endpoint URL is unique system-wide, so re-subscribing the
 *       same browser just refreshes p256dh/auth. An anonymous endpoint that
 *       later subscribes while logged in is ADOPTED onto that user; an
 *       endpoint already owned by a real user cannot be claimed anonymously
 *       (or by a different user) - 409.</li>
 *   <li>{@code DELETE /push/subscribe} - OPTIONAL identity. Removes a
 *       subscription by its endpoint URL, scoped to the caller's identity:
 *       a logged-in caller can only drop their own row, an anonymous caller
 *       can only drop an anonymous row. Endpoint URLs are not secrets, so a
 *       leaked endpoint alone must not detach another user's delivery.</li>
 * </ul>
 */
@Path("/push")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class PushController {

    @Inject PushService pushService;
    @Inject PushSubscriptionRepository subRepo;
    @Inject JsonWebToken jwt;

    /** Anonymous: serves the VAPID public key + a "ready" flag. */
    @GET
    @Path("/public-key")
    public Map<String, Object> publicKey() {
        return Map.of(
                "publicKey", pushService.publicKey() == null ? "" : pushService.publicKey(),
                "ready", pushService.isReady());
    }

    /**
     * Store (or refresh) a browser's subscription. Identity is OPTIONAL:
     * a bearer token makes it a logged-in subscription, its absence makes it
     * an anonymous one ({@code user_uid = NULL}). Idempotent - re-subscribing
     * the same endpoint just updates the crypto material and lastSeenAt.
     * Returns 201 either way.
     */
    @POST
    @Path("/subscribe")
    @Transactional
    public Response subscribe(SubscribeRequest body, @HeaderParam(HttpHeaders.USER_AGENT) String ua) {
        if (body == null || body.endpoint() == null || body.endpoint().isBlank()
                || body.p256dh() == null || body.p256dh().isBlank()
                || body.auth() == null || body.auth().isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST).entity("Missing endpoint/p256dh/auth").build();
        }
        // null => anonymous browser; a non-blank value => a logged-in user.
        String myUid = jwt != null ? jwt.getSubject() : null;
        if (myUid != null && myUid.isBlank()) myUid = null;

        var existing = subRepo.findByEndpoint(body.endpoint()).orElse(null);
        if (existing == null) {
            // Brand-new endpoint - owned by the caller (a real uid) or
            // anonymous (myUid == null).
            var s = new PushSubscription();
            s.setUserUid(myUid);
            s.setEndpoint(body.endpoint());
            s.setP256dh(body.p256dh());
            s.setAuth(body.auth());
            s.setUserAgent(truncate(ua, 512));
            subRepo.persist(s);
        } else if (myUid == null) {
            // Anonymous re-subscribe of a known endpoint. Allowed only when the
            // row is itself anonymous - an anon caller must NOT be able to
            // touch (or silently take over) a subscription a real user owns,
            // since endpoint URLs aren't secrets. 409 otherwise.
            if (existing.getUserUid() != null) {
                return Response.status(Response.Status.CONFLICT)
                        .entity("Endpoint claimed by a user.").build();
            }
            refresh(existing, body, ua);
        } else if (existing.getUserUid() == null) {
            // ADOPTION: this browser subscribed anonymously earlier and is now
            // logged in. Claim the row for the user so future fan-outs treat it
            // as theirs; refresh crypto material at the same time.
            existing.setUserUid(myUid);
            refresh(existing, body, ua);
        } else if (existing.getUserUid().equals(myUid)) {
            // Same user re-subscribing the same browser - refresh. Idempotent.
            refresh(existing, body, ua);
        } else {
            // The endpoint URL is already claimed by a DIFFERENT user.
            // We REFUSE the silent takeover that the old code performed,
            // because endpoint URLs aren't secrets - the browser
            // transmits them to the push service and some implementations
            // expose them in extension contexts. Silently reassigning
            // ownership would let an attacker who learned a victim's
            // endpoint hijack their push delivery (victim stops receiving,
            // attacker starts). 409 mirrors the spec's "subscription
            // already exists" expectation.
            return Response.status(Response.Status.CONFLICT)
                    .entity("Endpoint claimed by another user.").build();
        }
        return Response.status(Response.Status.CREATED).build();
    }

    /** Refresh crypto material + last-seen on an existing subscription. */
    private void refresh(PushSubscription existing, SubscribeRequest body, String ua) {
        existing.setP256dh(body.p256dh());
        existing.setAuth(body.auth());
        existing.setUserAgent(truncate(ua, 512));
        existing.setLastSeenAt(OffsetDateTime.now());
        subRepo.persist(existing);
    }

    /**
     * Drop a subscription matching the given endpoint, scoped to the caller's
     * identity. Ownership IS enforced: a logged-in caller deletes only rows
     * where {@code userUid = jwt.subject AND endpoint = ?}; an anonymous caller
     * deletes only ANONYMOUS rows for that endpoint ({@code userUid IS NULL}).
     *
     * <p>Push endpoint URLs are not secrets - the browser transmits them to the
     * push service and a few extension contexts can read them - so an attacker
     * who learns a victim's endpoint must not be able to unsubscribe them.
     */
    @DELETE
    @Path("/subscribe")
    @Transactional
    public Response unsubscribe(@QueryParam("endpoint") String endpoint) {
        if (endpoint == null || endpoint.isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST).build();
        }
        String myUid = jwt != null ? jwt.getSubject() : null;
        if (myUid != null && !myUid.isBlank()) {
            subRepo.deleteByUserUidAndEndpoint(myUid, endpoint);
        } else {
            // Anonymous caller - only anonymous rows for this endpoint.
            subRepo.deleteAnonByEndpoint(endpoint);
        }
        return Response.noContent().build();
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }

    public record SubscribeRequest(String endpoint, String p256dh, String auth) {}
}
