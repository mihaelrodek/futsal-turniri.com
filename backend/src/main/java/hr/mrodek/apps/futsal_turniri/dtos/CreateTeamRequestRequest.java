package hr.mrodek.apps.futsal_turniri.dtos;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record CreateTeamRequestRequest(
        @NotBlank(message = "playerName is required")
        @Size(max = 200, message = "playerName must be at most 200 characters")
        String playerName,

        @Size(max = 50, message = "phone must be at most 50 characters")
        String phone,

        @Size(max = 1000, message = "note must be at most 1000 characters")
        String note
) {}
