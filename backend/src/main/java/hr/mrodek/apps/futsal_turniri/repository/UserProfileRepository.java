package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.UserProfile;
import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import io.quarkus.panache.common.Sort;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.Collection;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

@ApplicationScoped
public class UserProfileRepository implements PanacheRepositoryBase<UserProfile, String> {

    public Optional<UserProfile> findByUid(String uid) {
        return findByIdOptional(uid);
    }

    public Optional<UserProfile> findBySlug(String slug) {
        if (slug == null || slug.isBlank()) return Optional.empty();
        return find("slug", slug.trim()).firstResultOptional();
    }

    /**
     * Bulk-load profiles for a collection of UIDs (used to enrich team lists
     * with submitter display names + slugs without N+1 queries). Empty input
     * returns an empty map without hitting the DB.
     */
    public Map<String, UserProfile> findByUids(Collection<String> uids) {
        if (uids == null || uids.isEmpty()) return Map.of();
        return list("userUid in ?1", uids).stream()
                .collect(Collectors.toMap(UserProfile::getUserUid, p -> p));
    }

    /** True when some other user already owns this slug. */
    public boolean slugTaken(String slug) {
        if (slug == null || slug.isBlank()) return false;
        return count("slug", slug) > 0;
    }

    /**
     * Free-text search by displayName for the admin dashboard's user
     * picker. Case-insensitive substring match — short and forgiving so
     * the admin doesn't have to type the exact casing or full name.
     *
     * <p>The {@code limit} cap is enforced because the admin dashboard
     * renders results as a dropdown; an unbounded list scrolls badly and
     * also leaks the full user base to an admin who maybe doesn't need
     * to see everyone at once. {@code null} or blank query returns the
     * first {@code limit} profiles sorted by display name so the
     * dropdown has something to show before the admin types.
     */
    public List<UserProfile> searchByDisplayName(String query, int limit) {
        int capped = Math.max(1, Math.min(limit, 100));
        if (query == null || query.isBlank()) {
            return find("displayName is not null", Sort.by("displayName"))
                    .page(0, capped)
                    .list();
        }
        String needle = "%" + query.trim().toLowerCase(Locale.ROOT) + "%";
        return find("lower(displayName) like ?1", Sort.by("displayName"), needle)
                .page(0, capped)
                .list();
    }

    /**
     * Full list of registered profiles, alphabetically by displayName.
     * Used by the admin "Popis igrača" tab which wants every user the
     * admin can navigate to, not just the top-N search hits.
     *
     * <p>No pagination yet — the user base is small enough that one page
     * fits comfortably; revisit if/when it grows to thousands.
     */
    public List<UserProfile> listAllByDisplayName() {
        return find("displayName is not null", Sort.by("displayName")).list();
    }
}
