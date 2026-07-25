package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.enums.MatchStatus;
import hr.mrodek.apps.futsal_turniri.enums.StreamState;
import hr.mrodek.apps.futsal_turniri.integrations.spectostream.SpectoStreamService;
import hr.mrodek.apps.futsal_turniri.model.Matches;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.repository.AppSettingsRepository;
import hr.mrodek.apps.futsal_turniri.repository.MatchesRepository;
import hr.mrodek.apps.futsal_turniri.repository.PlayersRepository;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;

import java.util.List;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.PUT;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;

/**
 * Site-wide SpectoStream CONNECTION settings, editable from the admin dashboard.
 *
 * <p>The platform URL + API key normally come from {@code specto.base-url} /
 * {@code specto.api-key} (.env). Saving them here stores them in
 * {@code app_settings} instead, where they WIN over the config and take effect
 * immediately - so the operator can repoint the integration or rotate the key
 * without editing .env and restarting the server.
 *
 * <p><b>The key is write-only.</b> It is never returned: the GET reports only
 * whether one is set, which source it came from, and its last four characters
 * so two keys can be told apart. Admin-only, like the rest of the dashboard.
 */
@Path("/specto-admin")
@RolesAllowed("admin")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class SpectoAdminController {

    @Inject SpectoStreamService specto;
    @Inject AppSettingsRepository settings;
    @Inject TournamentsRepository tournamentsRepo;
    @Inject MatchesRepository matchesRepo;
    @Inject PlayersRepository playersRepo;

    /* Home-page banner keys - shared with StreamBannerController, which owns
       their semantics. Starting a broadcast points the banner at this stream so
       the home page shows it; stopping only leaves STREAMING (the url stays, so
       it can be re-started). */
    private static final String KEY_BANNER_URL = "stream_banner_url";
    private static final String KEY_BANNER_LIVE = "stream_banner_live";
    private static final String KEY_BANNER_STATE = "stream_banner_state";
    private static final String KEY_BANNER_TOURNAMENT = "stream_banner_tournament";

    /** Body for saving the connection. A null/blank {@code apiKey} keeps the
     *  stored one (so the form saves without re-typing the secret);
     *  {@code clearApiKey} removes it and falls back to the .env config. */
    public record ConnectionRequest(String baseUrl, String apiKey, Boolean clearApiKey) {}

    /** Body for the reachability check. */
    public record VerifyRequest(String streamId) {}

    /** Result of the reachability check: ok, or a short Croatian reason. */
    public record VerifyResult(boolean ok, String reason) {}

    /** Effective connection (URL, whether a key is set + where from). */
    @GET
    @Path("/connection")
    public Response connection() {
        return Response.ok(specto.connectionInfo()).build();
    }

    /** Save the connection settings. Takes effect immediately - no restart. */
    @PUT
    @Path("/connection")
    @Transactional
    public Response saveConnection(ConnectionRequest req) {
        String base = req == null ? null : req.baseUrl();
        if (base != null && !base.isBlank()
                && !(base.startsWith("http://") || base.startsWith("https://"))) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("Adresa mora počinjati s http:// ili https://").build();
        }
        specto.saveConnection(
                base,
                req == null ? null : req.apiKey(),
                req != null && Boolean.TRUE.equals(req.clearApiKey()));
        return Response.ok(specto.connectionInfo()).build();
    }

    /** Check that the saved connection can actually reach the given stream. */
    @POST
    @Path("/verify")
    public Response verify(VerifyRequest req) {
        String reason = specto.verify(req == null ? null : req.streamId());
        return Response.ok(new VerifyResult(reason == null, reason)).build();
    }

    /** Body for starting / stopping the broadcast of one tournament's stream. */
    public record BroadcastRequest(String tournamentUuid) {}

    /**
     * START broadcasting: tell the platform the camera is live (with the next
     * fixture announced on the overlay) AND put the stream on the home page -
     * the banner is pointed at this tournament's embed and switched to
     * STREAMING. One button, both effects, so "Pokreni" does what it says.
     */
    @POST
    @Path("/broadcast/start")
    @Transactional
    public Response startBroadcast(BroadcastRequest req) {
        Tournaments t = resolve(req);
        if (t == null) return notFound();
        if (t.getSpectoStreamId() == null) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("Turnir nije povezan sa streamom.").build();
        }
        // Overlay: camera on + announce what's on next, then that match's squads
        // (single FIFO dispatch, so the lineup can't overtake stream_start).
        Matches next = matchesRepo.findNextScheduled(t.getId(), null);
        specto.streamStart(t, next);
        sendLineupFor(t, currentMatch(t));
        // Home page: point the banner at this stream and switch it live.
        settings.put(KEY_BANNER_URL, specto.embedUrl(t.getSpectoStreamId()));
        settings.put(KEY_BANNER_TOURNAMENT, t.getUuid().toString());
        settings.put(KEY_BANNER_STATE, StreamState.STREAMING.name());
        settings.put(KEY_BANNER_LIVE, "true");
        return Response.ok(specto.broadcastStatus(t)).build();
    }

    /** Show the linked stream on the home page WITHOUT sending stream_start to
     *  SpectoStream. Useful when the platform stream is already running and the
     *  operator only wants to expose it in the app. */
    @POST
    @Path("/broadcast/show")
    @Transactional
    public Response showBroadcast(BroadcastRequest req) {
        Tournaments t = resolve(req);
        if (t == null) return notFound();
        if (t.getSpectoStreamId() == null) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("Turnir nije povezan sa streamom.").build();
        }
        settings.put(KEY_BANNER_URL, specto.embedUrl(t.getSpectoStreamId()));
        settings.put(KEY_BANNER_TOURNAMENT, t.getUuid().toString());
        settings.put(KEY_BANNER_STATE, StreamState.STREAMING.name());
        settings.put(KEY_BANNER_LIVE, "true");
        return Response.ok(specto.broadcastStatus(t)).build();
    }

    /** Hide the home-page banner WITHOUT sending stream_end to SpectoStream.
     *  The tournament link and URL stay saved for a quick re-show. */
    @POST
    @Path("/broadcast/hide")
    @Transactional
    public Response hideBroadcast(BroadcastRequest req) {
        Tournaments t = resolve(req);
        if (t == null) return notFound();
        settings.put(KEY_BANNER_STATE, StreamState.OFF.name());
        settings.put(KEY_BANNER_LIVE, "false");
        return Response.ok(specto.broadcastStatus(t)).build();
    }

    /** STOP broadcasting: camera off on the overlay + take the home-page banner
     *  out of STREAMING (the url is kept so it can be started again). */
    @POST
    @Path("/broadcast/stop")
    @Transactional
    public Response stopBroadcast(BroadcastRequest req) {
        Tournaments t = resolve(req);
        if (t == null) return notFound();
        specto.streamEnd(t);
        settings.put(KEY_BANNER_STATE, StreamState.OFF.name());
        settings.put(KEY_BANNER_LIVE, "false");
        return Response.ok(specto.broadcastStatus(t)).build();
    }

    /** Whether this tournament's stream is currently the live home-page banner. */
    @GET
    @Path("/broadcast")
    public Response broadcast(@jakarta.ws.rs.QueryParam("tournamentUuid") String tournamentUuid) {
        Tournaments t = tournamentUuid == null || tournamentUuid.isBlank()
                ? null : tournamentsRepo.findByUuidOrSlug(tournamentUuid).orElse(null);
        if (t == null) return notFound();
        return Response.ok(specto.broadcastStatus(t)).build();
    }

    /** Body for pushing the squads. */
    public record LineupRequest(String tournamentUuid) {}

    /** Body for the standalone countdown. */
    public record TimerRequest(String tournamentUuid, Integer seconds) {}

    /**
     * Push the squads of the tournament's CURRENT match onto the overlay -
     * the LIVE one, or the next scheduled when nothing is live. Rosters come
     * from the Ekipe tab (number + name).
     */
    @POST
    @Path("/lineup")
    public Response lineup(LineupRequest req) {
        Tournaments t = req == null ? null : resolveUuid(req.tournamentUuid());
        if (t == null) return notFound();
        Matches m = currentMatch(t);
        if (m == null) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("Nema utakmice u tijeku ni sljedeće na rasporedu.").build();
        }
        if (m.getTeam1() == null && m.getTeam2() == null) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("Ekipe te utakmice još nisu poznate.").build();
        }
        sendLineupFor(t, m);
        return Response.status(Response.Status.ACCEPTED).build();
    }

    /** Push both sides' rosters for {@code m}. No-op when the match or both
     *  teams are unknown (a knockout slot still to be decided). */
    private void sendLineupFor(Tournaments t, Matches m) {
        if (m == null || (m.getTeam1() == null && m.getTeam2() == null)) return;
        specto.lineup(t,
                m.getTeam1() != null ? playersRepo.findByTeam_Id(m.getTeam1().getId()) : null,
                m.getTeam2() != null ? playersRepo.findByTeam_Id(m.getTeam2().getId()) : null);
    }

    /** Start / restart the standalone countdown (1-3600 s). */
    @POST
    @Path("/timer/start")
    public Response timerStart(TimerRequest req) {
        Tournaments t = req == null ? null : resolveUuid(req.tournamentUuid());
        if (t == null) return notFound();
        int secs = req.seconds() == null ? 0 : req.seconds();
        if (secs < 1 || secs > 3600) {
            return Response.status(Response.Status.BAD_REQUEST)
                    .entity("Trajanje mora biti između 1 i 3600 sekundi.").build();
        }
        specto.timerStart(t, secs);
        return Response.status(Response.Status.ACCEPTED).build();
    }

    /** Clear the countdown (also used for "pauza" - the client restarts it with
     *  the remaining seconds, since the API has no pause of its own). */
    @POST
    @Path("/timer/stop")
    public Response timerStop(TimerRequest req) {
        Tournaments t = req == null ? null : resolveUuid(req.tournamentUuid());
        if (t == null) return notFound();
        specto.timerStop(t);
        return Response.status(Response.Status.ACCEPTED).build();
    }

    /** The match the overlay is about: the LIVE one, else the next scheduled. */
    private Matches currentMatch(Tournaments t) {
        List<Matches> live = matchesRepo.findByTournament_IdAndStatus(t.getId(), MatchStatus.LIVE);
        if (!live.isEmpty()) return live.get(0);
        return matchesRepo.findNextScheduled(t.getId(), null);
    }

    private Tournaments resolveUuid(String uuid) {
        String u = uuid == null ? null : uuid.trim();
        if (u == null || u.isEmpty()) return null;
        return tournamentsRepo.findByUuidOrSlug(u).orElse(null);
    }

    private Tournaments resolve(BroadcastRequest req) {
        String uuid = req == null || req.tournamentUuid() == null ? null : req.tournamentUuid().trim();
        if (uuid == null || uuid.isEmpty()) return null;
        return tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
    }

    private static Response notFound() {
        return Response.status(Response.Status.NOT_FOUND).entity("Turnir nije pronađen.").build();
    }
}
