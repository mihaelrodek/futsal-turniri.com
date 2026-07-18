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
 * is a group placement ("A1", "D2") or a best-third token ("3-1"). The service
 * validates every label against the group positions, requires the pairing to
 * cover every qualifier exactly once, persists the tokens on the round-one
 * skeleton and resolves them into real teams when the bracket is drawn at
 * confirm time.
 */
public record ManualPositionsRequest(List<Pair> pairs) {
    /** One round-one match by position: {@code slot1} vs {@code slot2}. Either
     *  side may be {@code null} for a bye. Each non-null label is a group
     *  placement ("A1", "D2") or a best-third token ("3-1"). */
    public record Pair(String slot1, String slot2) {}
}
