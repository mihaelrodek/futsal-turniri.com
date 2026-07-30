package hr.mrodek.apps.futsal_turniri.services;

import com.stripe.StripeClient;
import com.stripe.exception.SignatureVerificationException;
import com.stripe.exception.StripeException;
import com.stripe.model.Event;
import com.stripe.model.checkout.Session;
import com.stripe.net.Webhook;
import com.stripe.param.checkout.SessionCreateParams;
import jakarta.enterprise.context.ApplicationScoped;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.util.List;
import java.util.Optional;

/**
 * Thin wrapper around stripe-java for the recording-request payment flow: one
 * Stripe Checkout Session per approved request
 * ({@link #createCheckoutSession}), and webhook-signature verification for
 * the resulting {@code checkout.session.completed} event
 * ({@link #constructWebhookEvent}).
 *
 * <p>Both keys default to blank so the app boots without Stripe configured;
 * {@link #isConfigured()} gates every caller. The real keys live only in
 * {@code .env} / {@code .env.prod} (git-ignored) - never in
 * {@code application.properties} or any committed file.
 */
@ApplicationScoped
public class StripeService {

    // Optional, not defaultValue="": SmallRye's String converter treats an
    // empty string as null and fails startup validation on it - Optional is
    // the supported way to express "may be absent/blank".
    @ConfigProperty(name = "stripe.secret-key")
    Optional<String> secretKey;

    @ConfigProperty(name = "stripe.webhook-secret")
    Optional<String> webhookSecret;

    public boolean isConfigured() {
        return secretKey.filter(s -> !s.isBlank()).isPresent();
    }

    /**
     * Creates a one-off Checkout Session (mode PAYMENT, single line item) for
     * a recording-request payment. The request uuid is stamped into the
     * session metadata so {@code StripeWebhookController} can resolve the
     * request back from the completed-checkout event without any other state.
     */
    public String createCheckoutSession(String requestUuid, long amountCents, String productName,
                                         String successUrl, String cancelUrl) {
        if (!isConfigured()) {
            throw new IllegalStateException("Stripe is not configured (stripe.secret-key is blank).");
        }

        SessionCreateParams params = SessionCreateParams.builder()
                .setMode(SessionCreateParams.Mode.PAYMENT)
                .setSuccessUrl(successUrl)
                .setCancelUrl(cancelUrl)
                .putMetadata("recording_request_uuid", requestUuid)
                .addLineItem(SessionCreateParams.LineItem.builder()
                        .setQuantity(1L)
                        .setPriceData(SessionCreateParams.LineItem.PriceData.builder()
                                .setCurrency("eur")
                                .setUnitAmount(amountCents)
                                .setProductData(SessionCreateParams.LineItem.PriceData.ProductData.builder()
                                        .setName(productName)
                                        .build())
                                .build())
                        .build())
                .build();

        try {
            StripeClient client = new StripeClient(secretKey.orElseThrow());
            Session session = client.checkout().sessions().create(params);
            return session.getUrl();
        } catch (StripeException e) {
            throw new RuntimeException(
                    "Stripe: failed to create checkout session for recording request " + requestUuid, e);
        }
    }

    /** One priced line on a /cjenik cart order (a tier, e.g. "Hattrick"). */
    public record CartLineItem(String name, long amountCents) {}

    /**
     * Creates a Checkout Session (mode PAYMENT) covering an entire /cjenik
     * cart in one payment - one Stripe line item per cart tier, so the payer
     * sees each package priced separately even though a single charge covers
     * all of them. The cart's group id is stamped into the session metadata
     * so {@code StripeWebhookController} can mark every generated
     * {@code MatchRecordingRequest} row paid from this one event.
     */
    public String createCartCheckoutSession(String cartGroupId, List<CartLineItem> items,
                                             String successUrl, String cancelUrl) {
        if (!isConfigured()) {
            throw new IllegalStateException("Stripe is not configured (stripe.secret-key is blank).");
        }

        SessionCreateParams.Builder builder = SessionCreateParams.builder()
                .setMode(SessionCreateParams.Mode.PAYMENT)
                .setSuccessUrl(successUrl)
                .setCancelUrl(cancelUrl)
                .putMetadata("cart_group_id", cartGroupId);
        for (CartLineItem item : items) {
            builder.addLineItem(SessionCreateParams.LineItem.builder()
                    .setQuantity(1L)
                    .setPriceData(SessionCreateParams.LineItem.PriceData.builder()
                            .setCurrency("eur")
                            .setUnitAmount(item.amountCents())
                            .setProductData(SessionCreateParams.LineItem.PriceData.ProductData.builder()
                                    .setName(item.name())
                                    .build())
                            .build())
                    .build());
        }

        try {
            StripeClient client = new StripeClient(secretKey.orElseThrow());
            Session session = client.checkout().sessions().create(builder.build());
            return session.getUrl();
        } catch (StripeException e) {
            throw new RuntimeException(
                    "Stripe: failed to create cart checkout session for cart " + cartGroupId, e);
        }
    }

    /**
     * Verifies the {@code Stripe-Signature} header against the raw request
     * body using the configured webhook secret and returns the parsed event.
     * Throws {@link SignatureVerificationException} (a checked
     * {@link StripeException}) when the signature doesn't match - callers
     * must catch it and respond 400, never trusting an unverified payload.
     */
    public Event constructWebhookEvent(String payload, String sigHeader) throws SignatureVerificationException {
        return Webhook.constructEvent(payload, sigHeader, webhookSecret.orElse(""));
    }
}
