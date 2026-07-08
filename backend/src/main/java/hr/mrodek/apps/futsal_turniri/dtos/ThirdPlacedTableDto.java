package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.List;

/**
 * The cross-group ranking of the best next-placed ("third-placed") teams, used
 * to render the "Najbolje trećeplasirane" table when {@code bestThirdCount > 0}.
 *
 * <p>Each row is the team placed at index {@code advancePerGroup} in its group
 * (the first non-qualifying spot - the 3rd-placed team when 2 advance), ranked
 * across all groups by points, then goal difference, then goals scored. The
 * top {@code bestThirdCount} rows carry {@code qualifies = true}; those are the
 * teams that also enter the knockout bracket.
 *
 * <p>{@code rows} is empty until enough matches are played for the tier to
 * exist (a group must have more teams than {@code advancePerGroup}).
 */
public record ThirdPlacedTableDto(
        int advancePerGroup,
        int bestThirdCount,
        List<Row> rows
) {
    /** One third-placed team with its group, its full standings record, its
     *  1-based cross-group rank and whether it qualifies. */
    public record Row(
            int rank,
            boolean qualifies,
            String groupName,
            GroupStandingRowDto standing
    ) {}
}
