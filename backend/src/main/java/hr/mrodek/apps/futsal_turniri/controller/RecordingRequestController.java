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
import hr.mrodek.apps.futsal_turniri.services.MessageService;
import hr.mrodek.apps.futsal_turniri.services.PushService;
import hr.mrodek.apps.futsal_turniri.services.RecordingAutoLinkService;
import hr.mrodek.apps.futsal_turniri.services.RecordingRequestNotifier;
import hr.mrodek.apps.futsal_turniri.services.RecordingStorageService;
import hr.mrodek.apps.futsal_turniri.services.StripeService;
import io.quarkus.security.Authenticated;
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
import java.util.regex.Pattern;

/**
 * Paid match-video requests. Two kinds, same lifecycle:
 *   - FULL_MATCH (~20 EUR) - the video of one whole match.
 *   - GOAL (~5 EUR)        - a clip of one goal of that match.
 *
 * A request may come from a signed-in user OR anonymously (contact email
 * only) - either way, an admin approves it, the requester pays via Stripe
 * Checkout, and delivery is exclusively a {@link MatchRecording} linked in
 * from the admin's library ({@link MatchRecordingController}) - no external
 * links are accepted, and uploads never happen against a request directly.
 * The link can be re-pointed at any time (e.g. to fix a wrongly mapped
 * recording), even after delivery.
 *
 * <p>For an anonymous request the {@code uuid} itself IS the capability
 * token: whoever holds the status-page link (emailed to {@code contactEmail})
 * can view status, pay and cancel. A signed-in user's requests are also
 * reachable this way, plus via {@link #mine()}.
 *
 * Routes:
 *   POST   /recording-requests/by-match/{matchId}       - create, whole match (public: authenticated or anonymous)
 *   POST   /recording-requests/by-goal/{matchEventId}   - create, single goal clip (public: authenticated or anonymous)
 *   GET    /recording-requests/{uuid}/public            - limited public status view (public)
 *   POST   /recording-requests/{uuid}/checkout          - create a Stripe Checkout session (public, uuid capability)
 *   GET    /recording-requests/mine                     - own requests (user)
 *   GET    /recording-requests?status=                  - list all (admin)
 *   PUT    /recording-requests/{uuid}/status             - approve/reject (admin)
 *   PUT    /recording-requests/{uuid}/paid               - toggle paid (admin, manual override)
 *   PUT    /recording-requests/{uuid}/link-recording      - deliver / re-link a library recording (admin)
 *   GET    /recording-requests/{uuid}/download-link      - presigned GET (public, uuid capability; requires paid + delivered)
 *   DELETE /recording-requests/{uuid}                    - cancel (owner, or anonymous via uuid; only while REQUESTED)
 */
