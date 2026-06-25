package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.List;

/**
 * Manual group-standings order. {@code teamIds} lists every team of the
 * group exactly once, best team first; the backend assigns each team's
 * {@code manualRank} from its position. Used by the organizer to settle a
 * tiebreaker by hand once the group is complete.
 */
public record GroupReorderRequest(
        List<Long> teamIds
) {}
