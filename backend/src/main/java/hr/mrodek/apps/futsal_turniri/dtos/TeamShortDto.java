package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.UUID;

public record TeamShortDto(
        UUID id,
        String names,
        Boolean eliminated
) {}
