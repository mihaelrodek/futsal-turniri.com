package hr.mrodek.apps.futsal_turniri.dtos;

import java.time.OffsetDateTime;

/**
 * One match in the knockout bracket. Team slots are null until the feeding
 * matches are decided. {@code penalties1/2} are populated only when the
 * match was level after regulation.
 */
public record BracketMatchDto(
        Long matchId,
        String stage,
        Long team1Id,
        String team1Name,
        Long team2Id,
        String team2Name,
        Integer score1,
        Integer score2,
        Integer penalties1,
        Integer penalties2,
        Long winnerTeamId,
        String status,
        String liveMode,
        OffsetDateTime liveStartedAt,
        /** Instant the 1st half was ended (match in half-time "pauza"); null otherwise. */
        OffsetDateTime firstHalfEndedAt,
        OffsetDateTime secondHalfStartedAt,
        /** Instant the live clock was paused; null while running. */
        OffsetDateTime livePausedAt,
        /** Scheduled kickoff - null until the schedule is generated/confirmed.
         *  A match can't be started live before it has one. */
        OffsetDateTime kickoffAt,
        /** Accumulated team fouls per half (for the live-entry foul controls). */
        Integer fouls1First,
        Integer fouls1Second,
        Integer fouls2First,
        Integer fouls2Second
) {}
