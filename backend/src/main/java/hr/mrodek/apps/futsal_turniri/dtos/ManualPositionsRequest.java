package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.List;

/**
 * Organizer-supplied ROUND-ONE knockout pairings BY GROUP POSITION for a
 * GROUPS_KNOCKOUT tournament - the "define the pairings before the group
 * stage finishes" flow. Each {@link Pair} is one round-one match given as
 * position labels ("A1" vs "B2") rather than team ids, so the pairing can be
 * set the moment the groups are drawn, long before anyone knows which team
 * finishes where.
 *
 * <p>A {@code null} slot is a bye ("slobodan prolaz") on that side. Each label
 * is a group placement ("A1", "D2") or a wildcard "best next-placed" token
 * "&lt;place&gt;-&lt;rank&gt;", where {@code place = advancePerGroup + 1} - the
 * first non-advancing spot - so "2-1" when one advances per group (best
 * runner-up) and "3-1" when two do (best third). The service validates every
 * label against the group positions, requires the pairing to cover every
 * qualifier exactly once, persists the tokens on the round-one skeleton and
 * resolves them into real teams (by wildcard rank) when the bracket is drawn at
 * confirm time. The old hardcoded "3-&lt;rank&gt;" token is still accepted for
 * backward compatibility.
 */
public record ManualPositionsRequest(List<Pair> pairs) {
    /** One round-one match by position: {@code slot1} vs {@code slot2}. Either
     *  side may be {@code null} for a bye. Each non-null label is a group
     *  placement ("A1", "D2") or a wildcard token ("2-1" / "3-1"). */
    public record Pair(String slot1, String slot2) {}
}
