package hr.mrodek.apps.futsal_turniri.dtos;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record TournamentDetailsResponse(
        Long id,
        UUID uuid,
        /**
         * Pretty URL slug (e.g. {@code "1-futsal-open-22-04-2026"}). May be null
         * for legacy rows that haven't been backfilled yet — frontend should
         * fall back to {@code uuid} when null.
         */
        String slug,
        String name,
        String location,
        String details,
        OffsetDateTime startAt,
        String bannerUrl,
        String status,

        // Not persisted yet in your model — keep nullable in response
        BigDecimal entryPrice,
        Integer maxTeams,

        // --- Format (Phase E) ---
        String format,               // "GROUPS_KNOCKOUT" | "KNOCKOUT_ONLY"
        Integer groupCount,
        Integer advancePerGroup,
        String bracketFill,          // "BYES" | "WILDCARDS"

        String contactName,
        String contactPhone,

        String rewardType,           // "FIXED" | "PERCENTAGE"
        BigDecimal rewardFirst,
        BigDecimal rewardSecond,
        BigDecimal rewardThird,

        List<String> additionalOptions, // if/when you join them; null/empty for now
        List<TeamShortDto> teams,       // empty until teams are implemented
        String winnerName,              // gold-place team name (set on FINISH)
        // Silver + bronze podium positions. Set by the organiser through
        // the dedicated /podium endpoint after FINISH. Both nullable —
        // the organiser may leave them blank.
        String secondPlaceName,
        String thirdPlaceName,

        // Individual awards (best GK / player / scorer), set via /awards.
        // Free-text uppercased player names; nullable until the organiser
        // fills them in.
        String bestGoalkeeperName,
        String bestPlayerName,
        String bestScorerName,

        // Creator (Firebase UID + display name copied at create-time).
        String createdByUid,
        String createdByName,

        // Admin-curated "tournament of the day" timestamp. Non-null when
        // featured; cleared back to null when unfeatured. Drives the
        // admin toggle button label + the /uzivo hero block visibility.
        java.time.OffsetDateTime featuredAt
) {}
