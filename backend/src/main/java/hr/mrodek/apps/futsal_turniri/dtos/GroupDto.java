package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.List;

/**
 * A group plus its computed standings and its fixtures. {@code standings}
 * is ordered best team first (after points and the UEFA head-to-head
 * tiebreakers); {@code matches} lists the group's fixtures for result entry.
 */
public record GroupDto(
        Long id,
        String name,
        int ordinal,
        List<GroupStandingRowDto> standings,
        List<GroupMatchDto> matches
) {}
