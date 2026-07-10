package hr.mrodek.apps.futsal_turniri.dtos;

import hr.mrodek.apps.futsal_turniri.enums.BracketFill;
import hr.mrodek.apps.futsal_turniri.enums.RewardType;
import hr.mrodek.apps.futsal_turniri.enums.TournamentFormat;
import hr.mrodek.apps.futsal_turniri.enums.TournamentStatus;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
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
        Integer maxTeams,                      // null = unlimited (no cap)

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

        // Futsal play system: "4+1" | "5+1" | "3vs3" | free-text custom.
        @Size(max = 40, message = "gameSystem must be at most 40 characters")
        String gameSystem,

        // External organizer link (Facebook event, club page, …).
        @Size(max = 500, message = "websiteUrl must be at most 500 characters")
        String websiteUrl,

        // Public organizer display name (udruga, klub, …). Optional; when
        // set it replaces the creator's account name on the public detail
        // page. Trimmed + blank-to-null in the mapper.
        @Size(max = 120, message = "organizerName must be at most 120 characters")
        String organizerName,

        // Legacy - the percent/fixed toggle was removed; always FIXED now.
        RewardType rewardType,                 // FIXED | PERCENTAGE

        // Each place: amount + optional free-text note ("Ostalo"). Prizes
        // for 1st-3rd place are mandatory (mirrors the SPA form validation);
        // 4th place and the notes stay optional.
        @NotNull(message = "rewardFirst is required")
        @DecimalMin(value = "0.0", inclusive = true, message = "rewardFirst cannot be negative")
        BigDecimal rewardFirst,
        @Size(max = 200, message = "rewardFirstNote must be at most 200 characters")
        String rewardFirstNote,

        @NotNull(message = "rewardSecond is required")
        @DecimalMin(value = "0.0", inclusive = true, message = "rewardSecond cannot be negative")
        BigDecimal rewardSecond,
        @Size(max = 200, message = "rewardSecondNote must be at most 200 characters")
        String rewardSecondNote,

        @NotNull(message = "rewardThird is required")
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
