package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.List;

/**
 * The tournament schedule: the stored match-format config, the derived
 * slot length, and every match in play order with its kickoff time.
 *
 * <p>{@code slotLengthMin} is the GROUP-stage slot. When the knockout has its
 * own format ({@code koHalfLengthMin} set), {@code koSlotLengthMin} carries
 * the knockout slot; otherwise the two are equal.
 */
public record ScheduleDto(
        Integer halfCount,
        Integer halfLengthMin,
        Integer halftimeBreakMin,
        Integer breakBetweenMatchesMin,
        Integer bufferMin,
        Integer koHalfLengthMin,
        Integer koHalftimeBreakMin,
        int slotLengthMin,
        int koSlotLengthMin,
        List<ScheduledMatchDto> matches
) {}
