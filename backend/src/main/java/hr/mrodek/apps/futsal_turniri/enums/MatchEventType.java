package hr.mrodek.apps.futsal_turniri.enums;

/**
 * Kind of in-match event recorded on the live-match timeline.
 *
 * <p>{@code GOAL} contributes to the match score (and may carry an
 * optional assist); the two card types are disciplinary records only
 * and never affect the score.
 */
public enum MatchEventType {
    GOAL,
    YELLOW_CARD,
    RED_CARD
}
