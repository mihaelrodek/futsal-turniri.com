package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Adjust a team's accumulated foul count for one half.
 *
 * @param team  1 or 2 (which team committed the foul)
 * @param half  1 or 2 (which half it counts towards - fouls reset each half)
 * @param delta +1 to add a foul, -1 to undo (count is clamped at 0)
 */
public record MatchFoulRequest(
        int team,
        int half,
        int delta
) {}
