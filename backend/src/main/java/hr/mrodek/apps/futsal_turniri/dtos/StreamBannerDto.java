package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Home-page live-stream banner state: the camera url, the current mode
 * ({@code state}: STREAMING | PAUSED | ADS | OFF), a derived {@code live}
 * boolean ({@code state == STREAMING}, kept for existing consumers), and the
 * tournament it's linked to (its uuid + display name). When linked, the home
 * page follows THAT tournament's live match (its "tijek utakmice" + group
 * table) instead of the globally-featured one. tournamentUuid is null when the
 * stream isn't tied to any tournament.
 */
public record StreamBannerDto(
        String url,
        boolean live,
        String state,
        String tournamentUuid,
        String tournamentName,
        /** The active ad (ADS mode): its id + media proxy url + IMAGE|VIDEO,
         *  or all null when none is selected. */
        Long adId,
        String adUrl,
        String adMediaType,
        /** The overlay currently shown OVER the live video (any state), or all
         *  null when hidden. Same media shape as an ad. */
        Long overlayId,
        String overlayUrl,
        String overlayMediaType
) {}
