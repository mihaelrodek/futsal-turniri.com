package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.UserTeamPresetDto;
import hr.mrodek.apps.futsal_turniri.model.UserTeamPreset;
import hr.mrodek.apps.futsal_turniri.model.UserProfile;
import hr.mrodek.apps.futsal_turniri.repository.UserTeamPresetRepository;
import hr.mrodek.apps.futsal_turniri.repository.UserProfileRepository;
import hr.mrodek.apps.futsal_turniri.services.PushService;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.Valid;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.jwt.JsonWebToken;

import java.security.SecureRandom;
import java.time.OffsetDateTime;
import java.util.Base64;
import java.util.List;
import java.util.Objects;
import java.util.UUID;

/**
 * Per-user team-name presets.
 *
 * Each preset can be viewed by two users - the primary (creator) and a
 * claimed co-owner. Both see the same row in their Moji parovi list.
 * Edit + visibility-toggle are open to either owner. Delete on a
 * co-owned preset goes through the archive-request flow:
 *
 *   1. Either owner POSTs /{uuid}/archive-request → request created,
 *      partner gets a push notification.
 *   2. Partner POSTs /{uuid}/archive-confirm → archived = true, both
 *      lose the row from their list.
 *   3. Either side can DELETE /{uuid}/archive-request to cancel/reject.
 */
