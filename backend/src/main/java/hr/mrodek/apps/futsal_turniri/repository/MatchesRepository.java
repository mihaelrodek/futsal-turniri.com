package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.enums.MatchStatus;
import hr.mrodek.apps.futsal_turniri.model.Matches;
import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.model.Rounds;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import io.quarkus.panache.common.Parameters;
import io.quarkus.panache.common.Sort;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;

import java.util.List;

@ApplicationScoped
public class MatchesRepository implements AppRepository<Matches, Long> {

    /**
     * CDI-injected {@link EntityManager} for the rare scalar/projection query
     * Panache's entity-shaped {@code find()} can't express. Same EM instance
     * Panache uses internally — preferred over {@code Panache.getEntityManager()}
     * because injection is the standard Quarkus + Hibernate ORM pattern and
     * is easier to mock if we ever add tests against this repo.
     */
    @Inject EntityManager em;

    public List<Matches> findByRound(Rounds round) {
        return list("round", round);
    }

    /**
     * Round number of the team's last FINISHED loss in the given tournament,
     * or {@code null} if none found. Scalar projection, so we go through
     * EntityManager rather than Panache's entity-shaped {@code find()}.
     */
    public Integer findLastLossRoundNumber(Tournaments tournament, Teams team) {
        return em.createQuery("""
                        select max(m.round.number)
                        from Matches m
                        where m.tournament = :t
                          and m.status = hr.mrodek.apps.futsal_turniri.enums.MatchStatus.FINISHED
                          and (
                                (m.team1 = :p and m.winnerTeam = m.team2)
                             or (m.team2 = :p and m.winnerTeam = m.team1)
                          )
                        """, Integer.class)
                .setParameter("t", tournament)
                .setParameter("p", team)
                .getSingleResult();
    }

    public List<Matches> findByTournament_Id(Long tournamentId) {
        return list("tournament.id", tournamentId);
    }

    public List<Matches> findByRound_Id(Long roundId) {
        return list("round.id", roundId);
    }

    public void deleteByTournament(Tournaments t) {
        delete("tournament", t);
    }

    public void deleteByRound(Rounds r) {
        delete("round", r);
    }

    public List<Matches> findByRound_IdOrderByTableNoAsc(Long roundId) {
        return list("round.id", Sort.by("tableNo").ascending(), roundId);
    }

    public List<Matches> findByTournament_IdAndStatus(Long tournamentId, MatchStatus status) {
        return list("tournament.id = ?1 and status = ?2", tournamentId, status);
    }

    /**
     * Tournament ids (from the given set) that have at least one match
     * currently {@link MatchStatus#LIVE}. Distinct, scalar projection —
     * powers the {@code liveMatch} badge on tournament cards without an
     * N+1 over the listing. Returns an empty list for a null/empty input.
     */
    @SuppressWarnings("unchecked")
    public List<Long> findTournamentIdsWithLiveMatch(List<Long> tournamentIds) {
        if (tournamentIds == null || tournamentIds.isEmpty()) return List.of();
        return em.createQuery("""
                        select distinct m.tournament.id
                        from Matches m
                        where m.tournament.id in :ids
                          and m.status = hr.mrodek.apps.futsal_turniri.enums.MatchStatus.LIVE
                        """)
                .setParameter("ids", tournamentIds)
                .getResultList();
    }

    /**
     * Every match the given team was on either side of, ordered by round
     * number then table number — i.e. how the day actually played out.
     * Eager-fetches round + the opponents so the caller doesn't N+1 when
     * rendering history rows.
     */
    public List<Matches> findByTeamId(Long teamId) {
        if (teamId == null) return List.of();
        // Full JPQL via Panache's list(...) — entity-shaped, so we can stay
        // on Panache rather than dropping to EntityManager. The "from" prefix
        // tells Panache this is a complete query, not a where-clause shortcut.
        return list("""
                from Matches m
                join fetch m.round r
                left join fetch m.team1
                left join fetch m.team2
                where m.team1.id = :pid or m.team2.id = :pid
                order by r.number asc, m.tableNo asc nulls last, m.id asc
                """, Parameters.with("pid", teamId));
    }
    /**
     * Every distinct {@link hr.mrodek.apps.futsal_turniri.model.Tournaments}
     * that currently has at least one match with status
     * {@link hr.mrodek.apps.futsal_turniri.enums.MatchStatus#LIVE}.
     * The {@code @Where(is_deleted=false)} filter on Tournaments is honoured
     * automatically by Hibernate because the join traverses the managed
     * association.
     */
    @SuppressWarnings("unchecked")
    public List<hr.mrodek.apps.futsal_turniri.model.Tournaments> findDistinctTournamentsWithLiveMatch() {
        return em.createQuery(
                        "select distinct m.tournament " +
                        "from Matches m " +
                        "where m.status = hr.mrodek.apps.futsal_turniri.enums.MatchStatus.LIVE")
                .getResultList();
    }

