package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Wire shape for a single live-match timeline event (goal or card).
 * Returned by the event endpoints under
 * {@code /tournaments/{uuid}/matches/{matchId}/events}.
 *
 * <p>{@code teamId} is the team of the {@code player} - derived so the
 * SPA can render the event on the correct side without a roster lookup.
 * {@code assistPlayerId} / {@code assistPlayerName} are populated only
 * for goals that carried an assist.
 */
public record MatchEventDto(
        Long id,
        String type,
        Long playerId,
        String playerName,
        Long teamId,
        Integer minute,
        Long assistPlayerId,
        String assistPlayerName,
        /** Echoes the client idempotency key so the frontend can reconcile an
         *  optimistic (offline) event with its persisted server row. */
        String clientEventId
) {}
