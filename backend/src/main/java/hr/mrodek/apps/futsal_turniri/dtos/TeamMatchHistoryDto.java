package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.List;

/**
 * Match-by-match history for a single team within a single tournament.
 * Used to drill into "round 3 - vs Pero & Ivo - 4:2 (won)".
 */
public record TeamMatchHistoryDto(
        Long teamId,
        String teamName,
        String tournamentName,

        List<Row> matches
) {
    public record Row(
            Long matchId,         // lets the profile link straight into the match page
            Integer roundNumber,
            /**
             * GROUP | ROUND_OF_32 | … | FINAL. Lets the profile label a row by
             * its knockout stage ("Četvrtfinale") instead of a round number,
             * which for a bracket match is meaningless.
             */
            String stage,
            Integer tableNo,
            String opponentName,
            Integer ourScore,
            Integer opponentScore,
            String status,        // SCHEDULED | IN_PROGRESS | COMPLETED | …
            Boolean won,          // null when not yet completed
            Boolean isBye,        // true when there was no opponent (auto-advance)

            // What THIS profile's own roster player did in this match, matched
            // by folded "ime prezime" (PersonNameFolder) - 0 when the person
            // isn't on the roster or did nothing of note.
            int goals,
            int ownGoals,
            int yellowCards,
            int redCards
    ) {}
}
