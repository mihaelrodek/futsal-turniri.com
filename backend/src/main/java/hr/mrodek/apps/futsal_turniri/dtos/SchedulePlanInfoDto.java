package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Prediction of how many matches the whole tournament will have, used to drive
 * the "matches remaining to schedule" counter in the multi-day generate flow.
 * {@code knockoutMatches} is the predicted knockout bracket size (elimination
 * matches + third-place playoff), reserved even before the bracket is drawn.
 */
public record SchedulePlanInfoDto(
        int groupMatches,
        int knockoutMatches,
        int totalMatches
) {}
