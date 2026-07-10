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
        /** Raw per-group advance override; null = tournament's advancePerGroup.
         *  Only used to show that a group differs from the default. */
        Integer advanceCount,
        /** Resolved effective advance for THIS group (advanceCount, else the
         *  tournament's advancePerGroup, else 2). Always set - the UI displays
         *  this directly so it never depends on a possibly-stale client-side
         *  tournament default. */
        int effectiveAdvance,
        List<GroupStandingRowDto> standings,
        List<GroupMatchDto> matches
) {}
