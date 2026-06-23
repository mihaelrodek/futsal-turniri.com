package hr.mrodek.apps.futsal_turniri.dtos;

import java.time.OffsetDateTime;

/**
 * Minimal projection returned by {@code GET /tournaments/live}.
 * Each element represents one match currently in status LIVE, enriched
 * with enough tournament and team context to render a "live now" widget
 * without further requests.
 */
public record LiveMatchDto(
        Long matchId,
        String tournamentUuid,
        String tournamentSlug,
        String tournamentName,
        String team1Name,
        String team2Name,
        Integer score1,
        Integer score2,
        String liveMode,
        OffsetDateTime liveStartedAt,
        OffsetDateTime secondHalfStartedAt,
        /**
         * Mirror of {@code tournaments.featured_at}. When non-null, the
         * tournament owning this match is the admin-curated daily
         * highlight. The frontend sorts/promotes matches by this so the
         * featured tournament's live game wins precedence on the home
         * page hero and the /uzivo stream header.
         */
        OffsetDateTime tournamentFeaturedAt
) {}
