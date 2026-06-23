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
        OffsetDateTime secondHalfStartedAt
) {}
