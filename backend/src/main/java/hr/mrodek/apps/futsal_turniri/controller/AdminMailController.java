package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.enums.RecordingRequestKind;
import hr.mrodek.apps.futsal_turniri.enums.RecordingRequestStatus;
import hr.mrodek.apps.futsal_turniri.model.AdminSentMail;
import hr.mrodek.apps.futsal_turniri.model.MatchRecordingRequest;
import hr.mrodek.apps.futsal_turniri.model.Matches;
import hr.mrodek.apps.futsal_turniri.repository.AdminSentMailRepository;
import hr.mrodek.apps.futsal_turniri.repository.MatchRecordingRequestRepository;
import hr.mrodek.apps.futsal_turniri.services.EmailService;
import hr.mrodek.apps.futsal_turniri.services.MailTemplates;
import hr.mrodek.apps.futsal_turniri.services.MessageService;
import hr.mrodek.apps.futsal_turniri.services.RecordingRequestNotifier;
import hr.mrodek.apps.futsal_turniri.services.StripeService;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.jboss.logging.Logger;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * Admin "Pošalji mail" module - a manual escape hatch for the platform's
 * transactional email.
 *
 * <p>Every automatic mail in this codebase is fire-and-forget (see
 * {@link EmailService}): a bounced or dropped message leaves no trace and no
 * way to retry it. That is acceptable for a notification, and not acceptable
 * for "your recording is approved, here is where you pay". This controller
 * lets an admin re-send exactly the same copy the automatic notifier would
 * have sent - to any address, not only the one stored on the request - plus a
 * free-form message, and records every attempt in {@link AdminSentMail} so the
 * admin can see whether a send already happened.
 *
 * <p><b>The copy is not duplicated.</b> Templates 2-4 render the same
 * {@code src/main/resources/mail/*.html} bodies and the same
 * {@code mail.recording.*} message keys as
 * {@link RecordingRequestNotifier}; only the recipient is overridable, which
 * is why they are rendered here instead of delegating to the notifier (whose
 * methods always address {@code contactEmail}).
 *
 * <p><b>Payment links.</b> The primary link is always the request's own status
 * page - the user pays from there and that page creates a fresh Stripe
 * Checkout session per click, so it can never expire. A pre-created Stripe
 * session URL is included only as a secondary convenience link, labelled as
 * time-limited, and is best-effort: if Stripe errors while creating it the
 * mail still goes out with the status-page link alone.
 *
 * <p>Every value handed to the mailer is resolved on THIS request thread -
 * {@link EmailService#sendHtml} subscribes to the reactive send and returns
 * immediately, so no lazy association may survive into it.
 *
 * Routes (all admin-only):
 *   GET  /admin/mail/templates           - the pickable templates
 *   GET  /admin/mail/recording-requests  - picker feed (?q= filters)
 *   POST /admin/mail/send                - render + send + log
 *   GET  /admin/mail/log                 - what was sent from this screen
 */
@Path("/admin/mail")
@RolesAllowed("admin")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class AdminMailController {

    private static final Logger LOG = Logger.getLogger(AdminMailController.class);

    /** Same deliberately simple, non-RFC-exhaustive pattern as
     *  {@link RecordingRequestController}. */
    private static final Pattern EMAIL_PATTERN = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[A-Za-z]{2,}$");

    /** Picker rows returned at most - it is a type-ahead, not a report. */
    private static final int PICKER_LIMIT = 50;

    /** Audit rows shown on the screen. */
    private static final int LOG_LIMIT = 100;

    private static final int SUBJECT_MAX = 255;
    private static final int FREEFORM_BODY_MAX = 5000;

    /**
     * What the admin can send. Only {@link #FREEFORM} is written by hand; the
     * other three re-send an existing lifecycle mail for one recording request
     * (hence {@link #needsRecordingRequest()}).
     */
    public enum MailTemplateKey {
        FREEFORM(false),
        RECORDING_RECEIVED(true),
        RECORDING_APPROVED(true),
        RECORDING_PAYMENT_LINK(true),
        RECORDING_DELIVERED(true);

        private final boolean needsRecordingRequest;

        MailTemplateKey(boolean needsRecordingRequest) {
            this.needsRecordingRequest = needsRecordingRequest;
        }

        public boolean needsRecordingRequest() {
            return needsRecordingRequest;
        }
    }

    @Inject MatchRecordingRequestRepository recordingRequests;
    @Inject AdminSentMailRepository sentMails;
    @Inject EmailService emailService;
    @Inject StripeService stripeService;
    @Inject RecordingRequestNotifier notifier;
    @Inject MessageService messages;
    @Inject JsonWebToken jwt;

    /* ─────────────────────────── wire shapes ─────────────────────────── */

    public record MailTemplateOption(String key, String label, boolean needsRecordingRequest) {}

    /** One row of the recording-request picker - enough to recognise a request
     *  without typing its uuid. */
    public record RecordingRequestPick(
            String uuid, String matchLabel, String tournamentName,
            String contactEmail, String status, boolean paid) {}

    /** {@code subject} / {@code bodyText} are required for FREEFORM only;
     *  {@code recordingRequestUuid} for every other template. */
    public record SendMailBody(
            String templateKey, String toEmail, String subject,
            String bodyText, String recordingRequestUuid) {}

    public record SentMailDto(
            Long id, String createdAt, String sentByUid, String toEmail, String templateKey,
            String subject, String bodyPreview, String recordingRequestUuid,
            boolean ok, String errorMessage) {}

    /** One fully rendered mail, ready to hand to {@link EmailService}. */
    private record RenderedMail(String subject, String html, String preview) {}

    /* ─────────────────────────── helpers ─────────────────────────── */

    private static Response conflict(String code) {
        return Response.status(Response.Status.CONFLICT).entity(Map.of("code", code)).build();
    }

    private String currentUid() {
        return jwt != null ? jwt.getSubject() : null;
    }

    private static String normalizeEmail(String s) {
        if (s == null) return null;
        String trimmed = s.trim();
        return trimmed.isEmpty() ? null : trimmed.toLowerCase();
    }

    private static boolean isValidEmail(String email) {
        return email != null && email.length() <= 255 && EMAIL_PATTERN.matcher(email).matches();
    }

    private MailTemplateKey parseTemplate(String key) {
        try {
            return MailTemplateKey.valueOf(key == null ? "" : key.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new BadRequestException(messages.t("adminMail.error.templateInvalid"));
        }
    }

    private static UUID parseUuid(String s) {
        if (s == null || s.isBlank()) return null;
        try {
            return UUID.fromString(s.trim());
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private String statusLink(MatchRecordingRequest r) {
        return emailService.baseUrl() + "/snimke/zahtjev/" + r.getUuid();
    }

    /** Same "Gol: …" paragraph {@link RecordingRequestNotifier} adds to every
     *  goal-clip mail; empty for a whole-match request. */
    private String goalHtml(MatchRecordingRequest r) {
        if (r.getKind() != RecordingRequestKind.GOAL || r.getGoalLabel() == null) return "";
        return MailTemplates.render("recording-goal-line",
                Map.of("goalLine", messages.t("mail.recording.goalLine", EmailService.escapeHtml(r.getGoalLabel()))));
    }

    /** APPROVED and DELIVERED both mean "the admin said yes" - the same pair
     *  {@link RecordingRequestController#checkout} accepts. */
    private static boolean isApproved(MatchRecordingRequest r) {
        return r.getStatus() == RecordingRequestStatus.APPROVED
                || r.getStatus() == RecordingRequestStatus.DELIVERED;
    }

    /** Plain-text snippet of a rendered body for the audit log. */
    private static String preview(String html) {
        String text = html == null ? "" : html.replaceAll("<[^>]*>", " ");
        text = text.replace("&quot;", "\"")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&amp;", "&")
                .replaceAll("\\s+", " ")
                .trim();
        return text.length() > AdminSentMail.BODY_PREVIEW_MAX
                ? text.substring(0, AdminSentMail.BODY_PREVIEW_MAX)
                : text;
    }

    private static String truncate(String s, int max) {
        if (s == null) return null;
        return s.length() > max ? s.substring(0, max) : s;
    }

    /* ─────────────────────────── read endpoints ─────────────────────────── */

    @GET
    @Path("/templates")
    public List<MailTemplateOption> templates() {
        List<MailTemplateOption> out = new ArrayList<>();
        for (MailTemplateKey key : MailTemplateKey.values()) {
            out.add(new MailTemplateOption(
                    key.name(),
                    messages.t("mail.adminMailer.template." + key.name() + ".label"),
                    key.needsRecordingRequest()));
        }
        return out;
    }

    /**
     * Picker feed for the three recording templates: recent requests, newest
     * first, optionally narrowed by a free-text {@code q} matched against the
     * match label, tournament name, contact email and uuid.
     *
     * <p>Transactional because the match / team / tournament relations are
     * lazy - every label is resolved here, on the request thread.
     */
    @GET
    @Path("/recording-requests")
    @Transactional
    public List<RecordingRequestPick> recordingRequestPicker(@QueryParam("q") String q) {
        String needle = q == null ? "" : q.trim().toLowerCase();
        List<RecordingRequestPick> out = new ArrayList<>();

        for (MatchRecordingRequest r : recordingRequests.findAllOrderByCreatedDesc()) {
            Matches match = r.getMatch();
            String matchLabel = match == null ? "" : RecordingRequestNotifier.matchLabel(match);
            String tournamentName = match != null && match.getTournament() != null
                    ? match.getTournament().getName()
                    : null;
            String contactEmail = r.getContactEmail();

            if (!needle.isEmpty()) {
                String haystack = (matchLabel + " "
                        + (tournamentName == null ? "" : tournamentName) + " "
                        + (contactEmail == null ? "" : contactEmail) + " "
                        + r.getUuid()).toLowerCase();
                if (!haystack.contains(needle)) continue;
            }

            out.add(new RecordingRequestPick(
                    r.getUuid().toString(), matchLabel, tournamentName,
                    contactEmail, r.getStatus().name(), r.getPaidAt() != null));
            if (out.size() >= PICKER_LIMIT) break;
        }
        return out;
    }

    @GET
    @Path("/log")
    @Transactional
    public List<SentMailDto> log() {
        List<SentMailDto> out = new ArrayList<>();
        for (AdminSentMail row : sentMails.findRecent(LOG_LIMIT)) {
            out.add(toDto(row));
        }
        return out;
    }

    private static SentMailDto toDto(AdminSentMail row) {
        return new SentMailDto(
                row.getId(),
                row.getCreatedAt() == null ? null : row.getCreatedAt().toString(),
                row.getSentByUid(),
                row.getToEmail(),
                row.getTemplateKey(),
                row.getSubject(),
                row.getBodyPreview(),
                row.getRecordingRequestUuid() == null ? null : row.getRecordingRequestUuid().toString(),
                row.isOk(),
                row.getErrorMessage());
    }

    /* ─────────────────────────── send ─────────────────────────── */

    /**
     * Renders the picked template, sends it and writes one audit row.
     *
     * <p>Returns 409 {@code {"code": …}} when a template's precondition fails
     * ({@code REQUEST_NOT_FOUND}, {@code NOT_APPROVED}, {@code ALREADY_PAID},
     * {@code STRIPE_NOT_CONFIGURED}, {@code NOT_DELIVERED}, {@code NOT_PAID},
     * {@code MAIL_NOT_CONFIGURED}); 400 for a malformed request body. A
     * precondition failure writes NO audit row - nothing was attempted - while
     * an unconfigured mailer does, with {@code ok = false}, because from the
     * admin's point of view that IS a failed send.
     *
     * <p>{@code @Transactional} because of the audit row. The payment template
     * does one outbound Stripe call inside that transaction, which is a
     * deliberate trade: this endpoint is a single, manual, low-frequency admin
     * action, and splitting it would mean either losing the audit row on a
     * rollback or writing it before the send is decided.
     */
    @POST
    @Path("/send")
    @Transactional
    public Response send(SendMailBody body) {
        MailTemplateKey template = parseTemplate(body == null ? null : body.templateKey());

        String to = normalizeEmail(body == null ? null : body.toEmail());
        if (!isValidEmail(to)) {
            throw new BadRequestException(messages.t("adminMail.error.invalidEmail"));
        }

        MatchRecordingRequest request = null;
        if (template.needsRecordingRequest()) {
            UUID uuid = parseUuid(body.recordingRequestUuid());
            if (uuid == null) return conflict("REQUEST_NOT_FOUND");
            request = recordingRequests.findByUuid(uuid).orElse(null);
            if (request == null) return conflict("REQUEST_NOT_FOUND");
        }

        RenderedMail rendered;
        if (template == MailTemplateKey.FREEFORM) {
            rendered = renderFreeform(body);
        } else if (template == MailTemplateKey.RECORDING_RECEIVED) {
            // No status precondition on purpose: "we got your request" is
            // exactly what an admin re-sends when the automatic one never
            // arrived, and by then the request may already have moved on.
            rendered = renderReceived(request);
        } else if (template == MailTemplateKey.RECORDING_APPROVED) {
            if (!isApproved(request)) return conflict("NOT_APPROVED");
            rendered = renderApproved(request);
        } else if (template == MailTemplateKey.RECORDING_PAYMENT_LINK) {
            if (!isApproved(request)) return conflict("NOT_APPROVED");
            if (request.getPaidAt() != null) return conflict("ALREADY_PAID");
            // Without Stripe the status page has no way to take the money
            // either, so a payment mail would be a dead end.
            if (!stripeService.isConfigured()) return conflict("STRIPE_NOT_CONFIGURED");
            rendered = renderPaymentLink(request);
        } else {
            if (request.getStatus() != RecordingRequestStatus.DELIVERED || request.getRecording() == null) {
                return conflict("NOT_DELIVERED");
            }
            if (request.getPaidAt() == null) return conflict("NOT_PAID");
            rendered = renderDelivered(request);
        }

        UUID requestUuid = request == null ? null : request.getUuid();

        if (!emailService.isReady()) {
            logSend(template, to, rendered, requestUuid, false, "MAIL_NOT_CONFIGURED");
            return conflict("MAIL_NOT_CONFIGURED");
        }

        emailService.sendHtml(to, rendered.subject(), rendered.html());
        AdminSentMail row = logSend(template, to, rendered, requestUuid, true, null);
        return Response.ok(toDto(row)).build();
    }

    private AdminSentMail logSend(MailTemplateKey template, String to, RenderedMail rendered,
                                  UUID recordingRequestUuid, boolean ok, String errorMessage) {
        AdminSentMail row = new AdminSentMail();
        row.setSentByUid(truncate(currentUid(), 64));
        row.setToEmail(to);
        row.setTemplateKey(template.name());
        row.setSubject(truncate(rendered.subject(), SUBJECT_MAX));
        row.setBodyPreview(rendered.preview());
        row.setRecordingRequestUuid(recordingRequestUuid);
        row.setOk(ok);
        row.setErrorMessage(truncate(errorMessage, 500));
        return sentMails.save(row);
    }

    /* ─────────────────────────── renderers ─────────────────────────── */

    private RenderedMail renderFreeform(SendMailBody body) {
        String subject = body.subject() == null ? "" : body.subject().trim();
        if (subject.isEmpty()) {
            throw new BadRequestException(messages.t("adminMail.error.subjectRequired"));
        }
        if (subject.length() > SUBJECT_MAX) {
            throw new BadRequestException(messages.t("adminMail.error.subjectTooLong"));
        }
        String text = body.bodyText() == null ? "" : body.bodyText().trim();
        if (text.isEmpty()) {
            throw new BadRequestException(messages.t("adminMail.error.bodyRequired"));
        }
        if (text.length() > FREEFORM_BODY_MAX) {
            throw new BadRequestException(messages.t("adminMail.error.bodyTooLong"));
        }

        String bodyHtml = MailTemplates.render("admin-freeform", Map.of("body", paragraphs(text)));
        String html = emailService.shell(subject, bodyHtml, null, null);
        return new RenderedMail(subject, html, preview(bodyHtml));
    }

    /**
     * Blank-line separated blocks become paragraphs, single newlines become
     * line breaks. Escaped BEFORE any markup is added, so an admin cannot
     * inject HTML into an outgoing mail by typing it.
     */
    private static String paragraphs(String text) {
        String normalized = text.replace("\r\n", "\n").replace("\r", "\n");
        StringBuilder sb = new StringBuilder();
        for (String block : normalized.split("\n\\s*\n")) {
            String trimmed = block.trim();
            if (trimmed.isEmpty()) continue;
            sb.append("<p>")
                    .append(EmailService.escapeHtml(trimmed).replace("\n", "<br>"))
                    .append("</p>");
        }
        return sb.toString();
    }

    /**
     * Byte-for-byte the body {@link RecordingRequestNotifier#notifyRequestReceived}
     * sends - the "zahtjev je zaprimljen" confirmation. The notifier's own
     * method always addresses the request's stored {@code contactEmail}, which
     * is precisely what an admin needs to override when that address was the
     * reason the mail never landed.
     */
    private RenderedMail renderReceived(MatchRecordingRequest r) {
        Matches match = r.getMatch();
        String bodyHtml = MailTemplates.render("recording-request-received", Map.of(
                "intro", messages.t("mail.recording.received.intro",
                        notifier.kindLabel(r.getKind()),
                        EmailService.escapeHtml(RecordingRequestNotifier.matchLabel(match)),
                        tournamentLine(match)),
                "goal", goalHtml(r)));
        String subject = messages.t("mail.recording.received.subject");
        String html = emailService.shell(subject, bodyHtml, statusLink(r),
                messages.t("mail.recording.received.cta"));
        return new RenderedMail(subject, html, preview(bodyHtml));
    }

    /** Same optional "Turnir: …" line the notifier appends; its own copy is
     *  private, and this is two lines rather than a widened API. */
    private String tournamentLine(Matches match) {
        String name = match != null && match.getTournament() != null ? match.getTournament().getName() : null;
        return name == null || name.isBlank()
                ? ""
                : messages.t("mail.recording.tournamentLine", EmailService.escapeHtml(name));
    }

    /** Byte-for-byte the body {@link RecordingRequestNotifier#notifyApproved} sends. */
    private RenderedMail renderApproved(MatchRecordingRequest r) {
        Matches match = r.getMatch();
        String bodyHtml = MailTemplates.render("recording-request-approved", Map.of(
                "intro", messages.t("mail.recording.approved.intro",
                        notifier.kindLabel(r.getKind()),
                        EmailService.escapeHtml(RecordingRequestNotifier.matchLabel(match)),
                        RecordingRequestNotifier.formatEurCents(r.getPriceEurCents())),
                "goal", goalHtml(r)));
        String heading = messages.t("mail.recording.approved.subject");
        String html = emailService.shell(heading, bodyHtml, statusLink(r),
                messages.t("mail.recording.approved.cta"));
        return new RenderedMail(messages.t("mail.recording.approved.emailSubject"), html, preview(bodyHtml));
    }

    /** Byte-for-byte the body {@link RecordingRequestNotifier#notifyDownloadReady} sends. */
    private RenderedMail renderDelivered(MatchRecordingRequest r) {
        boolean goal = r.getKind() == RecordingRequestKind.GOAL;
        String bodyHtml = MailTemplates.render("recording-download-ready", Map.of(
                "body", messages.t("mail.recording.downloadReady.body",
                        messages.t(goal ? "recording.kindNoun.goal" : "recording.kindNoun.match"))));
        String subject = messages.t("mail.recording.downloadReady.subject");
        String html = emailService.shell(subject, bodyHtml, statusLink(r),
                messages.t("mail.recording.downloadReady.cta"));
        return new RenderedMail(subject, html, preview(bodyHtml));
    }

    /**
     * Payment nudge - exactly what the automatic "approved" mail does: the CTA
     * is the request's own status page, and the Stripe Checkout session is
     * minted there, per click, by POST /recording-requests/{uuid}/checkout.
     * Nothing Stripe-issued is ever mailed: a session URL expires (~24h), so a
     * mailed one is a dead link by the time a slow payer opens it, while the
     * status page works forever.
     */
    private RenderedMail renderPaymentLink(MatchRecordingRequest r) {
        Matches match = r.getMatch();
        String statusUrl = statusLink(r);

        String bodyHtml = MailTemplates.render("admin-payment-link", Map.of(
                "intro", messages.t("mail.adminMailer.payment.intro",
                        notifier.kindLabel(r.getKind()),
                        EmailService.escapeHtml(RecordingRequestNotifier.matchLabel(match)),
                        RecordingRequestNotifier.formatEurCents(r.getPriceEurCents())),
                "goal", goalHtml(r)));

        String heading = messages.t("mail.adminMailer.payment.subject");
        String html = emailService.shell(heading, bodyHtml, statusUrl,
                messages.t("mail.adminMailer.payment.cta"));
        return new RenderedMail(heading, html, preview(bodyHtml));
    }
}
