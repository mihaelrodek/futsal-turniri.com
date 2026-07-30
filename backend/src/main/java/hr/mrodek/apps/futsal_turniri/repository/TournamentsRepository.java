package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.dtos.TeamMedalsDto;
import hr.mrodek.apps.futsal_turniri.enums.MatchStatus;
import hr.mrodek.apps.futsal_turniri.enums.TournamentStatus;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import io.quarkus.panache.common.Page;
import io.quarkus.panache.common.Sort;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.persistence.EntityManager;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@ApplicationScoped
public class TournamentsRepository implements AppRepository<Tournaments, Long> {

    @Inject EntityManager em;

    /**
     * How many times each (uppercase) player name has been awarded best
     * scorer across all tournaments. Keyed by uppercased trimmed name.
     * Feeds the all-time scorer-list tiebreaker: among equal goal totals,
     * a player who's been a tournament's top scorer ranks higher.
     */
    @SuppressWarnings("unchecked")
    public Map<String, Long> bestScorerAwardCounts() {
        List<Object[]> rows = em.createQuery("""
                        select upper(trim(t.bestScorerName)), count(t)
                        from Tournaments t
                        where t.bestScorerName is not null and t.bestScorerName <> ''
                        group by upper(trim(t.bestScorerName))
                        """)
                .getResultList();
        Map<String, Long> out = new HashMap<>();
        for (Object[] r : rows) {
            out.put((String) r[0], (Long) r[1]);
        }
        return out;
    }

    /**
     * All-time team medal table ("World Cup"-style): gold = tournament won,
     * silver = 2nd place, bronze = 3rd place, aggregated across every
     * FINISHED tournament. Teams are matched by uppercased trimmed name -
     * the same {@code winnerName} / {@code secondPlaceName} /
     * {@code thirdPlaceName} free-text fields used for the podium display.
     * Rows are unsorted; the controller orders them for the response.
     */
    public List<TeamMedalsDto> teamMedalCounts() {
        Map<String, Long> gold = goldCounts();
        Map<String, Long> silver = silverCounts();
        Map<String, Long> bronze = bronzeCounts();

        Map<String, long[]> totals = new HashMap<>();
        gold.forEach((name, count) -> totals.computeIfAbsent(name, n -> new long[3])[0] += count);
        silver.forEach((name, count) -> totals.computeIfAbsent(name, n -> new long[3])[1] += count);
        bronze.forEach((name, count) -> totals.computeIfAbsent(name, n -> new long[3])[2] += count);

        List<TeamMedalsDto> out = new ArrayList<>();
        totals.forEach((name, counts) -> out.add(new TeamMedalsDto(name, counts[0], counts[1], counts[2])));
        return out;
    }

