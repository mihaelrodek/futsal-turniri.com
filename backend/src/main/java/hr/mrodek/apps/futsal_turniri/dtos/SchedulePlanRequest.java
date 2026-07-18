package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.List;

/**
 * Multi-day schedule request: the match-format config (as in
 * {@link ScheduleConfigRequest}) plus the per-day plan. Used by both the
 * non-persisting preview ("Skiciraj") and the persisting generate ("Potvrdi").
 */
public record SchedulePlanRequest(
        Integer halfCount,
        Integer halfLengthMin,
        Integer halftimeBreakMin,
        Integer breakBetweenMatchesMin,
        Integer bufferMin,
        /** Knockout half-length override; null/0 = knockout plays like the groups. */
        Integer koHalfLengthMin,
        /** Knockout halftime-break override; only read when koHalfLengthMin is set. */
        Integer koHalftimeBreakMin,
        /** Knockout break-between-matches override; only read when koHalfLengthMin is set. */
        Integer koBreakBetweenMatchesMin,
        List<DaySchedule> days,
        /**
         * Optional custom play order from the preview's drag-and-drop: the
         * 0-based single-court plan indices in the order the organizer wants
         * them played. The j-th listed match gets the j-th time slot. Null or
         * empty = keep the automatic order. Only used by generate, ignored by
         * the preview.
         */
        List<Integer> order,
        /**
         * The {@code planHash} of the sketch the order was dragged on. When
         * set together with {@code order}, generate verifies the fixtures
         * still fingerprint the same and rejects a stale order otherwise.
         */
        String planHash,
        /**
         * Knockout-only mode. When {@code true}, this plan covers ONLY the
         * knockout matches (stage != GROUP, byes excluded): the group kickoffs
         * are never touched and the group-format fields on the tournament are
         * left as stored. Preview and generate build their ordered list from the
         * knockout matches alone, so planIndex/order/planHash all address that
         * knockout-only list. Null/false = the usual whole-tournament plan.
         */
        Boolean koOnly,
        /**
         * Draggable pauses. Each break advances the day cursor by {@code minutes}
         * BEFORE the match at 0-based play-order position {@code beforeOrderPos}
         * (positions index the final scheduled sequence, i.e. after any custom
         * {@code order} permutation). A pause never creates a match row - it only
         * shifts the subsequent kickoffs. Multiple breaks are additive and may
         * share a position. Null/empty = no pauses (bit-identical to the old
         * layout).
         */
        List<Break> breaks
) {
    /**
     * A single draggable pause in the schedule walk.
     *
     * @param beforeOrderPos 0-based play-order position the pause sits in front
     *                       of (the scheduled sequence the organizer saw/dragged)
     * @param minutes        how long the pause lasts (1..24*60)
     */
    public record Break(Integer beforeOrderPos, Integer minutes) {}
}
