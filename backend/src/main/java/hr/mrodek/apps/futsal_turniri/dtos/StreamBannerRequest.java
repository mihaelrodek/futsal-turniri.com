package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Body of PUT /stream-banner (admin dashboard): the camera url (YouTube link,
 * HLS .m3u8, direct media file, or an embeddable page; blank/null clears it),
 * the "camera is on" switch, and the tournament this stream is linked to
 * (uuid or slug; blank/null = not linked). When linked, the home page shows
 * that tournament's live match + its group table under the stream.
 */
public record StreamBannerRequest(String url, Boolean live, String tournamentUuid) {}
