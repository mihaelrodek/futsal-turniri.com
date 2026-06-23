package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.List;

/**
 * The full knockout bracket: the main rounds ordered from the earliest
 * round to the final, plus the separate third-place playoff.
 */
public record BracketDto(
        List<BracketRoundDto> rounds,
        BracketMatchDto thirdPlace
) {}
