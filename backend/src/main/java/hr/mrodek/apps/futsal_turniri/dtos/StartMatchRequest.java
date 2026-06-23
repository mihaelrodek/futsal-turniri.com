package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Body for {@code POST /tournaments/{uuid}/matches/{matchId}/start}.
 * {@code mode} is {@code "TIMER"} or {@code "SIMPLE"} — null/blank
 * defaults to SIMPLE in the controller.
 */
public record StartMatchRequest(
        String mode
) {}
