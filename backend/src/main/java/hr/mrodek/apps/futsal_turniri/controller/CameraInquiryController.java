package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.model.CameraPackageInquiry;
import hr.mrodek.apps.futsal_turniri.repository.AppSettingsRepository;
import hr.mrodek.apps.futsal_turniri.repository.CameraPackageInquiryRepository;
import hr.mrodek.apps.futsal_turniri.services.EmailService;
import hr.mrodek.apps.futsal_turniri.services.MailTemplates;
import hr.mrodek.apps.futsal_turniri.services.MessageService;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

import java.util.Map;

/**
 * Leads for the "custom camera package" pricing tier (/cjenik) - price is on
 * request, so there's no checkout here, just a public inquiry form that
 * persists a {@link CameraPackageInquiry} row and emails the admin
 * ({@code recording_notify_email} - the same address the recording-request
 * flow already notifies) to follow up manually.
 *
 * Routes:
 *   POST /camera-inquiries - create (fully public, no auth)
 */
@Path("/camera-inquiries")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class CameraInquiryController {

    @Inject CameraPackageInquiryRepository repo;
    @Inject AppSettingsRepository settings;
    @Inject EmailService emailService;
    @Inject MessageService messages;

    public record CreateCameraInquiryBody(
            String name, String contactEmail, String contactPhone,
            String tournamentName, String message
    ) {}

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
        if (email.isEmpty() && phone.isEmpty()) {
            throw new BadRequestException(messages.t("cameraInquiry.error.contactRequired"));
        }
        if (name.length() > 150 || email.length() > 255 || phone.length() > 40
                || tournamentName.length() > 255 || message.length() > 2000) {
            throw new BadRequestException(messages.t("cameraInquiry.error.tooLong"));
        }

        var inquiry = new CameraPackageInquiry();
        inquiry.setName(name);
        inquiry.setContactEmail(email.isEmpty() ? null : email);
        inquiry.setContactPhone(phone.isEmpty() ? null : phone);
        inquiry.setTournamentName(tournamentName.isEmpty() ? null : tournamentName);
        inquiry.setMessage(message.isEmpty() ? null : message);
        repo.save(inquiry);

        notifyAdmin(inquiry);

        return Response.status(Response.Status.CREATED).build();
    }

    private void notifyAdmin(CameraPackageInquiry inquiry) {
        String notifyEmail = settings.get("recording_notify_email");
        if (notifyEmail == null || notifyEmail.isBlank() || !emailService.isReady()) return;

        String contactLine = inquiry.getContactEmail() != null ? inquiry.getContactEmail() : inquiry.getContactPhone();
        String tournamentLine = inquiry.getTournamentName() == null || inquiry.getTournamentName().isBlank()
                ? "" : messages.t("mail.cameraInquiry.tournamentLine", EmailService.escapeHtml(inquiry.getTournamentName()));
        String messageLine = inquiry.getMessage() == null || inquiry.getMessage().isBlank()
                ? "" : messages.t("mail.cameraInquiry.messageLine", EmailService.escapeHtml(inquiry.getMessage()));

        String subject = messages.t("mail.cameraInquiry.subject");
        String body = MailTemplates.render("camera-inquiry-notify", Map.of(
                "intro", messages.t("mail.cameraInquiry.intro",
                        EmailService.escapeHtml(inquiry.getName()), EmailService.escapeHtml(contactLine)),
                "tournamentLine", tournamentLine,
                "messageLine", messageLine));
        String html = emailService.shell(subject, body, emailService.baseUrl() + "/cjenik", null);
        emailService.sendHtml(notifyEmail, subject, html);
    }
}
