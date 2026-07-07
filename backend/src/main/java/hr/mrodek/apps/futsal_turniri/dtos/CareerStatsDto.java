package hr.mrodek.apps.futsal_turniri.dtos;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * Aggregate career statistics for a single public profile. Computed by
 * {@code PublicProfileController#getCareer} on the fly - there's no
 * dedicated table, the numbers are summed across every {@code Teams}
 * row this user is associated with.
 *
 * <p>Only FINISHED matches contribute to W/D/L and goal counters; a
 * scheduled-but-not-played match would skew the goals-per-tournament
 * picture.
 */
public record CareerStatsDto(
        /** Distinct tournaments the user has participated in. */
        int tournamentsPlayed,

        /** Tournaments the user's team won (by {@code Tournaments.winnerName}). */
        int tournamentsWon,

        /** FINISHED matches the user's teams played. */
        int matchesPlayed,
        int matchesWon,
        int matchesDrawn,
        int matchesLost,

        /** Sum of goals scored across every FINISHED match. */
        int goalsFor,
        int goalsAgainst,

        /** Team name that's appeared in the most tournaments - null when no plays yet. */
        String topTeamName,

        /** 6 most recent tournaments, freshest first. */
        List<RecentTournament> recent
) {
    public record RecentTournament(
            String tournamentName,
            String tournamentSlug,
            String teamName,
            OffsetDateTime startAt,
            /** Outcome label: "Pobjeda", "Eliminacija", "Sudjelovanje". */
            String result
    ) {}
}
