package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.model.MatchRecordingRequest;
import hr.mrodek.apps.futsal_turniri.model.Matches;
import hr.mrodek.apps.futsal_turniri.repository.AppSettingsRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

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

    private String statusLink(MatchRecordingRequest r) {
        return emailService.baseUrl() + "/snimke/zahtjev/" + r.getUuid();
    }

    /** Fire-and-forget admin notification of a new request. */
    public void notifyAdmin(MatchRecordingRequest r, Matches match) {
        String notifyEmail = settings.get("recording_notify_email");
        if (notifyEmail == null || notifyEmail.isBlank() || !emailService.isReady()) return;

        String label = matchLabel(match);
        String tournamentName = match.getTournament() != null ? match.getTournament().getName() : "";
        String link = emailService.baseUrl() + "/profil";
        String html = emailService.shell(
                "Novi zahtjev za snimku utakmice",
                "<p>Zaprimljen je novi zahtjev za snimku utakmice <strong>"
                        + EmailService.escapeHtml(label) + "</strong>"
                        + (tournamentName.isBlank()
                                ? "" : " (turnir " + EmailService.escapeHtml(tournamentName) + ")")
                        + ".</p>"
                        + (r.getNote() == null
                                ? "" : "<p>Napomena: " + EmailService.escapeHtml(r.getNote()) + "</p>"),
                link, "Otvori");
        emailService.sendHtml(notifyEmail, "Novi zahtjev za snimku utakmice", html);
    }

    /** Confirmation sent to the requester right after submission. */
    public void notifyRequestReceived(MatchRecordingRequest r, Matches match) {
        String to = r.getContactEmail();
        if (to == null || to.isBlank() || !emailService.isReady()) return;

        String label = matchLabel(match);
        String tournamentName = match.getTournament() != null ? match.getTournament().getName() : "";
        String html = emailService.shell(
                "Zahtjev za snimku je zaprimljen",
                "<p>Tvoj zahtjev za snimku utakmice <strong>" + EmailService.escapeHtml(label) + "</strong>"
                        + (tournamentName.isBlank()
                                ? "" : " (turnir " + EmailService.escapeHtml(tournamentName) + ")")
                        + " je zaprimljen. Obavijestit ćemo te emailom kad bude odobren.</p>",
                statusLink(r), "Pogledaj status");
        emailService.sendHtml(to, "Zahtjev za snimku je zaprimljen", html);
    }

    /** Sent when an admin approves the request - states the price and asks for payment. */
    public void notifyApproved(MatchRecordingRequest r, Matches match) {
        String to = r.getContactEmail();
        if (to == null || to.isBlank() || !emailService.isReady()) return;

        String label = matchLabel(match);
        String price = formatEurCents(r.getPriceEurCents());
        String html = emailService.shell(
                "Zahtjev za snimku je odobren",
                "<p>Tvoj zahtjev za snimku utakmice <strong>" + EmailService.escapeHtml(label) + "</strong>"
                        + " je odobren. Cijena snimke je <strong>" + price + "</strong>."
                        + " Nakon plaćanja snimka postaje dostupna za preuzimanje.</p>",
                statusLink(r), "Plati snimku");
        emailService.sendHtml(to, "Zahtjev za snimku je odobren - plaćanje", html);
    }

    /** Courtesy email sent when an admin rejects the request. */
    public void notifyRejected(MatchRecordingRequest r, Matches match) {
        String to = r.getContactEmail();
        if (to == null || to.isBlank() || !emailService.isReady()) return;

        String label = matchLabel(match);
        String html = emailService.shell(
                "Zahtjev za snimku je odbijen",
                "<p>Tvoj zahtjev za snimku utakmice <strong>" + EmailService.escapeHtml(label) + "</strong>"
                        + " je nažalost odbijen.</p>"
                        + (r.getAdminNote() == null || r.getAdminNote().isBlank()
                                ? "" : "<p>Napomena: " + EmailService.escapeHtml(r.getAdminNote()) + "</p>"),
                null, null);
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

        String html = emailService.shell(
                "Snimka je spremna za preuzimanje",
                "<p>Tvoja plaćena snimka utakmice je spremna za preuzimanje. "
                        + "Link za preuzimanje na stranici statusa vrijedi 48 sati od otvaranja.</p>",
                statusLink(r), "Preuzmi snimku");
        emailService.sendHtml(to, "Snimka je spremna za preuzimanje", html);
    }
}
