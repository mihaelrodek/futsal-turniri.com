package hr.mrodek.apps.futsal_turniri.controller;

import com.stripe.exception.SignatureVerificationException;
import com.stripe.model.Event;
import com.stripe.model.checkout.Session;
import hr.mrodek.apps.futsal_turniri.model.MatchRecordingRequest;
import hr.mrodek.apps.futsal_turniri.repository.MatchRecordingRequestRepository;
import hr.mrodek.apps.futsal_turniri.services.RecordingRequestNotifier;
import hr.mrodek.apps.futsal_turniri.services.StripeService;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.logging.Logger;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Receives Stripe webhook events for the recording-request payment flow.
 *
 * <p><b>Signature verification.</b> The raw request body is never trusted on
 * its own: every call is verified against the {@code Stripe-Signature}
 * header via {@link StripeService#constructWebhookEvent}, which wraps
 * {@code com.stripe.net.Webhook.constructEvent} using the configured webhook
 * signing secret ({@code stripe.webhook-secret}). A payload that fails
 * verification is rejected with 400 before touching the database.
 *
 * <p><b>Idempotency.</b> Stripe retries webhook delivery until it receives a
 * 2xx response, so the same {@code checkout.session.completed} event can
 * arrive more than once. The handler only acts when
 * {@link MatchRecordingRequest#getPaidAt()} is still null - a replayed event
 * finds it already set and is a no-op, so duplicate delivery never double-
 * charges or double-sends the download email.
 *
 * <p>Route: {@code POST /webhooks/stripe} - public (Stripe cannot present a
 * Firebase token; the signature check is the only guard, as intended).
 */
@Path("/webhooks/stripe")
public class StripeWebhookController {

    private static final Logger LOG = Logger.getLogger(StripeWebhookController.class);

    @Inject StripeService stripeService;
    @Inject MatchRecordingRequestRepository repo;
    @Inject RecordingRequestNotifier notifier;

    @POST
    @Consumes(MediaType.APPLICATION_JSON)
    @Transactional
    public Response handle(String payload, @HeaderParam("Stripe-Signature") String sigHeader) {
        Event event;
        try {
            event = stripeService.constructWebhookEvent(payload, sigHeader);
        } catch (SignatureVerificationException e) {
            LOG.warn("Stripe webhook: signature verification failed");
            return Response.status(Response.Status.BAD_REQUEST).build();
        }

        if ("checkout.session.completed".equals(event.getType())) {
            handleCheckoutCompleted(event);
        }
        // Every other event type is acknowledged but ignored - still 200, so
        // Stripe doesn't keep retrying event types we don't act on.
        return Response.ok().build();
    }

    private void handleCheckoutCompleted(Event event) {
        var deserializer = event.getDataObjectDeserializer();
        if (deserializer.getObject().isEmpty()) {
            LOG.warn("Stripe webhook: checkout.session.completed with no deserializable data object");
            return;
        }
        Object obj = deserializer.getObject().get();
        if (!(obj instanceof Session session)) {
            LOG.warn("Stripe webhook: checkout.session.completed data object was not a Session");
            return;
        }

        String uuidStr = session.getMetadata() == null ? null : session.getMetadata().get("recording_request_uuid");
        if (uuidStr == null || uuidStr.isBlank()) {
            LOG.warn("Stripe webhook: checkout.session.completed missing recording_request_uuid metadata");
            return;
        }

        UUID uuid;
        try {
            uuid = UUID.fromString(uuidStr);
        } catch (IllegalArgumentException e) {
            LOG.warnf("Stripe webhook: malformed recording_request_uuid metadata '%s'", uuidStr);
            return;
        }

        MatchRecordingRequest r = repo.findByUuid(uuid).orElse(null);
        if (r == null) {
            LOG.warnf("Stripe webhook: no recording request for uuid %s", uuidStr);
            return;
        }

        if (r.getPaidAt() != null) return; // already processed - idempotent no-op on replay

        r.setPaidAt(OffsetDateTime.now());
        r.setUpdatedAt(OffsetDateTime.now());

        if (r.getRecording() != null) {
            notifier.notifyDownloadReady(r);
        }
    }
}
