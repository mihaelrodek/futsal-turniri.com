package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * One row of the all-time scorer list ("vječna lista strijelaca").
 * Goals are summed across every tournament/team the player (matched by
 * uppercase name) has scored in. {@code bestScorerAwards} is how many
 * tournaments named this player their best scorer — used as the tiebreaker
 * when goal totals are equal.
 */
public record GlobalScorerDto(
        String name,
        long goals,
        long tournamentsPlayed,
        long bestScorerAwards
) {}
