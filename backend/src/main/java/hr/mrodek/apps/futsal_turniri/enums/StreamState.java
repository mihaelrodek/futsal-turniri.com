package hr.mrodek.apps.futsal_turniri.enums;

import java.util.Locale;

/**
 * The site-wide home-page live-stream banner's mode. Replaces the old
 * {@code live} boolean with four explicit states so the admin can move the
 * banner between them without ever wiping the configured url:
 *
 * <ul>
 *   <li>{@code STREAMING} - the camera video plays in the home hero.</li>
 *   <li>{@code PAUSED}    - "Stream je trenutno pauziran" placeholder; the
 *       stream is coming back, so the url is kept.</li>
 *   <li>{@code ADS}       - a sponsor / advertising banner fills the slot
 *       instead of the video ("mod reklama").</li>
 *   <li>{@code OFF}       - the stream is off; the home page shows its normal
 *       promo banners. The url is retained (not deleted) so it can be
 *       re-started later.</li>
 * </ul>
 */
public enum StreamState {
    STREAMING,
    PAUSED,
    ADS,
    OFF;

    /** Parse a stored/request value, or null when absent/unrecognised. */
    public static StreamState fromNullable(String raw) {
        if (raw == null || raw.isBlank()) return null;
        try {
            return StreamState.valueOf(raw.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
