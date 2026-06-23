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
        String status
) {}
