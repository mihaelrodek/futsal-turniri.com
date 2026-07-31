package hr.mrodek.apps.futsal_turniri.services;

import java.text.Normalizer;
import java.util.Locale;

/**
 * Normalizes a person's name for diacritic/case-insensitive matching: trim,
 * collapse inner whitespace, lower-case, strip diacritics (NFD + combining-
 * mark removal, plus the explicit đ→d that NFD can't decompose). Mirrors the
 * SQL-side {@code translate(lower(trim(name)), 'šđčćž', 'sdccz')} used in
 * {@code PlayersRepository} queries for hr/sl letters.
 *
 * <p>Shared by the player-claim-suggestion flow ({@code UserMeController})
 * and the public-profile career stats ({@code PublicProfileController}),
 * which both need to match a registered "ime prezime" against roster
 * {@code Player.name} rows.
 */
public final class PersonNameFolder {
    private PersonNameFolder() {}

    public static String fold(String s) {
        if (s == null) return "";
        String collapsed = s.trim().toLowerCase(Locale.ROOT).replaceAll("\\s+", " ");
        String decomposed = Normalizer.normalize(collapsed, Normalizer.Form.NFD)
                .replaceAll("\\p{M}+", "");
        return decomposed.replace('đ', 'd');
    }

    /** The folded "ime prezime" needle, or null when either part is blank -
     *  nothing safe to match on. */
    public static String needle(String firstName, String lastName) {
        String first = firstName == null || firstName.isBlank() ? null : firstName.trim();
        String last = lastName == null || lastName.isBlank() ? null : lastName.trim();
        if (first == null || last == null) return null;
        return fold(first + " " + last);
    }

    /**
     * Same needle, derived from one free-text display name ("Mihael Rodek") -
     * for accounts that signed in with a social provider and never filled the
     * separate first/last fields.
     *
     * <p>Null unless the name has at least two words: a single token
     * ("Mihael", or a nickname) is far too weak to auto-link a person to a
     * roster row.
     */
    public static String needleFromDisplayName(String displayName) {
        if (displayName == null || displayName.isBlank()) return null;
        String folded = fold(displayName);
        return folded.contains(" ") ? folded : null;
    }
}
