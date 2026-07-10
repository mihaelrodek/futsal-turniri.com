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
         * for legacy rows that haven't been backfilled yet - frontend should
         * fall back to {@code uuid} when null.
         */
        String slug,
        String name,
        String location,
        // Geocoded coordinates of `location` (nullable until geocoded). The
        // edit form seeds its map picker with these so the SAVED spot shows
        // up as a marker immediately, instead of an empty Croatia-wide map.
        Double latitude,
        Double longitude,
        String details,
        OffsetDateTime startAt,
        String bannerUrl,
        String status,

        // Not persisted yet in your model - keep nullable in response
        BigDecimal entryPrice,
        Integer maxTeams,

        // --- Format (Phase E) ---
        String format,               // "GROUPS_KNOCKOUT" | "KNOCKOUT_ONLY"
        Integer groupCount,
        Integer advancePerGroup,
        // How many best "third-placed" teams also advance to the bracket
        // (0 = off). Chosen at draw time; drives the draw config default and
        // the "Najbolje trećeplasirane" table.
        Integer bestThirdCount,
        String bracketFill,          // "BYES" | "WILDCARDS"

        String contactName,
        String contactPhone,

        // Futsal play system ("4+1" | "5+1" | "3vs3" | custom) and an external
        // organizer link - both optional, shown on the detail page.
        String gameSystem,
        String websiteUrl,

        // Public organizer display name (udruga, klub, …). Optional; when
        // set, the SPA shows it as the organizer instead of createdByName.
        String organizerName,

        String rewardType,           // legacy "FIXED" | "PERCENTAGE"
        // Each place: amount + optional free-text note ("Ostalo").
        BigDecimal rewardFirst,
        String rewardFirstNote,
        BigDecimal rewardSecond,
        String rewardSecondNote,
        BigDecimal rewardThird,
        String rewardThirdNote,
        BigDecimal rewardFourth,
        String rewardFourthNote,

        List<String> additionalOptions, // if/when you join them; null/empty for now
        List<TeamShortDto> teams,       // empty until teams are implemented
        String winnerName,              // gold-place team name (set on FINISH)
        // Silver + bronze podium positions. Set by the organiser through
        // the dedicated /podium endpoint after FINISH. Both nullable -
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
        java.time.OffsetDateTime featuredAt,

        // Admin-set "not publicly visible". Only creator/admin ever receive a
        // hidden tournament (public readers get 404) - drives the greyed-out
        // treatment + banner on the details page and the admin toggle label.
        boolean hidden
) {}
