package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import java.text.Normalizer;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * Builds human-readable URL slugs for tournaments - e.g. a tournament called
 * "1. Futsal Open" starting on 2026-04-22 becomes {@code "1-futsal-open-22-04-2026"}.
 *
 * <p>The slug is the only piece of the URL the user sees in WhatsApp shares
 * and the address bar, so we want it to look like a real title even when the
 * input has Croatian diacritics, punctuation, or capitalization noise.
 *
 * <p>Uniqueness is enforced by appending {@code -2}, {@code -3}, ... when
 * another tournament already owns the candidate slug. The DB has a unique
 * index on {@code slug}, so this is also safe under race conditions: a
 * second concurrent insert would just bounce off the constraint and we'd
 * retry with the next suffix.
 */
@ApplicationScoped
public class TournamentSlugService {

    @Inject TournamentsRepository tournamentsRepo;

    private static final DateTimeFormatter DATE_FMT =
            DateTimeFormatter.ofPattern("dd-MM-yyyy");

    /** Strip diacritics + non-ASCII so "Đakovo" -> "Dakovo". */
    private static final Pattern DIACRITICS = Pattern.compile("\\p{InCombiningDiacriticalMarks}+");
    /** Anything that isn't a-z 0-9 collapses to a hyphen. */
    private static final Pattern NON_SLUG = Pattern.compile("[^a-z0-9]+");
    private static final Pattern HYPHENS = Pattern.compile("-+");

    /**
     * Build a slug for {@code t} and ensure it's globally unique. Pass
     * {@code currentId} when updating an existing row so its own current
     * slug doesn't count as a collision with itself; pass {@code null} on
     * insert.
     */
    public String generateUnique(Tournaments t, Long currentId) {
        String base = buildBase(t);
        if (base.isEmpty()) base = "turnir";

        String candidate = base;
        int suffix = 2;
        while (true) {
            var existing = tournamentsRepo.findBySlug(candidate);
            if (existing.isEmpty()) return candidate;
            if (currentId != null && existing.get().getId().equals(currentId)) {
                return candidate;
            }
            candidate = base + "-" + suffix;
            suffix++;
            // Defensive: stop runaway loops - should never realistically hit.
            if (suffix > 1000) {
                throw new IllegalStateException("Could not generate unique slug for " + t.getName());
            }
        }
    }

    /**
     * Build the un-suffixed slug from name + start date. Visible for testing.
     */
    String buildBase(Tournaments t) {
        String name = t.getName() == null ? "" : t.getName();
        String slugName = slugifyName(name);

        String slugDate = "";
        OffsetDateTime startAt = t.getStartAt();
        if (startAt != null) {
            // Use Europe/Zagreb so a tournament starting at 22:00 UTC on
            // 2026-04-22 doesn't render as "23-04-2026" in the slug - the
            // user thinks of the date in local time.
            slugDate = startAt.atZoneSameInstant(ZoneId.of("Europe/Zagreb"))
                    .toLocalDate()
                    .format(DATE_FMT);
        }

        if (slugName.isEmpty() && slugDate.isEmpty()) return "";
        if (slugName.isEmpty()) return slugDate;
        if (slugDate.isEmpty()) return slugName;
        return slugName + "-" + slugDate;
    }

    private static String slugifyName(String input) {
        String n = Normalizer.normalize(input, Normalizer.Form.NFD);
        n = DIACRITICS.matcher(n).replaceAll("");
        n = n.toLowerCase(Locale.ROOT);
        // Croatian-specific letters that NFD doesn't decompose ("đ" -> "d").
        n = n.replace('đ', 'd');
        n = NON_SLUG.matcher(n).replaceAll("-");
        n = HYPHENS.matcher(n).replaceAll("-");
        // Trim leading/trailing hyphens.
        if (n.startsWith("-")) n = n.substring(1);
        if (n.endsWith("-")) n = n.substring(0, n.length() - 1);
        // Hard cap so name + date stays within the 220-char column.
        if (n.length() > 180) n = n.substring(0, 180);
        // Same trim again in case substring left a trailing hyphen.
        if (n.endsWith("-")) n = n.substring(0, n.length() - 1);
        return n;
    }
}
