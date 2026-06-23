package hr.mrodek.apps.futsal_turniri.dtos;

import jakarta.validation.constraints.Size;

/**
 * Sent by the frontend on every login so the backend learns the user's
 * Firebase displayName and can ensure a slug exists for /profile/{slug}.
 *
 * displayName may be blank — the slug service has a fallback for that case.
 */
public record SyncProfileRequest(
        @Size(max = 200, message = "displayName must be at most 200 characters")
        String displayName
) {}
