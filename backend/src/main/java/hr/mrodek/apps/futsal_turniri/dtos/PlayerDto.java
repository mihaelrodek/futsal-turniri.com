package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Wire shape for a single roster player. Returned by the player
 * read/write endpoints under {@code /tournaments/{uuid}/teams/{teamId}/players}.
 */
public record PlayerDto(
        Long id,
        String name,
        Integer number,
        boolean captain
) {}
