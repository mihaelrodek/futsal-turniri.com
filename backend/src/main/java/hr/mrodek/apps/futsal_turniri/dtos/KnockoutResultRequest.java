package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Result of a knockout match. {@code penalties1/2} are required (and must
 * differ) only when {@code score1 == score2} — a knockout match cannot end
 * level.
 */
public record KnockoutResultRequest(
        int score1,
        int score2,
        Integer penalties1,
        Integer penalties2
) {}
