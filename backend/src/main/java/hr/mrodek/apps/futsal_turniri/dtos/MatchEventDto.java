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
        /** Which half it happened in (1/2) when RECORDED rather than guessed;
         *  null for older rows and types that still infer it from the minute.
         *  Set for FOUL - see MatchEvent#half. */
        Integer half,
        Long assistPlayerId,
        String assistPlayerName,
        /** Echoes the client idempotency key so the frontend can reconcile an
         *  optimistic (offline) event with its persisted server row. */
        String clientEventId,
        /** True only for a GOAL scored from an in-game penalty - the timeline
         *  renders a "(pen.)" tag; the goal otherwise behaves like any goal. */
        boolean penalty,
        /** Wall-clock moment the event was recorded (server time). Public
         *  viewers use it to hold an event back until the broadcast catches
         *  up: the stream runs a few seconds behind, so revealing a goal the
         *  instant it is entered spoils it before the video shows it. */
        java.time.OffsetDateTime createdAt
) {}
