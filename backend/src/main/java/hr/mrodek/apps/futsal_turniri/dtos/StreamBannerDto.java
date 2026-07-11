package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Home-page live-stream banner state: the camera url + the on/off switch,
 * and the tournament it's linked to (its uuid + display name). When linked,
 * the home page follows THAT tournament's live match (its "tijek utakmice"
 * + group table) instead of the globally-featured one. tournamentUuid is
 * null when the stream isn't tied to any tournament.
 */
public record StreamBannerDto(
        String url,
        boolean live,
        String tournamentUuid,
        String tournamentName
) {}
