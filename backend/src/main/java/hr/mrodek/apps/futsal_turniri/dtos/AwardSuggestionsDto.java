package hr.mrodek.apps.futsal_turniri.dtos;

import java.util.List;

/**
 * Data-driven award suggestions returned by
 * {@code GET /tournaments/{uuid}/awards/suggestions}, computed from the
 * tournament's results. The organiser can accept or override any of them.
 *
 * <ul>
 *   <li>{@code bestScorer} / {@code bestPlayer} - the top scorer (most goals,
 *       podium placement as tiebreak). bestPlayer mirrors the scorer since
 *       goals + a deep run is the only signal we have.</li>
 *   <li>{@code bestGoalkeeperTeam} - the team whose keeper is recommended:
 *       the team that went FURTHEST in the tournament, then conceded the
 *       fewest goals per match. We can't identify the keeper player from the
 *       data, so this is a hint pointing at a team; the organiser picks the
 *       actual player.</li>
 *   <li>{@code players} - every real (non-demo) player of the tournament with
 *       their team, so the organiser can pick each award from a dropdown.</li>
 * </ul>
 * Any suggestion field may be null when there's not enough data (no goals
 * recorded, no finished matches, etc.); {@code players} may be empty.
 */
public record AwardSuggestionsDto(
        Suggestion bestScorer,
        Suggestion bestPlayer,
        GoalkeeperHint bestGoalkeeperTeam,
        List<PlayerOption> players
) {
    public record Suggestion(String name, String teamName, long goals) {}

    /**
     * Recommended goalkeeper's team. {@code reachedStage} is a human label for
     * how far the team got (e.g. "FINALE", "POLUFINALE", "SKUPINA") so the
     * organiser sees why it was picked; {@code goalsConceded} is the total.
     */
    public record GoalkeeperHint(String teamName, long goalsConceded, String reachedStage) {}

    /** One selectable player for the award dropdowns. */
    public record PlayerOption(String name, String teamName) {}
}
