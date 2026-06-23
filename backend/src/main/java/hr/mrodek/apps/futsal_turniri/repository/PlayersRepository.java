package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.Player;
import io.quarkus.panache.common.Sort;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;

import java.util.List;

@ApplicationScoped
public class PlayersRepository implements AppRepository<Player, Long> {

    @Inject EntityManager em;

    /**
     * A team's roster, ordered for stable rendering: by sortOrder first
     * (nulls last), then by id so newly-added players without an explicit
     * sortOrder still land in a deterministic spot.
     */
    public List<Player> findByTeam_Id(Long teamId) {
        return list("team.id", Sort.by("sortOrder").ascending().and("id").ascending(), teamId);
    }

    /** Highest sortOrder currently used by a team's roster, or null if empty. */
    public Integer maxSortOrderForTeam(Long teamId) {
        return find("team.id", Sort.by("sortOrder").descending(), teamId)
                .firstResultOptional()
                .map(Player::getSortOrder)
                .orElse(null);
    }

    /**
     * Distinct player names (already stored uppercase) matching the query
     * as a prefix or substring, for the roster autocomplete. Case-folded
     * compare so partial lowercase input still matches. Capped at {@code limit}.
     */
    public List<String> searchDistinctNames(String q, int limit) {
        String like = "%" + q.trim().toLowerCase() + "%";
        return em.createQuery(
                        "select distinct p.name from Player p " +
                        "where lower(p.name) like :like " +
                        "order by p.name asc", String.class)
                .setParameter("like", like)
                .setMaxResults(limit)
                .getResultList();
    }

    /**
     * All-time goal tally per player, grouped by the (uppercase) name so the
     * same person scoring across multiple tournaments/teams aggregates into
     * one row — the "vječna lista strijelaca". Each element is an
     * {@code Object[3]}: [String name, Long goals, Long tournamentsPlayed].
     * Ordered goals-desc; the controller applies the best-scorer-award
     * tiebreaker afterwards.
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> findGlobalScorers() {
        return em.createQuery("""
                        select upper(trim(e.player.name)),
                               count(e),
                               count(distinct e.match.tournament.id)
                        from MatchEvent e
                        where e.type = hr.mrodek.apps.futsal_turniri.enums.MatchEventType.GOAL
                          and e.player is not null
                          and e.player.name is not null
                        group by upper(trim(e.player.name))
                        order by count(e) desc
                        """)
                .getResultList();
    }
}
