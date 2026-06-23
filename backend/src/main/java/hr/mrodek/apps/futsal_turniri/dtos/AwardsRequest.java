package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Body for {@code POST /tournaments/{uuid}/awards}. Each field is a free-text
 * player name (the backend uppercases + trims). Any field may be null/blank
 * to clear that award.
 */
public record AwardsRequest(
        String bestGoalkeeperName,
        String bestPlayerName,
        String bestScorerName
) {}
