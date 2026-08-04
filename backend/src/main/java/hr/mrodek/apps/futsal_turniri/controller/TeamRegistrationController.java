package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.RegistrationFormDto;
import hr.mrodek.apps.futsal_turniri.dtos.RegistrationLinkDto;
import hr.mrodek.apps.futsal_turniri.dtos.TeamRegistrationRequest;
import hr.mrodek.apps.futsal_turniri.enums.NotificationKind;
import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.model.TournamentRegistrationLink;
import hr.mrodek.apps.futsal_turniri.repository.TeamsRepository;
import hr.mrodek.apps.futsal_turniri.repository.TournamentRegistrationLinkRepository;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import hr.mrodek.apps.futsal_turniri.services.EmailService;
import hr.mrodek.apps.futsal_turniri.services.MailTemplates;
import hr.mrodek.apps.futsal_turniri.services.MessageService;
import hr.mrodek.apps.futsal_turniri.services.PushService;
import hr.mrodek.apps.futsal_turniri.services.TeamRegistrationService;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.PermitAll;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.jwt.JsonWebToken;
import org.jboss.logging.Logger;

import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Team registration by form: the organizer generates a link, sends it to a
 * club, and whoever holds it files a roster - <b>with no account</b>.
 *
 * <p>Why anonymous is the requirement and not a shortcut: the person who has
 * the squad list is a club contact, not a user of this app, and will not create
 * an account to type eight names in. Forcing a login is precisely what makes an
 * organizer give up and enter the roster by hand.
 *
 * <p><b>What the token can and cannot do.</b> It is the whole credential for
 * filing a registration against ONE tournament, so it is a random uuid and the
 * organizer can revoke it ({@code active = false}). It cannot publish
 * anything: {@link TeamRegistrationService} always creates the team with
 * {@code pendingApproval = true}, which keeps it out of the public team list,
 * the draw and the "enough teams to start" count until the organizer approves.
 * The worst a leaked link buys is junk in a review queue.
 *
 * <p>Both notification channels the rest of the app uses for organizer-facing
 * work fire on a submission: the in-app inbox of everyone who can edit the
 * tournament, and the organizer's e-mail when one is known.
 *
 * Routes:
 *   GET    /registration/{token}                       - PUBLIC form context
 *   POST   /registration/{token}                       - PUBLIC submit
 *   GET    /registration/tournaments/{uuid}/links       - organizer: list links
 *   POST   /registration/tournaments/{uuid}/links       - organizer: create a link
 *   PUT    /registration/links/{id}/active              - organizer: revoke / restore
 */
