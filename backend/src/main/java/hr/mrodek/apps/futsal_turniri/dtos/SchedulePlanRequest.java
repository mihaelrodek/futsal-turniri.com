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
        String planHash
) {}
