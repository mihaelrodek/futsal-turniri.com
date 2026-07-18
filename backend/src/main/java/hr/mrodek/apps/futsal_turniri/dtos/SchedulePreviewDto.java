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
            /** Predicted-pairing label for the slot while its team is undecided,
             *  so the sketch shows "A1 – D2" (or "Pobj. ČF1" / "Por. PF2")
             *  instead of TBD. Null when the team is already known, for a bye,
             *  and always for KNOCKOUT_ONLY / group rows. Round-one labels appear
             *  only for the classic mirror cross; later rounds and third place
             *  are always labeled. Mirrors {@code ScheduledMatchDto}. */
            String slot1Label,
            String slot2Label,
            /** Team name resolved from the standings for a round-one group-label
             *  slot once THAT group has finished (per-group). Null otherwise. */
            String slot1PredictedName,
            String slot2PredictedName,
            /** 0-based index in the single-court plan order - the identity a
             *  drag-and-drop reorder sends back (SchedulePlanRequest.order). */
            int planIndex
    ) {}
}
