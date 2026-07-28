package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.RecordingRequestDto;
import hr.mrodek.apps.futsal_turniri.enums.MatchEventType;
import hr.mrodek.apps.futsal_turniri.enums.MatchStatus;
import hr.mrodek.apps.futsal_turniri.enums.RecordingRequestKind;
import hr.mrodek.apps.futsal_turniri.enums.RecordingRequestStatus;
import hr.mrodek.apps.futsal_turniri.mappers.RecordingRequestMapper;
import hr.mrodek.apps.futsal_turniri.model.MatchEvent;
import hr.mrodek.apps.futsal_turniri.model.MatchRecording;
import hr.mrodek.apps.futsal_turniri.model.MatchRecordingRequest;
import hr.mrodek.apps.futsal_turniri.model.Matches;
import hr.mrodek.apps.futsal_turniri.repository.AppSettingsRepository;
import hr.mrodek.apps.futsal_turniri.repository.MatchEventRepository;
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
 * Paid match-video requests. Two kinds, same lifecycle:
 *   - FULL_MATCH (~20 EUR) - the video of one whole match.
 *   - GOAL (~5 EUR)        - a clip of one goal of that match.
 *
 * A user asks; an admin approves, marks it paid and delivers it by linking in a
 * recording from the admin's library ({@link MatchRecordingController}) - no
 * external links are accepted, and uploads never happen against a request
 * directly. The link can be re-pointed at any time (e.g. to fix a wrongly
 * mapped recording), even after delivery. The user then fetches a presigned
 * GET download link.
 *
 * Routes:
 *   POST   /recording-requests/by-match/{matchId}       - create, whole match (user)
 *   POST   /recording-requests/by-goal/{matchEventId}   - create, single goal clip (user)
 *   GET    /recording-requests/mine                     - own requests (user)
 *   GET    /recording-requests?status=                  - list all (admin)
 *   PUT    /recording-requests/{uuid}/status            - approve/reject (admin)
 *   PUT    /recording-requests/{uuid}/paid              - toggle paid (admin)
 *   PUT    /recording-requests/{uuid}/link-recording    - deliver / re-link a library recording (admin)
 *   GET    /recording-requests/{uuid}/download-link     - presigned GET (owner or admin)
 *   DELETE /recording-requests/{uuid}                   - cancel (owner, only while REQUESTED)
 */
