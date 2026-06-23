package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.model.UserProfile;
import hr.mrodek.apps.futsal_turniri.repository.UserProfileRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;

import java.text.Normalizer;

/**
 * Builds public, URL-safe handles like {@code marko-markovic} from a display
 * name. Croatian diacritics are stripped (š → s, ć → c, …), runs of
 * non-alphanumerics collapse to a single dash, and the result is lower-cased.
 *
 * Collisions are resolved with {@code -2}, {@code -3}, … suffixes per the
 * product decision (we don't add hashes — just plain numbers).
 */
@ApplicationScoped
public class SlugService {

    @Inject UserProfileRepository profileRepo;

    /** Hard fallback when displayName / email are both empty. */
    private static final String DEFAULT_BASE = "igrac";

    /** Normalize a free-form name into a slug base — never returns blank. */
    public String baseSlug(String displayName) {
        String src = displayName == null ? "" : displayName.trim();
        if (src.isBlank()) return DEFAULT_BASE;

        // NFD normalization splits accented chars into base + combining marks;
        // stripping the combining marks gives us the closest ASCII shape.
        String ascii = Normalizer.normalize(src, Normalizer.Form.NFD)
                .replaceAll("\\p{InCombiningDiacriticalMarks}+", "");

        // Croatian-specific letters that don't decompose under NFD:
        ascii = ascii
                .replace("đ", "d").replace("Đ", "d")
                .replace("ð", "d") // historical
                .replace("ł", "l").replace("Ł", "l");

        String slug = ascii.toLowerCase()
                .replaceAll("[^a-z0-9]+", "-")
                .replaceAll("(^-|-$)", "");

        return slug.isBlank() ? DEFAULT_BASE : slug;
    }

    /**
     * Build a slug guaranteed to be unique, given the UID that wants to claim
     * it. If the user already owns a slug we keep it. Otherwise we walk
     * {@code base, base-2, base-3, …} until we find one that's free.
     */
    public String allocateUniqueSlug(String displayName, String forUid) {
        String base = baseSlug(displayName);
        // The user might already own `base` (or a numbered variant) from a
        // previous sync — we shouldn't bump them to base-2 just because they
        // re-synced.
        var existing = profileRepo.findByUid(forUid).map(p -> p.getSlug()).orElse(null);
        if (existing != null && !existing.isBlank() && existing.startsWith(base)) {
            // Confirm it's still free or owned by us — if some race left a
            // duplicate we'd rather notice now than at insert time.
            if (!profileRepo.slugTaken(existing)
                    || profileRepo.findBySlug(existing)
                                  .map(p -> forUid.equals(p.getUserUid()))
                                  .orElse(false)) {
                return existing;
            }
        }

        String candidate = base;
        int n = 2;
        while (profileRepo.slugTaken(candidate)) {
            candidate = base + "-" + n;
            n++;
            if (n > 9999) {
                // Defensive — shouldn't ever happen.
                throw new IllegalStateException("Unable to allocate slug for: " + displayName);
            }
        }
        return candidate;
    }

    /**
     * Make sure the user has a {@link UserProfile} row with a slug. Called
     * from any path where we expect to enrich team / tournament results with
     * submitter info — covers users whose front-end {@code /user/me/sync}
     * call hasn't landed yet (or failed silently).
     *
     * Updates {@code displayName} on the row only when the supplied value is
     * non-blank; never blows away an existing name with null. Idempotent.
     */
    @Transactional
    public UserProfile ensureProfile(String uid, String displayName) {
        if (uid == null || uid.isBlank()) return null;
        UserProfile existing = profileRepo.findByUid(uid).orElse(null);
        if (existing == null) {
            existing = new UserProfile();
            existing.setUserUid(uid);
        }
        if (displayName != null && !displayName.isBlank()) {
            existing.setDisplayName(displayName.trim());
        }
        if (existing.getSlug() == null || existing.getSlug().isBlank()) {
            existing.setSlug(allocateUniqueSlug(existing.getDisplayName(), uid));
        }
        profileRepo.persist(existing);
        return existing;
    }
}
