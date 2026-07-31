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

        /** Tournaments the user's team finished 2nd/3rd (by
         *  {@code Tournaments.secondPlaceName}/{@code thirdPlaceName}). */
        int tournamentsSecond,
        int tournamentsThird,

        /** 1/2/3 - the best podium finish across every tournament, or null
         *  when the user has never finished on the podium. */
        Integer bestPlacement,

        /** FINISHED matches the user's teams played. */
        int matchesPlayed,
        int matchesWon,
        int matchesDrawn,
        int matchesLost,

        /** Sum of goals scored across every FINISHED match (TEAM score, not
         *  the user's personal tally - see {@link #playerGoals}). */
        int goalsFor,
        int goalsAgainst,

        /** Goals personally scored by the roster player whose name matches
         *  the profile's own "ime prezime", on teams the profile owns - 0
         *  when the profile has no name set or never matched a scorer. */
        int playerGoals,

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