@Path("/registration")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class TeamRegistrationController {

    private static final Logger LOG = Logger.getLogger(TeamRegistrationController.class);

    /** Submissions accepted per link per hour. A club filing twice is normal;
     *  twenty in an hour is a script. */
    private static final int SUBMITS_PER_HOUR = 20;
    private static final long HOUR_MS = 60 * 60 * 1000L;

    /** token -> timestamps of accepted submits inside the current window. In
     *  memory on purpose: this is a speed bump, not an audit trail, and a
     *  restart clearing it is harmless. */
    private static final Map<String, List<Long>> SUBMITS = new ConcurrentHashMap<>();

    @Inject TournamentRegistrationLinkRepository linkRepo;
    @Inject TournamentsRepository tournamentsRepo;
    @Inject TeamsRepository teamRepo;
    @Inject TeamRegistrationService registrationService;
    @Inject PushService pushService;
    @Inject EmailService emailService;
    @Inject MessageService messages;
    @Inject hr.mrodek.apps.futsal_turniri.repository.UserProfileRepository profileRepo;
    @Inject SecurityIdentity identity;
    @Inject JsonWebToken jwt;

    @ConfigProperty(name = "app.public-base-url", defaultValue = "https://futsal-turniri.com")
    String publicBaseUrl;

    public record CreateLinkBody(String label) {}

    public record ActiveBody(Boolean active) {}

    /* ─────────────────────────── helpers ─────────────────────────── */

    private static Response conflict(String code) {
        return Response.status(Response.Status.CONFLICT).entity(code).build();
    }

    private static UUID parseToken(String raw) {
        try {
            return UUID.fromString(raw.trim());
        } catch (Exception e) {
            return null;
        }
    }

    private String linkUrl(TournamentRegistrationLink link) {
        return publicBaseUrl + "/prijava-ekipe/" + link.getToken();
    }

    /**
     * Organizer-or-admin gate, mirroring {@code TournamentController#assertCanEdit}:
     * admin, owner, or a co-editor. Kept as a local check rather than shared
     * because that method is private to a 3000-line controller and this needs
     * exactly the owner/admin half plus the editor table.
     */
    private void assertCanManage(Tournaments t) {
        if (identity != null && identity.hasRole("admin")) return;
        String uid = jwt == null ? null : jwt.getSubject();
        if (uid != null && uid.equals(t.getCreatedByUid())) return;
        if (uid != null && editorRepo.isEditor(t.getId(), uid)) return;
        throw new ForbiddenException("Not allowed to manage this tournament");
    }

    @Inject hr.mrodek.apps.futsal_turniri.repository.TournamentEditorRepository editorRepo;

    /** True when this token has already used its hourly budget. Records the
     *  submit as a side effect when it has not. */
    private static boolean throttled(String token) {
        long now = System.currentTimeMillis();
        var stamps = SUBMITS.computeIfAbsent(token, k -> new ArrayList<>());
        synchronized (stamps) {
            stamps.removeIf(ts -> now - ts > HOUR_MS);
            if (stamps.size() >= SUBMITS_PER_HOUR) return true;
            stamps.add(now);
            return false;
        }
    }

    /* ─────────────────────────── public form ─────────────────────────── */

    /**
     * Everything the form needs to render. Answers 404 for both an unknown and
     * a malformed token; a revoked link or a started tournament comes back 200
     * with {@code open = false} and a reason, because "you are too late" is a
     * far more useful screen than a dead 404.
     */
    @GET
    @Path("/{token}")
    @PermitAll
    @Transactional
    public Response form(@PathParam("token") String token) {
        UUID parsed = parseToken(token);
        var link = parsed == null ? null : linkRepo.findByToken(parsed).orElse(null);
        if (link == null) return Response.status(Response.Status.NOT_FOUND).build();

        Tournaments t = link.getTournament();
        String closed = !link.isActive() ? "LINK_REVOKED" : registrationService.closedReason(t);

        return Response.ok(new RegistrationFormDto(
                t.getName(),
                t.getSlug(),
                t.getLocation(),
                t.getStartAt() == null ? null : t.getStartAt().format(DateTimeFormatter.ISO_OFFSET_DATE_TIME),
                t.getOrganizerName(),
                link.getLabel(),
                closed == null,
                closed)).build();
    }

    /**
     * Files the registration. No authentication - see the class doc.
     *
     * <p>409 codes: {@code LINK_REVOKED}, {@code TOURNAMENT_ALREADY_STARTED},
     * {@code DUPLICATE_TEAM} (name already used in this tournament),
     * {@code TOO_MANY_SUBMISSIONS}. 400 when the contact fields are missing -
     * they are the organizer's ONLY way back to an anonymous submitter, which
     * is why they are required here and not on the signed-in path.
     */
    @POST
    @Path("/{token}")
    @PermitAll
    @Transactional
    public Response submit(@PathParam("token") String token, @Valid TeamRegistrationRequest body) {
        UUID parsed = parseToken(token);
        var link = parsed == null ? null : linkRepo.findByToken(parsed).orElse(null);
        if (link == null) return Response.status(Response.Status.NOT_FOUND).build();
        if (!link.isActive()) return conflict("LINK_REVOKED");

        Tournaments t = link.getTournament();
        String closed = registrationService.closedReason(t);
        if (closed != null) return conflict(closed);

        if (body.contactName() == null || body.contactName().isBlank()
                || body.contact() == null || body.contact().isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST).entity("CONTACT_REQUIRED").build();
        }

        if (throttled(token)) return conflict("TOO_MANY_SUBMISSIONS");

        Teams team = registrationService.register(t, body, null, link);
        link.setUseCount(link.getUseCount() + 1);

        int playerCount = body.players() == null ? 0 : (int) body.players().stream()
                .filter(p -> p.name() != null && !p.name().isBlank())
                .count();

        // Resolve everything the notifications need HERE, on the request
        // thread - the push dispatch has no persistence context.
        notifyOrganizer(t, team.getName(), body.contactName().trim(), playerCount);

        return Response.status(Response.Status.CREATED)
                .entity(registrationService.summary(team, playerCount))
                .build();
    }

    /**
     * Tells the people who can act on it. In-app inbox for the owner and every
     * co-editor, plus e-mail to the tournament's contact address when there is
     * one. Fire-and-forget: the registration is already committed and must not
     * fail because a mail server is down.
     */
    private void notifyOrganizer(Tournaments t, String teamName, String contactName, int playerCount) {
        String title = messages.t("registration.notify.title");
        String bodyText = messages.t("registration.notify.body", teamName, contactName, playerCount);
        String url = "/turniri/" + (t.getSlug() != null ? t.getSlug() : t.getUuid()) + "?tab=ekipe";

        try {
            var payload = new PushService.PushPayload(title, bodyText, url);
            if (t.getCreatedByUid() != null && !t.getCreatedByUid().isBlank()) {
                pushService.sendToUser(t.getCreatedByUid(), payload, NotificationKind.ADMIN_REQUEST);
            }
            for (String editorUid : editorRepo.uidsForTournament(t.getId())) {
                if (editorUid == null || editorUid.isBlank()) continue;
                if (editorUid.equals(t.getCreatedByUid())) continue;
                pushService.sendToUser(editorUid, payload, NotificationKind.ADMIN_REQUEST);
            }
        } catch (Exception e) {
            LOG.warnf(e, "Registration: organizer notification failed for %s", teamName);
        }

        try {
            // Tournaments carry no contact address of their own - the owner's
            // profile e-mail is the only one we have, and it is the same
            // mailbox every other organizer notification uses.
            String to = t.getCreatedByUid() == null ? null
                    : profileRepo.findByUid(t.getCreatedByUid())
                            .map(hr.mrodek.apps.futsal_turniri.model.UserProfile::getEmail)
                            .orElse(null);
            if (to == null || to.isBlank() || !emailService.isReady()) return;
            String subject = messages.t("mail.registration.subject");
            String html = emailService.shell(subject,
                    MailTemplates.render("team-registration", Map.of(
                            "intro", messages.t("mail.registration.intro",
                                    EmailService.escapeHtml(teamName),
                                    EmailService.escapeHtml(t.getName())),
                            "detailsLine", messages.t("mail.registration.detailsLine",
                                    EmailService.escapeHtml(contactName), playerCount))),
                    publicBaseUrl + url,
                    messages.t("mail.registration.cta"));
            emailService.sendHtml(to, subject, html);
        } catch (Exception e) {
            LOG.warnf(e, "Registration: organizer e-mail failed for %s", teamName);
        }
    }

    /**
     * The same form, filed by ANYONE from the tournament page - no account, no
     * link. This is the open door: a visitor who finds the tournament can enter
     * their team, which is the point of a public tournament listing.
     *
     * <p>What keeps it from being a spam hole is the same thing that protects
     * the link: the entry lands {@code pendingApproval = true} and is invisible
     * until the organizer approves it. On top of that the contact fields are
     * mandatory and submissions are throttled per client IP.
     *
     * <p>Open exactly as long as the tournament accepts entries - once it is
     * STARTED, FINISHED or archived this answers 409, the same as the link.
     */
    @POST
    @Path("/tournaments/{uuid}/public")
    @PermitAll
    @Transactional
    public Response submitPublic(@PathParam("uuid") String uuid,
                                 @HeaderParam("X-Forwarded-For") String forwardedFor,
                                 @Valid TeamRegistrationRequest body) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();

        String closed = registrationService.closedReason(t);
        if (closed != null) return conflict(closed);

        if (body.contactName() == null || body.contactName().isBlank()
                || body.contact() == null || body.contact().isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST).entity("CONTACT_REQUIRED").build();
        }

        // Keyed on the caller, not the tournament: throttling per tournament
        // would let one abuser lock every other club out of registering.
        if (throttled("ip:" + clientIp(forwardedFor))) return conflict("TOO_MANY_SUBMISSIONS");

        Teams team = registrationService.register(t, body, null, null);

        int playerCount = body.players() == null ? 0 : (int) body.players().stream()
                .filter(p -> p.name() != null && !p.name().isBlank())
                .count();
        notifyOrganizer(t, team.getName(), body.contactName().trim(), playerCount);

        return Response.status(Response.Status.CREATED)
                .entity(registrationService.summary(team, playerCount))
                .build();
    }

    /**
     * First hop of {@code X-Forwarded-For} - the original client as Caddy saw
     * it. Null in local dev (no proxy); everyone then shares one bucket, which
     * is harmless there and never happens in production.
     */
    private static String clientIp(String forwardedFor) {
        if (forwardedFor == null || forwardedFor.isBlank()) return "unknown";
        int comma = forwardedFor.indexOf(',');
        String first = (comma >= 0 ? forwardedFor.substring(0, comma) : forwardedFor).trim();
        return first.isEmpty() ? "unknown" : first;
    }

    /**
     * The same form, filed by a SIGNED-IN user straight from the tournament
     * page - no link needed. Contact fields are optional here: the account is
     * the identity, and the organizer can reach the submitter through their
     * profile.
     *
     * <p>Deliberately separate from the legacy
     * {@code POST /tournaments/{uuid}/teams/self-register}, which takes a name
     * and nothing else and is still what the "quick" signup button uses. Both
     * go through {@link TeamRegistrationService}, so both land pending.
     */
    @POST
    @Path("/tournaments/{uuid}/register")
    @Authenticated
    @Transactional
    public Response registerAsUser(@PathParam("uuid") String uuid,
                                   @Valid TeamRegistrationRequest body) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();

        String closed = registrationService.closedReason(t);
        if (closed != null) return conflict(closed);

        // Required here too, not just anonymously: an organizer reviewing a
        // pending entry needs a phone or e-mail on the row itself, rather than
        // having to open the submitter's profile to find one.
        if (body.contactName() == null || body.contactName().isBlank()
                || body.contact() == null || body.contact().isBlank()) {
            return Response.status(Response.Status.BAD_REQUEST).entity("CONTACT_REQUIRED").build();
        }

        String uid = jwt == null ? null : jwt.getSubject();
        Teams team = registrationService.register(t, body, uid, null);

        int playerCount = body.players() == null ? 0 : (int) body.players().stream()
                .filter(p -> p.name() != null && !p.name().isBlank())
                .count();
        String who = body.contactName() != null && !body.contactName().isBlank()
                ? body.contactName().trim()
                : team.getName();
        notifyOrganizer(t, team.getName(), who, playerCount);

        return Response.status(Response.Status.CREATED)
                .entity(registrationService.summary(team, playerCount))
                .build();
    }

    /* ─────────────────────────── organizer: links ─────────────────────────── */

    @GET
    @Path("/tournaments/{uuid}/links")
    @Authenticated
    @Transactional
    public Response listLinks(@PathParam("uuid") String uuid) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        assertCanManage(t);

        // One grouped count instead of a query per link.
        Map<Long, Long> perLink = teamRepo.countByRegistrationLink(t.getId());

        List<RegistrationLinkDto> out = new ArrayList<>();
        for (var link : linkRepo.findByTournamentId(t.getId())) {
            out.add(toDto(link, perLink.getOrDefault(link.getId(), 0L).intValue()));
        }
        return Response.ok(out).build();
    }

    @POST
    @Path("/tournaments/{uuid}/links")
    @Authenticated
    @Transactional
    public Response createLink(@PathParam("uuid") String uuid, CreateLinkBody body) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return Response.status(Response.Status.NOT_FOUND).build();
        assertCanManage(t);

        var link = new TournamentRegistrationLink();
        link.setTournament(t);
        link.setCreatedByUid(jwt == null ? null : jwt.getSubject());
        String label = body == null || body.label() == null ? null : body.label().trim();
        if (label != null && label.isEmpty()) label = null;
        if (label != null && label.length() > 200) label = label.substring(0, 200);
        link.setLabel(label);
        linkRepo.save(link);

        return Response.status(Response.Status.CREATED).entity(toDto(link, 0)).build();
    }

    /**
     * Revoke or restore a link. Never a DELETE: the teams that registered
     * through it point back at it, and "where did this entry come from" has to
     * survive the organizer tidying up their link list.
     */
    @PUT
    @Path("/links/{id}/active")
    @Authenticated
    @Transactional
    public Response setActive(@PathParam("id") Long id, ActiveBody body) {
        var link = linkRepo.findByIdOptional(id).orElse(null);
        if (link == null) return Response.status(Response.Status.NOT_FOUND).build();
        assertCanManage(link.getTournament());

        link.setActive(Boolean.TRUE.equals(body == null ? null : body.active()));
        Map<Long, Long> perLink = teamRepo.countByRegistrationLink(link.getTournament().getId());
        return Response.ok(toDto(link, perLink.getOrDefault(link.getId(), 0L).intValue())).build();
    }

    /**
     * Delete a link outright.
     *
     * <p>Safe because {@code teams.registration_link_id} is
     * {@code ON DELETE SET NULL}: the registrations filed through it stay
     * exactly where they are, they just stop recording which link they came
     * through. That provenance is the one thing lost - which is why
     * {@link #setActive} still exists for "stop accepting, keep the trail".
     */
    @DELETE
    @Path("/links/{id}")
    @Authenticated
    @Transactional
    public Response deleteLink(@PathParam("id") Long id) {
        var link = linkRepo.findByIdOptional(id).orElse(null);
        if (link == null) return Response.status(Response.Status.NOT_FOUND).build();
        assertCanManage(link.getTournament());
        linkRepo.delete(link);
        return Response.noContent().build();
    }

    private RegistrationLinkDto toDto(TournamentRegistrationLink link, int teamCount) {
        return new RegistrationLinkDto(
                link.getId(),
                link.getToken().toString(),
                linkUrl(link),
                link.getLabel(),
                link.isActive(),
                link.getUseCount(),
                teamCount,
                link.getCreatedAt() == null ? null : link.getCreatedAt().toString());
    }
}
