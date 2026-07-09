package hr.mrodek.apps.futsal_turniri.dtos;

import jakarta.validation.constraints.Size;

/**
 * Sent right after a Firebase sign-up to set the user's chosen username +
 * first/last name on their profile. The username is normalized to the slug
 * form server-side and must be unique.
 */
public record RegisterProfileRequest(
        @Size(max = 120, message = "firstName must be at most 120 characters")
        String firstName,

        @Size(max = 120, message = "lastName must be at most 120 characters")
        String lastName,

        @Size(max = 200, message = "username must be at most 200 characters")
        String username
) {}
