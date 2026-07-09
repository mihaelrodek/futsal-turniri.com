package hr.mrodek.apps.futsal_turniri.dtos;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * Result of a group match. Group matches may end level (a draw). Scores are
 * bounded to non-negative sane values (mirrors {@link UpdateMatchRequest}) so
 * negative or absurd input can't corrupt the standings / qualifier seeding.
 */
public record GroupResultRequest(
        @Min(value = 0, message = "score1 cannot be negative")
        @Max(value = 100_000, message = "score1 is unrealistically high")
        int score1,

        @Min(value = 0, message = "score2 cannot be negative")
        @Max(value = 100_000, message = "score2 is unrealistically high")
        int score2
) {}
