package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.enums.NotificationKind;
import hr.mrodek.apps.futsal_turniri.model.ContactMessage;
import hr.mrodek.apps.futsal_turniri.repository.AppSettingsRepository;
import hr.mrodek.apps.futsal_turniri.repository.ContactMessageRepository;
import hr.mrodek.apps.futsal_turniri.services.AdminNotifier;
import hr.mrodek.apps.futsal_turniri.services.EmailService;
import hr.mrodek.apps.futsal_turniri.services.MailTemplates;
import hr.mrodek.apps.futsal_turniri.services.MessageService;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.HeaderParam;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.jboss.logging.Logger;

import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayDeque;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * "Kontaktiraj nas" - the generic public contact form (/kontakt). Everything
 * that isn't one of the structured flows (recording requests, camera-package
 * quotes, player claims) lands here: a public form persists a
 * {@link ContactMessage} row, confirms receipt to the sender's own email,
 * emails the admin ({@code recording_notify_email} - the same address every
 * other admin-facing form already notifies) and files an in-app admin
 * notification. No account is required to submit - the sender may happen to
 * be signed in, in which case their uid is recorded purely for context.
 *
 * Routes:
 *   POST /contact - create (fully public, no auth)
 *   GET  /contact - list, newest first (admin) - shown in the admin
 *                   dashboard's "Poruke" tab
 *   POST /contact/{id}/handled - set/clear handledAt (admin); unanswered
 *                   messages are what the admin console's "poruke" badge
 *                   counts
 *
 * <p><b>Spam guard.</b> A public, unauthenticated form that sends two emails
 * per submit is an obvious amplification target, so submits are throttled
 * in-memory to {@value #THROTTLE_MAX_PER_WINDOW} per hour per sender email
 * AND per client IP (429 otherwise). Deliberately NOT a table and NOT a new
 * dependency: the window is short, the cost of losing the counters on a
 * restart is one extra allowed submit, and Caddy already rate-limits the
 * edge. See {@link #throttled(String, String)}.
 */
@Path("/contact")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class ContactController {

    private static final Logger LOG = Logger.getLogger(ContactController.class);

    /** local@domain.tld, TLD at least 2 letters - same simple, non-exhaustive
     *  pattern used across the app (see CameraInquiryController). */
    private static final Pattern EMAIL_PATTERN = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[A-Za-z]{2,}$");

    private static final int NAME_MIN = 3;
    private static final int NAME_MAX = 120;
    private static final int EMAIL_MAX = 255;
    private static final int SUBJECT_MAX = 160;
    /**
     * The reasons the form offers. A fixed set, validated here: the value goes
     * into e-mail subjects and the admin console's filter, so free text would
     * turn both into noise. Unknown or missing → OSTALO, because a message
     * that arrived is worth more than a 400 over a dropdown.
     */
    private static final Set<String> REASONS = Set.of(
            "PLACANJE", "SNIMKA", "TURNIR", "SURADNJA", "INFORMACIJE", "GRESKA", "OSTALO");

    private static final String REASON_FALLBACK = "OSTALO";

    private static final int MESSAGE_MIN = 10;
    private static final int MESSAGE_MAX = 4000;

    /* ─────────────────────────── spam guard ─────────────────────────── */

    /** Sliding window length for the submit throttle. */
    private static final long THROTTLE_WINDOW_MS = 60L * 60L * 1000L;

    /** Submits allowed per key inside one window. */
    private static final int THROTTLE_MAX_PER_WINDOW = 5;

    /**
     * Hard cap on tracked keys. A flood from thousands of distinct spoofed
     * IPs must not turn the guard itself into the memory leak it is meant to
     * prevent, so once the map grows past this the expired entries are swept
     * and, if that isn't enough, the whole map is dropped (worst case: every
     * counter restarts, i.e. the guard degrades to "off" for one window
     * rather than to OOM).
     */
    private static final int THROTTLE_MAX_KEYS = 5_000;

    /**
     * key ("e:{email}" / "i:{ip}") → submit timestamps inside the window.
     * {@code static} on purpose: it must survive regardless of how the JAX-RS
     * resource is scoped, and there is exactly one process per node.
     * Every access to a deque is synchronized on the deque itself -
     * {@link ArrayDeque} is not thread-safe.
     */
    private static final ConcurrentHashMap<String, ArrayDeque<Long>> SUBMITS = new ConcurrentHashMap<>();

    @Inject ContactMessageRepository repo;
    @Inject AppSettingsRepository settings;
    @Inject EmailService emailService;
    @Inject MessageService messages;
    @Inject AdminNotifier adminNotifier;
    @Inject JsonWebToken jwt;

    /** Body of POST /contact. {@code subject} is the only optional field. */
    public record CreateContactMessageBody(
            String name, String email, String subject, String message, String reason
    ) {}

    /** {@code handledAt} is null while the message is still in the admin queue. */
    public record ContactMessageDto(
            Long id, String name, String email, String subject, String message,
            String reason, String createdAt, String handledAt, String userUid
    ) {}

    /** Body of POST /contact/{id}/handled - true marks, false clears. */
    public record SetHandledBody(Boolean handled) {}

    @GET
    @RolesAllowed("admin")
    public List<ContactMessageDto> list() {
        return repo.findAllOrderByCreatedDesc().stream().map(this::toDto).toList();
    }

    /**
     * Marks a message as answered (or puts it back in the queue). Only this
     * flag drives the {@code poruke} badge on the admin console, so clearing
     * it makes the message count again.
     */
    @POST
    @Path("/{id}/handled")
    @RolesAllowed("admin")
    @Transactional
    public ContactMessageDto setHandled(@PathParam("id") Long id, SetHandledBody body) {
        var msg = repo.findByIdOptional(id)
                .orElseThrow(() -> new NotFoundException("Poruka nije pronađena."));
        boolean handled = body != null && Boolean.TRUE.equals(body.handled());
        msg.setHandledAt(handled ? OffsetDateTime.now() : null);
        repo.save(msg);
        return toDto(msg);
    }

    private ContactMessageDto toDto(ContactMessage m) {
        return new ContactMessageDto(
                m.getId(), m.getName(), m.getEmail(), m.getSubject(), m.getMessage(),
                m.getReason() == null ? REASON_FALLBACK : m.getReason(),
                m.getCreatedAt() == null ? null : m.getCreatedAt().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME),
                m.getHandledAt() == null ? null : m.getHandledAt().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME),
                m.getUserUid());
    }

    /**
     * Public submit. Validates, persists, then fires the three side channels
     * (sender confirmation, admin email, admin inbox) best-effort - none of
     * them may ever turn a successfully stored message into an error for the
     * visitor.
     *
     * @param forwardedFor the {@code X-Forwarded-For} Caddy sets in front of
     *                     us; absent in local dev, in which case only the
     *                     email key throttles.
     */
    @POST
    @Transactional
    public Response create(CreateContactMessageBody body,
                           @HeaderParam("X-Forwarded-For") String forwardedFor) {
        String name = body == null || body.name() == null ? "" : body.name().trim();
        String email = body == null || body.email() == null ? "" : body.email().trim();
        String subject = body == null || body.subject() == null ? "" : body.subject().trim();
        String message = body == null || body.message() == null ? "" : body.message().trim();
        String reason = normalizeReason(body == null ? null : body.reason());

        if (name.isEmpty()) {
            throw new BadRequestException(messages.t("contact.error.nameRequired"));
        }
        if (name.length() < NAME_MIN || name.length() > NAME_MAX) {
            throw new BadRequestException(messages.t("contact.error.invalidName"));
        }
        if (email.isEmpty()) {
            throw new BadRequestException(messages.t("contact.error.emailRequired"));
        }
        if (email.length() > EMAIL_MAX || !EMAIL_PATTERN.matcher(email).matches()) {
            throw new BadRequestException(messages.t("contact.error.invalidEmail"));
        }
        if (subject.length() > SUBJECT_MAX) {
            throw new BadRequestException(messages.t("contact.error.subjectTooLong"));
        }
        if (message.isEmpty()) {
            throw new BadRequestException(messages.t("contact.error.messageRequired"));
        }
        if (message.length() < MESSAGE_MIN || message.length() > MESSAGE_MAX) {
            throw new BadRequestException(messages.t("contact.error.invalidMessage"));
        }

        if (throttled(email, clientIp(forwardedFor))) {
            return Response.status(429)
                    .entity(Map.of("message", messages.t("contact.error.tooManyRequests")))
                    .build();
        }

        var msg = new ContactMessage();
        msg.setName(name);
        msg.setEmail(email);
        msg.setSubject(subject.isEmpty() ? null : subject);
        msg.setMessage(message);
        msg.setReason(reason);
        msg.setUserUid(currentUid());
        repo.save(msg);

        // Everything below is a side-effect of the request, never part of it:
        // the visitor's message is already stored, so a dead SMTP server or a
        // failing template must not roll it back or surface as an error.
        // Values are read off the entity HERE, on the request thread.
        notifyRequester(name, email, subject);
        notifyAdmin(name, email, subject, message, reason);
        notifyAdminInbox(name, subject, reason);

        return Response.status(Response.Status.CREATED).build();
    }

    /** Upper-cases and whitelists the submitted reason; anything unknown or
     *  missing becomes {@value #REASON_FALLBACK}. */
    private static String normalizeReason(String raw) {
        if (raw == null) return REASON_FALLBACK;
        String key = raw.trim().toUpperCase();
        return REASONS.contains(key) ? key : REASON_FALLBACK;
    }

    /** Human label for the admin channels; falls back to the raw key so an
     *  un-translated reason is still readable rather than "???key???". */
    private String reasonLabel(String reason) {
        String label = messages.t("contact.reason." + reason);
        return label.startsWith("???") ? reason : label;
    }

    /** Firebase uid when the sender happened to be signed in, else null. */
    private String currentUid() {
        try {
            return jwt != null ? jwt.getSubject() : null;
        } catch (Exception ignored) {
            // No token on this request - the form is public, so that's normal.
            return null;
        }
    }

    /** Confirms receipt to the sender's own email - no account required. */
    private void notifyRequester(String name, String email, String subject) {
        try {
            if (!emailService.isReady()) return;
            String mailSubject = messages.t("mail.contact.received.subject");
            String bodyHtml = MailTemplates.render("contact-received", Map.of(
                    "intro", messages.t("mail.contact.received.intro",
                            EmailService.escapeHtml(name)),
                    "subjectLine", subject == null || subject.isEmpty()
                            ? ""
                            : messages.t("mail.contact.subjectLine", EmailService.escapeHtml(subject))));
            String html = emailService.shell(mailSubject, bodyHtml, emailService.baseUrl() + "/kontakt", null);
            emailService.sendHtml(email, mailSubject, html);
        } catch (Exception e) {
            LOG.warnf(e, "Contact: sender confirmation failed for %s", email);
        }
    }

    /** Emails the single admin mailbox so someone can actually reply. */
    private void notifyAdmin(String name, String email, String subject, String message, String reason) {
        try {
            String notifyEmail = settings.get("recording_notify_email");
            if (notifyEmail == null || notifyEmail.isBlank() || !emailService.isReady()) return;

            String mailSubject = messages.t("mail.contact.subject");
            String bodyHtml = MailTemplates.render("contact-admin-notify", Map.of(
                    "intro", messages.t("mail.contact.intro",
                            EmailService.escapeHtml(name), EmailService.escapeHtml(email)),
                    "subjectLine", subject == null || subject.isEmpty()
                            ? ""
                            : messages.t("mail.contact.subjectLine", EmailService.escapeHtml(subject)),
                    "messageLine", messages.t("mail.contact.messageLine",
                            EmailService.escapeHtml(message)),
                    "reasonLine", messages.t("mail.contact.reasonLine", reasonLabel(reason))));
            String html = emailService.shell(mailSubject, bodyHtml, emailService.baseUrl() + "/admin/poruke", null);
            emailService.sendHtml(notifyEmail, mailSubject, html);
        } catch (Exception e) {
            LOG.warnf(e, "Contact: admin notification email failed for %s", email);
        }
    }

    /**
     * In-app twin of {@link #notifyAdmin} - the same message, delivered to
     * every admin's "Obavijesti" inbox instead of only to the single
     * {@code recording_notify_email} mailbox. Fires from the same spot so the
     * two channels can never drift apart. NOT html-escaped: this text goes
     * into a notification body the SPA renders as plain text, never as markup.
     */
    private void notifyAdminInbox(String name, String subject, String reason) {
        try {
            adminNotifier.notifyAdmins(
                    NotificationKind.ADMIN_REQUEST,
                    messages.t("mail.contact.adminInbox.title") + " - " + reasonLabel(reason),
                    messages.t("mail.contact.adminInbox.body",
                            name, subject == null || subject.isEmpty()
                                    ? messages.t("mail.contact.adminInbox.noSubject")
                                    : subject),
                    "/admin/poruke");
        } catch (Exception e) {
            LOG.warnf(e, "Contact: admin inbox notification failed for %s", name);
        }
    }

    /* ───────────────────────── throttle internals ───────────────────────── */

    /**
     * First hop of {@code X-Forwarded-For} (the original client as Caddy saw
     * it), or null when the header is absent - local dev talks straight to
     * Quarkus, and throttling every such submit under one shared "unknown"
     * key would lock the form after five submits from anyone.
     */
    private static String clientIp(String forwardedFor) {
        if (forwardedFor == null || forwardedFor.isBlank()) return null;
        int comma = forwardedFor.indexOf(',');
        String first = (comma >= 0 ? forwardedFor.substring(0, comma) : forwardedFor).trim();
        return first.isEmpty() ? null : first;
    }

    /**
     * True when either key is already at its hourly limit. Checked first for
     * BOTH keys and only then recorded for both, so a submit rejected on the
     * IP key doesn't silently consume the email key's budget.
     */
    private static boolean throttled(String email, String ip) {
        sweepIfLarge();
        String emailKey = "e:" + email.toLowerCase();
        String ipKey = ip == null ? null : "i:" + ip;
        long now = System.currentTimeMillis();
        if (throttleKeyRejected(emailKey, now) || throttleKeyRejected(ipKey, now)) return true;
        recordSubmit(emailKey, now);
        recordSubmit(ipKey, now);
        return false;
    }

    /** True when {@code key} has already used its full window budget. */
    private static boolean throttleKeyRejected(String key, long now) {
        if (key == null) return false;
        ArrayDeque<Long> stamps = SUBMITS.get(key);
        if (stamps == null) return false;
        synchronized (stamps) {
            prune(stamps, now);
            return stamps.size() >= THROTTLE_MAX_PER_WINDOW;
        }
    }

    private static void recordSubmit(String key, long now) {
        if (key == null) return;
        ArrayDeque<Long> stamps = SUBMITS.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (stamps) {
            prune(stamps, now);
            stamps.addLast(now);
        }
    }

    /** Drops timestamps that fell out of the sliding window. */
    private static void prune(ArrayDeque<Long> stamps, long now) {
        Long head;
        while ((head = stamps.peekFirst()) != null && now - head > THROTTLE_WINDOW_MS) {
            stamps.pollFirst();
        }
    }

    /** Keeps the guard's own memory bounded - see {@link #THROTTLE_MAX_KEYS}. */
    private static void sweepIfLarge() {
        if (SUBMITS.size() < THROTTLE_MAX_KEYS) return;
        long now = System.currentTimeMillis();
        SUBMITS.entrySet().removeIf(e -> {
            ArrayDeque<Long> stamps = e.getValue();
            synchronized (stamps) {
                prune(stamps, now);
                return stamps.isEmpty();
            }
        });
        if (SUBMITS.size() >= THROTTLE_MAX_KEYS) {
            LOG.warnf("Contact: throttle map still at %d keys after sweep - resetting", SUBMITS.size());
            SUBMITS.clear();
        }
    }
}
