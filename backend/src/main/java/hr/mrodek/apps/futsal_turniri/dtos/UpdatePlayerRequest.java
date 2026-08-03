package hr.mrodek.apps.futsal_turniri.dtos;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * Body for editing an existing roster player. {@code number} (jersey
 * number) is optional. {@code captain} is nullable - a null value leaves
 * the captain flag unchanged; {@code true} makes this player the team's
 * sole captain (clearing it on every other player).
 *
 * <p>{@code goalkeeper} is nullable the same way, but carries no such
 * side-effect: several players on one roster may be marked GK, and the two
 * flags never influence each other.
 */
public record UpdatePlayerRequest(
        @NotBlank(message = "player name is required")
        @Size(max = 200, message = "player name must be at most 200 characters")
        String name,

        Integer number,

        Boolean captain,

        Boolean goalkeeper
) {}
