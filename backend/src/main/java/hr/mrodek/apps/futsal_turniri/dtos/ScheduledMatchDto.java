package hr.mrodek.apps.futsal_turniri.dtos;

import java.time.OffsetDateTime;

/** One match in the tournament schedule, in play order. */
public record ScheduledMatchDto(
        Long matchId,
        String stage,
        Integer roundNumber,
        Long team1Id,
        String team1Name,
        Long team2Id,
        String team2Name,
        Integer score1,
        Integer score2,
        OffsetDateTime kickoffAt,
        String status
) {}
