package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.List;

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
        int points,
        /** Recent form — up to the last 5 finished results in chronological
         *  order, each "W" | "D" | "L" (SofaScore-style "Last 5"). */
        List<String> form
) {}
