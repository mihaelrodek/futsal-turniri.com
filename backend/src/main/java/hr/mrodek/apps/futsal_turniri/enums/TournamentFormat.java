package hr.mrodek.apps.futsal_turniri.enums;

/**
 * How a futsal tournament is structured.
 *
 * <ul>
 *   <li>{@code GROUPS_KNOCKOUT} — a group stage (single round-robin within
 *       each group) followed by a single-elimination knockout bracket built
 *       from the teams that advance.</li>
 *   <li>{@code KNOCKOUT_ONLY} — a single-elimination bracket with no group
 *       stage; every registered team enters the bracket directly.</li>
 * </ul>
 */
public enum TournamentFormat {
    GROUPS_KNOCKOUT,
    KNOCKOUT_ONLY
}
