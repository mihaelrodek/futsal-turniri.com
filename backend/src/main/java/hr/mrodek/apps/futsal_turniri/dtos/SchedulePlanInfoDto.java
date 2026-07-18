package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Prediction of how many matches the whole tournament will have, used to drive
 * the "matches remaining to schedule" counter in the multi-day generate flow.
 * {@code knockoutMatches} is the predicted knockout bracket size (elimination
 * matches + third-place playoff), reserved even before the bracket is drawn.
 *
 * <p>{@code remainingGroupMatches} / {@code remainingKnockoutMatches} count the
 * PERSISTED matches that still need (re)scheduling - those that are neither
 * played (LIVE or FINISHED) nor byes. Mid-tournament re-planning lays out only
 * these, leaving already-played matches' kickoffs untouched; each is 0 for a
 * stage whose matches don't exist yet or are all already played. The predicted
 * totals above are unaffected.
 */
public record SchedulePlanInfoDto(
        int groupMatches,
        int knockoutMatches,
        int totalMatches,
        int remainingGroupMatches,
        int remainingKnockoutMatches
) {}
