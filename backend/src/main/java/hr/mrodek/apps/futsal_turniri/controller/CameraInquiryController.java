package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.model.CameraPackageInquiry;
import hr.mrodek.apps.futsal_turniri.repository.AppSettingsRepository;
import hr.mrodek.apps.futsal_turniri.repository.CameraPackageInquiryRepository;
import hr.mrodek.apps.futsal_turniri.services.EmailService;
import hr.mrodek.apps.futsal_turniri.services.MailTemplates;
import hr.mrodek.apps.futsal_turniri.services.MessageService;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * "Zatraži ponudu" leads for the custom camera package (/cjenik) - price is
 * on request, so there's no checkout here: a public form persists a
 * {@link CameraPackageInquiry} row, emails the admin
 * ({@code recording_notify_email} - the same address the recording-request
 * flow already notifies) to follow up manually, and confirms receipt to the
 * requester's own email. No account is required to submit - the email may
 * happen to belong to a registered user, but that's incidental.
 *
 * Routes:
 *   POST /camera-inquiries - create (fully public, no auth)
 *   GET  /camera-inquiries - list, newest first (admin) - shown in the
 *                            admin dashboard's "Zahtjevi za ponudu" tab
 */
@Path("/camera-inquiries")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class CameraInquiryController {

    /** local@domain.tld, TLD at least 2 letters - same simple, non-exhaustive
     *  pattern used across the app (see RecordingRequestController). */
    private static final Pattern EMAIL_PATTERN = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[A-Za-z]{2,}$");

    /** Digits only after stripping spaces, optional leading "+", 6-15 digits -
     *  enough to reject obviously fake input ("asdf", "123") without being a
     *  real phone-number validator. */
    private static final Pattern PHONE_PATTERN = Pattern.compile("^\\+?[0-9]{6,15}$");

    @Inject CameraPackageInquiryRepository repo;
    @Inject AppSettingsRepository settings;
    @Inject EmailService emailService;
    @Inject MessageService messages;

    public record CreateCameraInquiryBody(
            String name, String contactEmail, String contactPhone,
            String tournamentName, String message
    ) {}

    public record CameraInquiryDto(
            Long id, String name, String contactEmail, String contactPhone,
            String tournamentName, String message, String createdAt
    ) {}

    @GET
    @RolesAllowed("admin")
    public List<CameraInquiryDto> list() {
        return repo.findAllOrderByCreatedDesc().stream().map(this::toDto).toList();
    }

    private CameraInquiryDto toDto(CameraPackageInquiry i) {
        return new CameraInquiryDto(
                i.getId(), i.getName(), i.getContactEmail(), i.getContactPhone(),
                i.getTournamentName(), i.getMessage(),
                i.getCreatedAt() == null ? null : i.getCreatedAt().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME));
    }

    @POST
    @Transactional
    public Response create(CreateCameraInquiryBody body) {
        String name = body == null || body.name() == null ? "" : body.name().trim();
        String email = body == null || body.contactEmail() == null ? "" : body.contactEmail().trim();
        String phone = body == null || body.contactPhone() == null ? "" : body.contactPhone().trim();
        String tournamentName = body == null || body.tournamentName() == null ? "" : body.tournamentName().trim();
        String message = body == null || body.message() == null ? "" : body.message().trim();

        if (name.isEmpty()) {
            throw new BadRequestException(messages.t("cameraInquiry.error.nameRequired"));
        }
        if (email.isEmpty()) {
            throw new BadRequestException(messages.t("cameraInquiry.error.emailRequired"));
        }
        if (!EMAIL_PATTERN.matcher(email).matches()) {
            throw new BadRequestException(messages.t("cameraInquiry.error.invalidEmail"));
        }
        if (phone.isEmpty()) {
            throw new BadRequestException(messages.t("cameraInquiry.error.phoneRequired"));
        }
        if (!PHONE_PATTERN.matcher(phone.replace(" ", "")).matches()) {
            throw new BadRequestException(messages.t("cameraInquiry.error.invalidPhone"));
        }
        if (tournamentName.isEmpty()) {
            throw new BadRequestException(messages.t("cameraInquiry.error.tournamentRequired"));
        }
        if (message.isEmpty()) {
            throw new BadRequestException(messages.t("cameraInquiry.error.messageRequired"));
        }
        if (name.length() > 150 || email.length() > 255 || phone.length() > 40
                || tournamentName.length() > 255 || message.length() > 2000) {
            throw new BadRequestException(messages.t("cameraInquiry.error.tooLong"));
        }

        var inquiry = new CameraPackageInquiry();
        inquiry.setName(name);
        inquiry.setContactEmail(email);
        inquiry.setContactPhone(phone);
        inquiry.setTournamentName(tournamentName);
        inquiry.setMessage(message);
        repo.save(inquiry);

        notifyAdmin(inquiry);
        notifyRequester(inquiry);

        return Response.status(Response.Status.CREATED).build();
    }

    private void notifyAdmin(CameraPackageInquiry inquiry) {
        String notifyEmail = settings.get("recording_notify_email");
        if (notifyEmail == null || notifyEmail.isBlank() || !emailService.isReady()) return;

        String tournamentLine = messages.t("mail.cameraInquiry.tournamentLine",
                EmailService.escapeHtml(inquiry.getTournamentName()));
        String messageLine = messages.t("mail.cameraInquiry.messageLine",
                EmailService.escapeHtml(inquiry.getMessage()));

        String subject = messages.t("mail.cameraInquiry.subject");
        String body = MailTemplates.render("camera-inquiry-notify", Map.of(
                "intro", messages.t("mail.cameraInquiry.intro",
                        EmailService.escapeHtml(inquiry.getName()),
                        EmailService.escapeHtml(inquiry.getContactEmail() + " / " + inquiry.getContactPhone())),
                "tournamentLine", tournamentLine,
                "messageLine", messageLine));
        String html = emailService.shell(subject, body, emailService.baseUrl() + "/cjenik", null);
        emailService.sendHtml(notifyEmail, subject, html);
    }

    /** Confirms receipt to the requester's own email - sent from the site's
     *  usual notification address, no account required. */
    private void notifyRequester(CameraPackageInquiry inquiry) {
        if (!emailService.isReady()) return;

        String subject = messages.t("mail.cameraInquiry.received.subject");
        String body = MailTemplates.render("camera-inquiry-received", Map.of(
                "intro", messages.t("mail.cameraInquiry.received.intro",
                        EmailService.escapeHtml(inquiry.getTournamentName()))));
        String html = emailService.shell(subject, body, emailService.baseUrl() + "/cjenik", null);
        emailService.sendHtml(inquiry.getContactEmail(), subject, html);
    }
}
