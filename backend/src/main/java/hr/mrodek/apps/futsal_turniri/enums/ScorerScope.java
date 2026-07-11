package hr.mrodek.apps.futsal_turniri.enums;

import java.util.EnumSet;
import java.util.Set;

/**
 * Which goals count toward the tournament's best-scorer race, chosen by the
 * organizer. Guards against a scorer padding their tally against weak group
 * opponents: the default counts knockout goals only, but the organizer can
 * widen it to everything or narrow it to "from the quarterfinal on".
 *
 * <p>The scorers LIST always shows both tallies (counted + with groups);
 * this scope drives the ranking order and the best-scorer award suggestion.
 */
public enum ScorerScope {
    /** Group stage + knockout - every goal counts. */
    ALL,
    /** Whole knockout, group goals excluded (default). */
    KNOCKOUT,
    /** From the round of 32 (šesnaestina finala) onward. */
    ROUND_OF_32,
    /** From the round of 16 (osmina finala) onward. */
    ROUND_OF_16,
    /** From the quarterfinal onward. */
    QUARTERFINAL,
    /** From the semifinal onward (incl. third place + final). */
    SEMIFINAL;

    /** The match stages whose goals count under this scope. */
    public Set<MatchStage> stages() {
        return switch (this) {
            case ALL -> EnumSet.allOf(MatchStage.class);
            case KNOCKOUT -> EnumSet.complementOf(EnumSet.of(MatchStage.GROUP));
            case ROUND_OF_32 -> EnumSet.of(
                    MatchStage.ROUND_OF_32, MatchStage.ROUND_OF_16, MatchStage.QUARTERFINAL,
                    MatchStage.SEMIFINAL, MatchStage.FINAL, MatchStage.THIRD_PLACE);
            case ROUND_OF_16 -> EnumSet.of(
                    MatchStage.ROUND_OF_16, MatchStage.QUARTERFINAL,
                    MatchStage.SEMIFINAL, MatchStage.FINAL, MatchStage.THIRD_PLACE);
            case QUARTERFINAL -> EnumSet.of(
                    MatchStage.QUARTERFINAL, MatchStage.SEMIFINAL,
                    MatchStage.FINAL, MatchStage.THIRD_PLACE);
            case SEMIFINAL -> EnumSet.of(
                    MatchStage.SEMIFINAL, MatchStage.FINAL, MatchStage.THIRD_PLACE);
        };
    }
}
