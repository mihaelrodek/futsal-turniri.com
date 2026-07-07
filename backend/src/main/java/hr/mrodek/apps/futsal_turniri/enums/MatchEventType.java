package hr.mrodek.apps.futsal_turniri.enums;

/**
 * Kind of in-match event recorded on the live-match timeline.
 *
 * <p>{@code GOAL} contributes to the match score (and may carry an
 * optional assist); the two card types are disciplinary records only
 * and never affect the score.
 *
 * <p>{@code PENALTY_GOAL} / {@code PENALTY_MISSED} record one kick in a
 * knockout penalty shootout (who shot, and whether it went in). They are
 * NOT goals - the score recompute and the scorer stats both filter on
 * {@code GOAL}, so penalty kicks never affect either. The shootout result
 * itself lives in {@code matches.penalties1/2}.
 */
public enum MatchEventType {
    GOAL,
    YELLOW_CARD,
    RED_CARD,
    PENALTY_GOAL,
    PENALTY_MISSED
}
