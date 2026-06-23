package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * One tournament that currently has at least one match LIVE — returned
 * by {@code GET /tournaments/live} to power the public "live now" list.
 */
public record LiveTournamentDto(
        String uuid,
        String slug,
        String name
) {}
