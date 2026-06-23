package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.List;

public record RoundDto(
        Long id,
        Integer number,
        String status,
        List<MatchDto> matches
) {}