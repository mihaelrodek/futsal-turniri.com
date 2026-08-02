package hr.mrodek.apps.futsal_turniri.dtos;

public record MatchDto(
        Long id,
        Integer tableNo,
        Long team1Id,
        String team1Name,
        Long team2Id,
        String team2Name,
        Integer score1,
        Integer score2,
        Long winnerTeamId,
        String status,
        /** Which side wears training bibs this match: 1, 2 or null. Its
         *  effective jersey colour is bib yellow for this match only. */
        Integer bibTeam
) {}
