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

    @ConfigProperty(name = "stripe.secret-key", defaultValue = "")
    String secretKey;

    @ConfigProperty(name = "stripe.webhook-secret", defaultValue = "")
    String webhookSecret;

    public boolean isConfigured() {
        return secretKey != null && !secretKey.isBlank();
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
            StripeClient client = new StripeClient(secretKey);
            Session session = client.checkout().sessions().create(params);
            return session.getUrl();
        } catch (StripeException e) {
            throw new RuntimeException(
                    "Stripe: failed to create checkout session for recording request " + requestUuid, e);
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
        return Webhook.constructEvent(payload, sigHeader, webhookSecret);
    }
}
