package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * One row of a group standings table — a single team's record in its
 * group, already ranked. {@code points = 3*won + drawn}.
 */
public record GroupStandingRowDto(
        Long teamId,
        String teamName,
        int played,
        int won,
        int drawn,
        int lost,
        int goalsFor,
        int goalsAgainst,
        int goalDiff,
        int points
) {}
