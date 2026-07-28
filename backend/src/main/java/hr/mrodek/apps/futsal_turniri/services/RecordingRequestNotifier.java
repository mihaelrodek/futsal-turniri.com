package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.enums.RecordingRequestKind;
import hr.mrodek.apps.futsal_turniri.model.MatchRecordingRequest;
import hr.mrodek.apps.futsal_turniri.model.Matches;
import hr.mrodek.apps.futsal_turniri.repository.AppSettingsRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import java.util.Map;

/**
 * All outbound email for the recording-request lifecycle: admin notify,
 * requester confirmation, approved/rejected, and the final "download ready"
 * mail once a request is both paid and delivered. Centralised here so both
 * {@link hr.mrodek.apps.futsal_turniri.controller.RecordingRequestController}
 * and {@link hr.mrodek.apps.futsal_turniri.controller.StripeWebhookController}
 * can trigger the same "download ready" copy without duplicating markup.
 *
 * <p>Every {@link MatchRecordingRequest} / {@link Matches} passed in here must
 * already have its lazy fields (team names, tournament) resolved on the
 * caller's own request thread - this class only reads what's handed to it,
 * it never triggers its own lazy loads.
 *
 * <p>Each method below builds a small {@code vars} map and renders one email
 * body template from {@code src/main/resources/mail/} via {@link MailTemplates}
 * - no HTML is built inline here. Every value that comes from user input is
 * escaped with {@link EmailService#escapeHtml} before it enters the map.
 */
@ApplicationScoped
public class RecordingRequestNotifier {

    @Inject EmailService emailService;
    @Inject AppSettingsRepository settings;

    /** "Team A - Team B" with graceful fallback for undecided knockout slots. */
    public static String matchLabel(Matches m) {
        String t1 = m.getTeam1() != null ? m.getTeam1().getName() : "TBD";
        String t2 = m.getTeam2() != null ? m.getTeam2().getName() : "TBD";
        return t1 + " - " + t2;
    }

    /** "20,00 €" from a euro-cents amount - deliberately locale-independent. */
    public static String formatEurCents(int cents) {
        int whole = cents / 100;
        int fraction = Math.abs(cents % 100);
        return whole + "," + (fraction < 10 ? "0" + fraction : String.valueOf(fraction)) + " €";
    }

    /** Croatian noun phrase for the request's kind, used in every notification. */
    public static String kindLabel(RecordingRequestKind kind) {
        return kind == RecordingRequestKind.GOAL ? "snimku gola" : "snimku utakmice";
    }

    /** "Gol: 12' - M. Rodek (Ekipa A)" paragraph for goal-clip requests, "" otherwise. */
    private static String goalHtml(MatchRecordingRequest r) {
        if (r.getKind() != RecordingRequestKind.GOAL || r.getGoalLabel() == null) return "";
        return MailTemplates.render("recording-goal-line",
                Map.of("goalLabel", EmailService.escapeHtml(r.getGoalLabel())));
    }

    /** "(turnir X)" suffix, or "" when the match has no tournament name. */
    private static String tournamentLine(Matches match) {
        String name = match.getTournament() != null ? match.getTournament().getName() : null;
        return name == null || name.isBlank() ? "" : " (turnir " + EmailService.escapeHtml(name) + ")";
    }

    private String statusLink(MatchRecordingRequest r) {
        return emailService.baseUrl() + "/snimke/zahtjev/" + r.getUuid();
    }

    /** Fire-and-forget admin notification of a new request. */
    public void notifyAdmin(MatchRecordingRequest r, Matches match) {
        String notifyEmail = settings.get("recording_notify_email");
        if (notifyEmail == null || notifyEmail.isBlank() || !emailService.isReady()) return;

        boolean goal = r.getKind() == RecordingRequestKind.GOAL;
        String subject = goal ? "Novi zahtjev za snimku gola" : "Novi zahtjev za snimku utakmice";
        String link = emailService.baseUrl() + "/profil";
        String body = MailTemplates.render("recording-admin-notify", Map.of(
                "kind", kindLabel(r.getKind()),
                "label", EmailService.escapeHtml(matchLabel(match)),
                "tournamentLine", tournamentLine(match),
                "goal", goalHtml(r),
                "noteLine", r.getNote() == null ? "" : "<p>Napomena: " + EmailService.escapeHtml(r.getNote()) + "</p>"));
        String html = emailService.shell(subject, body, link, "Otvori");
        emailService.sendHtml(notifyEmail, subject, html);
    }

    /** Confirmation sent to the requester right after submission. */
    public void notifyRequestReceived(MatchRecordingRequest r, Matches match) {
        String to = r.getContactEmail();
        if (to == null || to.isBlank() || !emailService.isReady()) return;

        String body = MailTemplates.render("recording-request-received", Map.of(
                "kind", kindLabel(r.getKind()),
                "label", EmailService.escapeHtml(matchLabel(match)),
                "tournamentLine", tournamentLine(match),
                "goal", goalHtml(r)));
        String html = emailService.shell("Zahtjev za snimku je zaprimljen", body, statusLink(r), "Pogledaj status");
        emailService.sendHtml(to, "Zahtjev za snimku je zaprimljen", html);
    }

    /** Sent when an admin approves the request - states the price and asks for payment. */
    public void notifyApproved(MatchRecordingRequest r, Matches match) {
        String to = r.getContactEmail();
        if (to == null || to.isBlank() || !emailService.isReady()) return;

        String body = MailTemplates.render("recording-request-approved", Map.of(
                "kind", kindLabel(r.getKind()),
                "label", EmailService.escapeHtml(matchLabel(match)),
                "price", formatEurCents(r.getPriceEurCents()),
                "goal", goalHtml(r)));
        String html = emailService.shell("Zahtjev za snimku je odobren", body, statusLink(r), "Plati snimku");
        emailService.sendHtml(to, "Zahtjev za snimku je odobren - plaćanje", html);
    }

    /** Courtesy email sent when an admin rejects the request. */
    public void notifyRejected(MatchRecordingRequest r, Matches match) {
        String to = r.getContactEmail();
        if (to == null || to.isBlank() || !emailService.isReady()) return;

        String body = MailTemplates.render("recording-request-rejected", Map.of(
                "kind", kindLabel(r.getKind()),
                "label", EmailService.escapeHtml(matchLabel(match)),
                "noteLine", r.getAdminNote() == null || r.getAdminNote().isBlank()
                        ? "" : "<p>Napomena: " + EmailService.escapeHtml(r.getAdminNote()) + "</p>"));
        String html = emailService.shell("Zahtjev za snimku je odbijen", body, null, null);
        emailService.sendHtml(to, "Zahtjev za snimku je odbijen", html);
    }

    /**
     * Sent once the request is BOTH paid and delivered (a library recording
     * is linked) - the actual presigned download URL is generated per click
     * on the status page, so this mail deliberately links only to that page.
     */
    public void notifyDownloadReady(MatchRecordingRequest r) {
        String to = r.getContactEmail();
        if (to == null || to.isBlank() || !emailService.isReady()) return;

        boolean goal = r.getKind() == RecordingRequestKind.GOAL;
        String body = MailTemplates.render("recording-download-ready",
                Map.of("kindNoun", goal ? "snimka gola" : "snimka utakmice"));
        String html = emailService.shell("Snimka je spremna za preuzimanje", body, statusLink(r), "Preuzmi snimku");
        emailService.sendHtml(to, "Snimka je spremna za preuzimanje", html);
    }
}
