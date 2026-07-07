package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.List;

/** One column of the knockout bracket - all matches at a given stage. */
public record BracketRoundDto(
        String stage,
        String title,
        List<BracketMatchDto> matches
) {}
