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
        Integer penalties2,
        /** Accumulated team fouls per half - counters, not timestamped events,
         *  so they surface as a per-half tally on the match timeline (and stay
         *  readable once the match is FINISHED and the live overlay is gone). */
        Integer fouls1First,
        Integer fouls1Second,
        Integer fouls2First,
        Integer fouls2Second,
        /** Predicted-pairing label for the slot while its team is still undecided,
         *  so the Raspored can show "A1 – D2" (or "Pobj. ČF1" / "Por. PF2") instead
         *  of TBD. Null once the real team is known, for a bye, and always for
         *  KNOCKOUT_ONLY / group matches. */
        String slot1Label,
        String slot2Label,
        /** Team name resolved from the standings for a round-one group-label slot
         *  once THAT group is finished (per-group). Null otherwise. */
        String slot1PredictedName,
        String slot2PredictedName
) {}
