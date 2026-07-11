package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * One row in the tournament's goal-scorers ranking, returned by
 * {@code GET /tournaments/{uuid}/stats/scorers}.
 *
 * <p>{@code goals} counts only the goals inside the organizer's scorer scope
 * (default: knockout only) and drives the ranking; {@code goalsAll} is the
 * full tally including the group stage, shown alongside so both reads are
 * always visible. Equal when the scope is ALL.
 */
public record ScorerDto(
        Long playerId,
        String playerName,
        String teamName,
        long goals,
        long goalsAll
) {}
