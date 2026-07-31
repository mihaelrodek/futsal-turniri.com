package hr.mrodek.apps.futsal_turniri.enums;

/**
 * Kind of in-match event recorded on the live-match timeline.
 *
 * <p>{@code GOAL} contributes to the match score (and may carry an
 * optional assist); the two card types are disciplinary records only
 * and never affect the score.
 *
 * <p>{@code OWN_GOAL} is a goal a player put into his OWN net. The event's
 * {@code team} column stores the BENEFICIARY (the side whose score goes up),
 * while {@code player} - when named - belongs to the other team. Own goals
 * count in the score recompute but never in the scorer stats (which filter
 * on {@code GOAL} only).
 *
 * <p>{@code PENALTY_GOAL} / {@code PENALTY_MISSED} record one kick in a
 * knockout penalty shootout (who shot, and whether it went in). They are
 * NOT goals - the score recompute and the scorer stats both filter on
 * goal types, so penalty kicks never affect either. The shootout result
 * itself lives in {@code matches.penalties1/2}.
 *
 * <p>An IN-GAME penalty (a penalty awarded during regulation play, not a
 * shootout kick) is modelled differently on purpose: a SCORED one is a plain
 * {@code GOAL} event with the {@code penalty} flag set on the row - so it
 * counts in the score recompute and the scorer stats exactly like any other
 * goal - while a MISSED one is {@code PENALTY_MISSED_LIVE}, a timeline-only
 * record (no score, no stats).
 *
 * <p>{@code EXCLUSION} is a futsal 2-minute suspension ("isključenje 2 min").
 * Timeline-only: it never affects the score, and - unlike a red card - it does
 * NOT lock the player out of further events (he returns after 2 minutes).
 */
public enum MatchEventType {
    GOAL,
    OWN_GOAL,
    YELLOW_CARD,
    RED_CARD,
    PENALTY_GOAL,
    PENALTY_MISSED,
    PENALTY_MISSED_LIVE,
    EXCLUSION
}
