package hr.mrodek.apps.futsal_turniri.dtos;

import java.time.OffsetDateTime;

/** One fixture within a group — used for the group's match list / result entry. */
public record GroupMatchDto(
        Long matchId,
        Long team1Id,
        String team1Name,
        Long team2Id,
        String team2Name,
        Integer score1,
        Integer score2,
        String status,
        String liveMode,
        OffsetDateTime liveStartedAt,
        OffsetDateTime secondHalfStartedAt
) {}
