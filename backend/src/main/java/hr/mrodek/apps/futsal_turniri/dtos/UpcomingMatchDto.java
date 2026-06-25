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
        /** Scheduled kickoff — always non-null (the query filters nulls out). */
        OffsetDateTime kickoffAt,
        Integer tableNo,
        /** Match stage (GROUP, ROUND_OF_32, …, FINAL) — lets the /uzivo row
         *  show the phase next to the tournament name. */
        String stage,
        /** Group letter (A, B, …) for GROUP-stage matches; null for knockout. */
        String groupName
) {}
