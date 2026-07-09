package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * SET a team's accumulated foul count for one half to an absolute value.
 *
 * Unlike {@link MatchFoulRequest} (a ±1 delta), this is idempotent: replaying
 * the same "set to N" any number of times leaves the count at N. That's what
 * makes it safe for the offline queue, which flushes the organizer's final
 * local counter on reconnect and may resend it if a response was lost.
 *
 * @param team  1 or 2 (which team the count belongs to)
 * @param half  1 or 2 (which half it counts towards - fouls reset each half)
 * @param value the absolute foul count to set (clamped at 0)
 */
public record MatchFoulSetRequest(
        int team,
        int half,
        int value
) {}
