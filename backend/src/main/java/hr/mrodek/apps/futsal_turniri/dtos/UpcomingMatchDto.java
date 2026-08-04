package hr.mrodek.apps.futsal_turniri.dtos;

import java.time.OffsetDateTime;

/**
 * Projection returned by {@code GET /tournaments/upcoming-matches}.
 * One SCHEDULED match with a concrete kickoff time, plus enough tournament
 * and team context to render a "starting soon" row on the /uzivo page
 * without follow-up requests.
 */
public record UpcomingMatchDto(
        Long matchId,
        String tournamentUuid,
        String tournamentSlug,
        String tournamentName,
        String team1Name,
        String team2Name,
        /** Scheduled kickoff - always non-null (the query filters nulls out). */
        OffsetDateTime kickoffAt,
        Integer tableNo,
        /** Match stage (GROUP, ROUND_OF_32, …, FINAL) - lets the /uzivo row
         *  show the phase next to the tournament name. */
        String stage,
        /** Group letter (A, B, …) for GROUP-stage matches; null for knockout. */
        String groupName,
        /** Stable numbered knockout code ("Š1", "O3", "ČF2", "PF1"), so /uzivo
         *  can say "ČF1" instead of a bare "Četvrtfinale" - four quarter-finals
         *  all labelled the same are indistinguishable in a list. */
        String knockoutCode,
        /** Predicted-pairing label for a slot whose team is still undecided
         *  ("A1", "Pobj. ČF1"). Exactly the fields the Raspored already renders -
         *  without them a knockout fixture reads as "- vs -" until the group
         *  stage ends, which is most of the time it spends in this feed. */
        String slot1Label,
        String slot2Label,
        /** Team name resolved from the standings once that group is finished. */
        String slot1PredictedName,
        String slot2PredictedName
) {}
