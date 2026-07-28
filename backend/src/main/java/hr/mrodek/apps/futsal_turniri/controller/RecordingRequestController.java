package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.RecordingRequestDto;
import hr.mrodek.apps.futsal_turniri.enums.RecordingRequestStatus;
import hr.mrodek.apps.futsal_turniri.mappers.RecordingRequestMapper;
import hr.mrodek.apps.futsal_turniri.model.MatchRecording;
import hr.mrodek.apps.futsal_turniri.model.MatchRecordingRequest;
import hr.mrodek.apps.futsal_turniri.model.Matches;
import hr.mrodek.apps.futsal_turniri.repository.AppSettingsRepository;
import hr.mrodek.apps.futsal_turniri.repository.MatchRecordingRepository;
import hr.mrodek.apps.futsal_turniri.repository.MatchRecordingRequestRepository;
import hr.mrodek.apps.futsal_turniri.repository.MatchesRepository;
import hr.mrodek.apps.futsal_turniri.services.EmailService;
import hr.mrodek.apps.futsal_turniri.services.PushService;
import hr.mrodek.apps.futsal_turniri.services.RecordingStorageService;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.jwt.JsonWebToken;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Paid match-recording requests (~20 EUR/match). A user asks for the video of
 * one match; an admin approves, marks it paid and delivers either an external
 * URL or a recording linked in from the admin's library
 * ({@link MatchRecordingController}) - uploads never happen against a request
 * directly. The user then fetches a presigned GET download link.
 *
 * Routes:
 *   POST   /recording-requests/by-match/{matchId}       - create (user)
 *   GET    /recording-requests/mine                     - own requests (user)
 *   GET    /recording-requests?status=                  - list all (admin)
 *   PUT    /recording-requests/{uuid}/status            - approve/reject (admin)
 *   PUT    /recording-requests/{uuid}/paid              - toggle paid (admin)
 *   PUT    /recording-requests/{uuid}/deliver-url       - deliver external URL (admin)
 *   PUT    /recording-requests/{uuid}/link-recording    - deliver via a library recording (admin)
 *   GET    /recording-requests/{uuid}/download-link     - presigned GET / external URL (owner or admin)
 *   DELETE /recording-requests/{uuid}                   - cancel (owner, only while REQUESTED)
 */
