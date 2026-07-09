package hr.mrodek.apps.futsal_turniri.dtos;

import jakarta.validation.constraints.Size;

/** Login helper: resolve a username to its account email. */
public record EmailForUsernameRequest(
        @Size(max = 200, message = "username must be at most 200 characters")
        String username
) {}
