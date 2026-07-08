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
 */
public enum MatchEventType {
    GOAL,
    OWN_GOAL,
    YELLOW_CARD,
    RED_CARD,
    PENALTY_GOAL,
    PENALTY_MISSED
}
