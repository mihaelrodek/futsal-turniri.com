package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Body of PUT /tournaments/{uuid}/teams/{teamId}/jersey-color - the team's
 * jersey colour as a {@code #rrggbb} hex. Null/blank clears the colour.
 */
public record JerseyColorRequest(String color) {}