@Path("/user/team-presets")
@Authenticated
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class UserTeamPresetController {

    @Inject UserTeamPresetRepository repo;
    @Inject UserProfileRepository profileRepo;
    @Inject PushService pushService;
    @Inject JsonWebToken jwt;

    private String currentUid() {
        return jwt.getSubject();
    }

    /**
     * Build the viewer-aware DTO. "Partner" = the OTHER user from this
     * viewer's perspective (whichever side they are).
     */
    private UserTeamPresetDto toDto(UserTeamPreset p) {
        String me = currentUid();
        boolean iAmPrimary = me != null && me.equals(p.getUserUid());
        String partnerUid = iAmPrimary ? p.getCoOwnerUid() : p.getUserUid();
        UserProfile partner = partnerUid == null ? null : profileRepo.findByUid(partnerUid).orElse(null);

        // Token only goes to the primary when no one's claimed yet - that's
        // the only state where sharing is meaningful.
        boolean unclaimed = p.getCoOwnerUid() == null || p.getCoOwnerUid().isBlank();
        String token = (iAmPrimary && unclaimed) ? p.getClaimToken() : null;

        boolean archReqByMe = p.getArchiveRequestByUid() != null
                && p.getArchiveRequestByUid().equals(me);
        boolean archReqByPartner = p.getArchiveRequestByUid() != null
                && !p.getArchiveRequestByUid().equals(me);

        return new UserTeamPresetDto(
                p.getUuid(),
                p.getName(),
                p.isHidden(),
                iAmPrimary ? "PRIMARY" : "CO_OWNER",
                partner == null ? null : partner.getSlug(),
                partner == null ? null : partner.getDisplayName(),
                token,
                archReqByMe,
                archReqByPartner
        );
    }

    private static String generateClaimToken() {
        byte[] buf = new byte[24];
        new SecureRandom().nextBytes(buf);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(buf);
    }

    @GET
    public List<UserTeamPresetDto> list() {
        return repo.findActiveForViewer(currentUid()).stream()
                .map(this::toDto)
                .toList();
    }

    @POST
    @Transactional
    public Response create(@Valid UserTeamPresetDto body) {
        UserTeamPreset p = new UserTeamPreset();
        p.setUserUid(currentUid());
        p.setName(body.name().trim());
        p.setHidden(Boolean.TRUE.equals(body.hidden()));
        p.setClaimToken(generateClaimToken());
        repo.save(p);
        return Response.status(Response.Status.CREATED).entity(toDto(p)).build();
    }

    @PUT
    @Path("/{uuid}")
    @Transactional
    public Response update(@PathParam("uuid") UUID uuid, @Valid UserTeamPresetDto body) {
        // Either owner can rename.
        var p = repo.findByUuidForOwnerOrCoOwner(uuid, currentUid()).orElse(null);
        if (p == null) return Response.status(Response.Status.NOT_FOUND).build();
        p.setName(body.name().trim());
        if (body.hidden() != null) p.setHidden(body.hidden());
        return Response.ok(toDto(p)).build();
    }

    @POST
    @Path("/{uuid}/visibility")
    @Transactional
    public Response setVisibility(
            @PathParam("uuid") UUID uuid,
            VisibilityRequest body
    ) {
        if (body == null) throw new BadRequestException("Body required");
        var p = repo.findByUuidForOwnerOrCoOwner(uuid, currentUid()).orElse(null);
        if (p == null) return Response.status(Response.Status.NOT_FOUND).build();
        p.setHidden(body.hidden());
        return Response.ok(toDto(p)).build();
    }

    @DELETE
    @Path("/{uuid}")
    @Transactional
    public Response delete(@PathParam("uuid") UUID uuid) {
        // Only the primary can hit this - co-owner gets 404. Once
        // co-owned, deletion must go through the archive-request flow.
        var p = repo.findByUuidAndUserUid(uuid, currentUid()).orElse(null);
        if (p == null) return Response.status(Response.Status.NOT_FOUND).build();
        if (p.getCoOwnerUid() != null && !p.getCoOwnerUid().isBlank()) {
            return Response.status(Response.Status.CONFLICT)
                    .entity("CO_OWNED_USE_ARCHIVE_FLOW")
                    .build();
        }
        repo.delete(p);
        return Response.noContent().build();
    }

    /* ===================== Archive-request lifecycle ===================== */

    /**
     * File a request to archive. Either owner can call this. The partner
     * gets a push notification and sees the request in their UI.
     */
    @POST
    @Path("/{uuid}/archive-request")
    @Transactional
    public Response requestArchive(@PathParam("uuid") UUID uuid) {
        String me = currentUid();
        var p = repo.findByUuidForOwnerOrCoOwner(uuid, me).orElse(null);
        if (p == null) return Response.status(Response.Status.NOT_FOUND).build();
        if (p.getCoOwnerUid() == null || p.getCoOwnerUid().isBlank()) {
            // Not co-owned - nothing to archive. UI should never hit this,
            // but return 409 with a code instead of crashing.
            return Response.status(Response.Status.CONFLICT)
                    .entity("NOT_CO_OWNED").build();
        }
        if (p.getArchiveRequestByUid() != null) {
            // Already pending - idempotent.
            return Response.ok(toDto(p)).build();
        }
        p.setArchiveRequestByUid(me);
        repo.persist(p);

        // Push the partner.
        String partnerUid = me.equals(p.getUserUid()) ? p.getCoOwnerUid() : p.getUserUid();
        var myProfile = profileRepo.findByUid(me).orElse(null);
        String requesterName = myProfile != null && myProfile.getDisplayName() != null
                ? myProfile.getDisplayName()
                : "Suvlasnik";
        pushService.sendToUser(partnerUid, new PushService.PushPayload(
                "Zahtjev za brisanje para",
                requesterName + " želi obrisati par \"" + p.getName() + "\". Prihvati ili odbij u Postavkama.",
                "/profil"
        ));
        return Response.ok(toDto(p)).build();
    }

    /**
     * Confirm the request - sets archived=true and pushes the requester
     * that their request was accepted. Caller must be the OTHER owner
     * (the one who didn't file the request).
     */
    @POST
    @Path("/{uuid}/archive-confirm")
    @Transactional
    public Response confirmArchive(@PathParam("uuid") UUID uuid) {
        String me = currentUid();
        var p = repo.findByUuidForOwnerOrCoOwner(uuid, me).orElse(null);
        if (p == null) return Response.status(Response.Status.NOT_FOUND).build();
        if (p.getArchiveRequestByUid() == null) {
            return Response.status(Response.Status.CONFLICT)
                    .entity("NO_REQUEST_PENDING").build();
        }
        if (Objects.equals(p.getArchiveRequestByUid(), me)) {
            // The requester is trying to confirm their own request - wrong side.
            return Response.status(Response.Status.CONFLICT)
                    .entity("OWN_REQUEST_CANNOT_CONFIRM").build();
        }

        String requesterUid = p.getArchiveRequestByUid();
        p.setArchived(true);
        p.setArchivedAt(OffsetDateTime.now());
        p.setArchiveRequestByUid(null);
        repo.persist(p);

        var myProfile = profileRepo.findByUid(me).orElse(null);
        String confirmerName = myProfile != null && myProfile.getDisplayName() != null
                ? myProfile.getDisplayName()
                : "Suvlasnik";
        pushService.sendToUser(requesterUid, new PushService.PushPayload(
                "Par obrisan",
                confirmerName + " je potvrdio brisanje para \"" + p.getName() + "\".",
                "/profil"
        ));
        return Response.noContent().build();
    }

    /**
     * Cancel a pending request. Either side can hit this:
     *   - Requester cancels their own request (changed their mind)
     *   - Partner rejects the request (doesn't want to archive)
     */
    @DELETE
    @Path("/{uuid}/archive-request")
    @Transactional
    public Response cancelArchive(@PathParam("uuid") UUID uuid) {
        String me = currentUid();
        var p = repo.findByUuidForOwnerOrCoOwner(uuid, me).orElse(null);
        if (p == null) return Response.status(Response.Status.NOT_FOUND).build();
        if (p.getArchiveRequestByUid() == null) {
            return Response.ok(toDto(p)).build(); // nothing to cancel
        }

        String requesterUid = p.getArchiveRequestByUid();
        boolean rejection = !requesterUid.equals(me);
        p.setArchiveRequestByUid(null);
        repo.persist(p);

        // If the partner is rejecting, push the original requester so they
        // know their request was declined.
        if (rejection) {
            var myProfile = profileRepo.findByUid(me).orElse(null);
            String rejecterName = myProfile != null && myProfile.getDisplayName() != null
                    ? myProfile.getDisplayName()
                    : "Suvlasnik";
            pushService.sendToUser(requesterUid, new PushService.PushPayload(
                    "Zahtjev odbijen",
                    rejecterName + " je odbio brisanje para \"" + p.getName() + "\".",
                    "/profil"
            ));
        }
        return Response.noContent().build();
    }

    public record VisibilityRequest(boolean hidden) {}
}
