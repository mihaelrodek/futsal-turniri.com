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

    /** Every event of the given type for a match — used to recompute the score from goals. */
    public List<MatchEvent> findByMatch_IdAndType(Long matchId, MatchEventType type) {
        return list("match.id = ?1 and type = ?2", matchId, type);
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
}
