package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.Map;
import java.util.Set;

/**
 * Everything a tournament LISTING knows that a single {@code Tournaments} row
 * does not: per-tournament team counts and the two "has a match in state X"
 * lookups. Gathered once per page (three aggregate queries) and handed to the
 * mapper, so rendering N cards costs no extra queries.
 *
 * <p>Why one object instead of three mapper {@code @Context} parameters:
 * MapStruct requires every {@code @Context} parameter to have a DISTINCT type,
 * and the live-match and played-match lookups are both {@code Set<Long>} - that
 * pair fails the generator with "The types of @Context parameters must be
 * unique". Bundling them also means a future listing flag is a field here
 * rather than another signature change rippling through every call site.
 *
 * <p>Null-tolerant by construction: a caller that has nothing to report may
 * pass nulls, and every accessor then answers 0 / false rather than throwing.
 */
public record TournamentCardContext(
        Map<Long, Long> teamCountsByTournamentId,
        Set<Long> liveTournamentIds,
        Set<Long> playedTournamentIds
) {

    /** Registered teams for this tournament; 0 when unknown. */
    public int teamCount(Long tournamentId) {
        if (teamCountsByTournamentId == null || tournamentId == null) return 0;
        return teamCountsByTournamentId.getOrDefault(tournamentId, 0L).intValue();
    }

    /** At least one match currently in progress. */
    public boolean isLive(Long tournamentId) {
        return liveTournamentIds != null && tournamentId != null && liveTournamentIds.contains(tournamentId);
    }

    /** At least one match played to a result here - i.e. the tournament was
     *  actually run on the platform, not just created and later marked
     *  finished. */
    public boolean hasResult(Long tournamentId) {
        return playedTournamentIds != null && tournamentId != null && playedTournamentIds.contains(tournamentId);
    }
}