    @SuppressWarnings("unchecked")
    private Map<String, Long> goldCounts() {
        List<Object[]> rows = em.createQuery("""
                        select upper(trim(t.winnerName)), count(t)
                        from Tournaments t
                        where t.status = ?1 and t.winnerName is not null and t.winnerName <> ''
                        group by upper(trim(t.winnerName))
                        """)
                .setParameter(1, TournamentStatus.FINISHED)
                .getResultList();
        return toCountMap(rows);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Long> silverCounts() {
        List<Object[]> rows = em.createQuery("""
                        select upper(trim(t.secondPlaceName)), count(t)
                        from Tournaments t
                        where t.status = ?1 and t.secondPlaceName is not null and t.secondPlaceName <> ''
                        group by upper(trim(t.secondPlaceName))
                        """)
                .setParameter(1, TournamentStatus.FINISHED)
                .getResultList();
        return toCountMap(rows);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Long> bronzeCounts() {
        List<Object[]> rows = em.createQuery("""
                        select upper(trim(t.thirdPlaceName)), count(t)
                        from Tournaments t
                        where t.status = ?1 and t.thirdPlaceName is not null and t.thirdPlaceName <> ''
                        group by upper(trim(t.thirdPlaceName))
                        """)
                .setParameter(1, TournamentStatus.FINISHED)
                .getResultList();
        return toCountMap(rows);
    }

    private static Map<String, Long> toCountMap(List<Object[]> rows) {
        Map<String, Long> out = new HashMap<>();
        for (Object[] r : rows) {
            out.put((String) r[0], (Long) r[1]);
        }
        return out;
    }

    /**
     * Merge support (admin duplicate-name merge): the podium fields
     * ({@code winnerName}/{@code secondPlaceName}/{@code thirdPlaceName})
     * are denormalized team-name snapshots on FINISHED tournaments (see
     * {@code teamMedalCounts} above, and {@code TeamsSection.tsx}'s podium
     * card matching) - they must be repointed to the canonical spelling too,
     * or the all-time medal table and the podium UI would silently split a
     * merged team's history across the old and new names. Case-sensitive
     * exact match against the raw variants the caller collected for the
     * duplicate group. Returns the total number of column values updated.
     */
    public int renamePodiumNames(java.util.Collection<String> names, String canonicalName) {
        if (names == null || names.isEmpty()) return 0;
        int n = 0;
        n += update("winnerName = ?1 where winnerName in ?2", canonicalName, names);
        n += update("secondPlaceName = ?1 where secondPlaceName in ?2", canonicalName, names);
        n += update("thirdPlaceName = ?1 where thirdPlaceName in ?2", canonicalName, names);
        return n;
    }

    public Optional<Tournaments> findByUuid(UUID uuid) {
        return find("uuid", uuid).firstResultOptional();
    }

    public Optional<Tournaments> findBySlug(String slug) {
        if (slug == null || slug.isBlank()) return Optional.empty();
        return find("slug", slug).firstResultOptional();
    }

    /**
     * Resolve a path-segment that can be either a UUID (legacy URLs, action
     * endpoints) or a slug (new pretty URLs). Slug is tried after UUID parsing
     * fails so we don't pay an extra DB hit on the common UUID path.
     */
    public Optional<Tournaments> findByUuidOrSlug(String idOrSlug) {
        if (idOrSlug == null || idOrSlug.isBlank()) return Optional.empty();
        try {
            UUID uuid = UUID.fromString(idOrSlug);
            return findByUuid(uuid);
        } catch (IllegalArgumentException ignored) {
            // Not a UUID - fall through to slug lookup.
        }
        return findBySlug(idOrSlug);
    }

    public boolean existsByUuid(UUID uuid) {
        return count("uuid", uuid) > 0;
    }

    public List<Tournaments> findByStartAtBeforeOrderByStartAtDesc(OffsetDateTime now) {
        return list("startAt < ?1", Sort.by("startAt").descending(), now);
    }

    public List<Tournaments> findByStartAtGreaterThanEqualOrderByStartAtAsc(OffsetDateTime now) {
        return list("startAt >= ?1", Sort.by("startAt").ascending(), now);
    }

    // A tournament counts as "finished" for the public listings when it is
    // explicitly FINISHED, OR it was never actually run and its start passed
    // more than a day ago - an ABANDONED draft, which then auto-drops out of
    // "Nadolazeći" after 24h instead of lingering there forever.
    //
    // "Abandoned" means: still DRAFT, past its date, AND with NO played match
    // (no match in LIVE/FINISHED - i.e. only SCHEDULED or none). A tournament
    // that is being played must NEVER be auto-finished: a STARTED one is
    // already excluded (only DRAFT matches ?2), and the played-match guard
    // additionally protects a tournament whose matches were started before the
    // auto-STARTED transition existed (still DRAFT but clearly in progress). It
    // stays live until the organizer finishes it explicitly.
    // Both listing predicates additionally require archivedAt IS NULL: a
    // tournament whose deletion has been requested (archived, awaiting the
    // admin's confirm) must drop out of the public lists immediately, even
    // though its detail page stays reachable by direct link until the admin
    // finalizes. Prepended OUTSIDE the or-group so it applies to both arms.
    private static final String EFFECTIVELY_FINISHED =
            "archivedAt is null and (status = ?1 or (status = ?2 and startAt is not null and startAt < ?3 "
            + "and id not in (select m.tournament.id from Matches m where m.status <> ?4)))";
    private static final String NOT_EFFECTIVELY_FINISHED =
            "archivedAt is null and status <> ?1 and not (status = ?2 and startAt is not null and startAt < ?3 "
            + "and id not in (select m.tournament.id from Matches m where m.status <> ?4))";

    /** Start-of-grace cutoff: drafts whose start is older than this are done. */
    private static OffsetDateTime draftFinishedCutoff() {
        return OffsetDateTime.now().minusHours(24);
    }

    /**
     * "Finished" listing - explicitly FINISHED tournaments plus abandoned
     * drafts whose date passed >24h ago (see {@link #EFFECTIVELY_FINISHED}).
     * Paged so the SPA can lazy-load older results behind a "Učitaj više" button.
     */
    public List<Tournaments> findFinishedPaged(int offset, int limit) {
        return find(EFFECTIVELY_FINISHED,
                Sort.by("startAt").descending(),
                TournamentStatus.FINISHED, TournamentStatus.DRAFT, draftFinishedCutoff(), MatchStatus.SCHEDULED)
                .page(Page.of(offset / Math.max(1, limit), Math.max(1, limit)))
                .list();
    }

    public long countFinished() {
        return count(EFFECTIVELY_FINISHED,
                TournamentStatus.FINISHED, TournamentStatus.DRAFT, draftFinishedCutoff(), MatchStatus.SCHEDULED);
    }

    /**
     * "Upcoming / in progress" listing - everything not (effectively) finished:
     * not FINISHED, and not an abandoned draft whose date passed >24h ago (those
     * move to the finished bucket so they leave "Nadolazeći").
     */
    public List<Tournaments> findNotFinishedOrderByStartAtAsc() {
        return list(NOT_EFFECTIVELY_FINISHED,
                Sort.by("startAt").ascending(),
                TournamentStatus.FINISHED, TournamentStatus.DRAFT, draftFinishedCutoff(), MatchStatus.SCHEDULED);
    }

    /**
     * Currently-featured tournament for the /uzivo hero. Returns the row
     * with the highest {@code featured_at} that hasn't been marked
     * FINISHED - finished tournaments shouldn't keep appearing in the
     * "tournament of the day" slot even if an admin forgot to unfeature.
     *
     * <p>Backed by the partial index {@code idx_tournaments_featured_at}
     * (see the {@code tournaments_featured} changelog) so the lookup is
     * a cheap index seek regardless of table size.
     */
    public java.util.Optional<Tournaments> findCurrentlyFeatured() {
        return find(
                "featuredAt is not null and archivedAt is null and status <> ?1",
                Sort.by("featuredAt").descending(),
                TournamentStatus.FINISHED)
                .firstResultOptional();
    }

    /**
     * Pending deletion requests for the admin dashboard: archived (deletion
     * requested) but not yet finally deleted. Rows whose deletion was already
     * confirmed are excluded automatically by the entity's
     * {@code @Where(is_deleted = false)} clause. Newest request first.
     */
    public List<Tournaments> findPendingDeleteRequests() {
        return list("archivedAt is not null", Sort.by("archivedAt").descending());
    }
}