    /**
     * All matches currently in status {@link MatchStatus#LIVE}, with their
     * tournament and both teams eagerly fetched so the caller can map to
     * {@link hr.mrodek.apps.futsal_turniri.dtos.LiveMatchDto} without N+1.
     * Soft-deleted tournaments are excluded automatically by the
     * {@code @Where(is_deleted=false)} clause on Tournaments.
     */
    @SuppressWarnings("unchecked")
    public List<Matches> findAllLiveMatches() {
        return em.createQuery("""
                        select m from Matches m
                        join fetch m.tournament t
                        left join fetch m.team1
                        left join fetch m.team2
                        where m.status = hr.mrodek.apps.futsal_turniri.enums.MatchStatus.LIVE
                        """)
                .getResultList();
    }

    /**
     * Goals conceded per team across all FINISHED matches of a tournament.
     * For each finished match, the away team's score counts against the home
     * team and vice-versa. Each element is {@code Object[2]}: [Teams, Long
     * conceded]. Used by the best-goalkeeper award heuristic (fewest
     * conceded → strongest defence). Teams with zero matches won't appear.
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> concededGoalsByTeam(hr.mrodek.apps.futsal_turniri.model.Tournaments tournament) {
        // Two halves: conceded as team1 (= score2) and as team2 (= score1),
        // summed per team via a UNION-style two-query merge in Java would be
        // verbose; instead use a single query per side and let the caller
        // merge. Simpler: query both sides and combine.
        List<Object[]> asTeam1 = em.createQuery("""
                        select m.team1, coalesce(sum(m.score2), 0)
                        from Matches m
                        where m.tournament = :t
                          and m.status = hr.mrodek.apps.futsal_turniri.enums.MatchStatus.FINISHED
                          and m.team1 is not null
                        group by m.team1
                        """)
                .setParameter("t", tournament)
                .getResultList();
        List<Object[]> asTeam2 = em.createQuery("""
                        select m.team2, coalesce(sum(m.score1), 0)
                        from Matches m
                        where m.tournament = :t
                          and m.status = hr.mrodek.apps.futsal_turniri.enums.MatchStatus.FINISHED
                          and m.team2 is not null
                        group by m.team2
                        """)
                .setParameter("t", tournament)
                .getResultList();
        var merged = new java.util.LinkedHashMap<hr.mrodek.apps.futsal_turniri.model.Teams, Long>();
        for (Object[] r : asTeam1) {
            merged.merge((hr.mrodek.apps.futsal_turniri.model.Teams) r[0], ((Number) r[1]).longValue(), Long::sum);
        }
        for (Object[] r : asTeam2) {
            merged.merge((hr.mrodek.apps.futsal_turniri.model.Teams) r[0], ((Number) r[1]).longValue(), Long::sum);
        }
        var out = new java.util.ArrayList<Object[]>(merged.size());
        merged.forEach((team, conceded) -> out.add(new Object[]{team, conceded}));
        return out;
    }

    /**
     * Upcoming (SCHEDULED) matches across every tournament that have a
     * concrete kickoff time at or after {@code from}, ordered soonest-first.
     * Both teams + the tournament are eagerly fetched so the caller can map
     * to a DTO without N+1. Soft-deleted tournaments are excluded by the
     * {@code @Where(is_deleted=false)} clause on Tournaments.
     *
     * <p>Matches with no assigned kickoff are skipped — they can't be placed
     * on a "starting soon" timeline. The result is capped by {@code limit}.
     */
    @SuppressWarnings("unchecked")
    public List<Matches> findUpcomingMatches(java.time.OffsetDateTime from, int limit) {
        return em.createQuery("""
                        select m from Matches m
                        join fetch m.tournament t
                        left join fetch m.team1
                        left join fetch m.team2
                        where m.status = hr.mrodek.apps.futsal_turniri.enums.MatchStatus.SCHEDULED
                          and m.kickoffAt is not null
                          and m.kickoffAt >= :from
                        order by m.kickoffAt asc
                        """)
                .setParameter("from", from)
                .setMaxResults(limit)
                .getResultList();
    }


}
