package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.integrations.spectostream.SpectoStreamService;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.repository.TournamentEditorRepository;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import hr.mrodek.apps.futsal_turniri.services.MessageService;
import io.quarkus.security.Authenticated;
import io.quarkus.security.identity.SecurityIdentity;
import jakarta.annotation.security.PermitAll;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.ForbiddenException;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.jwt.JsonWebToken;

/**
 * SpectoStream broadcast-overlay integration for a single tournament.
 *
 * <p>Provisioning links the tournament to a SpectoStream broadcast (creating,
 * idempotently, the upstream stream) and hands the organizer back their OBS
 * server/key + an embed snippet; unlinking clears the link. While linked, the
 * live-match hooks in {@link TournamentController} forward every clock / score /
 * card event to the overlay. This controller only manages the link itself plus
 * a manual custom overlay message.
 *
 * <p>Every endpoint is organizer-guarded (admin, the tournament's creator, or a
 * granted co-editor) - mirrors {@link TournamentController}'s
 * {@code canManage}/{@code assertCanEdit} and {@link KnockoutController}'s guard.
 */
@Path("/tournaments/{uuid}/specto")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class SpectoStreamController {

    @Inject SpectoStreamService specto;
    @Inject TournamentsRepository tournamentsRepo;
    @Inject TournamentEditorRepository editorRepo;
    @Inject SecurityIdentity identity;
    @Inject JsonWebToken jwt;
    @Inject MessageService messages;

    /** Integration/link status for the tournament: whether the SpectoStream
     *  integration is configured on the server at all, whether THIS tournament
     *  is linked, and its stream id (null when unlinked). */
    public record SpectoStatusDto(boolean configured, boolean linked, String streamId) {}

    /** Body for a manual custom overlay message. */
    public record SpectoMessageRequest(String text) {}

    /** Body for attaching an existing stream by id. */
    public record SpectoLinkRequest(String streamId) {}

    /** Public view: just the stream id a viewer needs to mount the player. */
    public record SpectoPublicDto(String streamId) {}

    /**
     * PUBLIC (no auth): the tournament's SpectoStream id, or null when it isn't
     * linked. A hidden tournament deliberately exposes no player to ordinary
     * viewers; its creator, co-editors and admins retain access. Deliberately
     * exposes ONLY the id: the OBS ingest key stays behind the organizer-
     * guarded provision endpoint.
     */
    @GET
    @Path("/public")
    @PermitAll
    public Response publicInfo(@PathParam("uuid") String uuid) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) throw new NotFoundException("Tournament not found");
        if (t.isHidden() && !canManage(t)) {
            return Response.ok(new SpectoPublicDto(null)).build();
        }
        String streamId = t.getSpectoStreamId();
        return Response.ok(new SpectoPublicDto(
                streamId != null && isPlainStreamId(streamId) ? streamId : null)).build();
    }

    /** Current status - configured + linked + streamId. Organizer-guarded. */
    @GET
    public Response status(@PathParam("uuid") String uuid) {
        Tournaments t = resolveAndGuard(uuid);
        String streamId = t.getSpectoStreamId();
        return Response.ok(new SpectoStatusDto(
                specto.isConfigured(), streamId != null, streamId)).build();
    }

    /**
     * Provision (or re-provision) the SpectoStream broadcast for this
     * tournament and link it. Idempotent - the upstream call is a PUT, so
     * repeating it just returns the same stream. Returns the OBS server/key +
     * embed snippet the organizer needs to go live. Organizer-guarded.
     *
     * <p>503 when the integration isn't configured on the server; 502 (raised
     * by the service) when the upstream provisioning call fails.
     */
    @POST
    @Path("/provision")
    @Transactional
    public Response provision(@PathParam("uuid") String uuid) {
        Tournaments t = resolveAndGuard(uuid);
        if (!specto.isConfigured()) {
            return Response.status(Response.Status.SERVICE_UNAVAILABLE)
                    .entity(messages.t("specto.error.notConfigured")).build();
        }
        // SYNC: persists the stream id on the tournament; raises 502 on upstream
        // failure, which propagates as-is (and rolls back this transaction).
        SpectoStreamService.ProvisionInfo info = specto.provisionTournament(t);
        return Response.ok(info).build();
    }

    /**
     * Attach an EXISTING SpectoStream broadcast by id, without provisioning a
     * new one - for a stream created directly on the platform. No upstream call
     * is made: the id is simply recorded, after which the live hooks relay
     * events to it and viewers' players mount. A blank id clears the link
     * (same as DELETE). Organizer-guarded.
     */
    @POST
    @Path("/link")
    @Transactional
    public Response link(@PathParam("uuid") String uuid, SpectoLinkRequest body) {
        Tournaments t = resolveAndGuard(uuid);
        String streamId = body == null || body.streamId() == null ? null : body.streamId().trim();
        if (streamId != null && !streamId.isEmpty() && !isPlainStreamId(streamId)) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(messages.t("specto.error.invalidStreamId")).build();
        }
        specto.linkExisting(t, streamId);
        return Response.ok(new SpectoStatusDto(
                specto.isConfigured(), t.getSpectoStreamId() != null, t.getSpectoStreamId())).build();
    }

    private static boolean isPlainStreamId(String streamId) {
        return streamId.length() <= 200 && streamId.matches("^[A-Za-z0-9][A-Za-z0-9_-]*$");
    }

    /** Unlink the tournament from its SpectoStream broadcast (clears the stream
     *  id only; no upstream teardown). Idempotent. Organizer-guarded. */
    @DELETE
    @Transactional
    public Response unlink(@PathParam("uuid") String uuid) {
        Tournaments t = resolveAndGuard(uuid);
        specto.unlink(t);
        return Response.noContent().build();
    }

    /**
     * Push a manual custom message onto the overlay. Non-blank, at most 200
     * characters. A no-op on the service side when the tournament is unlinked /
     * the integration is unconfigured, so it always returns 202 (accepted for
     * best-effort delivery). Organizer-guarded.
     */
    @POST
    @Path("/message")
    public Response message(@PathParam("uuid") String uuid, SpectoMessageRequest body) {
        Tournaments t = resolveAndGuard(uuid);
        String text = body == null || body.text() == null ? null : body.text().trim();
        if (text == null || text.isEmpty() || text.length() > 200) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity(messages.t("specto.error.messageBlankOrTooLong")).build();
        }
        specto.customMessage(t, text);
        return Response.status(Response.Status.ACCEPTED).build();
    }

    /* ── Guard ─────────────────────────────────────────────────────────────
       Resolve the tournament by uuid/slug and enforce organizer access. Mirrors
       TournamentController.canManage/assertCanEdit: admin, the creator, or a
       granted co-editor may manage the stream; anyone else gets 403. */

    private Tournaments resolveAndGuard(String uuid) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) throw new NotFoundException("Tournament not found");
        if (!canManage(t)) {
            throw new ForbiddenException(
                    "Only the creator, a granted editor or an admin can manage this tournament's stream.");
        }
        return t;
    }

    private boolean canManage(Tournaments t) {
        boolean admin = identity != null && identity.hasRole("admin");
        if (admin) return true;
        String me = jwt != null ? jwt.getSubject() : null;
        if (me == null) return false;
        if (me.equals(t.getCreatedByUid())) return true;
        return editorRepo.isEditor(t.getId(), me);
    }
}