@Path("/recording-requests")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class RecordingRequestController {

    /** Presigned GET validity for the requester's download (48 h). */
    private static final int DOWNLOAD_EXPIRY_SECONDS = 172_800;

    /** local@domain.tld, TLD at least 2 letters - deliberately simple, not RFC-exhaustive. */
    private static final Pattern EMAIL_PATTERN = Pattern.compile("^[^\\s@]+@[^\\s@]+\\.[A-Za-z]{2,}$");

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
    @Inject AppSettingsRepository settings;
    @Inject RecordingRequestMapper mapper;
    @Inject RecordingStorageService recordingStorage;
    @Inject EmailService emailService;
    @Inject PushService pushService;
    @Inject StripeService stripeService;
    @Inject RecordingRequestNotifier notifier;
    @Inject RecordingAutoLinkService autoLink;
    @Inject MessageService messages;
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

    public record CheckoutResponse(String url) {}

    /** Limited status view for the public capability-link page - no contactEmail/adminNote. */
    public record PublicRequestView(
            UUID uuid, String team1Name, String team2Name, String tournamentName,
            String kickoffAt, String status, int priceEurCents, boolean paid, boolean hasVideo,
            String kind, String goalLabel) {}

    /* ─────────────────────────── helpers ─────────────────────────── */

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

    /** Trim + lower-case; blank collapses to null. */
    private static String normalizeEmail(String s) {
        if (s == null) return null;
        String t = s.trim();
        return t.isEmpty() ? null : t.toLowerCase();
    }

    private static boolean isValidEmail(String email) {
        if (email == null) return false;
        String t = email.trim();
        return !t.isEmpty() && t.length() <= 255 && EMAIL_PATTERN.matcher(t).matches();
    }

    /** Resolved requester identity: Firebase uid (null when anonymous) + validated contact email. */
    private record RequesterContact(String uid, String email) {}

    /**
     * Shared create-time contact resolution for both request kinds: a
     * signed-in caller may omit the email (falls back to the JWT email
     * claim), an anonymous caller must supply one. Always validated.
     */
    private RequesterContact resolveContact(CreateRecordingRequestBody body) {
        String me = currentUid();
        String contactEmail = normalizeEmail(body == null ? null : body.contactEmail());
        if (me != null && contactEmail == null) {
            Object emailClaim = jwt.getClaim("email");
            contactEmail = normalizeEmail(emailClaim == null ? null : emailClaim.toString());
        }
        if (contactEmail == null) {
            throw new BadRequestException(messages.t("recording.error.contactEmailRequired"));
        }
        if (!isValidEmail(contactEmail)) {
            throw new BadRequestException(messages.t("recording.error.invalidEmail"));
        }
        return new RequesterContact(me, contactEmail);
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

    /* ─────────────────────────── user endpoints ─────────────────────────── */

    /**
     * Request the whole match video (~20 EUR) - either as a signed-in user
     * (contactEmail optional, falls back to the Firebase token's email claim)
     * or fully anonymously (contactEmail mandatory; {@code createdByUid}
     * stays null and the uuid itself becomes the requester's only handle on
     * the request). Deliberately has NO match-status gate: a request may be
     * filed upfront, for a match that hasn't kicked off yet. (Goal clips are
     * the opposite - see {@link #createForGoal}.)
     */
    @POST
    @Path("/by-match/{matchId}")
    @Transactional
    public Response create(@PathParam("matchId") Long matchId, @Valid CreateRecordingRequestBody body) {
        Matches match = matchesRepo.findByIdOptional(matchId).orElse(null);
        if (match == null) return Response.status(Response.Status.NOT_FOUND).build();

        RequesterContact contact = resolveContact(body);
        boolean duplicate = contact.uid() != null
                ? repo.existsOpenForUserAndMatch(contact.uid(), matchId)
                : repo.existsOpenForEmailAndMatch(contact.email(), matchId);
        if (duplicate) return conflict("DUPLICATE");

        var r = new MatchRecordingRequest();
        r.setMatch(match);
        r.setKind(RecordingRequestKind.FULL_MATCH);
        r.setCreatedByUid(contact.uid());
        r.setContactEmail(contact.email());
        if (body != null) {
            r.setNote(body.note() == null || body.note().isBlank() ? null : body.note().trim());
        }
        r.setStatus(RecordingRequestStatus.REQUESTED);
        repo.save(r);

        notifier.notifyAdmin(r, match);
        notifier.notifyRequestReceived(r, match);

        return Response.status(Response.Status.CREATED).entity(toDto(r)).build();
    }

    /**
     * Request a clip of ONE goal (~5 EUR) instead of the whole match. The goal
     * is addressed by its {@link MatchEvent} id; its match is derived from the
     * event, so the caller never has to keep the two in sync. Deduped per goal
     * (409 {@code DUPLICATE}) - independently of any whole-match request, so a
     * user can ask for both. Anonymous callers are supported the same way as
     * in {@link #create}.
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
            throw new BadRequestException(messages.t("recording.error.goalEventRequired"));
        }

        Matches match = ev.getMatch();
        if (match.getStatus() != MatchStatus.FINISHED) {
            return conflict("MATCH_NOT_FINISHED");
        }

        RequesterContact contact = resolveContact(body);
        boolean duplicate = contact.uid() != null
                ? repo.existsOpenForUserAndGoal(contact.uid(), matchEventId)
                : repo.existsOpenForEmailAndGoal(contact.email(), matchEventId);
        if (duplicate) return conflict("DUPLICATE");

        var r = new MatchRecordingRequest();
        r.setMatch(match);
        r.setKind(RecordingRequestKind.GOAL);
        r.setMatchEvent(ev);
        r.setGoalMinute(ev.getMinute());
        r.setGoalLabel(buildGoalLabel(ev));
        r.setCreatedByUid(contact.uid());
        r.setContactEmail(contact.email());
        if (body != null) {
            r.setNote(body.note() == null || body.note().isBlank() ? null : body.note().trim());
        }
        r.setStatus(RecordingRequestStatus.REQUESTED);
        repo.save(r);

        notifier.notifyAdmin(r, match);
        notifier.notifyRequestReceived(r, match);

        return Response.status(Response.Status.CREATED).entity(toDto(r)).build();
    }

    @GET
    @Path("/mine")
    @Authenticated
    public List<RecordingRequestDto> mine() {
        return toDtoList(repo.findByCreatedByUid(currentUid()));
    }

    /**
     * Limited, public status view for the capability-link page - resolves the
     * same match/tournament labels as the full DTO but never leaks
     * {@code contactEmail} or {@code adminNote}.
     */
    @GET
    @Path("/{uuid}/public")
    public Response publicView(@PathParam("uuid") UUID uuid) {
        var r = repo.findByUuid(uuid).orElse(null);
        if (r == null) return Response.status(Response.Status.NOT_FOUND).build();

        Matches match = r.getMatch();
        String tournamentName = match.getTournament() != null ? match.getTournament().getName() : null;
        String team1 = match.getTeam1() != null ? match.getTeam1().getName() : null;
        String team2 = match.getTeam2() != null ? match.getTeam2().getName() : null;
        String kickoff = match.getKickoffAt() != null ? match.getKickoffAt().toString() : null;

        return Response.ok(new PublicRequestView(
                r.getUuid(), team1, team2, tournamentName, kickoff,
                r.getStatus().name(), r.getPriceEurCents(), r.getPaidAt() != null, r.getRecording() != null,
                r.getKind().name(), r.getGoalLabel()
        )).build();
    }

    /**
     * Creates a Stripe Checkout session for an approved-but-unpaid request.
     * Public: the uuid (only ever shared with the requester by email) is the
     * capability that authorizes payment - no login is required or possible
     * for an anonymous request.
     */
    @POST
    @Path("/{uuid}/checkout")
    public Response checkout(@PathParam("uuid") UUID uuid) {
        var r = repo.findByUuid(uuid).orElse(null);
        if (r == null) return Response.status(Response.Status.NOT_FOUND).build();
        if (r.getStatus() != RecordingRequestStatus.APPROVED && r.getStatus() != RecordingRequestStatus.DELIVERED) {
            return conflict("NOT_APPROVED");
        }
        if (r.getPaidAt() != null) {
            return conflict("ALREADY_PAID");
        }
        if (!stripeService.isConfigured()) {
            return conflict("NOT_CONFIGURED");
        }

        Matches match = r.getMatch();
        String productName = (r.getKind() == RecordingRequestKind.GOAL
                ? messages.t("recording.stripe.product.goal") + " " + (r.getGoalLabel() != null ? r.getGoalLabel() + ", " : "")
                : messages.t("recording.stripe.product.match") + " ")
                + RecordingRequestNotifier.matchLabel(match);
        String base = emailService.baseUrl() + "/snimke/zahtjev/" + uuid;
        String successUrl = base + "?placanje=uspjeh";
        String cancelUrl = base + "?placanje=odustao";

        String url = stripeService.createCheckoutSession(
                uuid.toString(), r.getPriceEurCents(), productName, successUrl, cancelUrl);
        return Response.ok(new CheckoutResponse(url)).build();
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
            throw new BadRequestException(messages.t("recording.error.statusInvalid"));
        }
        if (target != RecordingRequestStatus.APPROVED && target != RecordingRequestStatus.REJECTED) {
            throw new BadRequestException(messages.t("recording.error.statusInvalid"));
        }
        if (r.getStatus() != RecordingRequestStatus.REQUESTED) {
            return conflict("NOT_REQUESTED");
        }

        // Resolve the match on THIS request thread before any email work below.
        Matches match = r.getMatch();

        r.setStatus(target);
        if (body.adminNote() != null && !body.adminNote().isBlank()) {
            r.setAdminNote(body.adminNote().trim());
        }
        r.setUpdatedAt(OffsetDateTime.now());

        boolean approved = target == RecordingRequestStatus.APPROVED;
        // Resolve the kind wording HERE - the push is dispatched off-thread.
        String what = notifier.kindLabel(r.getKind());
        pushService.sendToUser(r.getCreatedByUid(), new PushService.PushPayload(
                messages.t(approved ? "recording.push.statusApproved.title" : "recording.push.statusRejected.title"),
                messages.t(approved ? "recording.push.approved.body" : "recording.push.rejected.body", what),
                "/profil"));

        if (approved) {
            notifier.notifyApproved(r, match);
        } else {
            notifier.notifyRejected(r, match);
        }

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
        boolean becamePaid = paid && r.getPaidAt() == null;
        r.setPaidAt(paid ? OffsetDateTime.now() : null);
        r.setUpdatedAt(OffsetDateTime.now());
        // The manual toggle stands in for the Stripe webhook (e.g. a cash /
        // bank-transfer payment): auto-link a library recording if one
        // already exists for this match, and send the download email either
        // way it ends up linked - same as the webhook path.
        if (becamePaid) {
            autoLink.autoLinkAndNotify(r);
        }
        return Response.ok(toDto(r)).build();
    }

    /**
     * Manual delivery path: the admin uploads to the library (see
     * {@link MatchRecordingController}) and links it here, for the case where
     * no recording existed for the match at the moment payment came in
     * ({@link RecordingAutoLinkService} already auto-links + emails instantly
     * when one does). Also used to re-link after DELIVERED, to fix a wrongly
     * mapped recording. No external URL is ever accepted, and the admin never
     * uploads against a request directly. The recording must belong to the
     * SAME match as the request, and the request must already be APPROVED or
     * DELIVERED.
     */
    @PUT
    @Path("/{uuid}/link-recording")
    @RolesAllowed("admin")
    @Transactional
    public Response linkRecording(@PathParam("uuid") UUID uuid, LinkRecordingBody body) {
        var r = repo.findByUuid(uuid).orElse(null);
        if (r == null) return Response.status(Response.Status.NOT_FOUND).build();
        if (body == null || body.recordingUuid() == null) {
            throw new BadRequestException(messages.t("recording.error.recordingUuidRequired"));
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
        if (r.getPaidAt() != null) {
            notifier.notifyDownloadReady(r);
        }
        return Response.ok(toDto(r)).build();
    }

    private void notifyDelivered(MatchRecordingRequest r) {
        boolean goal = r.getKind() == RecordingRequestKind.GOAL;
        pushService.sendToUser(r.getCreatedByUid(), new PushService.PushPayload(
                messages.t(goal ? "recording.push.downloadReady.goal.title" : "recording.push.downloadReady.match.title"),
                messages.t(goal ? "recording.push.downloadReady.goal.body" : "recording.push.downloadReady.match.body"),
                "/profil"));
    }

    /* ─────────────────────────── delivery download ─────────────────────────── */

    /**
     * Presigned GET for the delivered recording. Public: the uuid is the
     * capability (only ever emailed to the requester's contactEmail, or
     * visible to the signed-in owner / an admin). Requires the request to be
     * both paid AND delivered.
     */
    @GET
    @Path("/{uuid}/download-link")
    public Response downloadLink(@PathParam("uuid") UUID uuid) {
        var r = repo.findByUuid(uuid).orElse(null);
        if (r == null) return Response.status(Response.Status.NOT_FOUND).build();
        if (r.getStatus() != RecordingRequestStatus.DELIVERED || r.getRecording() == null) {
            return conflict("NOT_DELIVERED");
        }
        if (r.getPaidAt() == null) {
            return conflict("NOT_PAID");
        }
        String url = recordingStorage.presignedGet(
                r.getRecording().getVideoObjectKey(), DOWNLOAD_EXPIRY_SECONDS, r.getRecording().getFileName());
        return Response.ok(new DownloadLinkResponse(url, DOWNLOAD_EXPIRY_SECONDS)).build();
    }

    /* ─────────────────────────── cancel ─────────────────────────── */

    /**
     * Cancel a still-open request. A signed-in owner may cancel their own
     * request as before; an anonymous request (no {@code createdByUid}) may
     * be cancelled by anyone holding its uuid, since the uuid IS the
     * capability for that request. A request created by a signed-in user can
     * only be cancelled by that same user, never by a stranger who merely
     * guesses/observes the uuid.
     */
    @DELETE
    @Path("/{uuid}")
    @Transactional
    public Response cancel(@PathParam("uuid") UUID uuid) {
        var r = repo.findByUuid(uuid).orElse(null);
        if (r == null) return Response.status(Response.Status.NOT_FOUND).build();
        if (r.getCreatedByUid() != null && !isOwner(r)) {
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
