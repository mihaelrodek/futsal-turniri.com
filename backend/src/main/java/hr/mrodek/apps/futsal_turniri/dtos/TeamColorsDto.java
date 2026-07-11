package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * A team's kit colours for the presentational colour chips: jersey (dres) and
 * shorts (hlače). Either may be null. Returned as a {@code teamId → colours}
 * map from GET /tournaments/{uuid}/teams/jersey-colors.
 */
public record TeamColorsDto(String jersey, String shorts) {}
