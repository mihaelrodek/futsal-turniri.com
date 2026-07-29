package hr.mrodek.apps.futsal_turniri.services;

import java.text.Normalizer;

/**
 * Normalization + fuzzy-match helpers shared by the cross-tournament team
 * identity features (default kits table, admin duplicate-name finder/merge).
 *
 * <p>Team identity is name-based (no shared id across tournaments - see
 * {@link hr.mrodek.apps.futsal_turniri.repository.TeamsRepository}), so
 * "OGREVANJE ZAMUDA" and "Ogrevanje Zamuda" need to resolve to the same
 * bucket. {@link #normalize} is the single canonical form used both as the
 * lookup key for {@code team_default_kits} and as the equality test for the
 * admin duplicate finder's "exact" grouping.
 */
public final class TeamNameNormalizer {

    private TeamNameNormalizer() {}

    /**
     * Lowercase, diacritics stripped (NFD + drop combining marks - same
     * approach as {@link SlugService#normalizeUsername}), whitespace
     * collapsed to a single space, trimmed. Not intended to be displayed -
     * it's a lookup/comparison key only.
     */
    public static String normalize(String raw) {
        if (raw == null) return "";
        String ascii = Normalizer.normalize(raw, Normalizer.Form.NFD)
                .replaceAll("\\p{InCombiningDiacriticalMarks}+", "");
        return ascii.toLowerCase(java.util.Locale.ROOT)
                .trim()
                .replaceAll("\\s+", " ");
    }

    /**
     * Classic Levenshtein edit distance (insert/delete/substitute, cost 1
     * each) between two already-normalized strings. O(n*m) DP, fine for the
     * short team-name strings this is used on. Used by the admin duplicate
     * finder to flag near-equal names (distance &le; 2) that aren't already
     * an exact normalized match.
     */
    public static int levenshtein(String a, String b) {
        int n = a.length();
        int m = b.length();
        if (n == 0) return m;
        if (m == 0) return n;
        int[] prev = new int[m + 1];
        int[] curr = new int[m + 1];
        for (int j = 0; j <= m; j++) prev[j] = j;
        for (int i = 1; i <= n; i++) {
            curr[0] = i;
            char ca = a.charAt(i - 1);
            for (int j = 1; j <= m; j++) {
                int cost = ca == b.charAt(j - 1) ? 0 : 1;
                curr[j] = Math.min(
                        Math.min(curr[j - 1] + 1, prev[j] + 1),
                        prev[j - 1] + cost
                );
            }
            int[] tmp = prev;
            prev = curr;
            curr = tmp;
        }
        return prev[m];
    }
}
