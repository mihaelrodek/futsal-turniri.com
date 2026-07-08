package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.List;

/**
 * Request to draw the registered teams into groups.
 *
 * <p>{@code groupCount}, {@code advancePerGroup} and {@code bestThirdCount}
 * are chosen at draw time (not at tournament creation) and stored on the
 * tournament before the draw. {@code bestThirdCount} is how many best
 * next-placed ("third-placed") teams also advance to the bracket; 0/null off.
 *
 * <p>{@code mode = AUTO} - the server randomly distributes registered teams
 * across {@code groupCount} groups; {@code assignments} is ignored.
 *
 * <p>{@code mode = MANUAL} - the organizer supplies an explicit team→group
 * placement via {@code assignments}; every registered team must appear. The UI
 * sends MANUAL for both the auto-preview (it shuffles client-side, then lets
 * the organizer confirm the exact split) and the hand draw.
 */
public record DrawRequest(
        Mode mode,
        Integer groupCount,
        Integer advancePerGroup,
        Integer bestThirdCount,
        List<Assignment> assignments
) {
    public enum Mode { AUTO, MANUAL }

    /** Places one team into the group at the given 0-based ordinal (A=0, B=1, …). */
    public record Assignment(Long teamId, int groupOrdinal) {}
}
