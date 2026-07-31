package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.enums.MatchEventType;
import hr.mrodek.apps.futsal_turniri.model.MatchEvent;
import io.quarkus.panache.common.Sort;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.List;

@ApplicationScoped
public class MatchEventRepository implements AppRepository<MatchEvent, Long> {

    /**
     * A match's full event timeline, ordered for stable rendering:
     * by minute first, then by id so events sharing a minute keep
     * their insertion order.
     */
    public List<MatchEvent> findByMatch_IdOrdered(Long matchId) {
        return list("match.id", Sort.by("minute").ascending().and("id").ascending(), matchId);
    }

    /** Every event of the given type for a match - used to recompute the score from goals. */
    public List<MatchEvent> findByMatch_IdAndType(Long matchId, MatchEventType type) {
        return list("match.id = ?1 and type = ?2", matchId, type);
    }

    /** True if the player has already been sent off (red card) in this match -
     *  a sent-off player can't score or otherwise affect the match. */
    public boolean playerSentOff(Long matchId, Long playerId) {
        return count("match.id = ?1 and player.id = ?2 and type = ?3",
                matchId, playerId, MatchEventType.RED_CARD) > 0;
    }

    public void deleteByMatch_Id(Long matchId) {
        delete("match.id", matchId);
    }

    /**
     * Aggregated goal counts per player for all matches in the given
     * tournament. Only {@link hr.mrodek.apps.futsal_turniri.enums.MatchEventType#GOAL}
     * events are counted. Rows are ordered goal-count descending so the
     * caller can stream them straight into the scorers list.
     *
     * <p>Each element is an {@code Object[3]}: [Player, Teams, Long goals].
     */
    @jakarta.inject.Inject
    jakarta.persistence.EntityManager em;

    @SuppressWarnings("unchecked")
    public java.util.List<Object[]> findGoalCountsByTournament(hr.mrodek.apps.futsal_turniri.model.Tournaments tournament) {
        return em.createQuery("""
                        select e.player, e.player.team, count(e)
                        from MatchEvent e
                        where e.type = hr.mrodek.apps.futsal_turniri.enums.MatchEventType.GOAL
                          and e.match.tournament = :t
                        group by e.player, e.player.team
                        order by count(e) desc
                        """)
                .setParameter("t", tournament)
                .getResultList();
    }

    /**
     * Like {@link #findGoalCountsByTournament(hr.mrodek.apps.futsal_turniri.model.Tournaments)},
     * but only counting goals scored in the given match stages - backs the
     * organizer's best-scorer scope (e.g. knockout-only, from the QF onward).
     */
    @SuppressWarnings("unchecked")
    public java.util.List<Object[]> findGoalCountsByTournament(
            hr.mrodek.apps.futsal_turniri.model.Tournaments tournament,
            java.util.Collection<hr.mrodek.apps.futsal_turniri.enums.MatchStage> stages) {
        return em.createQuery("""
                        select e.player, e.player.team, count(e)
                        from MatchEvent e
                        where e.type = hr.mrodek.apps.futsal_turniri.enums.MatchEventType.GOAL
                          and e.match.tournament = :t
                          and e.match.stage in :stages
                        group by e.player, e.player.team
                        order by count(e) desc
                        """)
                .setParameter("t", tournament)
                .setParameter("stages", stages)
                .getResultList();
    }

    /**
     * Per-match tally of what ONE person did while playing for one team -
     * one row per (match, event type). Backs the profile's match history,
     * where each result line also shows that person's goals/cards.
     *
     * <p>The person is matched by folded "ime prezime" (same folding as
     * {@link hr.mrodek.apps.futsal_turniri.services.PersonNameFolder}, mirrored
     * SQL-side with {@code translate}) rather than by a player id, because a
     * roster row isn't necessarily claimed by the profile.
     *
     * <p>Each element is an {@code Object[3]}: [Long matchId, MatchEventType type, Long count].
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> findEventCountsByMatchForTeamAndFoldedName(Long teamId, String foldedNeedle) {
        if (teamId == null || foldedNeedle == null || foldedNeedle.isBlank()) return List.of();
        return em.createQuery("""
                        select e.match.id, e.type, count(e)
                        from MatchEvent e
                        where e.player is not null
                          and e.player.team.id = :tid
                          and function('translate', lower(trim(e.player.name)), 'šđčćž', 'sdccz') = :needle
                        group by e.match.id, e.type
                        """)
                .setParameter("tid", teamId)
                .setParameter("needle", foldedNeedle)
                .getResultList();
    }
}
