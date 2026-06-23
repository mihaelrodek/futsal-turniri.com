package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Match-format configuration used to lay out the schedule. The slot length
 * (gap between consecutive kickoffs) is:
 * {@code halfCount*halfLengthMin + halftimeBreakMin + breakBetweenMatchesMin + bufferMin}.
 */
public record ScheduleConfigRequest(
        Integer halfCount,
        Integer halfLengthMin,
        Integer halftimeBreakMin,
        Integer breakBetweenMatchesMin,
        Integer bufferMin
) {}
