package hr.mrodek.apps.futsal_turniri.dtos;

/**
 * Body of PUT /stream-banner (admin dashboard): the camera url (YouTube link,
 * HLS .m3u8, direct media file, or an embeddable page; blank/null keeps the
 * slot without a video), the desired {@code state} (STREAMING | PAUSED | ADS |
 * OFF), and the tournament this stream is linked to (uuid or slug; blank/null =
 * not linked). When linked, the home page shows that tournament's live match +
 * its group table under the stream.
 *
 * <p>{@code live} is the legacy boolean input, honoured only when {@code state}
 * is absent (older clients): true → STREAMING, false → PAUSED/OFF.
 */
public record StreamBannerRequest(
        String url, Boolean live, String state, String tournamentUuid, Long adId, Long overlayId) {}
