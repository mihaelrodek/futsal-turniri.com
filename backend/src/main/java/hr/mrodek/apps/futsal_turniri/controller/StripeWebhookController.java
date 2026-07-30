package hr.mrodek.apps.futsal_turniri.controller;

import com.stripe.exception.SignatureVerificationException;
import com.stripe.model.Event;
import com.stripe.model.checkout.Session;
import hr.mrodek.apps.futsal_turniri.model.MatchRecordingRequest;
import hr.mrodek.apps.futsal_turniri.repository.MatchRecordingRequestRepository;
import hr.mrodek.apps.futsal_turniri.services.RecordingAutoLinkService;
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
import java.util.List;
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
    @Inject RecordingAutoLinkService autoLink;
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

        var metadata = session.getMetadata();
        String cartGroupIdStr = metadata == null ? null : metadata.get("cart_group_id");
        if (cartGroupIdStr != null && !cartGroupIdStr.isBlank()) {
            handleCartCheckoutCompleted(cartGroupIdStr, session);
            return;
        }

        String uuidStr = metadata == null ? null : metadata.get("recording_request_uuid");
        if (uuidStr == null || uuidStr.isBlank()) {
            LOG.warn("Stripe webhook: checkout.session.completed with neither cart_group_id nor recording_request_uuid metadata");
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
        // Payment reference: the session id finds the charge in the Stripe
        // dashboard; the payer email is whatever the payer typed on the
        // Checkout page - it may legitimately differ from the request's
        // contactEmail (the status link is a capability anyone can pay).
        r.setStripeSessionId(session.getId());
        r.setPayerEmail(session.getCustomerDetails() != null ? session.getCustomerDetails().getEmail() : null);
        r.setUpdatedAt(OffsetDateTime.now());

        // Auto-link a library recording if one already exists for this match,
        // and send the download-ready email either way it ends up linked.
        autoLink.autoLinkAndNotify(r);
    }

    /**
     * A /cjenik cart order (Hattrick, Zlatna kopačka, or a mixed cart) pays
     * for N {@code MatchRecordingRequest} rows in one Checkout Session, all
     * sharing {@code cartGroupId}. Marks each unpaid row in the group paid
     * (idempotent per row, same as the single-request path), auto-links a
     * library recording where one already exists, and sends ONE admin
     * heads-up email (on the first row - its {@code note} carries the whole
     * order's summary, stamped at creation time) instead of one per match.
     */
    private void handleCartCheckoutCompleted(String cartGroupIdStr, Session session) {
        UUID cartGroupId;
        try {
            cartGroupId = UUID.fromString(cartGroupIdStr);
        } catch (IllegalArgumentException e) {
            LOG.warnf("Stripe webhook: malformed cart_group_id metadata '%s'", cartGroupIdStr);
            return;
        }

        List<MatchRecordingRequest> rows = repo.findByCartGroupId(cartGroupId);
        if (rows.isEmpty()) {
            LOG.warnf("Stripe webhook: no rows for cart_group_id %s", cartGroupIdStr);
            return;
        }

        String payerEmail = session.getCustomerDetails() != null ? session.getCustomerDetails().getEmail() : null;
        boolean anyNewlyPaid = false;
        for (MatchRecordingRequest r : rows) {
            if (r.getPaidAt() != null) continue; // already processed - idempotent no-op on replay
            anyNewlyPaid = true;
            r.setPaidAt(OffsetDateTime.now());
            r.setStripeSessionId(session.getId());
            r.setPayerEmail(payerEmail);
            r.setUpdatedAt(OffsetDateTime.now());
            autoLink.autoLinkAndNotify(r);
        }

        if (anyNewlyPaid) {
            notifier.notifyAdmin(rows.get(0), rows.get(0).getMatch());
        }
    }
}
