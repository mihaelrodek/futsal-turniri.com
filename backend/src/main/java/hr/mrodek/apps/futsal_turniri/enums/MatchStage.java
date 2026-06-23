package hr.mrodek.apps.futsal_turniri.enums;

/**
 * Which stage of a futsal tournament a match belongs to.
 *
 * <p>{@code GROUP} is the round-robin group phase. The remaining values are
 * single-elimination knockout rounds, from the largest bracket down to the
 * final, plus the optional third-place playoff.
 */
public enum MatchStage {
    GROUP,
    ROUND_OF_32,
    ROUND_OF_16,
    QUARTERFINAL,
    SEMIFINAL,
    FINAL,
    THIRD_PLACE
}
