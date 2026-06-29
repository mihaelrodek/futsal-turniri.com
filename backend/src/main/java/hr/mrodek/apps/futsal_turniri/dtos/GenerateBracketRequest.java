package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.List;

/**
 * Optional body for the auto bracket generation. {@code byeTeamIds} lists the
 * teams the organizer chose to advance directly (round-one bye) when the
 * qualifier count isn't a power of two. Null/empty → the best seeds get the
 * byes automatically.
 */
public record GenerateBracketRequest(
        List<Long> byeTeamIds,
        /** Randomly reorder the non-bye teams (the automatic draw). */
        Boolean shuffleRest
) {}
