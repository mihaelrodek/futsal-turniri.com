package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.List;

/**
 * Request to draw the registered teams into groups.
 *
 * <p>{@code mode = AUTO} — the server randomly distributes registered teams
 * across the tournament's configured group count; {@code assignments} is
 * ignored.
 *
 * <p>{@code mode = MANUAL} — the organizer supplies an explicit team→group
 * placement via {@code assignments}; every registered team must appear.
 */
public record DrawRequest(
        Mode mode,
        List<Assignment> assignments
) {
    public enum Mode { AUTO, MANUAL }

    /** Places one team into the group at the given 0-based ordinal (A=0, B=1, …). */
    public record Assignment(Long teamId, int groupOrdinal) {}
}