@Path("/recording-requests")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class RecordingRequestController {

    /** Presigned GET validity for the requester's download (48 h). */
    private static final int DOWNLOAD_EXPIRY_SECONDS = 172_800;

    @Inject MatchRecordingRequestRepository repo;
    @Inject MatchRecordingRepository recordingRepo;
    @Inject MatchesRepository matchesRepo;
    @Inject RecordingRequestMapper mapper;
    @Inject RecordingStorageService recordingStorage;
    @Inject AppSettingsRepository settings;
    @Inject EmailService emailService;
    @Inject PushService pushService;
    @Inject SecurityIdentity identity;
    @Inject JsonWebToken jwt;

    /* ─────────────────────────── request bodies ─────────────────────────── */

    public record CreateRecordingRequestBody(
            @Size(max = 1000, message = "note must be at most 1000 characters") String note,
            @Size(max = 255, message = "contactEmail must be at most 255 characters") String contactEmail
    ) {}

    public record UpdateStatusBody(String status, @Size(max = 1000) String adminNote) {}

    public record PaidBody(Boolean paid) {}

    public record DeliverUrlBody(@Size(max = 1000) String url) {}

    public record LinkRecordingBody(UUID recordingUuid) {}

    public record DownloadLinkResponse(String url, int expiresInSeconds) {}

    /* ─────────────────────────── helpers ─────────────────────────── */

    private boolean isAdmin() {
        return identity != null && identity.hasRole("admin");
    }

    private String currentUid() {
        return jwt != null ? jwt.getSubject() : null;
    }

    private boolean isOwner(MatchRecordingRequest r) {
        String me = currentUid();
        return me != null && me.equals(r.getCreatedByUid());
    }

    /**
     * Map to DTO applying the deliveryUrl visibility rule: the raw URL is
     * shown only to the owner once DELIVERED, and always to admins.
     */
    private RecordingRequestDto toDto(MatchRecordingRequest r) {
        RecordingRequestDto dto = mapper.toDto(r);
        if (isAdmin() || (isOwner(r) && r.getStatus() == RecordingRequestStatus.DELIVERED)) {
            dto.setDeliveryUrl(r.getDeliveryUrl());
        }
        return dto;
    }

    private List<RecordingRequestDto> toDtoList(List<MatchRecordingRequest> list) {
        List<RecordingRequestDto> out = new ArrayList<>(list.size());
        for (var r : list) out.add(toDto(r));
        return out;
    }

    private static Response conflict(String code) {
        return Response.status(Response.Status.CONFLICT).entity(Map.of("code", code)).build();
    }

    /** "Team A - Team B" with graceful fallbacks for undecided knockout slots. */
    private static String matchLabel(Matches m) {
        String t1 = m.getTeam1() != null ? m.getTeam1().getName() : "TBD";
        String t2 = m.getTeam2() != null ? m.getTeam2().getName() : "TBD";
        return t1 + " - " + t2;
    }

    /* ─────────────────────────── user endpoints ─────────────────────────── */

    @POST
    @Path("/by-match/{matchId}")
    @Authenticated
    @Transactional
    public Response create(@PathParam("matchId") Long matchId, @Valid CreateRecordingRequestBody body) {
        Matches match = matchesRepo.findByIdOptional(matchId).orElse(null);
        if (match == null) return Response.status(Response.Status.NOT_FOUND).build();

        String me = currentUid();
        if (repo.existsOpenForUserAndMatch(me, matchId)) {
            return conflict("DUPLICATE");
        }

        var r = new MatchRecordingRequest();
        r.setMatch(match);
        r.setCreatedByUid(me);
        if (body != null) {
            r.setNote(body.note() == null || body.note().isBlank() ? null : body.note().trim());
            r.setContactEmail(body.contactEmail() == null || body.contactEmail().isBlank()
                    ? null : body.contactEmail().trim());
        }
        r.setStatus(RecordingRequestStatus.REQUESTED);
        repo.save(r);

        notifyAdminByEmail(r, match);

        return Response.status(Response.Status.CREATED).entity(toDto(r)).build();
    }

    /**
     * Fire-and-forget admin notification. Everything the email needs is
     * resolved HERE on the request thread (lazy relations must never be
     * touched from the reactive mailer); sendHtml itself never throws.
     */
    private void notifyAdminByEmail(MatchRecordingRequest r, Matches match) {
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

    @GET
    @Path("/mine")
    @Authenticated
    public List<RecordingRequestDto> mine() {
        return toDtoList(repo.findByCreatedByUid(currentUid()));
    }

    /* ─────────────────────────── admin endpoints ─────────────────────────── */

    @GET
    @RolesAllowed("admin")
    public List<RecordingRequestDto> list(@QueryParam("status") String status) {
        if (status == null || status.isBlank()) {
            return toDtoList(repo.findAllOrderByCreatedDesc());
        }
        try {
            RecordingRequestStatus s = RecordingRequestStatus.valueOf(status.toUpperCase());
            return toDtoList(repo.findByStatus(s));
        } catch (IllegalArgumentException ex) {
            return List.of();
        }
    }

    @PUT
    @Path("/{uuid}/status")
    @RolesAllowed("admin")
    @Transactional
    public Response updateStatus(@PathParam("uuid") UUID uuid, UpdateStatusBody body) {
        var r = repo.findByUuid(uuid).orElse(null);
        if (r == null) return Response.status(Response.Status.NOT_FOUND).build();

        RecordingRequestStatus target;
        try {
            target = RecordingRequestStatus.valueOf(
                    body == null || body.status() == null ? "" : body.status().toUpperCase());
        } catch (IllegalArgumentException ex) {
            throw new BadRequestException("status must be APPROVED or REJECTED");
        }
        if (target != RecordingRequestStatus.APPROVED && target != RecordingRequestStatus.REJECTED) {
            throw new BadRequestException("status must be APPROVED or REJECTED");
        }
        if (r.getStatus() != RecordingRequestStatus.REQUESTED) {
            return conflict("NOT_REQUESTED");
        }

        r.setStatus(target);
        if (body.adminNote() != null && !body.adminNote().isBlank()) {
            r.setAdminNote(body.adminNote().trim());
        }
        r.setUpdatedAt(OffsetDateTime.now());

        boolean approved = target == RecordingRequestStatus.APPROVED;
        pushService.sendToUser(r.getCreatedByUid(), new PushService.PushPayload(
                approved ? "Zahtjev za snimku odobren" : "Zahtjev za snimku odbijen",
                approved
                        ? "Tvoj zahtjev za snimku utakmice je odobren. Detalji su na tvom profilu."
                        : "Tvoj zahtjev za snimku utakmice je odbijen. Detalji su na tvom profilu.",
                "/profil"));

        return Response.ok(toDto(r)).build();
    }

    @PUT
    @Path("/{uuid}/paid")
    @RolesAllowed("admin")
    @Transactional
    public Response setPaid(@PathParam("uuid") UUID uuid, PaidBody body) {
        var r = repo.findByUuid(uuid).orElse(null);
        if (r == null) return Response.status(Response.Status.NOT_FOUND).build();

        boolean paid = body != null && Boolean.TRUE.equals(body.paid());
        r.setPaidAt(paid ? OffsetDateTime.now() : null);
        r.setUpdatedAt(OffsetDateTime.now());
        return Response.ok(toDto(r)).build();
    }

    @PUT
    @Path("/{uuid}/deliver-url")
    @RolesAllowed("admin")
    @Transactional
    public Response deliverUrl(@PathParam("uuid") UUID uuid, @Valid DeliverUrlBody body) {
        var r = repo.findByUuid(uuid).orElse(null);
        if (r == null) return Response.status(Response.Status.NOT_FOUND).build();

        String url = body == null || body.url() == null ? "" : body.url().trim();
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
            throw new BadRequestException("url must start with http:// or https://");
        }

        r.setDeliveryUrl(url);
        r.setStatus(RecordingRequestStatus.DELIVERED);
        r.setUpdatedAt(OffsetDateTime.now());

        notifyDelivered(r);
        return Response.ok(toDto(r)).build();
    }

    /**
     * Deliver by linking in a library recording (see {@link MatchRecordingController}
     * for the upload itself) - the admin never uploads against a request directly.
     * The recording must belong to the SAME match as the request.
     */
    @PUT
    @Path("/{uuid}/link-recording")
    @RolesAllowed("admin")
    @Transactional
    public Response linkRecording(@PathParam("uuid") UUID uuid, LinkRecordingBody body) {
        var r = repo.findByUuid(uuid).orElse(null);
        if (r == null) return Response.status(Response.Status.NOT_FOUND).build();
        if (body == null || body.recordingUuid() == null) {
            throw new BadRequestException("recordingUuid is required");
        }

        MatchRecording rec = recordingRepo.findByUuid(body.recordingUuid()).orElse(null);
        if (rec == null) return conflict("RECORDING_NOT_FOUND");
        if (!rec.getMatch().getId().equals(r.getMatch().getId())) {
            return conflict("MATCH_MISMATCH");
        }

        r.setRecording(rec);
        r.setStatus(RecordingRequestStatus.DELIVERED);
        r.setUpdatedAt(OffsetDateTime.now());

        notifyDelivered(r);
        return Response.ok(toDto(r)).build();
    }

    private void notifyDelivered(MatchRecordingRequest r) {
        pushService.sendToUser(r.getCreatedByUid(), new PushService.PushPayload(
                "Snimka utakmice je dostupna",
                "Tvoja snimka utakmice je spremna. Preuzmi je na svom profilu.",
                "/profil"));
    }

    /* ─────────────────────────── delivery download ─────────────────────────── */

    @GET
    @Path("/{uuid}/download-link")
    @Authenticated
    public Response downloadLink(@PathParam("uuid") UUID uuid) {
        var r = repo.findByUuid(uuid).orElse(null);
        if (r == null) return Response.status(Response.Status.NOT_FOUND).build();
        if (!isAdmin() && !isOwner(r)) {
            throw new ForbiddenException("Only the requester or an admin can fetch the download link.");
        }
        if (r.getStatus() != RecordingRequestStatus.DELIVERED) {
            return conflict("NOT_DELIVERED");
        }
        if (r.getDeliveryUrl() != null && !r.getDeliveryUrl().isBlank()) {
            return Response.ok(new DownloadLinkResponse(r.getDeliveryUrl(), 0)).build();
        }
        if (r.getRecording() != null) {
            String url = recordingStorage.presignedGet(
                    r.getRecording().getVideoObjectKey(), DOWNLOAD_EXPIRY_SECONDS, r.getRecording().getFileName());
            return Response.ok(new DownloadLinkResponse(url, DOWNLOAD_EXPIRY_SECONDS)).build();
        }
        return conflict("NOT_DELIVERED");
    }

    /* ─────────────────────────── cancel ─────────────────────────── */

    @DELETE
    @Path("/{uuid}")
    @Authenticated
    @Transactional
    public Response cancel(@PathParam("uuid") UUID uuid) {
        var r = repo.findByUuid(uuid).orElse(null);
        if (r == null) return Response.status(Response.Status.NOT_FOUND).build();
        if (!isOwner(r)) {
            throw new ForbiddenException("Only the requester can cancel this request.");
        }
        if (r.getStatus() != RecordingRequestStatus.REQUESTED) {
            return conflict("NOT_REQUESTED");
        }
        r.setStatus(RecordingRequestStatus.CANCELLED);
        r.setUpdatedAt(OffsetDateTime.now());
        return Response.noContent().build();
    }
}
