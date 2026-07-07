package hr.mrodek.apps.futsal_turniri.enums;

/**
 * How the knockout bracket is filled when the number of teams advancing
 * from the group stage is not a power of two.
 *
 * <ul>
 *   <li>{@code BYES} - only the fixed "top N per group" advance; the
 *       best-ranked qualifiers get a bye through the first knockout round
 *       so the bracket still resolves.</li>
 *   <li>{@code WILDCARDS} - the best lower-placed teams across all groups
 *       also advance, rounding the qualifier count up to a power of two so
 *       no byes are needed.</li>
 * </ul>
 *
 * Only meaningful for {@link TournamentFormat#GROUPS_KNOCKOUT}.
 */
public enum BracketFill {
    BYES,
    WILDCARDS
}
