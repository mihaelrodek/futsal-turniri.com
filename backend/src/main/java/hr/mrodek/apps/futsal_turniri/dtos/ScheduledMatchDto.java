package hr.mrodek.apps.futsal_turniri.dtos;

import java.time.OffsetDateTime;

/** One match in the tournament schedule, in play order. */
public record ScheduledMatchDto(
        Long matchId,
        String stage,
        /** Group letter (A, B, …) for GROUP-stage matches; null for knockout. */
        String groupName,
        Integer roundNumber,
        Long team1Id,
        String team1Name,
        Long team2Id,
        String team2Name,
        Integer score1,
        Integer score2,
        OffsetDateTime kickoffAt,
        String status,
        /** Knockout only - the team that advanced (decides win/loss in a team's
         *  match history; group matches leave this null and use the score). */
        Long winnerTeamId,
        /** Penalty-shootout score, set only for a knockout match level after
         *  regulation. */
        Integer penalties1,
        Integer penalties2
) {}
