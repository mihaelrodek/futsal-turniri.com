package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.TeamColorsDto;
import hr.mrodek.apps.futsal_turniri.repository.TeamDefaultKitRepository;
import hr.mrodek.apps.futsal_turniri.repository.TeamsRepository;
import hr.mrodek.apps.futsal_turniri.services.TeamNameNormalizer;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;

import java.util.List;

/**
 * Cross-tournament team endpoints - distinct from the per-tournament team
 * management endpoints under {@code /tournaments/{uuid}/teams} and the
 * claim-flow endpoints under {@code /teams/claim/{token}} (TeamClaimController).
 *
 * <ul>
 *   <li>{@code GET /teams/search?q=} - autocomplete of existing team names
 *       across all tournaments (authenticated; used while adding/self-
 *       registering a team so the same team can reuse an existing name).</li>
 *   <li>{@code GET /teams/default-kits?name=} - every kit colour combination
 *       ever saved for that team identity (authenticated; used to pre-fill
 *       jersey/shorts colours right after picking a name from the
 *       autocomplete).</li>
 * </ul>
 */
@Path("/teams")
@Produces(MediaType.APPLICATION_JSON)
public class TeamsSearchController {

    @Inject TeamsRepository teamRepo;
    @Inject TeamDefaultKitRepository defaultKitRepo;

    @GET
    @Path("/search")
    @Authenticated
    public List<String> search(@QueryParam("q") String q) {
        if (q == null || q.trim().length() < 2) return List.of();
        return teamRepo.searchDistinctNames(q, 10);
    }

    /**
     * Saved default kits for a team identity, most-recently-used first (so
     * the caller can just take the first entry to pre-fill). Empty when the
     * team has never had a kit colour saved under this name.
     */
    @GET
    @Path("/default-kits")
    @Authenticated
    public List<TeamColorsDto> defaultKits(@QueryParam("name") String name) {
        if (name == null || name.trim().isEmpty()) return List.of();
        String normalized = TeamNameNormalizer.normalize(name);
        return defaultKitRepo.findByNormalizedName(normalized).stream()
                .map(k -> new TeamColorsDto(k.getJerseyColor(), k.getShortsColor()))
                .toList();
    }
}
