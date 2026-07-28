package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.repository.TeamsRepository;
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
 * </ul>
 */
@Path("/teams")
@Produces(MediaType.APPLICATION_JSON)
public class TeamsSearchController {

    @Inject TeamsRepository teamRepo;

    @GET
    @Path("/search")
    @Authenticated
    public List<String> search(@QueryParam("q") String q) {
        if (q == null || q.trim().length() < 2) return List.of();
        return teamRepo.searchDistinctNames(q, 10);
    }
}
