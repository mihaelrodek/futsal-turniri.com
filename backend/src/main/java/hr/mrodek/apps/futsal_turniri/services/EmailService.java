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
import java.util.Map;

/**
 * Transactional-email sender (Resend SMTP via quarkus-mailer).
 *
 * <p>Every send is <em>fire-and-forget</em> and swallows failures - exactly
 * like {@link PushService}: a flaky mail server must never break the request
 * that triggered the notification. When SMTP credentials aren't configured
 * ({@code MAIL_SMTP_LOGIN} empty) {@link #isReady()} is false and every send is
 * a silent no-op, so the app runs fine locally / before Resend is wired up.
 */
@ApplicationScoped
public class EmailService {

    private static final Logger LOG = Logger.getLogger(EmailService.class);

    @Inject ReactiveMailer mailer;
    @Inject TournamentSubscriptionRepository tournamentSubRepo;
    @Inject UserProfileRepository profileRepo;
    @Inject MessageService messages;

    /** Absent when SMTP isn't configured → sending is skipped. Optional, NOT a
     *  defaultValue="" String - SmallRye Config treats an empty string as a
     *  missing value and fails the injection at boot. */
    @ConfigProperty(name = "quarkus.mailer.username")
    java.util.Optional<String> smtpUser;

    @ConfigProperty(name = "app.mail.base-url", defaultValue = "http://localhost:5181")
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
     *
     * <p><b>Deliberately NOT gated on {@code UserProfile.promoEmail}.</b> The
     * recipients here are exactly the people who tapped the bell on this
     * tournament, and the only current caller is the "turnir je završio,
     * pobjednik je X" mail - a subscription event, not marketing. The
     * account-wide promo switch governs broadcast-style promo / general
     * announcements only, and must never silence something a user explicitly
     * followed. A future promo blast should filter its recipients through
     * {@code UserProfileRepository.filterPromoEmailAllowed(uids)} (one query,
     * never per-recipient).
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
     * The markup itself lives in {@code src/main/resources/mail/shell.html} /
     * {@code cta.html} - see {@link MailTemplates}.
     */
    public String shell(String heading, String bodyHtml, String ctaUrl, String ctaLabel) {
        String cta = (ctaUrl == null || ctaUrl.isBlank())
                ? ""
                : MailTemplates.render("cta", Map.of(
                        "url", escapeHtml(ctaUrl),
                        "label", escapeHtml(ctaLabel == null ? messages.t("mail.shell.defaultCtaLabel") : ctaLabel)));

        return MailTemplates.render("shell", Map.of(
                "heading", escapeHtml(heading),
                "body", bodyHtml,
                "cta", cta,
                "footer", messages.t("mail.shell.footer")));
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
