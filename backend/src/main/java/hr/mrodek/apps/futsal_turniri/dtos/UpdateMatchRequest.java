package hr.mrodek.apps.futsal_turniri.dtos;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * Score is nullable — a match can be temporarily saved without a decisive result.
 * When both values are present, they must be non-negative and within a sane cap.
 * Futsal match scores are tiny (single or low double digits); 100_000 is an absurdly
 * high defensive ceiling to catch obvious typos / malicious input.
 */
public record UpdateMatchRequest(
        @Min(value = 0, message = "score1 cannot be negative")
        @Max(value = 100_000, message = "score1 is unrealistically high")
        Integer score1,

        @Min(value = 0, message = "score2 cannot be negative")
        @Max(value = 100_000, message = "score2 is unrealistically high")
        Integer score2
) {}
