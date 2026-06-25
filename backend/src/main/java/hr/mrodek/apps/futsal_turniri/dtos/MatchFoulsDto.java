package hr.mrodek.apps.futsal_turniri.dtos;

/** A match's accumulated team fouls, per team and half. */
public record MatchFoulsDto(
        Integer fouls1First,
        Integer fouls1Second,
        Integer fouls2First,
        Integer fouls2Second
) {}
