package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.repository.TeamsRepository;
import hr.mrodek.apps.futsal_turniri.repository.UserProfileRepository;
import hr.mrodek.apps.futsal_turniri.services.SlugService;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.jwt.JsonWebToken;

import java.time.OffsetDateTime;

/**
 * Team-sharing claim flow.
 *
 *   GET   /teams/claim/{token}/preview   — public read of basic info so
 *                                          the claim landing page can
 *                                          show the partner what they're
 *                                          claiming before they accept.
 *   POST  /teams/claim/{token}           — auth-required claim; sets
 *                                          coSubmittedByUid on the team.
 *
 * The primary submitter copies the share URL from their team card
 * (the /claim-team/{token} route on the frontend) and hands it to
 * their partner. The partner opens it, signs in if needed, taps the
 * Preuzmi button, and becomes co-owner of the team — meaning the team
 * shows up on their profile, they get push notifications about it,
 * and their personal invoice list includes matches it played.
 */
@Path("/teams/claim/{token}")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class TeamClaimController {

    @Inject TeamsRepository teamRepo;
    @Inject UserProfileRepository userProfileRepo;
    @Inject SlugService slugService;
    @Inject JsonWebToken jwt;

    /**
     * Public read used by the claim landing page. Returns the minimum
     * info the partner needs to recognise the team: team name,
     * tournament name + start date, and current claim state (whether
     * it's already been claimed by someone, and by whom if so — name +
     * slug for display, no UIDs leaked).
     */
    @GET
    @Path("/preview")
    public ClaimPreviewDto preview(@PathParam("token") String token) {
        Teams p = teamRepo.findByClaimToken(token).orElse(null);
        if (p == null) throw new NotFoundException();

        String primaryName = null, primarySlug = null;
        if (p.getSubmittedByUid() != null) {
            var prof = userProfileRepo.findByUid(p.getSubmittedByUid()).orElse(null);
            if (prof != null) {
                primaryName = prof.getDisplayName();
                primarySlug = prof.getSlug();
            }
        }
        String coName = null, coSlug = null;
        if (p.getCoSubmittedByUid() != null) {
            var prof = userProfileRepo.findByUid(p.getCoSubmittedByUid()).orElse(null);
            if (prof != null) {
                coName = prof.getDisplayName();
                coSlug = prof.getSlug();
            }
        }

        var t = p.getTournament();
        return new ClaimPreviewDto(
                p.getName(),
                t.getName(),
                t.getSlug() != null ? t.getSlug() : (t.getUuid() != null ? t.getUuid().toString() : null),
                t.getStartAt(),
                primaryName,
                primarySlug,
                p.getCoSubmittedByUid() != null,
                coName,
                coSlug
        );
    }

    /**
     * Claim co-ownership. Conflict states:
     *   - already claimed by a different user → 409 ALREADY_CLAIMED
     *   - viewer is the primary submitter → 409 OWNER_SAME
     *   - viewer is already the co-owner → no-op, 200
     */
    @POST
    @Authenticated
    @Transactional
    public ClaimResultDto claim(@PathParam("token") String token) {
        String me = jwt.getSubject();
        if (me == null || me.isBlank()) throw new NotAuthorizedException("Auth required");

        Teams p = teamRepo.findByClaimToken(token).orElse(null);
        if (p == null) throw new NotFoundException();

        if (me.equals(p.getSubmittedByUid())) {
            throw new ClientErrorException("OWNER_SAME", 409);
        }
        if (p.getCoSubmittedByUid() != null) {
            if (me.equals(p.getCoSubmittedByUid())) {
                // No-op idempotent — already claimed by this same user.
                return new ClaimResultDto(true, p.getId());
            }
            throw new ClientErrorException("ALREADY_CLAIMED", 409);
        }

        // Make sure the claimer's UserProfile + slug exist so they show
        // up on subsequent team-list enrichments. Mirrors the same
        // ensureProfile call used in self-register.
        String displayName = null;
        if (jwt != null && jwt.getRawToken() != null) {
            Object n = jwt.getClaim("name");
            if (n != null) displayName = n.toString();
            else {
                Object email = jwt.getClaim("email");
                if (email != null) displayName = email.toString();
            }
        }
        slugService.ensureProfile(me, displayName);

        p.setCoSubmittedByUid(me);
        p.setUpdatedAt(OffsetDateTime.now());
        teamRepo.persist(p);

        return new ClaimResultDto(true, p.getId());
    }

    /* ===================== DTOs ===================== */

    public record ClaimPreviewDto(
            String teamName,
            String tournamentName,
            String tournamentRef,
            OffsetDateTime tournamentStartAt,
            String primaryName,
            String primarySlug,
            boolean alreadyClaimed,
            String coOwnerName,
            String coOwnerSlug
    ) {}

    public record ClaimResultDto(boolean claimed, Long teamId) {}
}
