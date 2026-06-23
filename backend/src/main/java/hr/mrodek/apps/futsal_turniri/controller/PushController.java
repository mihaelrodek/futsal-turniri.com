package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.model.PushSubscription;
import hr.mrodek.apps.futsal_turniri.repository.PushSubscriptionRepository;
import hr.mrodek.apps.futsal_turniri.services.PushService;
import io.quarkus.security.Authenticated;
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
 *   <li>{@code GET /push/public-key} — unauthenticated. Frontend needs the
 *       VAPID public key BEFORE the user has decided whether to subscribe,
 *       so it can be passed to {@code pushManager.subscribe()}. Public
 *       knowledge by design — the private half stays on the server.</li>
 *   <li>{@code POST /push/subscribe} — authenticated. Upserts a
 *       subscription owned by the calling Firebase UID. Endpoint URL is
 *       unique system-wide, so re-subscribing the same browser just
 *       refreshes p256dh/auth.</li>
 *   <li>{@code DELETE /push/subscribe} — authenticated. Removes a specific
 *       subscription by its endpoint URL. Used when the user toggles
 *       notifications off in browser settings or in the app.</li>
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
     * Store (or refresh) a browser's subscription for the calling user.
     * Idempotent — re-subscribing the same endpoint just updates the
     * crypto material and lastSeenAt. Returns 201 either way.
     */
    @POST
    @Path("/subscribe")
    @Authenticated
    @Transactional
    public Response subscribe(SubscribeRequest body, @HeaderParam(HttpHeaders.USER_AGENT) String ua) {
        if (body == null || body.endpoint() == null || body.endpoint().isBlank()
                || body.p256dh() == null || body.p256dh().isBlank()
                || body.auth() == null || body.auth().isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST).entity("Missing endpoint/p256dh/auth").build();
        }
        String myUid = jwt.getSubject();
        if (myUid == null || myUid.isBlank()) {
            return Response.status(Response.Status.UNAUTHORIZED).build();
        }

        var existing = subRepo.findByEndpoint(body.endpoint()).orElse(null);
        if (existing == null) {
            var s = new PushSubscription();
            s.setUserUid(myUid);
            s.setEndpoint(body.endpoint());
            s.setP256dh(body.p256dh());
            s.setAuth(body.auth());
            s.setUserAgent(truncate(ua, 512));
            subRepo.persist(s);
        } else if (existing.getUserUid() == null || existing.getUserUid().equals(myUid)) {
            // Same user re-subscribing the same browser — refresh crypto
            // material and last-seen. Idempotent.
            existing.setP256dh(body.p256dh());
            existing.setAuth(body.auth());
            existing.setUserAgent(truncate(ua, 512));
            existing.setLastSeenAt(OffsetDateTime.now());
            subRepo.persist(existing);
        } else {
            // The endpoint URL is already claimed by a different user.
            // We REFUSE the silent takeover that the old code performed,
            // because endpoint URLs aren't secrets — the browser
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

    /**
     * Drop the calling user's subscription matching the given endpoint.
     *
     * <p>Ownership IS enforced: the delete is scoped to rows where
     * {@code userUid = jwt.subject AND endpoint = ?}. Push endpoint URLs
     * are not secrets — the browser transmits them to the push service
     * and a few extension contexts can read them — so an attacker who
     * learns a victim's endpoint must not be able to unsubscribe them.
     */
    @DELETE
    @Path("/subscribe")
    @Authenticated
    @Transactional
    public Response unsubscribe(@QueryParam("endpoint") String endpoint) {
        if (endpoint == null || endpoint.isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST).build();
        }
        String myUid = jwt != null ? jwt.getSubject() : null;
        if (myUid == null || myUid.isBlank()) {
            return Response.status(Response.Status.UNAUTHORIZED).build();
        }
        subRepo.deleteByUserUidAndEndpoint(myUid, endpoint);
        return Response.noContent().build();
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() <= max ? s : s.substring(0, max);
    }

    public record SubscribeRequest(String endpoint, String p256dh, String auth) {}
}
