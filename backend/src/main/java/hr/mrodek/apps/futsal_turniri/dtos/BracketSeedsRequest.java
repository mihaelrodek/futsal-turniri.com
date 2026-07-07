package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.List;

/**
 * Manual seed order for a KNOCKOUT_ONLY bracket. {@code teamIds} lists every
 * team exactly once, best seed (nositelj) first; the backend stores each team's
 * position as its {@code manualRank} so the auto draw becomes deterministic -
 * the same seed order always yields the same bracket, like Challonge.
 */
public record BracketSeedsRequest(
        List<Long> teamIds
) {}
