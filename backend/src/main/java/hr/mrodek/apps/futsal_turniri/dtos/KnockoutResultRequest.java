package hr.mrodek.apps.futsal_turniri.dtos;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * Result of a knockout match. {@code penalties1/2} are required (and must
 * differ) only when {@code score1 == score2} - a knockout match cannot end
 * level. Scores/penalties are bounded to non-negative sane values (mirrors
 * {@link UpdateMatchRequest}) so negative or absurd input can't corrupt the
 * bracket / podium.
 */
public record KnockoutResultRequest(
        @Min(value = 0, message = "score1 cannot be negative")
        @Max(value = 100_000, message = "score1 is unrealistically high")
        int score1,

        @Min(value = 0, message = "score2 cannot be negative")
        @Max(value = 100_000, message = "score2 is unrealistically high")
        int score2,

        @Min(value = 0, message = "penalties1 cannot be negative")
        @Max(value = 100_000, message = "penalties1 is unrealistically high")
        Integer penalties1,

        @Min(value = 0, message = "penalties2 cannot be negative")
        @Max(value = 100_000, message = "penalties2 is unrealistically high")
        Integer penalties2
) {}
