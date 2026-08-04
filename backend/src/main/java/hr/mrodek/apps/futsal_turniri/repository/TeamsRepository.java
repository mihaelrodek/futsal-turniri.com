package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.Teams;
import io.quarkus.panache.common.Parameters;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;

import java.util.Collection;
import java.util.List;

@ApplicationScoped
public class TeamsRepository implements AppRepository<Teams, Long> {

    /**
     * CDI-injected {@link EntityManager} for tuple-shaped projections that
     * Panache's entity-only {@code find()} can't express (e.g. GROUP BY
     * returning {@code Object[]} rows). Same EM instance Panache uses
     * internally.
     */
    @Inject EntityManager em;

    public List<Teams> findByTournament_Id(Long tournamentId) {
        return list("tournament.id", tournamentId);
    }

    /**
     * {@code registrationLinkId -> teams filed through it} for one tournament,
     * in ONE grouped query - the organizer's link list shows a count per row
     * and a query per link would scale with however many links they made.
     */
    public java.util.Map<Long, Long> countByRegistrationLink(Long tournamentId) {
        var rows = em.createQuery(
                        "select t.registrationLink.id, count(t) from Teams t "
                                + "where t.tournament.id = :tid and t.registrationLink is not null "
                                + "group by t.registrationLink.id", Object[].class)
                .setParameter("tid", tournamentId)
                .getResultList();
        var out = new java.util.HashMap<Long, Long>();
        for (Object[] row : rows) out.put((Long) row[0], (Long) row[1]);
        return out;
    }

    /**
     * Teams from a given tournament that aren't yet linked to any registered
     * user. Used by the admin dashboard to surface candidates for legacy /
     * organizer-added teams that a real user can claim retroactively.
     *
     * <p>"Unclaimed" = both {@code submittedByUid} and {@code coSubmittedByUid}
     * are null. A team that's only attached via name-matching a user's preset
     * is still considered unclaimed here, since the preset is a soft link the
     * admin might want to override.
     *
     * <p>Pending self-registrations are excluded - the admin shouldn't be
     * reassigning a team the organiser hasn't approved yet.
     */
    public List<Teams> findUnclaimedByTournamentId(Long tournamentId) {
        return list("tournament.id = ?1 " +
                        "and submittedByUid is null " +
                        "and coSubmittedByUid is null " +
                        "and pendingApproval = false",
                tournamentId);
    }

    /** Single-team lookup by claim token (the share URL). */
    public java.util.Optional<Teams> findByClaimToken(String token) {
        if (token == null || token.isBlank()) return java.util.Optional.empty();
        return find("claimToken", token).firstResultOptional();
    }

    /**
     * True if the given user has at least one Team with the given name
     * (case-insensitive, trimmed) where a partner has claimed co-ownership
     * via the share link. Used by the preset DELETE flow to prevent the
     * owner from removing a name that's anchoring someone else's history.
     */
    public boolean existsClaimedTeamForUserByName(String userUid, String name) {
        if (userUid == null || name == null) return false;
        String needle = name.trim().toLowerCase();
        if (needle.isEmpty()) return false;
        return count(
                "submittedByUid = ?1 and coSubmittedByUid is not null " +
                "and lower(trim(name)) = ?2",
                userUid, needle
        ) > 0;
    }

