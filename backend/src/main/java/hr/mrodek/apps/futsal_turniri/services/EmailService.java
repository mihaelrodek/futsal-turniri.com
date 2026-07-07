package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.repository.TournamentSubscriptionRepository;
import hr.mrodek.apps.futsal_turniri.repository.UserProfileRepository;
import io.quarkus.mailer.Mail;
import io.quarkus.mailer.reactive.ReactiveMailer;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;

/**
 * Transactional-email sender (Brevo SMTP via quarkus-mailer).
 *
 * <p>Every send is <em>fire-and-forget</em> and swallows failures - exactly
 * like {@link PushService}: a flaky mail server must never break the request
 * that triggered the notification. When SMTP credentials aren't configured
 * ({@code MAIL_SMTP_LOGIN} empty) {@link #isReady()} is false and every send is
 * a silent no-op, so the app runs fine locally / before Brevo is wired up.
 */
@ApplicationScoped
public class EmailService {

    private static final Logger LOG = Logger.getLogger(EmailService.class);

    @Inject ReactiveMailer mailer;
    @Inject TournamentSubscriptionRepository tournamentSubRepo;
    @Inject UserProfileRepository profileRepo;

    /** Absent when SMTP isn't configured → sending is skipped. Optional, NOT a
     *  defaultValue="" String - SmallRye Config treats an empty string as a
     *  missing value and fails the injection at boot. */
    @ConfigProperty(name = "quarkus.mailer.username")
    java.util.Optional<String> smtpUser;

    @ConfigProperty(name = "app.mail.base-url", defaultValue = "http://localhost:5174")
    String baseUrl;

    /** True only when SMTP credentials are present; otherwise no mail is sent. */
    public boolean isReady() {
        return smtpUser.filter(u -> !u.isBlank()).isPresent();
    }

    public String baseUrl() {
        return baseUrl;
    }

    /**
     * Send one HTML email. Never throws, never blocks the caller (subscribes to
     * the reactive send and returns immediately). No-op when not configured or
     * the address/subject/body is blank.
     */
    public void sendHtml(String to, String subject, String html) {
        if (!isReady()) return;
        if (to == null || to.isBlank() || subject == null || html == null) return;
        try {
            mailer.send(Mail.withHtml(to.trim(), subject, html))
                    .subscribe().with(
                            ignored -> { },
                            err -> LOG.warnf(err, "Email: send failed to %s", to));
        } catch (Exception e) {
            LOG.warnf(e, "Email: send threw for %s", to);
        }
    }

    /**
     * Fan-out an HTML email to every user who follows a tournament (the same
     * opt-in table push uses). Resolves subscriber UIDs → profile emails,
     * de-duped case-insensitively. No-op when not configured.
     */
    @Transactional
    public void sendToTournamentSubscribers(Long tournamentId, String subject, String html) {
        if (!isReady() || tournamentId == null) return;
        var subs = tournamentSubRepo.findByTournamentId(tournamentId);
        if (subs.isEmpty()) return;

        List<String> uids = new ArrayList<>();
        for (var s : subs) {
            if (s.getUserUid() != null && !s.getUserUid().isBlank()) uids.add(s.getUserUid());
        }
        if (uids.isEmpty()) return;

        var profiles = profileRepo.findByUids(uids);
        var sent = new HashSet<String>();
        for (var p : profiles.values()) {
            String email = p.getEmail();
            if (email == null || email.isBlank()) continue;
            if (!sent.add(email.toLowerCase())) continue; // one mail per address
            sendHtml(email, subject, html);
        }
    }

    /* ─────────────────────────── HTML helpers ─────────────────────────── */

    /**
     * Wrap body content in a simple branded, inline-styled shell (email clients
     * strip &lt;style&gt; and external CSS, so everything is inline). Optional
     * CTA button. Always appends a plain-language footer noting why the user
     * got the mail + how to stop it (GDPR-friendly for opted-in notifications).
     */
    public String shell(String heading, String bodyHtml, String ctaUrl, String ctaLabel) {
        String cta = (ctaUrl == null || ctaUrl.isBlank())
                ? ""
                : "<div style=\"margin:24px 0;\">"
                + "<a href=\"" + escapeHtml(ctaUrl) + "\" "
                + "style=\"display:inline-block;background:#0b6b3a;color:#ffffff;text-decoration:none;"
                + "font-weight:700;font-size:15px;padding:12px 22px;border-radius:10px;\">"
                + escapeHtml(ctaLabel == null ? "Otvori" : ctaLabel) + "</a></div>";

        return "<!doctype html><html lang=\"hr\"><body style=\"margin:0;background:#f1f5f2;"
                + "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;\">"
                + "<div style=\"max-width:520px;margin:0 auto;padding:24px;\">"
                + "<div style=\"background:#ffffff;border:1px solid #e2e8e4;border-radius:16px;overflow:hidden;\">"
                + "<div style=\"background:linear-gradient(135deg,#0b6b3a,#084a28);padding:20px 24px;color:#fff;"
                + "font-weight:800;letter-spacing:0.02em;font-size:16px;\">Futsal Turniri</div>"
                + "<div style=\"padding:24px;color:#0f172a;\">"
                + "<h1 style=\"font-size:20px;margin:0 0 12px;letter-spacing:-0.01em;\">" + escapeHtml(heading) + "</h1>"
                + "<div style=\"font-size:15px;line-height:1.6;color:#334155;\">" + bodyHtml + "</div>"
                + cta
                + "</div></div>"
                + "<p style=\"font-size:12px;color:#94a3b8;text-align:center;margin:16px 8px;line-height:1.5;\">"
                + "Primaš ovu poruku jer pratiš turnir na Futsal Turniri. "
                + "Za odjavu isključi praćenje (zvonce) na stranici turnira.</p>"
                + "</div></body></html>";
    }

    /** Minimal HTML escaping for user-supplied text interpolated into email HTML. */
    public static String escapeHtml(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;");
    }
}
