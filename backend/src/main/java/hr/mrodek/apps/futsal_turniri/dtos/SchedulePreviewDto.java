package hr.mrodek.apps.futsal_turniri.dtos;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * The computed (but NOT yet persisted) multi-day schedule shown to the
 * organizer before they confirm. Matches are grouped by day in play order.
 * {@code unscheduled} counts matches that didn't fit the day plan.
 */
public record SchedulePreviewDto(
        int totalMatches,
        int groupMatches,
        int knockoutMatches,
        int scheduled,
        int unscheduled,
        int slotLengthMin,
        /** Fingerprint of the full plan (stages + team ids in play order).
         *  Echoed back with a custom drag order so generate can detect that
         *  the fixtures changed since this sketch. */
        String planHash,
        List<Day> days
) {
    public record Day(String date, List<Match> matches) {}

    /** One planned match. {@code teamsKnown} is false for knockout placeholders
     *  (teams decided only after the group stage). */
    public record Match(
            OffsetDateTime kickoff,
            String stage,
            String groupName,
            String team1Name,
            String team2Name,
            boolean teamsKnown,
            /** 0-based index in the single-court plan order - the identity a
             *  drag-and-drop reorder sends back (SchedulePlanRequest.order). */
            int planIndex
    ) {}
}
