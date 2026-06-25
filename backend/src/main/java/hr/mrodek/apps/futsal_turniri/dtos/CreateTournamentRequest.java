package hr.mrodek.apps.futsal_turniri.dtos;

import hr.mrodek.apps.futsal_turniri.enums.BracketFill;
import hr.mrodek.apps.futsal_turniri.enums.RewardType;
import hr.mrodek.apps.futsal_turniri.enums.TournamentFormat;
import hr.mrodek.apps.futsal_turniri.enums.TournamentStatus;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

public record CreateTournamentRequest(
        @NotBlank(message = "name is required")
        @Size(max = 200, message = "name must be at most 200 characters")
        String name,

        @Size(max = 200, message = "location must be at most 200 characters")
        String location,

        @Size(max = 4000, message = "details must be at most 4000 characters")
        String details,

        OffsetDateTime startAt,

        @Size(max = 1000, message = "bannerUrl must be at most 1000 characters")
        String bannerUrl,

        @Min(value = 2, message = "maxTeams must be at least 2")
        Integer maxTeams,                      // default 16 if null

        // --- Format (Phase E) ---
        TournamentFormat format,               // GROUPS_KNOCKOUT (default) | KNOCKOUT_ONLY

        @Min(value = 2, message = "groupCount must be at least 2")
        Integer groupCount,                    // GROUPS_KNOCKOUT only

        @Min(value = 1, message = "advancePerGroup must be at least 1")
        Integer advancePerGroup,               // GROUPS_KNOCKOUT only

        BracketFill bracketFill,               // GROUPS_KNOCKOUT only: BYES | WILDCARDS

        @DecimalMin(value = "0.0", inclusive = true, message = "entryPrice cannot be negative")
        BigDecimal entryPrice,                 // default 0 if null

        @Size(max = 200, message = "contactName must be at most 200 characters")
        String contactName,

        @Size(max = 50, message = "contactPhone must be at most 50 characters")
        String contactPhone,

        // Legacy — the percent/fixed toggle was removed; always FIXED now.
        RewardType rewardType,                 // FIXED | PERCENTAGE

        // Each place: amount + optional free-text note ("Ostalo").
        @DecimalMin(value = "0.0", inclusive = true, message = "rewardFirst cannot be negative")
        BigDecimal rewardFirst,
        @Size(max = 200, message = "rewardFirstNote must be at most 200 characters")
        String rewardFirstNote,

        @DecimalMin(value = "0.0", inclusive = true, message = "rewardSecond cannot be negative")
        BigDecimal rewardSecond,
        @Size(max = 200, message = "rewardSecondNote must be at most 200 characters")
        String rewardSecondNote,

        @DecimalMin(value = "0.0", inclusive = true, message = "rewardThird cannot be negative")
        BigDecimal rewardThird,
        @Size(max = 200, message = "rewardThirdNote must be at most 200 characters")
        String rewardThirdNote,

        @DecimalMin(value = "0.0", inclusive = true, message = "rewardFourth cannot be negative")
        BigDecimal rewardFourth,
        @Size(max = 200, message = "rewardFourthNote must be at most 200 characters")
        String rewardFourthNote,

        TournamentStatus status                // DRAFT | STARTED | FINISHED (default DRAFT if null)
) {}
