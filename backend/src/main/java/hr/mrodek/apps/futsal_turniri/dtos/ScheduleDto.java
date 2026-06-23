package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.List;

/**
 * The tournament schedule: the stored match-format config, the derived
 * slot length, and every match in play order with its kickoff time.
 */
public record ScheduleDto(
        Integer halfCount,
        Integer halfLengthMin,
        Integer halftimeBreakMin,
        Integer breakBetweenMatchesMin,
        Integer bufferMin,
        int slotLengthMin,
        List<ScheduledMatchDto> matches
) {}
