package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Set (or clear) which side wears fluorescent training bibs ("markirke") for
 * one match.
 *
 * <p>{@code Integer}, not {@code int}: null is a meaningful value here - it
 * means "neither side wears bibs" (clear the flag), which an {@code int}
 * couldn't express without inventing a 0 sentinel.
 *
 * @param team 1 = team1 wears bibs, 2 = team2 wears bibs, null = neither.
 *             Anything else is rejected with 400.
 */
public record MatchBibRequest(
        Integer team
) {}
