package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Data-driven award suggestions returned by
 * {@code GET /tournaments/{uuid}/awards/suggestions}, computed from the
 * tournament's results. The organiser can accept or override any of them.
 *
 * <ul>
 *   <li>{@code bestScorer} / {@code bestPlayer} - the top scorer (most goals,
 *       podium placement as tiebreak). bestPlayer mirrors the scorer since
 *       goals + a deep run is the only signal we have.</li>
 *   <li>{@code bestGoalkeeperTeam} - the team that conceded the fewest goals
 *       (preferring podium teams). We can't identify the keeper player from
 *       the data, so this is a hint; the organiser fills the actual name.</li>
 * </ul>
 * Any field may be null when there's not enough data (no goals recorded, no
 * finished matches, etc.).
 */
public record AwardSuggestionsDto(
        Suggestion bestScorer,
        Suggestion bestPlayer,
        GoalkeeperHint bestGoalkeeperTeam
) {
    public record Suggestion(String name, String teamName, long goals) {}
    public record GoalkeeperHint(String teamName, long goalsConceded) {}
}
