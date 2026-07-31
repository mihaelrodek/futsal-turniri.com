package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.Player;
import hr.mrodek.apps.futsal_turniri.services.PersonNameFolder;
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
     * The first existing player in this tournament (any team) with exactly
     * {@code name} (already normalized - trimmed + uppercase), other than
     * {@code excludePlayerId} - used to block the same person's name existing
     * on two different rosters in one tournament. Pass {@code null} for
     * {@code excludePlayerId} on a create; pass the player's own id on a
     * rename so it doesn't collide with itself. Team is join-fetched so the
     * caller can name it in the error message without a second query.
     */
    public java.util.Optional<Player> findByTournamentAndName(Long tournamentId, String name, Long excludePlayerId) {
        var query = em.createQuery(
                        "select p from Player p join fetch p.team " +
                        "where p.team.tournament.id = :tid and p.name = :name " +
                        (excludePlayerId != null ? "and p.id != :pid " : "") +
                        "order by p.id asc",
                        Player.class)
                .setParameter("tid", tournamentId)
                .setParameter("name", name)
                .setMaxResults(1);
        if (excludePlayerId != null) query.setParameter("pid", excludePlayerId);
        return query.getResultList().stream().findFirst();
    }

    /**
     * Roster players whose full name equals {@code foldedNeedle} after the
     * same normalization the caller applied Java-side: trimmed, lower-cased,
     * with the Croatian/Slovenian diacritics folded to ASCII (š→s, đ→d,
     * č/ć→c, ž→z). Folding on the DB side uses SQL {@code translate()} so
     * "ŠIMIĆ" matches a user who registered as "Simic" and vice versa.
     *
     * <p>Only players still worth suggesting for a self-claim are returned:
     * non-demo players, on non-demo approved teams that NOBODY has claimed
     * yet (both submitter uid slots null), in publicly visible tournaments.
     * Team + tournament are join-fetched so the caller can build display
     * DTOs without extra lazy loads. Freshest tournament first, capped at
     * {@code limit}.
     */
    public List<Player> findUnclaimedByFoldedName(String foldedNeedle, int limit) {
        if (foldedNeedle == null || foldedNeedle.isBlank()) return List.of();
        return em.createQuery("""
                        select p from Player p
                        join fetch p.team t
                        join fetch t.tournament tr
                        where p.demo = false
                          and t.demo = false
                          and t.pendingApproval = false
                          and t.submittedByUid is null
                          and t.coSubmittedByUid is null
                          and tr.hidden = false
                          and function('translate', lower(trim(p.name)), 'šđčćž', 'sdccz') = :needle
                        order by tr.startAt desc nulls last, p.id desc
                        """, Player.class)
                .setParameter("needle", foldedNeedle)
                .setMaxResults(limit)
                .getResultList();
    }

    /**
     * Free-text roster search for the manual "this player is me" request
     * dialog: a folded substring match on the player's name, so "sim" finds
     * "ŠIMIĆ". Same visibility rules as
     * {@link #findUnclaimedByFoldedName(String, int)}, except the team's
     * PRIMARY submitter slot may already be taken - a teammate registering
     * the team must not make its players unrequestable. Only the co-owner
     * slot has to be free, since that's what an approval fills.
     */
    @SuppressWarnings("unchecked")
    public List<Player> searchClaimableByName(String q, int limit) {
        if (q == null || q.isBlank()) return List.of();
        String needle = "%" + PersonNameFolder.fold(q) + "%";
        // NATIVE on purpose. The equality variants above can compare
        // function('translate', …) with `=`, but HQL types that legacy
        // function call as Object, and Hibernate 6 rejects an Object operand
        // on the left of LIKE - which surfaced as an IllegalArgumentException
        // and, through our mapper, a 400 on every search. Postgres has no
        // such qualms, and translate() is a Postgres function anyway.
        return em.createNativeQuery("""
                        select p.* from players p
                        join teams t on t.id = p.team_id
                        join tournaments tr on tr.id = t.tournament_id
                        where p.is_demo = false
                          and t.is_demo = false
                          and t.pending_approval = false
                          and t.co_submitted_by_uid is null
                          and tr.is_hidden = false
                          and translate(lower(trim(p.name)), 'šđčćž', 'sdccz') like :needle
                        order by tr.start_at desc nulls last, p.id desc
                        """, Player.class)
                .setParameter("needle", needle)
                .setMaxResults(limit)
                .getResultList();
    }

    /**
     * Unlinked roster rows whose folded name equals {@code foldedNeedle} -
     * what {@code PlayerProfileLinker} walks when a profile is created or
     * renamed, so old tournaments attach to the new account immediately.
     * Team + tournament are join-fetched; the linker checks their demo/hidden
     * flags itself.
     */
    public List<Player> findUnlinkedByFoldedName(String foldedNeedle) {
        if (foldedNeedle == null || foldedNeedle.isBlank()) return List.of();
        return em.createQuery("""
                        select p from Player p
                        join fetch p.team t
                        join fetch t.tournament tr
                        where p.claimedByUid is null
                          and p.demo = false
                          and function('translate', lower(trim(p.name)), 'šđčćž', 'sdccz') = :needle
                        """, Player.class)
                .setParameter("needle", foldedNeedle)
                .getResultList();
    }

    /**
     * Is this user linked to a roster row of that team? The identity link
     * (claimed_by_uid) is what puts a tournament on someone's profile even
     * when a teammate registered the team, so the endpoints that drill into
     * that tournament have to accept it as ownership too.
     */
    public boolean isClaimedInTeam(Long teamId, String uid) {
        if (teamId == null || uid == null || uid.isBlank()) return false;
        return count("team.id = ?1 and claimedByUid = ?2", teamId, uid) > 0;
    }

    /**
     * Ids of every roster row nobody is linked to yet - the backfill's input
     * set. Ids rather than entities so the pass can hold one short
     * transaction per row instead of one long one over the whole table (a
     * single big transaction risks the default 60s timeout, and on a fresh
     * deploy that would fail the very pass that back-fills history).
     */
    public List<Long> findAllUnlinkedIds() {
        return em.createQuery("""
                        select p.id from Player p
                        where p.claimedByUid is null
                          and p.demo = false
                        """, Long.class)
                .getResultList();
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
     * Goals scored (type {@code GOAL} only - own goals and shootout kicks
     * don't count) by players ON THIS TEAM whose folded name matches
     * {@code foldedNeedle}, e.g. the profile owner's own "ime prezime" -
     * used to attribute career goals to a specific person once their team
     * is linked, mirroring {@link #findUnclaimedByFoldedName}'s folding.
     */
    public long countGoalsForTeamAndFoldedName(Long teamId, String foldedNeedle) {
        if (teamId == null || foldedNeedle == null || foldedNeedle.isBlank()) return 0L;
        Long count = em.createQuery("""
                        select count(e) from MatchEvent e
                        where e.type = hr.mrodek.apps.futsal_turniri.enums.MatchEventType.GOAL
                          and e.player is not null
                          and e.player.team.id = :tid
                          and function('translate', lower(trim(e.player.name)), 'šđčćž', 'sdccz') = :needle
                        """, Long.class)
                .setParameter("tid", teamId)
                .setParameter("needle", foldedNeedle)
                .getSingleResult();
        return count == null ? 0L : count;
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
