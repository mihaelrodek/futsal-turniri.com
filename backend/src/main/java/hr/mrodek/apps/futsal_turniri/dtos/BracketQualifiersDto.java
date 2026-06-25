package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.List;

/**
 * The teams eligible to enter the knockout bracket, used by the manual-draw
 * UI so the organizer can only place teams that actually advanced.
 *
 * <p>{@code groupStageComplete} is false for a GROUPS_KNOCKOUT tournament
 * whose group fixtures aren't all finished yet — the UI uses it to keep the
 * "generate bracket" actions disabled. For KNOCKOUT_ONLY it is always true and
 * {@code teams} is the full registered field.
 */
public record BracketQualifiersDto(
        boolean groupStageComplete,
        List<Team> teams
) {
    /** A minimal team reference (id + name) for the slot pickers. */
    public record Team(Long id, String name) {}
}
