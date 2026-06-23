package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Body for adding a live-match event under
 * {@code POST /tournaments/{uuid}/matches/{matchId}/events}.
 *
 * <p>{@code type} is a {@code MatchEventType} name (GOAL, YELLOW_CARD,
 * RED_CARD). {@code playerId} is the scorer or carded player and
 * {@code minute} the match minute — both required. {@code assistPlayerId}
 * is optional and accepted only for goals. The endpoint validates each
 * field and returns 400 on bad input, so no bean-validation annotations
 * are needed here.
 */
public record CreateMatchEventRequest(
        String type,
        Long playerId,
        Integer minute,
        Long assistPlayerId
) {}
