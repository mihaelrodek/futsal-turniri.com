package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * One row of the all-time team medal table ("World Cup"-style): how many
 * finished tournaments a team (matched by uppercase name) has won, finished
 * runner-up in, or finished third in. {@code name} is the normalized
 * (uppercase, trimmed) team name, matching the podium fields on
 * {@code Tournaments} ({@code winnerName} / {@code secondPlaceName} /
 * {@code thirdPlaceName}).
 */
public record TeamMedalsDto(
        String name,
        long gold,
        long silver,
        long bronze
) {}
