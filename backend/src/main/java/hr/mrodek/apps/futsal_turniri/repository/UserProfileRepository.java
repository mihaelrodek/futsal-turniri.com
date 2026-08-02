package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.UserProfile;
import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;
import io.quarkus.panache.common.Sort;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
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

    /**
     * Profiles whose name folds to {@code needle} - the mirror image of
     * {@code PlayersRepository.findUnclaimedByFoldedName}, looked at from the
     * other side: from a roster name to the registered people who could be it.
     *
     * <p>Matches either the separate first+last fields or the single display
     * name (social logins never fill the former). Returns ALL matches on
     * purpose - the caller links only when there is exactly one, because two
     * people sharing a name must never be auto-resolved to whichever row the
     * database happened to return first.
     */
    public List<UserProfile> findByFoldedFullName(String needle) {
        if (needle == null || needle.isBlank()) return List.of();
        return find("""
                        function('translate', lower(trim(concat(coalesce(firstName, ''), ' ', coalesce(lastName, '')))), 'šđčćž', 'sdccz') = ?1
                     or function('translate', lower(trim(coalesce(displayName, ''))), 'šđčćž', 'sdccz') = ?1
                        """, needle)
                .list();
    }

    /** True when some other user already owns this slug. */
    public boolean slugTaken(String slug) {
        if (slug == null || slug.isBlank()) return false;
        return count("slug", slug) > 0;
    }

    /**
     * Free-text search by displayName for the admin dashboard's user
     * picker. Case-insensitive substring match - short and forgiving so
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

    /* ───────────── promo / announcement preferences ─────────────
     *
     * The account-wide "promotivne poruke i novosti" switches. They gate
     * BROADCAST-style promo / general announcements ONLY.
     *
     * They are deliberately NOT consulted for the notification bells: a
     * tournament or match a user explicitly followed keeps notifying them
     * (goal, half-time, final whistle, schedule, elimination), as do purely
     * transactional messages (team approved, recording delivered, pair
     * archive request). Those live in their own subscription tables and must
     * never be silenced by a marketing preference.
     *
     * Missing profile row → treated as opted IN, matching the entity's
     * default and the column default, so a user who has never touched the
     * setting is never accidentally excluded.
     */

    /** Whether this user accepts promotional / announcement e-mail. */
    public boolean allowsPromoEmail(String uid) {
        if (uid == null || uid.isBlank()) return false;
        return findByUid(uid).map(UserProfile::isPromoEmail).orElse(true);
    }

    /** Whether this user accepts promotional / announcement push. */
    public boolean allowsPromoPush(String uid) {
        if (uid == null || uid.isBlank()) return false;
        return findByUid(uid).map(UserProfile::isPromoPush).orElse(true);
    }

    /**
     * Bulk form of {@link #allowsPromoEmail(String)} for fan-outs: given the
     * candidate recipients, returns the subset that still accepts promo
     * e-mail. ONE query for the whole list - never call the single-uid variant
     * inside a loop.
     *
     * <p>UIDs with no profile row are kept (opted in by default), so the
     * filter can only ever remove people who explicitly said no.
     */
    public Set<String> filterPromoEmailAllowed(Collection<String> uids) {
        return filterPromoAllowed(uids, "promoEmail");
    }

    /** Bulk form of {@link #allowsPromoPush(String)}. Same one-query rule. */
    public Set<String> filterPromoPushAllowed(Collection<String> uids) {
        return filterPromoAllowed(uids, "promoPush");
    }

    /**
     * Shared implementation of the two bulk filters. {@code field} is one of
     * this class's own literals ("promoEmail" / "promoPush") - never caller
     * input - so the string concatenation carries no injection risk.
     *
     * <p>Works by SUBTRACTION: one query fetches the UIDs that opted OUT, and
     * everything else in the input survives. That way a UID with no profile
     * row is kept without needing a second lookup.
     */
    private Set<String> filterPromoAllowed(Collection<String> uids, String field) {
        if (uids == null || uids.isEmpty()) return Set.of();
        Set<String> candidates = new LinkedHashSet<>();
        for (String uid : uids) {
            if (uid != null && !uid.isBlank()) candidates.add(uid);
        }
        if (candidates.isEmpty()) return Set.of();
        List<String> optedOut = getEntityManager()
                .createQuery("select p.userUid from UserProfile p "
                        + "where p.userUid in :uids and p." + field + " = false", String.class)
                .setParameter("uids", candidates)
                .getResultList();
        candidates.removeAll(optedOut);
        return candidates;
    }

    /**
     * Every UID currently flagged as a platform admin - the recipient list for
     * admin-facing inbox notifications (new recording request, camera/quote
     * inquiry, player-claim request).
     *
     * <p>ONE query, a projection of the uid column only: the fan-out needs
     * nothing else off the profile, and a per-row lookup for something that
     * runs on every public form submit would be indefensible.
     *
     * <p><b>Not an authorization check.</b> The flag is a mirror of the Firebase
     * {@code role} claim kept for addressing only - see
     * {@link UserProfile#isAdmin()}. Never call this to decide whether the
     * current caller may do something; that is what {@code @RolesAllowed} on
     * the verified JWT is for.
     */
    public List<String> findAdminUids() {
        return getEntityManager()
                .createQuery("select p.userUid from UserProfile p where p.admin = true", String.class)
                .getResultList();
    }

    /**
     * Full list of registered profiles, alphabetically by displayName.
     * Used by the admin "Popis igrača" tab which wants every user the
     * admin can navigate to, not just the top-N search hits.
     *
     * <p>No pagination yet - the user base is small enough that one page
     * fits comfortably; revisit if/when it grows to thousands.
     */
    public List<UserProfile> listAllByDisplayName() {
        return find("displayName is not null", Sort.by("displayName")).list();
    }
}
