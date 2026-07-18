package hr.mrodek.apps.futsal_turniri.dtos;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * The full knockout bracket: the main rounds ordered from the earliest
 * round to the final, plus the separate third-place playoff.
 *
 * <p>{@code confirmedAt} is the instant the organizer confirmed the bracket
 * (null while still provisional). {@code confirmationRequired} is true only for
 * GROUPS_KNOCKOUT - the format whose knockout matches are gated behind an
 * organizer confirmation; false (no gate) for KNOCKOUT_ONLY.
 */
public record BracketDto(
        List<BracketRoundDto> rounds,
        BracketMatchDto thirdPlace,
        OffsetDateTime confirmedAt,
        boolean confirmationRequired
) {}
