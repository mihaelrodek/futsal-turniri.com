package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Body for adding a live-match event under
 * {@code POST /tournaments/{uuid}/matches/{matchId}/events}.
 *
 * <p>{@code type} is a {@code MatchEventType} name (GOAL, YELLOW_CARD,
 * RED_CARD, PENALTY_GOAL, PENALTY_MISSED). {@code playerId} is the scorer,
 * carded player, or penalty taker and {@code minute} the match minute.
 * {@code playerId} is required for goals/cards but optional for penalty
 * kicks whose taker wasn't named - for those {@code teamId} must be given
 * instead, naming the side. {@code assistPlayerId} is optional and accepted
 * only for goals. The endpoint validates each field and returns 400 on bad
 * input, so no bean-validation annotations are needed here.
 */
public record CreateMatchEventRequest(
        String type,
        Long playerId,
        Long teamId,
        Integer minute,
        Long assistPlayerId
) {}
