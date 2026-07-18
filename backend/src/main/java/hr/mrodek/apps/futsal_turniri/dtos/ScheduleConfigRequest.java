package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Match-format configuration used to lay out the schedule. The slot length
 * (gap between consecutive kickoffs) is:
 * {@code halfCount*halfLengthMin + halftimeBreakMin + breakBetweenMatchesMin + bufferMin}.
 *
 * <p>The {@code ko*} fields optionally override the format for knockout
 * matches (e.g. groups 2x6, knockout 2x8) - then group and knockout matches
 * get different slot lengths. Null/0 {@code koHalfLengthMin} = the knockout
 * plays exactly like the group stage.
 */
public record ScheduleConfigRequest(
        Integer halfCount,
        Integer halfLengthMin,
        Integer halftimeBreakMin,
        Integer breakBetweenMatchesMin,
        Integer bufferMin,
        Integer koHalfLengthMin,
        Integer koHalftimeBreakMin,
        Integer koBreakBetweenMatchesMin
) {}
