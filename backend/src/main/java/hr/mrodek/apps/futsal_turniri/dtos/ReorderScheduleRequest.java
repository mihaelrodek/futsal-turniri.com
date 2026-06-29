package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.List;

/**
 * Reorder the schedule by drag-and-drop. {@code matchIds} lists the not-yet-
 * played matches in their new play order; the backend keeps the existing time
 * slots fixed and reassigns each one to the match now occupying that position
 * (so moving a match up/down swaps kickoff times with its neighbours).
 */
public record ReorderScheduleRequest(
        List<Long> matchIds
) {}