@Path("/recording-requests")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class RecordingRequestController {

    /** Presigned GET validity for the requester's download (48 h). */
    private static final int DOWNLOAD_EXPIRY_SECONDS = 172_800;

    /**
     * {@code app_settings} key that turns ORDERING single-goal clips on.
     * Absent/anything but "true" = off, which is the current default: the
     * feature is finished but not on sale yet. Being a setting (not a constant)
     * means launching it is a DB flip, no redeploy - and it only gates CREATING
     * new goal requests; existing ones keep working end to end.
     */
    private static final String GOAL_REQUESTS_ENABLED_KEY = "goal_clip_requests_enabled";

    @Inject MatchRecordingRequestRepository repo;
    @Inject MatchRecordingRepository recordingRepo;
    @Inject MatchesRepository matchesRepo;
    @Inject MatchEventRepository eventRepo;
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

    private RecordingRequestDto toDto(MatchRecordingRequest r) {
        return mapper.toDto(r);
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

    /** Only an actual goal can be clipped - cards and missed penalties can't. */
    private static boolean isGoal(MatchEventType type) {
        return type == MatchEventType.GOAL
                || type == MatchEventType.OWN_GOAL
                || type == MatchEventType.PENALTY_GOAL;
    }

    /**
     * Readable snapshot of a goal ("12' - M. Rodek (Ekipa A)") stored on the
     * request, so an admin still knows which goal was asked for after the
     * organizer corrects or deletes the event. Resolves the lazy player/team
     * relations HERE, on the request thread.
     */
    private static String buildGoalLabel(MatchEvent ev) {
        String who = ev.getPlayer() != null ? ev.getPlayer().getName() : null;
        String team = ev.getPlayer() != null && ev.getPlayer().getTeam() != null
                ? ev.getPlayer().getTeam().getName()
                : ev.getTeam() != null ? ev.getTeam().getName() : null;

        StringBuilder sb = new StringBuilder();
        if (ev.getType() == MatchEventType.PENALTY_GOAL) {
            // Shootout kicks carry no meaningful match minute.
            sb.append("Penali");
        } else {
            sb.append(ev.getMinute() != null ? ev.getMinute() + "'" : "?");
        }
        sb.append(" - ");
        if (ev.getType() == MatchEventType.OWN_GOAL) {
            sb.append(who != null ? who + " (ag)" : "autogol");
        } else {
            sb.append(who != null ? who : "nepoznat strijelac");
        }
        if (team != null) sb.append(" (").append(team).append(")");

        String label = sb.toString();
        return label.length() > 255 ? label.substring(0, 255) : label;
    }

    /** Off unless the setting is explicitly "true" - see {@link #GOAL_REQUESTS_ENABLED_KEY}. */
    private boolean goalRequestsEnabled() {
        return "true".equalsIgnoreCase(String.valueOf(settings.get(GOAL_REQUESTS_ENABLED_KEY)).trim());
    }

    /** Croatian noun phrase for the request's kind, used in every notification. */
    private static String kindLabel(RecordingRequestKind kind) {
        return kind == RecordingRequestKind.GOAL ? "snimku gola" : "snimku utakmice";
    }

    /* ─────────────────────────── user endpoints ─────────────────────────── */

    /**
     * Request the whole match video (~20 EUR). Deliberately has NO match-status
     * gate: a request may be filed upfront, for a match that hasn't kicked off
     * yet. (Goal clips are the opposite - see {@link #createForGoal}.)
     */
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
        r.setKind(RecordingRequestKind.FULL_MATCH);
        r.setStatus(RecordingRequestStatus.REQUESTED);
        repo.save(r);

        notifyAdminByEmail(r, match);

        return Response.status(Response.Status.CREATED).entity(toDto(r)).build();
    }

    /**
     * Request a clip of ONE goal (~5 EUR) instead of the whole match. The goal
     * is addressed by its {@link MatchEvent} id; its match is derived from the
     * event, so the caller never has to keep the two in sync. Deduped per goal
     * (409 {@code DUPLICATE}) - independently of any whole-match request, so a
     * user can ask for both.
     *
     * <p>Unlike a whole-match request (which may be filed upfront, before the
     * match is played), a goal clip is only orderable once the match is
     * FINISHED: while it is live an event can still be corrected or deleted by
     * the organizer, so the ordered goal wouldn't be stable. 409
     * {@code MATCH_NOT_FINISHED} otherwise.
     *
     * <p>Currently OFF by default: without {@code app_settings} key
     * {@code goal_clip_requests_enabled = true} this answers 409
     * {@code GOAL_REQUESTS_DISABLED}. Only CREATION is gated - already-filed
     * goal requests keep being approved, paid, delivered and downloaded.
     */
    @POST
    @Path("/by-goal/{matchEventId}")
    @Authenticated
    @Transactional
    public Response createForGoal(@PathParam("matchEventId") Long matchEventId,
                                  @Valid CreateRecordingRequestBody body) {
        // Not on sale yet - checked FIRST so a disabled feature can't be probed
        // for which events exist.
        if (!goalRequestsEnabled()) {
            return conflict("GOAL_REQUESTS_DISABLED");
        }

        MatchEvent ev = eventRepo.findByIdOptional(matchEventId).orElse(null);
        if (ev == null) return Response.status(Response.Status.NOT_FOUND).build();
        if (!isGoal(ev.getType())) {
            throw new BadRequestException("matchEventId must reference a goal event");
        }

        Matches match = ev.getMatch();
        if (match.getStatus() != MatchStatus.FINISHED) {
            return conflict("MATCH_NOT_FINISHED");
        }

        String me = currentUid();
        if (repo.existsOpenForUserAndGoal(me, matchEventId)) {
            return conflict("DUPLICATE");
        }

        var r = new MatchRecordingRequest();
        r.setMatch(match);
        r.setKind(RecordingRequestKind.GOAL);
        r.setMatchEvent(ev);
        r.setGoalMinute(ev.getMinute());
        r.setGoalLabel(buildGoalLabel(ev));
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
        boolean goal = r.getKind() == RecordingRequestKind.GOAL;
        String subject = goal ? "Novi zahtjev za snimku gola" : "Novi zahtjev za snimku utakmice";
        String link = emailService.baseUrl() + "/profil";
        String html = emailService.shell(
                subject,
                "<p>Zaprimljen je novi zahtjev za " + kindLabel(r.getKind()) + " <strong>"
                        + EmailService.escapeHtml(label) + "</strong>"
                        + (tournamentName.isBlank()
                                ? "" : " (turnir " + EmailService.escapeHtml(tournamentName) + ")")
                        + ".</p>"
                        + (goal && r.getGoalLabel() != null
                                ? "<p>Gol: <strong>" + EmailService.escapeHtml(r.getGoalLabel())
                                        + "</strong></p>"
                                : "")
                        + (r.getNote() == null
                                ? "" : "<p>Napomena: " + EmailService.escapeHtml(r.getNote()) + "</p>"),
                link, "Otvori");
        emailService.sendHtml(notifyEmail, subject, html);
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
        // Resolve the kind wording HERE - the push is dispatched off-thread.
        String what = kindLabel(r.getKind());
        pushService.sendToUser(r.getCreatedByUid(), new PushService.PushPayload(
                approved ? "Zahtjev za snimku odobren" : "Zahtjev za snimku odbijen",
                "Tvoj zahtjev za " + what + (approved ? " je odobren." : " je odbijen.")
                        + " Detalji su na tvom profilu.",
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

    /**
     * Deliver, or re-link, a library recording (see {@link MatchRecordingController}
     * for the upload itself) - the admin never uploads against a request directly,
     * and no external URL is ever accepted. Callable again after DELIVERED to fix a
     * wrongly mapped recording. The recording must belong to the SAME match as the
     * request, and the request must already be APPROVED or DELIVERED.
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
        if (r.getStatus() != RecordingRequestStatus.APPROVED && r.getStatus() != RecordingRequestStatus.DELIVERED) {
            return conflict("NOT_APPROVED");
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
        boolean goal = r.getKind() == RecordingRequestKind.GOAL;
        pushService.sendToUser(r.getCreatedByUid(), new PushService.PushPayload(
                goal ? "Snimka gola je dostupna" : "Snimka utakmice je dostupna",
                goal
                        ? "Tvoja snimka gola je spremna. Preuzmi je na svom profilu."
                        : "Tvoja snimka utakmice je spremna. Preuzmi je na svom profilu.",
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
