package hr.mrodek.apps.futsal_turniri.dtos;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Body for adding a player to a team's roster.
 * {@code number} (jersey number) is optional.
 */
public record CreatePlayerRequest(
        @NotBlank(message = "player name is required")
        @Size(max = 200, message = "player name must be at most 200 characters")
        String name,

        Integer number
) {}