    /**
     * Teams the user has played as. We match in two ways:
     *   - direct: team was self-registered with the user's UID, OR
     *   - by-name: team has no submittedByUid (organizer-added or pre-self-register
     *     legacy) AND its name matches one of the user's saved team-presets,
     *     case-insensitive.
     *
     * The by-name fallback covers tournaments that finished before self-register
     * existed, plus organizers who add their own team via "Dodaj par" - they
     * still want to see those in their personal history.
     *
     * Pass an empty list of presets to skip the by-name OR clause entirely.
     */
    public List<Teams> findMyParticipations(String uid, Collection<String> presetNames) {
        if (uid == null || uid.isBlank()) return List.of();

        List<String> lowered = presetNames == null
                ? List.of()
                : presetNames.stream()
                        .filter(s -> s != null && !s.isBlank())
                        .map(s -> s.trim().toLowerCase())
                        .toList();

        // Build the JPQL dynamically - the OR-by-name clause is only added
        // when the user has saved team-name presets. Stays on Panache:
        // entity-shaped result, full "from" prefix tells Panache this is
        // a complete query, named params via Parameters builder.
        // Co-owned teams (claimed via the share link) also count - they
        // show on the claimer's profile just like their own self-registrations.
        // The third arm is the identity link (players.claimed_by_uid): a roster
        // row that IS this person, set automatically on a unique name match or
        // by an admin approving a claim request. It grants no rights - it only
        // makes the appearance show up here, which is what lets a whole roster
        // of registered players each see the tournament even though a team has
        // only two submitter slots.
        StringBuilder jpql = new StringBuilder("""
                from Teams p
                join fetch p.tournament t
                where p.submittedByUid = :uid
                   or p.coSubmittedByUid = :uid
                   or exists (select 1 from Player pl where pl.team = p and pl.claimedByUid = :uid)
                """);
        Parameters params = Parameters.with("uid", uid);
        if (!lowered.isEmpty()) {
            jpql.append(" or (p.submittedByUid is null and p.coSubmittedByUid is null and lower(trim(p.name)) in :names)");
            params = params.and("names", lowered);
        }
        jpql.append(" order by t.startAt desc nulls last");

        return list(jpql.toString(), params);
    }

    /**
     * Returns rows of {@code [tournamentId, count]} for the given tournament
     * ids. Tuple-shaped projection - Panache {@code find()} is entity-shaped
     * and can't return {@code Object[]} from GROUP BY, so this goes through
     * the injected EntityManager.
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> countByTournamentIds(List<Long> ids) {
        if (ids == null || ids.isEmpty()) return List.of();
        return em.createQuery("""
                        select p.tournament.id, count(p)
                        from Teams p
                        where p.tournament.id in :ids
                        group by p.tournament.id
                        """)
                .setParameter("ids", ids)
                .getResultList();
    }

    /**
     * Distinct team names across ALL tournaments matching the query as a
     * substring, for the cross-tournament name autocomplete (mirrors
     * PlayersRepository.searchDistinctNames). Case-folded compare so
     * partial lowercase input still matches. Capped at {@code limit}.
     * Demo/test teams (is_demo) are excluded - they must never be offered
     * while adding a real team.
     */
    public List<String> searchDistinctNames(String q, int limit) {
        String like = "%" + q.trim().toLowerCase() + "%";
        return em.createQuery(
                        "select distinct p.name from Teams p " +
                        "where lower(p.name) like :like " +
                        "and p.demo = false " +
                        "order by p.name asc", String.class)
                .setParameter("like", like)
                .setMaxResults(limit)
                .getResultList();
    }

    /**
     * Every distinct raw team name across all tournaments with its row count
     * (how many per-tournament Teams rows use it), the number of distinct
     * tournaments it appears in, and whether EVERY row sharing that exact
     * name is currently flagged demo. Backs the admin "Baza ekipa" list and
     * the duplicate-name finder - both need the full (non-filtered) name
     * inventory, unlike {@link #searchDistinctNames} which is the public
     * autocomplete.
     */
    @SuppressWarnings("unchecked")
    public List<Object[]> findAllNameStats() {
        return em.createQuery("""
                        select p.name, count(p), count(distinct p.tournament.id),
                               sum(case when p.demo then 1 else 0 end)
                        from Teams p
                        group by p.name
                        order by p.name asc
                        """)
                .getResultList();
    }

    /**
     * Bulk-toggle the demo flag for every Teams row with this EXACT name
     * (trimmed, case-insensitive) - the admin action operates on the whole
     * cross-tournament identity, not a single per-tournament row, since
     * that's the unit "hide from the database" actually means to an
     * organizer. Returns the number of rows updated.
     */
    public int setDemoByName(String name, boolean demo) {
        if (name == null || name.isBlank()) return 0;
        return update("demo = ?1 where lower(trim(name)) = ?2", demo, name.trim().toLowerCase());
    }

    /**
     * Merge support (admin duplicate-name merge): rename every Teams row
     * whose name is one of {@code names} (exact match, case-sensitive - the
     * caller passes the precise raw variants observed in the duplicate
     * group) to {@code canonicalName}. Returns the number of rows renamed.
     */
    public int renameTeams(java.util.Collection<String> names, String canonicalName) {
        if (names == null || names.isEmpty()) return 0;
        return update("name = ?1 where name in ?2", canonicalName, names);
    }
}
