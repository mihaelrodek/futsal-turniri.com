package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * A team's derived tournament placement - never persisted, always
 * recomputed from the live bracket/group results (see
 * {@link hr.mrodek.apps.futsal_turniri.services.KnockoutService#computePlacements}),
 * so it can't drift out of sync when an admin corrects a knockout result
 * after the fact.
 *
 * @param rank  standard competition ("1224") rank - 1 + the number of teams
 *              that finished strictly better. Tied teams (eliminated in the
 *              same bracket round, or never out of the group stage) share
 *              the same rank number.
 * @param label Croatian display string matching the app's existing
 *              ordinal-dot convention, e.g. {@code "5. mjesto"} for a single
 *              rank or {@code "17.-27. mjesto"} for a group-only-eliminated
 *              range.
 */
public record TeamPlacement(Integer rank, String label) {
}
