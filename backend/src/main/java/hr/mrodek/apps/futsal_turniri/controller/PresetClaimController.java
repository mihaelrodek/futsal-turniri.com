package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.model.UserTeamPreset;
import hr.mrodek.apps.futsal_turniri.repository.UserTeamPresetRepository;
import hr.mrodek.apps.futsal_turniri.repository.UserProfileRepository;
import hr.mrodek.apps.futsal_turniri.services.SlugService;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.jwt.JsonWebToken;

import java.time.OffsetDateTime;

/**
 * Preset-level claim flow ("share with partner").
 *
 *   GET   /teams-name/claim/{token}/preview  - public read of the preset
 *                                              + primary submitter info
 *   POST  /teams-name/claim/{token}          - auth-required claim; sets
 *                                              preset.coOwnerUid AND
 *                                              backfills coSubmittedByUid
 *                                              on every existing Team
 *                                              with that name submitted
 *                                              by the primary so the
 *                                              partner sees them on their
 *                                              profile + gets push.
 *
 * The /claim-name/{token} URL on the frontend hands the token in here.
 */
@Path("/teams-name/claim/{token}")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class PresetClaimController {

    @Inject UserTeamPresetRepository presetRepo;
    @Inject UserProfileRepository userProfileRepo;
    @Inject SlugService slugService;
    @Inject EntityManager em;
    @Inject JsonWebToken jwt;

    @GET
    @Path("/preview")
    public ClaimPreviewDto preview(@PathParam("token") String token) {
        UserTeamPreset p = presetRepo.findByClaimToken(token).orElse(null);
        if (p == null) throw new NotFoundException();

        String primaryName = null, primarySlug = null;
        if (p.getUserUid() != null) {
            var prof = userProfileRepo.findByUid(p.getUserUid()).orElse(null);
            if (prof != null) {
                primaryName = prof.getDisplayName();
                primarySlug = prof.getSlug();
            }
        }
        String coName = null, coSlug = null;
        if (p.getCoOwnerUid() != null) {
            var prof = userProfileRepo.findByUid(p.getCoOwnerUid()).orElse(null);
            if (prof != null) {
                coName = prof.getDisplayName();
                coSlug = prof.getSlug();
            }
        }
        return new ClaimPreviewDto(
                p.getName(),
                primaryName,
                primarySlug,
                p.getCoOwnerUid() != null,
                coName,
                coSlug
        );
    }

    /**
     * Claim co-ownership. Conflict states:
     *   - viewer is the primary owner → 409 OWNER_SAME
     *   - preset already claimed by a different user → 409 ALREADY_CLAIMED
     *   - viewer is already the co-owner → idempotent no-op, 200
     *
     * Side effect: every existing Team submitted by the primary with
     * this name (case-insensitive trim) gets its coSubmittedByUid set
     * to the claimer's UID. This propagates equal-participant view to
     * old teams too - profile listing, push notifications, bill access.
     */
    @POST
    @Authenticated
    @Transactional
    public ClaimResultDto claim(@PathParam("token") String token) {
        String me = jwt.getSubject();
        if (me == null || me.isBlank()) throw new NotAuthorizedException("Auth required");

        UserTeamPreset p = presetRepo.findByClaimToken(token).orElse(null);
        if (p == null) throw new NotFoundException();

        if (me.equals(p.getUserUid())) {
            throw new ClientErrorException("OWNER_SAME", 409);
        }
        if (p.getCoOwnerUid() != null) {
            if (me.equals(p.getCoOwnerUid())) {
                return new ClaimResultDto(true, p.getUuid().toString());
            }
            throw new ClientErrorException("ALREADY_CLAIMED", 409);
        }

        // Ensure the claimer's UserProfile + slug exist for downstream
        // enrichment on the primary's team list.
        String displayName = null;
        Object n = jwt.getClaim("name");
        if (n != null) displayName = n.toString();
        else {
            Object email = jwt.getClaim("email");
            if (email != null) displayName = email.toString();
        }
        slugService.ensureProfile(me, displayName);

        // Mark the preset claimed.
        p.setCoOwnerUid(me);
        p.setUpdatedAt(OffsetDateTime.now());
        presetRepo.persist(p);

        // Backfill: every Team the primary submitted under this name
        // that doesn't already have a co-owner gets the claimer set.
        // Plain bulk UPDATE via JPQL - touches only matching rows.
        em.createQuery("""
                update Teams p
                set p.coSubmittedByUid = :coUid
                where p.submittedByUid = :primary
                  and p.coSubmittedByUid is null
                  and lower(trim(p.name)) = :name
                """)
                .setParameter("coUid", me)
                .setParameter("primary", p.getUserUid())
                .setParameter("name", p.getName().trim().toLowerCase())
                .executeUpdate();

        return new ClaimResultDto(true, p.getUuid().toString());
    }

    /* ===================== DTOs ===================== */

    public record ClaimPreviewDto(
            String name,
            String primaryName,
            String primarySlug,
            boolean alreadyClaimed,
            String coOwnerName,
            String coOwnerSlug
    ) {}

    public record ClaimResultDto(boolean claimed, String presetUuid) {}
}
