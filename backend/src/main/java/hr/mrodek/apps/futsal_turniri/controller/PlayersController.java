package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.GlobalScorerDto;
import hr.mrodek.apps.futsal_turniri.repository.PlayersRepository;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import io.quarkus.security.Authenticated;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;

import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Cross-tournament player endpoints — distinct from the per-team roster
 * endpoints under {@code /tournaments/{uuid}/teams/{teamId}/players}.
 *
 * <ul>
 *   <li>{@code GET /players/search?q=} — autocomplete of existing player
 *       names (authenticated; only used while editing a roster). Lets the
 *       organiser reuse an existing name so the same person's goals
 *       aggregate on the all-time scorer list.</li>
 *   <li>{@code GET /players/scorers} — the all-time scorer list
 *       ("vječna lista strijelaca"). Public.</li>
 * </ul>
 */
@Path("/players")
@Produces(MediaType.APPLICATION_JSON)
public class PlayersController {

    @Inject PlayersRepository playerRepo;
    @Inject TournamentsRepository tournamentsRepo;

    @GET
    @Path("/search")
    @Authenticated
    public List<String> search(@QueryParam("q") String q) {
        if (q == null || q.trim().length() < 2) return List.of();
        return playerRepo.searchDistinctNames(q, 10);
    }

    @GET
    @Path("/scorers")
    public List<GlobalScorerDto> scorers() {
        Map<String, Long> awards = tournamentsRepo.bestScorerAwardCounts();
        return playerRepo.findGlobalScorers().stream()
                .map(row -> {
                    String name = (String) row[0];
                    long goals = (Long) row[1];
                    long tournaments = (Long) row[2];
                    long awardCount = awards.getOrDefault(
                            name == null ? null : name.toUpperCase(Locale.ROOT), 0L);
                    return new GlobalScorerDto(name, goals, tournaments, awardCount);
                })
                // goals desc, then best-scorer awards desc, then name asc.
                .sorted((a, b) -> {
                    if (a.goals() != b.goals()) return Long.compare(b.goals(), a.goals());
                    if (a.bestScorerAwards() != b.bestScorerAwards()) {
                        return Long.compare(b.bestScorerAwards(), a.bestScorerAwards());
                    }
                    return String.valueOf(a.name()).compareTo(String.valueOf(b.name()));
                })
                .toList();
    }
}
