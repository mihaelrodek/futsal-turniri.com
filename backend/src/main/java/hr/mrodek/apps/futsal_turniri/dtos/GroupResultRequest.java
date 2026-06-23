package hr.mrodek.apps.futsal_turniri.dtos;

/** Result of a group match. Group matches may end level (a draw). */
public record GroupResultRequest(
        int score1,
        int score2
) {}
