package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * One row in the tournament's goal-scorers ranking, returned by
 * {@code GET /tournaments/{uuid}/stats/scorers}.
 */
public record ScorerDto(
        Long playerId,
        String playerName,
        String teamName,
        long goals
) {}
