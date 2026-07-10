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

    /**
     * Player count per team for a whole tournament, as {@code teamId -> count},
     * in ONE grouped query (avoids N per-team counts). Teams with no players
     * are simply absent from the map - the caller treats a missing team as 0.
     */
    public java.util.Map<Long, Long> countByTeamForTournament(Long tournamentId) {
        var out = new java.util.HashMap<Long, Long>();
        if (tournamentId == null) return out;
        @SuppressWarnings("unchecked")
        List<Object[]> rows = em.createQuery(
                        "select p.team.id, count(p) from Player p " +
                        "where p.team.tournament.id = :tid group by p.team.id")
                .setParameter("tid", tournamentId)
                .getResultList();
        for (Object[] r : rows) out.put((Long) r[0], (Long) r[1]);
        return out;
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
     * Demo-tournament players (is_demo) are excluded - fake showcase names
     * must never be offered while editing a real roster.
     */
    public List<String> searchDistinctNames(String q, int limit) {
        String like = "%" + q.trim().toLowerCase() + "%";
        return em.createQuery(
                        "select distinct p.name from Player p " +
                        "where lower(p.name) like :like " +
                        "and p.demo = false " +
                        "order by p.name asc", String.class)
                .setParameter("like", like)
                .setMaxResults(limit)
                .getResultList();
    }

    /**
     * Every real (non-demo) player of a tournament with their team name, for
     * the end-of-tournament award pickers (MVP / scorer / goalkeeper). Ordered
     * by team then roster order. Each element is {@code Object[2]}:
     * [String playerName, String teamName].
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> findByTournamentWithTeamName(Long tournamentId) {
        return em.createQuery("""
                        select p.name, p.team.name
                        from Player p
                        where p.team.tournament.id = :tid
                          and p.demo = false
                        order by p.team.name asc, p.sortOrder asc nulls last, p.id asc
                        """)
                .setParameter("tid", tournamentId)
                .getResultList();
    }

    /**
     * All-time goal tally per player, grouped by the (uppercase) name so the
     * same person scoring across multiple tournaments/teams aggregates into
     * one row - the "vječna lista strijelaca". Each element is an
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
