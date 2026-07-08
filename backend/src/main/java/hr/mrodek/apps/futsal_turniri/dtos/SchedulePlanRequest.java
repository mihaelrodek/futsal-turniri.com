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
        List<DaySchedule> days
) {}
