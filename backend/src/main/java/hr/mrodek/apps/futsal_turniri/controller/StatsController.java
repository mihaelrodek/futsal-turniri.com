package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.TeamMedalsDto;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

import java.util.List;

/**
 * Cross-tournament, site-wide statistics endpoints.
 *
 * <ul>
 *   <li>{@code GET /stats/team-medals} - the all-time team medal table
 *       ("World Cup"-style): gold/silver/bronze counts aggregated across
 *       every finished tournament. Public.</li>
 * </ul>
 */
@Path("/stats")
@Produces(MediaType.APPLICATION_JSON)
public class StatsController {

    @Inject TournamentsRepository tournamentsRepo;

    @GET
    @Path("/team-medals")
    public List<TeamMedalsDto> teamMedals() {
        return tournamentsRepo.teamMedalCounts().stream()
                // gold desc, then silver desc, then bronze desc, then name asc.
                .sorted((a, b) -> {
                    if (a.gold() != b.gold()) return Long.compare(b.gold(), a.gold());
                    if (a.silver() != b.silver()) return Long.compare(b.silver(), a.silver());
                    if (a.bronze() != b.bronze()) return Long.compare(b.bronze(), a.bronze());
                    return String.valueOf(a.name()).compareTo(String.valueOf(b.name()));
                })
                .toList();
    }
}
