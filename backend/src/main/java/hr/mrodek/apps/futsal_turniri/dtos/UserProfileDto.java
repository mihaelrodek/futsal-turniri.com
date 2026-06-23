package hr.mrodek.apps.futsal_turniri.dtos;

import jakarta.validation.constraints.Size;

public record UserProfileDto(
        @Size(max = 8, message = "phoneCountry must be at most 8 characters")
        String phoneCountry,

        @Size(max = 50, message = "phone must be at most 50 characters")
        String phone,

        // Read-only fields — populated via /user/me/sync. Returned alongside
        // contact info so the frontend can link straight to /profile/{slug}.
        String displayName,
        String slug,

        /**
         * Read-only proxied URL for the user's avatar (e.g. "/api/resources/42/image"),
         * or {@code null} when the user hasn't uploaded one. Set on read paths;
         * incoming PUT bodies leave it null and it's ignored by the server.
         */
        String avatarUrl,

        /**
         * Per-user theme preference. Accepts "light" or "dark" on PUT;
         * other values get ignored server-side. Null means the user
         * hasn't picked one yet — frontend falls back to its own default.
         */
        @Size(max = 10, message = "colorMode must be at most 10 characters")
        String colorMode
) {
    /** Two-arg convenience for callers that only manage phone fields. */
    public UserProfileDto(String phoneCountry, String phone) {
        this(phoneCountry, phone, null, null, null, null);
    }

    public UserProfileDto(String phoneCountry, String phone, String displayName, String slug) {
        this(phoneCountry, phone, displayName, slug, null, null);
    }

    public UserProfileDto(String phoneCountry, String phone, String displayName, String slug, String avatarUrl) {
        this(phoneCountry, phone, displayName, slug, avatarUrl, null);
    }
}
