package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.StreamBannerDto;
import hr.mrodek.apps.futsal_turniri.dtos.StreamBannerRequest;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.repository.AppSettingsRepository;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.HttpHeaders;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

/**
 * Site-wide live-stream banner (the Veo court camera on the HOME page).
 * While switched on, the SPA replaces the home hero (promo slides + the
 * "uživo" scoreboard slide) with a video player of this url.
 *
 * <p>The banner can be LINKED to a tournament: when it is, the home page
 * shows that tournament's currently-live match next to the video ("tijek
 * utakmice") plus the group table of that match - so pointing the camera at
 * a tournament auto-drives the on-screen scoreboard. Unlinked, it falls back
 * to the globally-featured live match.
 *
 * <p>GET is public and explicitly {@code Cache-Control: no-store}: the
 * banner must appear/disappear the moment the admin flips the switch -
 * no browser/SW/edge copy may serve a stale on/off state. (The service
 * worker is network-first for /api reads, and this header additionally
 * keeps the browser HTTP cache out of the loop.)
 *
 * <p>PUT is admin-only (dashboard). A blank url clears the banner and
 * forces the switch off.
 */
@Path("/stream-banner")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class StreamBannerController {

    static final String KEY_URL = "stream_banner_url";
    static final String KEY_LIVE = "stream_banner_live";
    static final String KEY_TOURNAMENT = "stream_banner_tournament";

    @Inject AppSettingsRepository settings;
    @Inject TournamentsRepository tournamentsRepo;

    /** Current banner state: {@code {url, live, tournamentUuid, tournamentName}}.
     *  Public, never cached. */
    @GET
    public Response get() {
        String url = settings.get(KEY_URL);
        boolean live = url != null && Boolean.parseBoolean(settings.get(KEY_LIVE));
        String tUuid = settings.get(KEY_TOURNAMENT);
        String tName = null;
        if (tUuid != null && !tUuid.isBlank()) {
            // Normalise to the immutable uuid + resolve the display name so the
            // admin card can show what's linked. A since-deleted tournament
            // just resolves to null → the home page finds no live match.
            Tournaments t = tournamentsRepo.findByUuidOrSlug(tUuid).orElse(null);
            if (t != null) {
                tUuid = t.getUuid().toString();
                tName = t.getName();
            }
        } else {
            tUuid = null;
        }
        return Response.ok(new StreamBannerDto(url, live, tUuid, tName))
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .build();
    }

    /** Set the banner url, the "camera is on" switch, and the linked
     *  tournament (uuid/slug; blank clears the link). Admin only. */
    @PUT
    @RolesAllowed("admin")
    @Transactional
    public Response set(StreamBannerRequest req) {
        String url = req == null || req.url() == null ? null : req.url().trim();
        if (url != null && url.isEmpty()) url = null;
        if (url != null && !(url.startsWith("http://") || url.startsWith("https://"))) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("STREAM_URL_INVALID").build();
        }
        if (url != null && url.length() > 1000) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("STREAM_URL_TOO_LONG").build();
        }

        // Resolve the linked tournament (if any) to its immutable uuid.
        String tUuid = null;
        String tName = null;
        String rawT = req == null || req.tournamentUuid() == null ? null : req.tournamentUuid().trim();
        if (rawT != null && !rawT.isEmpty()) {
            Tournaments t = tournamentsRepo.findByUuidOrSlug(rawT).orElse(null);
            if (t == null) {
                return Response.status(Response.Status.BAD_REQUEST)
                        .entity("TOURNAMENT_NOT_FOUND").build();
            }
            tUuid = t.getUuid().toString();
            tName = t.getName();
        }

        boolean live = url != null && req != null && Boolean.TRUE.equals(req.live());
        settings.put(KEY_URL, url);
        settings.put(KEY_LIVE, String.valueOf(live));
        settings.put(KEY_TOURNAMENT, tUuid);
        return Response.ok(new StreamBannerDto(url, live, tUuid, tName))
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .build();
    }
}
