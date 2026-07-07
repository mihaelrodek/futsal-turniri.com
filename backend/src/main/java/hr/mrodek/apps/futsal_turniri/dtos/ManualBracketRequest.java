package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.List;

/**
 * Organizer-supplied first-round pairings for a manually-drawn knockout
 * bracket (the "I'll draw the pairs myself" flow). Each pairing is one
 * round-one match; a {@code null} team id is a bye on that side.
 *
 * <p>{@code pairs.size()} must be a power of two (1, 2, 4, 8, 16) - that is
 * the number of first-round matches - and no team may appear twice. The
 * service builds the rest of the single-elimination tree (plus the
 * third-place match) from these pairings exactly like the auto draw.
 */
public record ManualBracketRequest(
        List<Pairing> pairs
) {
    /** One round-one match: team1 vs team2 (either may be null for a bye). */
    public record Pairing(Long team1Id, Long team2Id) {}
}
