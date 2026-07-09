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
        /** DB ids of the two teams - let the live event timeline map each
         *  goal/card to the correct home/away side (same order as
         *  team1Name/team2Name), instead of guessing from numeric id order. */
        Long team1Id,
        Long team2Id,
        String team1Name,
        String team2Name,
        Integer score1,
        Integer score2,
        String liveMode,
        OffsetDateTime liveStartedAt,
        /** Instant the 1st half was ended (match in half-time "pauza"); null otherwise. */
        OffsetDateTime firstHalfEndedAt,
        OffsetDateTime secondHalfStartedAt,
        /** Instant the live clock was paused; null while running. */
        OffsetDateTime livePausedAt,
        /** Tournament half length (minutes) + half count - lets every live
         *  widget run the scoreboard-semaphore countdown (stop at the end of
         *  a half) instead of a free-running elapsed clock. Null until the
         *  schedule is generated. */
        Integer halfLengthMin,
        Integer halfCount,
        /** Accumulated team fouls per half - drives the fullscreen foul /
         *  "deveterac" display under each team name. */
        Integer fouls1First,
        Integer fouls1Second,
        Integer fouls2First,
        Integer fouls2Second,
        /**
         * Mirror of {@code tournaments.featured_at}. When non-null, the
         * tournament owning this match is the admin-curated daily
         * highlight. The frontend sorts/promotes matches by this so the
         * featured tournament's live game wins precedence on the home
         * page hero and the /uzivo stream header.
         */
        OffsetDateTime tournamentFeaturedAt,
        /** Match stage (GROUP, ROUND_OF_32, …, FINAL, THIRD_PLACE). Lets the
         *  home-page "Prati uživo" link jump to the right tab - the groups
         *  draw for a GROUP match, the bracket for a knockout match. */
        String stage
) {}
