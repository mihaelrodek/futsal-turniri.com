package hr.mrodek.apps.futsal_turniri.integrations.spectostream;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import hr.mrodek.apps.futsal_turniri.enums.MatchStage;
import hr.mrodek.apps.futsal_turniri.enums.MatchStatus;
import hr.mrodek.apps.futsal_turniri.model.Matches;
import hr.mrodek.apps.futsal_turniri.model.Player;
import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.repository.AppSettingsRepository;
import hr.mrodek.apps.futsal_turniri.repository.MatchesRepository;
import jakarta.annotation.PreDestroy;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.ws.rs.WebApplicationException;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.jboss.logging.Logger;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Relays live match telemetry to SpectoStream (the operator's own streaming
 * platform at {@code specto.base-url}), which renders it as a scoreboard/clock
 * overlay on the broadcast.
 *
 * <p>Two call shapes with deliberately different guarantees:
 * <ul>
 *   <li><b>{@link #provisionTournament} is SYNCHRONOUS.</b> The organizer is
 *       waiting on the "link stream" click, so it blocks and, on any upstream
 *       problem, throws {@link WebApplicationException} (502) so the caller
 *       surfaces a real error instead of a silent half-link. It runs inside the
 *       caller's {@code @Transactional} boundary and writes the returned stream
 *       id straight onto the managed entity (dirty-checked on commit).</li>
 *   <li><b>Every event method (match/period/goal/card/…) is FIRE-AND-FORGET.</b>
 *       They are called from the zapisnik (match-record) flow, which must never
 *       fail or stall because the overlay is slow or down. They return after
 *       trivial setup, do the HTTP off the request thread, retry once, then log
 *       at WARN and give up. They are a silent no-op whenever the integration is
 *       unconfigured or the tournament isn't linked.</li>
 * </ul>
 *
 * <p><b>Ordering.</b> SpectoStream requires {@code match_start} to arrive before
 * the {@code period_start} that follows it, because {@code match_start} resets
 * the scoreboard. The zapisnik flow calls {@link #matchStart} then
 * {@link #periodStart} back-to-back, so dispatch runs on a SINGLE daemon thread:
 * FIFO submission order is FIFO send order. One operator drives one match, so
 * throughput is irrelevant here — a single thread trades nothing we care about
 * for guaranteed per-stream ordering.
 *
 * <p><b>JPA off-thread rule.</b> The async sends run after the request's
 * transaction has closed and its persistence context is gone, so the
 * {@link Tournaments} entity MUST NOT be touched off the request thread. Each
 * method reads everything it needs (only the stream id) into a local on the
 * request thread BEFORE submitting; the dispatch thread only ever sees immutable
 * strings and a detached Jackson node.
 *
 * <p><b>Idempotency.</b> Every event carries a deterministic
 * {@code idempotency_key} so the single retry cannot create a duplicate. The
 * {@code occurred_at} instant (and any epoch-second suffix baked into the key)
 * is captured at SUBMIT time, not send time, so a retry replays the original
 * moment — SpectoStream runs its overlay clock off {@code occurred_at}.
 *
 * <p><b>The clock stops on time, not on the click.</b> SpectoStream is told
 * when a period starts but never how long it lasts, so its overlay clock would
 * free-run past the whistle until the organizer got round to tapping "završi
 * poluvrijeme" — a 2x10 match showing 11:24 on the broadcast while this app
 * already froze at 10:00. {@link #schedulePeriodEnd} therefore ARMS the end of
 * the period the moment it starts: a timer fires at the exact boundary instant
 * and freezes the overlay at exactly the half length, with no operator in the
 * loop. The manual end still sends the same event with the same idempotency key
 * (so it's a no-op if the timer already fired) but back-dated to the boundary —
 * which is what makes an app restart, a lost timer or a late tap still land on
 * 10:00 rather than wherever the clock happened to be.
 */
@ApplicationScoped
public class SpectoStreamService {

    private static final Logger LOG = Logger.getLogger(SpectoStreamService.class);

    /** Setting keys backing the admin dashboard's connection form. Whatever is
     *  stored here WINS over the {@code specto.*} config, so the operator can
     *  point the integration at another deployment / rotate the key from the UI
     *  without editing .env and restarting. Blank/absent → fall back to config. */
    public static final String KEY_BASE_URL = "specto_base_url";
    public static final String KEY_API_KEY = "specto_api_key";

    @ConfigProperty(name = "specto.base-url", defaultValue = "https://stream.safeflow.hr")
    String baseUrl;

    // Optional<String>, NOT String: SmallRye converts an empty value to null,
    // and injecting null into a plain String aborts STARTUP with
    // "SRCFG00040 ... considered to be null". The integration is optional, so an
    // unset/blank key must simply mean "off" - never a boot failure.
    @ConfigProperty(name = "specto.api-key")
    Optional<String> apiKey;

    @ConfigProperty(name = "specto.enabled", defaultValue = "true")
    boolean enabled;

    @Inject
    ObjectMapper json;

    @Inject
    AppSettingsRepository settings;

    @Inject
    MatchesRepository matchesRepo;

    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3))
            .build();

    // Single daemon thread: guarantees per-stream ordering (match_start before
    // period_start) and keeps overlay dispatch off the request thread. Unbounded
    // queue, so submit() never blocks the caller.
    private final ExecutorService dispatch = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "specto-dispatch");
        t.setDaemon(true);
        return t;
    });

    // Fires the automatic end-of-period. Separate from `dispatch` on purpose: a
    // scheduled task must not sit in the FIFO send queue for minutes and block
    // the goals/cards behind it. It does no I/O itself - it hands the event to
    // `dispatch` when it fires, so ordering is still guaranteed at send time.
    private final ScheduledExecutorService clockTimers = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "specto-clock");
        t.setDaemon(true);
        return t;
    });

    /** Pending automatic period end, per match id. At most one - a match has
     *  exactly one clock, so arming a new period replaces the old timer. */
    private final ConcurrentMap<Long, ScheduledFuture<?>> periodEndTimers = new ConcurrentHashMap<>();

    /** Pending automatic post-tournament podium push, per tournament id. */
    private final ConcurrentMap<Long, ScheduledFuture<?>> podiumTimers = new ConcurrentHashMap<>();

    /** Overlay title of the podium popup. The overlay is Croatian-facing, so
     *  this is a fixed string rather than a request-locale message. */
    public static final String FINAL_STANDINGS_TITLE = "Konačni poredak";

    /** How long after the tournament's last match finishes before the
     *  automatic top-3 podium popup fires - long enough that it lands after
     *  the match's own final score has visibly landed on the overlay. */
    private static final int PODIUM_AUTO_DELAY_SECONDS = 15;

    @PreDestroy
    void shutdown() {
        clockTimers.shutdownNow();
        dispatch.shutdown();
        try {
            if (!dispatch.awaitTermination(2, TimeUnit.SECONDS)) {
                dispatch.shutdownNow();
            }
        } catch (InterruptedException e) {
            dispatch.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    /* ── Effective connection settings ──────────────────────────────────────
       DB setting (admin dashboard) first, {@code specto.*} config as fallback.
       CALL THESE ON THE REQUEST THREAD ONLY - they hit the database, and the
       dispatch thread has no persistence context (see the JPA off-thread rule
       above). Every public entry point resolves them before handing work to
       `dispatch`, and the resolved strings travel with the job. */

    /** Effective API key: DB setting wins, else {@code specto.api-key}, else "". */
    private String key() {
        String v = settings.get(KEY_API_KEY);
        if (v != null && !v.isBlank()) return v.trim();
        return apiKey.orElse("");
    }

    /** Effective base URL (no trailing slash): DB setting wins, else config. */
    private String base() {
        String v = settings.get(KEY_BASE_URL);
        String raw = (v != null && !v.isBlank()) ? v.trim() : baseUrl;
        return raw.replaceAll("/+$", "");
    }

    /** True when streaming is enabled AND an API key is present (from either
     *  source). Off = every event send is a silent no-op and
     *  {@link #provisionTournament} refuses. Request thread only. */
    public boolean isConfigured() {
        return enabled && !key().isBlank();
    }

    /** OBS ingest + playback + embed details returned by the tournament upsert.
     *  {@code playbackUrl} is the public HLS manifest - the app's own player
     *  consumes it directly (the embed snippet is only for foreign websites). */
    public record ProvisionInfo(String streamId, String obsServer, String obsStreamKey,
                                String playbackUrl, String embedSnippet) {}

    // ── Synchronous provisioning ────────────────────────────────────────────

    /**
     * Idempotent upsert of the tournament into SpectoStream: PUT
     * {@code /v1/tournaments/{uuid}} with {@code {"name": ...}}, keyed by OUR
     * tournament uuid so re-linking never creates a duplicate stream. On 2xx it
     * parses the stream id + OBS/embed details, persists the id via
     * {@code t.setSpectoStreamId(...)} (the caller's transaction commits it), and
     * returns them. Any failure throws {@link WebApplicationException} 502 with a
     * short Croatian message.
     */
    public ProvisionInfo provisionTournament(Tournaments t) {
        if (!isConfigured()) {
            throw new WebApplicationException("SpectoStream nije konfiguriran.", 502);
        }
        if (t.getUuid() == null) {
            throw new WebApplicationException("SpectoStream: turnir nema uuid.", 502);
        }
        String uuid = t.getUuid().toString();

        String bodyJson;
        try {
            ObjectNode body = json.createObjectNode();
            body.put("name", t.getName() == null ? "" : t.getName());
            bodyJson = json.writeValueAsString(body);
        } catch (Exception e) {
            LOG.warnf(e, "SpectoStream: priprema upserta za turnir %s nije uspjela", uuid);
            throw new WebApplicationException("SpectoStream: povezivanje streama nije uspjelo.", 502);
        }

        // Resolved once here (request thread - DB reads are safe).
        final String apiBase = base();
        HttpRequest req = HttpRequest.newBuilder(URI.create(apiBase + "/v1/tournaments/" + uuid))
                .timeout(Duration.ofSeconds(5))
                .header("Authorization", "Bearer " + key())
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .PUT(HttpRequest.BodyPublishers.ofString(bodyJson, StandardCharsets.UTF_8))
                .build();

        try {
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            int code = res.statusCode();
            if (code < 200 || code >= 300) {
                LOG.warnf("SpectoStream: upsert turnira %s vratio HTTP %d: %s", uuid, code, res.body());
                // 401/403 is always a bad/revoked specto.api-key, never anything
                // the organizer can fix by retrying - say so instead of the
                // generic failure, which sent people hunting the wrong problem.
                if (code == 401 || code == 403) {
                    throw new WebApplicationException(
                            "SpectoStream: API ključ nije valjan (odbijen od servisa).", 502);
                }
                throw new WebApplicationException("SpectoStream: povezivanje streama nije uspjelo.", 502);
            }
            JsonNode root = json.readTree(res.body());
            JsonNode stream = root.path("stream");
            String streamId = stream.path("id").asText(null);
            if (streamId == null || streamId.isBlank()) {
                LOG.warnf("SpectoStream: odgovor bez stream.id za turnir %s: %s", uuid, res.body());
                throw new WebApplicationException("SpectoStream: neispravan odgovor servisa.", 502);
            }
            JsonNode urls = stream.path("urls");
            // playback_url comes back RELATIVE ("/v1/streams/{id}/master.m3u8");
            // absolutise it so the app can hand it straight to the HLS player.
            String playback = root.path("playback_url").asText(null);
            if (playback == null || playback.isBlank()) {
                playback = urls.path("playback_hls").asText(null);
            }
            String playbackUrl = playback == null || playback.isBlank()
                    ? apiBase + "/v1/streams/" + streamId + "/master.m3u8"
                    : (playback.startsWith("http") ? playback : apiBase + playback);
            ProvisionInfo info = new ProvisionInfo(
                    streamId,
                    urls.path("obs_server").asText(null),
                    urls.path("obs_stream_key").asText(null),
                    playbackUrl,
                    root.path("embed_snippet").asText(null));
            t.setSpectoStreamId(streamId);
            return info;
        } catch (WebApplicationException wae) {
            throw wae;
        } catch (Exception e) {
            LOG.warnf(e, "SpectoStream: upsert turnira %s nije uspio", uuid);
            throw new WebApplicationException("SpectoStream: povezivanje streama nije uspjelo.", 502);
        }
    }

    /** Detach the tournament from its stream locally. No upstream call — the
     *  stream keeps living on SpectoStream; we just forget its id. */
    public void unlink(Tournaments t) {
        t.setSpectoStreamId(null);
    }

    /** Attach an EXISTING SpectoStream broadcast by its id, without provisioning
     *  a new one. For streams created directly on the platform. No upstream call
     *  — the id is simply recorded, after which the live hooks relay events to it
     *  and the player mounts. Blank clears the link. */
    public void linkExisting(Tournaments t, String streamId) {
        String id = streamId == null ? null : streamId.trim();
        t.setSpectoStreamId(id == null || id.isEmpty() ? null : id);
    }

    /* ── Admin connection settings (dashboard form) ─────────────────────────── */

    /** Effective connection settings for the admin form. The key is NEVER
     *  returned - only whether one is set and where it came from. */
    public record ConnectionInfo(String baseUrl, boolean apiKeySet, boolean apiKeyFromDb,
                                 String apiKeyHint, boolean enabled) {}

    /** Current effective connection, for the admin dashboard. Request thread. */
    public ConnectionInfo connectionInfo() {
        String dbKey = settings.get(KEY_API_KEY);
        boolean fromDb = dbKey != null && !dbKey.isBlank();
        String effective = key();
        // Last 4 chars only - enough to tell two keys apart, useless if leaked.
        String hint = effective.isBlank() ? null
                : (effective.length() <= 4 ? "…" : "…" + effective.substring(effective.length() - 4));
        return new ConnectionInfo(base(), !effective.isBlank(), fromDb, hint, enabled);
    }

    /**
     * Save the connection settings from the admin dashboard. A null/blank
     * {@code apiKey} LEAVES the stored key untouched (so the form can be saved
     * without re-typing the secret); pass {@code clearApiKey} to remove it and
     * fall back to {@code specto.api-key}. Takes effect immediately - no restart.
     */
    public void saveConnection(String newBaseUrl, String newApiKey, boolean clearApiKey) {
        String b = newBaseUrl == null ? null : newBaseUrl.trim().replaceAll("/+$", "");
        settings.put(KEY_BASE_URL, b == null || b.isEmpty() ? null : b);
        if (clearApiKey) {
            settings.put(KEY_API_KEY, null);
        } else if (newApiKey != null && !newApiKey.isBlank()) {
            settings.put(KEY_API_KEY, newApiKey.trim());
        }
    }

    /** Public HLS manifest for a stream - what the home-page banner plays. */
    public String embedUrl(String streamId) {
        return base() + "/v1/streams/" + streamId + "/master.m3u8";
    }

    /** Whether THIS tournament's stream is the one currently live on the home
     *  page, plus the values the admin card renders. */
    public record BroadcastStatus(String streamId, boolean broadcasting, String playbackUrl) {}

    /** Broadcast status for the admin card. Request thread (reads settings). */
    public BroadcastStatus broadcastStatus(Tournaments t) {
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return new BroadcastStatus(null, false, null);
        String state = settings.get("stream_banner_state");
        String bannerTournament = settings.get("stream_banner_tournament");
        boolean live = "STREAMING".equals(state)
                && t.getUuid() != null && t.getUuid().toString().equals(bannerTournament);
        return new BroadcastStatus(streamId, live, embedUrl(streamId));
    }

    /**
     * Verify the current settings against the platform: GETs the stream's public
     * state. Returns null when reachable, else a short Croatian reason. Used by
     * the dashboard's "connect" button so a bad key/url surfaces immediately
     * instead of silently swallowing every later event.
     */
    public String verify(String streamId) {
        String id = streamId == null ? null : streamId.trim();
        if (id == null || id.isEmpty()) return "Stream ID je prazan.";
        if (!isConfigured()) return "API ključ nije postavljen.";
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(base() + "/v1/streams/" + id + "/state"))
                    .timeout(Duration.ofSeconds(5))
                    .header("Accept", "application/json")
                    .GET()
                    .build();
            HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
            int code = res.statusCode();
            if (code == 404) return "Stream s tim ID-om ne postoji.";
            if (code < 200 || code >= 300) return "Servis je vratio HTTP " + code + ".";
            return null;
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            return "Provjera je prekinuta.";
        } catch (Exception e) {
            LOG.warnf(e, "SpectoStream: provjera streama %s nije uspjela", id);
            return "Servis nije dostupan na toj adresi.";
        }
    }

    // ── Fire-and-forget events ──────────────────────────────────────────────
    // Every method below: no-op when !isConfigured() or the tournament isn't
    // linked; read the stream id on the request thread; never throw; never block.

    /**
     * Start of a match — resets the scoreboard, so it MUST precede its period.
     * Carries each side's kit colours when the organizer set them on the Ekipe
     * tab, so the overlay draws the real jerseys instead of its defaults.
     *
     * <p>{@code bibTeam} (1, 2 or null) is the match's training-bib flag,
     * passed in as a PLAIN Integer rather than the {@link Matches} entity: the
     * whole payload is built here, on the request thread, and the dispatch
     * thread must never touch a managed entity (see the JPA off-thread rule in
     * the class docs). It only changes which jersey colour is sent — see
     * {@link #effectiveJersey}.
     */
    public void matchStart(Tournaments t, long matchId, Teams home, Teams away, Integer bibTeam) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        String homeName = home != null ? home.getName() : null;
        String awayName = away != null ? away.getName() : null;
        ObjectNode payload = json.createObjectNode();
        payload.put("home_name", fullName(homeName));
        payload.put("home_short", shortCode(homeName));
        payload.put("away_name", fullName(awayName));
        payload.put("away_short", shortCode(awayName));
        putColour(payload, "home_jersey", effectiveJersey(
                home != null ? home.getJerseyColor() : null, wearsBib(bibTeam, 1)));
        putColour(payload, "home_shorts", home != null ? home.getShortsColor() : null);
        putColour(payload, "away_jersey", effectiveJersey(
                away != null ? away.getJerseyColor() : null, wearsBib(bibTeam, 2)));
        putColour(payload, "away_shorts", away != null ? away.getShortsColor() : null);
        enqueue(streamId, "match_start", "m" + matchId + "-match_start",
                Instant.now().toString(), payload);
    }

    /**
     * Announce the next fixture on the overlay ("uskoro"): teams, their kit
     * colours and the kickoff. Sent as the payload of {@code match_end} and
     * {@code stream_start}, where every {@code next_*} field is optional - an
     * unknown side (a knockout slot still to be decided) is simply omitted and
     * the platform falls back to showing nothing.
     *
     * <p>Runs on the REQUEST thread only (its callers build the payload before
     * {@link #enqueue}), which is what makes reading the entity here legal —
     * the entity itself never travels to the dispatch thread.
     */
    private void putNextMatch(ObjectNode payload, Matches next) {
        if (next == null) return;
        Teams h = next.getTeam1();
        Teams a = next.getTeam2();
        Integer bibTeam = next.getBibTeam();
        if (h != null) {
            payload.put("next_home_name", fullName(h.getName()));
            payload.put("next_home_short", shortCode(h.getName()));
            putColour(payload, "next_home_jersey",
                    effectiveJersey(h.getJerseyColor(), wearsBib(bibTeam, 1)));
            putColour(payload, "next_home_shorts", h.getShortsColor());
        }
        if (a != null) {
            payload.put("next_away_name", fullName(a.getName()));
            payload.put("next_away_short", shortCode(a.getName()));
            putColour(payload, "next_away_jersey",
                    effectiveJersey(a.getJerseyColor(), wearsBib(bibTeam, 2)));
            putColour(payload, "next_away_shorts", a.getShortsColor());
        }
        if (next.getKickoffAt() != null) {
            payload.put("next_kickoff_at", next.getKickoffAt().toInstant().toString());
        }
    }

    /**
     * Fluorescent training-bib ("markirka") yellow. When two teams turn up in
     * similar kit one side pulls on bibs, and THAT is the colour the camera
     * sees for the rest of the match.
     *
     * <p>MUST stay a 6-digit {@code #RRGGBB} hex: {@link #putColour} silently
     * drops anything else, and a dropped colour would leave the old kit on air.
     */
    private static final String BIB_YELLOW = "#D9F225";

    /**
     * The jersey colour actually seen on the pitch: bib yellow when this side
     * wears training bibs this match, otherwise the team's own kit.
     *
     * <p>Single point of truth - every outbound jersey colour ({@code
     * match_start}, {@code match_end}/{@code stream_start} next-fixture,
     * the future kit update) routes through it, so no path can send a stale
     * colour. Returns bib yellow even when the team has no saved kit: the bibs
     * are on the players regardless of what the organizer typed in.
     */
    private static String effectiveJersey(String teamJersey, boolean wearsBib) {
        return wearsBib ? BIB_YELLOW : teamJersey;
    }

    /** True when {@code bibTeam} (1, 2 or null) names this side. Null-safe, so
     *  callers never unbox a null. */
    private static boolean wearsBib(Integer bibTeam, int side) {
        return bibTeam != null && bibTeam == side;
    }

    /**
     * Push the CURRENT kit colours to the overlay mid-stream:
     * {@code PUT /v1/streams/{id}/kits}. Called whenever the markirka flag
     * flips on a live match, so the picture follows without restarting the
     * broadcast.
     *
     * <p>Always sends the full set of four colours rather than a delta. That is
     * what makes removing the bibs work with no separate "restore" path: with
     * {@code bibTeam == null} the effective jersey is the team's own kit again,
     * so the same call puts the original colours back.
     *
     * <p>Everything arrives as plain strings/Integer, resolved by the caller on
     * the REQUEST thread (the JPA off-thread rule): no {@link Matches} or
     * {@link Teams} entity crosses into the dispatch thread.
     */
    public void kitUpdate(Tournaments t, long matchId,
                          String homeJersey, String homeShorts,
                          String awayJersey, String awayShorts,
                          Integer bibTeam) {
        if (!isConfigured()) return;
        String streamId = t == null ? null : t.getSpectoStreamId();
        if (streamId == null) return;

        // Always the FULL set, resolved through effectiveJersey. That is what
        // makes taking the bibs off work with no special case: bibTeam goes
        // back to null, effectiveJersey returns the team's own kit again, and
        // the same call pushes the original colours back to the overlay.
        ObjectNode body = json.createObjectNode();
        putColour(body, "home_jersey", effectiveJersey(homeJersey, wearsBib(bibTeam, 1)));
        putColour(body, "home_shorts", homeShorts);
        putColour(body, "away_jersey", effectiveJersey(awayJersey, wearsBib(bibTeam, 2)));
        putColour(body, "away_shorts", awayShorts);
        // The API rejects an empty body with 400. Nothing usable to send means
        // no team has a valid kit colour on file - there is nothing to update.
        if (body.isEmpty()) {
            LOG.debugf("SpectoStream: preskačem /kits za meč %d - nijedna boja nije #RRGGBB", matchId);
            return;
        }
        // Optional per the contract, but sendKits retries once on IOException/5xx
        // and a retry must not register as a second change. Fresh per user
        // action (millis), so a later toggle is never mistaken for a duplicate
        // of an earlier one. Stamped HERE, on the request thread.
        body.put("idempotency_key", "kits-" + matchId + "-" + System.currentTimeMillis());

        // base()/key() read the database - request thread only, exactly like
        // enqueue() does for events.
        final String apiBase = base();
        final String apiKeyNow = key();
        try {
            dispatch.execute(() -> sendKits(apiBase, apiKeyNow, streamId, body));
        } catch (RejectedExecutionException ree) {
            LOG.debugf("SpectoStream: dispatch odbijen za /kits (stream %s)", streamId);
        }
    }

    /** PUT the kit colours. Unlike every other call here this is NOT an event -
     *  it targets {@code /v1/streams/{id}/kits} directly - so it can't go
     *  through {@link #sendWithRetry}. Same retry policy though: one retry on
     *  IOException/5xx, give up on 4xx (a rejected colour won't fix itself).
     *  Runs on the dispatch thread, so it takes the resolved settings and never
     *  touches the database. */
    private void sendKits(String apiBase, String apiKeyNow, String streamId, ObjectNode body) {
        String bodyJson;
        try {
            bodyJson = json.writeValueAsString(body);
        } catch (Exception e) {
            LOG.warnf(e, "SpectoStream: serijalizacija /kits nije uspjela");
            return;
        }
        URI uri = URI.create(apiBase + "/v1/streams/" + streamId + "/kits");
        for (int attempt = 1; attempt <= 2; attempt++) {
            try {
                HttpRequest req = HttpRequest.newBuilder(uri)
                        .timeout(Duration.ofSeconds(5))
                        .header("Authorization", "Bearer " + apiKeyNow)
                        .header("Content-Type", "application/json")
                        .header("Accept", "application/json")
                        .PUT(HttpRequest.BodyPublishers.ofString(bodyJson, StandardCharsets.UTF_8))
                        .build();
                HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
                int code = res.statusCode();
                if (code >= 200 && code < 300) return;
                if (code >= 500 && attempt == 1) {
                    sleep(1000);
                    continue;
                }
                LOG.warnf("SpectoStream: /kits za stream %s vratio HTTP %d (pokušaj %d): %s",
                        streamId, code, attempt, res.body());
                return;
            } catch (IOException ioe) {
                if (attempt == 1) {
                    sleep(1000);
                    continue;
                }
                LOG.warnf(ioe, "SpectoStream: /kits za stream %s nije poslan (pokušaj %d)", streamId, attempt);
                return;
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    /** Write a kit colour only when it is a usable {@code #RRGGBB} - the API
     *  rejects anything else, and a rejected event would take the whole
     *  match_start (scoreboard reset) down with it. */
    private static void putColour(ObjectNode payload, String field, String colour) {
        if (colour == null) return;
        String c = colour.trim();
        if (!c.matches("^#[0-9a-fA-F]{6}$")) return;
        payload.put(field, c);
    }

    /** Start of a period — the overlay clock runs from occurred_at + clock_seconds. */
    public void periodStart(Tournaments t, long matchId, int period, long clockSeconds) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        ObjectNode payload = json.createObjectNode();
        payload.put("period", period);
        payload.put("clock_seconds", clockSeconds);
        // Epoch-second suffix: a resume repeats period_start with the same
        // matchId+period, so the timestamp keeps the retry idempotent without
        // colliding with the earlier start.
        Instant now = Instant.now();
        enqueue(streamId, "period_start",
                "m" + matchId + "-p" + period + "-start-" + now.getEpochSecond(),
                now.toString(), payload);
    }

    /** Stop the overlay period immediately. Used only as a fallback for
     *  free-running/zero-length halves where there is no exact boundary clock
     *  to sync before ending the period. Operator pause uses period_pause. */
    public void periodEnd(Tournaments t, long matchId) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        Instant now = Instant.now();
        enqueue(streamId, "period_end",
                "m" + matchId + "-period_end-" + now.getEpochSecond(),
                now.toString(), json.createObjectNode());
    }

    /** Pause the overlay clock at the precise click time. SpectoStream computes
     *  the frozen clock value from {@code occurredAt}, so the caller passes the
     *  timestamp captured by the frontend/backend pause path instead of letting
     *  network latency become the pause moment. */
    public void periodPause(Tournaments t, long matchId, Instant occurredAt) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        Instant at = occurredAt != null ? occurredAt : Instant.now();
        enqueue(streamId, "period_pause",
                "m" + matchId + "-period_pause-" + at.toEpochMilli(),
                at.toString(), json.createObjectNode());
    }

    /**
     * End period {@code period} with the overlay clock frozen at EXACTLY
     * {@code clockSeconds} (the cumulative match second, e.g. 600 at the end of
     * the 1st half of a 2x10, 1200 at the end of the 2nd).
     *
     * <p>Sends {@code clock_sync} then {@code period_end}, both stamped
     * {@code occurredAt}: the sync pins the value the platform freezes, the end
     * stops it there. Belt and braces on purpose — a stop that lands on 10:00
     * only when the request happens to arrive on time isn't a stop on 10:00.
     *
     * <p>The key is deterministic per match+period, so this is safe to send
     * twice: once from the automatic timer at the boundary and once from the
     * organizer's manual "završi poluvrijeme". Whichever lands first wins;
     * SpectoStream drops the other.
     */
    public void periodEndExact(Tournaments t, long matchId, int period, long clockSeconds, Instant occurredAt) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        cancelPeriodEnd(matchId);
        sendPeriodEndExact(base(), key(), streamId, matchId, period, clockSeconds, occurredAt);
    }

    /**
     * Arm the AUTOMATIC end of a period: at {@code endAt} the overlay clock is
     * frozen at {@code clockSeconds} without anyone touching the app. Replaces
     * any timer already armed for this match. A boundary already in the past
     * fires immediately.
     *
     * <p>Reads the stream id AND the connection settings on the CALLER's thread
     * (JPA off-thread rule) — the timer body only ever sees strings, so it never
     * touches the database from the clock thread.
     */
    public void schedulePeriodEnd(Tournaments t, long matchId, int period, long clockSeconds, Instant endAt) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        cancelPeriodEnd(matchId);
        final String apiBase = base();
        final String apiKeyNow = key();
        long delayMs = Math.max(0, Duration.between(Instant.now(), endAt).toMillis());
        try {
            // The task deliberately does NOT evict its own map entry. It can only
            // identify itself by match id, and a resume landing in the same
            // millisecond as the boundary would have it evict the REPLACEMENT
            // timer - which would then be un-cancellable and freeze the clock in
            // the middle of the next period. A spent future left in the map costs
            // nothing (it is overwritten on re-arm and dropped by every terminal
            // path: period end, match end, reset).
            ScheduledFuture<?> f = clockTimers.schedule(
                    () -> sendPeriodEndExact(apiBase, apiKeyNow, streamId, matchId, period, clockSeconds, endAt),
                    delayMs, TimeUnit.MILLISECONDS);
            periodEndTimers.put(matchId, f);
        } catch (RejectedExecutionException ree) {
            LOG.debugf("SpectoStream: auto-kraj perioda odbijen za utakmicu %d", matchId);
        }
    }

    /** Disarm a pending automatic period end (pause, early finish, reset).
     *  Safe to call for a match that never had one. */
    public void cancelPeriodEnd(long matchId) {
        ScheduledFuture<?> f = periodEndTimers.remove(matchId);
        if (f != null) f.cancel(false);
    }

    /** Runs on the CLOCK thread when armed by {@link #schedulePeriodEnd} - so it
     *  takes pre-resolved connection settings and never reads the database. */
    private void sendPeriodEndExact(String apiBase, String apiKeyNow, String streamId,
                                    long matchId, int period, long clockSeconds, Instant occurredAt) {
        String at = occurredAt.toString();
        ObjectNode sync = json.createObjectNode();
        sync.put("clock_seconds", clockSeconds);
        enqueueResolved(apiBase, apiKeyNow, streamId, "clock_sync",
                "m" + matchId + "-p" + period + "-end-sync", at, sync);
        enqueueResolved(apiBase, apiKeyNow, streamId, "period_end",
                "m" + matchId + "-p" + period + "-end", at, json.createObjectNode());
    }

    /** End of a match — clock freezes, status = ended. Also disarms the
     *  automatic period end: a match finished early must not get a period_end
     *  minutes later, when the half it never played out would have expired.
     *
     *  <p>{@code next} (optional) announces the following fixture on the
     *  overlay until the next {@code match_start}. */
    public void matchEnd(Tournaments t, long matchId, Matches next) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        cancelPeriodEnd(matchId);
        ObjectNode payload = json.createObjectNode();
        putNextMatch(payload, next);
        enqueue(streamId, "match_end", "m" + matchId + "-match_end",
                Instant.now().toString(), payload);
    }

    /**
     * Tell the platform the camera is broadcasting — clears the viewer's
     * "Uskoro" placeholder. Delivered without the broadcast delay, unlike every
     * other event. {@code next} (optional) announces the first fixture until a
     * {@code match_start} arrives. Fired when the admin starts the stream.
     */
    public void streamStart(Tournaments t, Matches next) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        ObjectNode payload = json.createObjectNode();
        putNextMatch(payload, next);
        // Random key: starting the camera again is a genuinely new event, not a
        // retry of the previous one (idempotency must not swallow it).
        enqueue(streamId, "stream_start", UUID.randomUUID().toString(),
                Instant.now().toString(), payload);
    }

    /** Tell the platform the camera stopped broadcasting. */
    public void streamEnd(Tournaments t) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        enqueue(streamId, "stream_end", UUID.randomUUID().toString(),
                Instant.now().toString(), json.createObjectNode());
    }

    /** Goal for {@code team} ("home"|"away"); {@code playerName} optional. */
    public void goal(Tournaments t, long eventId, String team, String playerName) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        ObjectNode payload = json.createObjectNode();
        payload.put("team", team);
        if (playerName != null && !playerName.isBlank()) {
            payload.put("player_name", playerName.trim());
        }
        enqueue(streamId, "goal", "evt" + eventId + "-goal",
                Instant.now().toString(), payload);
    }

    /** Cancel a goal for {@code team} ("home"|"away") — score −1, not below 0. */
    public void goalCancelled(Tournaments t, long eventId, String team) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        ObjectNode payload = json.createObjectNode();
        payload.put("team", team);
        enqueue(streamId, "goal_cancelled", "evt" + eventId + "-goal_cancelled",
                Instant.now().toString(), payload);
    }

    /**
     * IN-GAME penalty for {@code team} ("home"|"away"). {@code scored=true}
     * bumps the overlay score by one and renders like a goal; {@code false}
     * shows a red × chip with no score change. {@code playerName} optional -
     * omitted, the overlay shows just the ball/× chip.
     */
    public void penalty(Tournaments t, long eventId, String team, String playerName, boolean scored) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        ObjectNode payload = json.createObjectNode();
        payload.put("team", team);
        payload.put("scored", scored);
        if (playerName != null && !playerName.isBlank()) {
            payload.put("player_name", playerName.trim());
        }
        enqueue(streamId, "penalty", "evt" + eventId + "-penalty",
                Instant.now().toString(), payload);
    }

    /**
     * 2-minute suspension ("isključenje") for {@code team} ("home"|"away").
     * The platform expires the chip automatically 2 min after
     * {@code occurred_at}, so it is stamped at submit time - which is exactly
     * when the organizer recorded the suspension. {@code playerName} optional.
     */
    public void exclusion(Tournaments t, long eventId, String team, String playerName) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        ObjectNode payload = json.createObjectNode();
        payload.put("team", team);
        if (playerName != null && !playerName.isBlank()) {
            payload.put("player_name", playerName.trim());
        }
        enqueue(streamId, "exclusion", "evt" + eventId + "-exclusion",
                Instant.now().toString(), payload);
    }

    /** One row of the overlay's standings/podium popup, pre-resolved to plain
     *  values ON THE REQUEST THREAD (JPA off-thread rule) - the dispatch
     *  thread only ever sees these strings. Colours may be null/invalid; they
     *  are dropped rather than sent (the API rejects non-#RRGGBB). */
    public record StandingRow(String name, int rank, String jersey, String shorts) {}

    /**
     * Show the standings/podium popup on the overlay (~30 s; ranks 1-3 get
     * medals). {@code title} optional, clamped to the API's 40 chars; rows are
     * capped at the API's 12 and rows without a usable name are skipped.
     * Random idempotency key - every send is a genuinely new popup.
     */
    public void standings(Tournaments t, String title, List<StandingRow> rows) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;
        ObjectNode payload = buildStandingsPayload(title, rows);
        if (payload == null) return;

        enqueue(streamId, "standings", UUID.randomUUID().toString(),
                Instant.now().toString(), payload);
    }

    /** Builds the "standings" event body, or {@code null} when there's
     *  nothing usable to send (no rows, or every row lacks a name). */
    private ObjectNode buildStandingsPayload(String title, List<StandingRow> rows) {
        if (rows == null || rows.isEmpty()) return null;
        ObjectNode payload = json.createObjectNode();
        if (title != null && !title.isBlank()) {
            String tt = title.trim();
            payload.put("title", tt.length() > 40 ? tt.substring(0, 40) : tt);
        }
        var arr = payload.putArray("teams");
        int n = 0;
        for (StandingRow r : rows) {
            if (r == null || r.name() == null || r.name().isBlank()) continue;
            if (n++ >= 12) break; // API cap
            ObjectNode row = arr.addObject();
            row.put("name", fullName(r.name()));
            row.put("short", shortCode(r.name()));
            if (r.rank() >= 1 && r.rank() <= 99) row.put("rank", r.rank());
            putColour(row, "jersey", r.jersey());
            putColour(row, "shorts", r.shorts());
        }
        if (arr.isEmpty()) return null; // nothing usable - don't spend an event
        return payload;
    }

    /**
     * The tournament's final placement as overlay standings rows, ranks 1-3.
     * Winner + runner-up come from the FINISHED FINAL match (kit colours from
     * the team entities, the same source match_start uses); third place from
     * the FINISHED THIRD_PLACE match. Each falls back to the podium names the
     * organizer stored on the tournament (no colours there). Empty when no
     * winner can be determined - i.e. the final isn't decided. Must run on a
     * thread with a live persistence context (the request thread); only
     * plain strings leave this method.
     */
    public List<StandingRow> podiumRows(Tournaments t) {
        Matches fin = matchesRepo.find(
                "tournament = ?1 and stage = ?2", t, MatchStage.FINAL).firstResult();
        Teams winner = null;
        Teams second = null;
        if (fin != null && fin.getStatus() == MatchStatus.FINISHED && fin.getWinnerTeam() != null) {
            winner = fin.getWinnerTeam();
            second = Objects.equals(winner.getId(),
                    fin.getTeam1() != null ? fin.getTeam1().getId() : null)
                    ? fin.getTeam2() : fin.getTeam1();
        }
        String winnerName = winner != null ? winner.getName() : t.getWinnerName();
        if (winnerName == null || winnerName.isBlank()) return List.of();

        List<StandingRow> rows = new ArrayList<>(3);
        rows.add(standingRow(winnerName, 1, winner));

        String secondName = second != null ? second.getName() : t.getSecondPlaceName();
        if (secondName != null && !secondName.isBlank()) {
            rows.add(standingRow(secondName, 2, second));
        }

        Matches third = matchesRepo.find(
                "tournament = ?1 and stage = ?2", t, MatchStage.THIRD_PLACE).firstResult();
        Teams thirdTeam = third != null && third.getStatus() == MatchStatus.FINISHED
                ? third.getWinnerTeam() : null;
        String thirdName = thirdTeam != null ? thirdTeam.getName() : t.getThirdPlaceName();
        if (thirdName != null && !thirdName.isBlank()) {
            rows.add(standingRow(thirdName, 3, thirdTeam));
        }
        return rows;
    }

    /** One podium row; kit colours only when the team entity is known. */
    private static StandingRow standingRow(String name, int rank, Teams team) {
        return new StandingRow(
                name, rank,
                team != null ? team.getJerseyColor() : null,
                team != null ? team.getShortsColor() : null);
    }

    /**
     * Called right after a match transitions to FINISHED, from ANY stage
     * (group or knockout) - if no other match in the tournament is still
     * scheduled/live AND a podium is now decided, arms the automatic top-3
     * popup {@value #PODIUM_AUTO_DELAY_SECONDS}s out. A no-op otherwise
     * (mid-tournament, or the final wasn't decisive enough to name a winner).
     * Must run on the request thread - reads {@code matchesRepo} and
     * {@link #podiumRows}, both needing a live persistence context.
     */
    public void maybeSchedulePodiumAfterLastMatch(Tournaments t) {
        if (!isConfigured() || t == null) return;
        long remaining = matchesRepo.count(
                "tournament = ?1 and status <> ?2", t, MatchStatus.FINISHED);
        if (remaining > 0) return;
        List<StandingRow> podium = podiumRows(t);
        if (podium.isEmpty()) return;
        schedulePodiumStandings(t, podium, FINAL_STANDINGS_TITLE, PODIUM_AUTO_DELAY_SECONDS);
    }

    /**
     * Schedules the top-3 podium popup {@code delaySeconds} from now. Reads
     * the stream id AND the connection settings on the CALLER's thread (JPA
     * off-thread rule) - the clock thread only ever sees strings and the
     * already-resolved {@code rows}. Replaces any podium timer already
     * pending for this tournament (a match can only finish once, but this
     * keeps the method safe to call more than once defensively).
     */
    public void schedulePodiumStandings(Tournaments t, List<StandingRow> rows, String title, long delaySeconds) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;
        ObjectNode payload = buildStandingsPayload(title, rows);
        if (payload == null) return;

        Long tournamentId = t.getId();
        ScheduledFuture<?> prev = podiumTimers.remove(tournamentId);
        if (prev != null) prev.cancel(false);

        final String apiBase = base();
        final String apiKeyNow = key();
        try {
            ScheduledFuture<?> f = clockTimers.schedule(
                    () -> enqueueResolved(apiBase, apiKeyNow, streamId, "standings",
                            UUID.randomUUID().toString(), Instant.now().toString(), payload),
                    delaySeconds, TimeUnit.SECONDS);
            podiumTimers.put(tournamentId, f);
        } catch (RejectedExecutionException ree) {
            LOG.debugf("SpectoStream: odgođeni poredak odbijen za turnir %d", tournamentId);
        }
    }

    /** Card for {@code team} ("home"|"away"), {@code color} "yellow"|"red". */
    public void card(Tournaments t, long eventId, String team, String playerName, String color) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        ObjectNode payload = json.createObjectNode();
        payload.put("team", team);
        if (playerName != null && !playerName.isBlank()) {
            payload.put("player_name", playerName.trim());
        }
        payload.put("color", color);
        enqueue(streamId, "card", "evt" + eventId + "-card",
                Instant.now().toString(), payload);
    }

    /**
     * Push the squads onto the overlay: the platform pops a "sastavi" panel
     * (number + name per side) for ~10s and keeps them until {@code match_end}.
     *
     * <p>Each side is optional and sent ONLY when that team has players - an
     * omitted side leaves whatever the platform already had, so a half-filled
     * roster never wipes the other team's list. Players without a shirt number
     * are still sent (the number is the optional part, the name is not), capped
     * at the API's 40-per-side limit.
     */
    public void lineup(Tournaments t, List<Player> home, List<Player> away) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        ObjectNode payload = json.createObjectNode();
        boolean any = false;
        if (home != null && !home.isEmpty()) { putSquad(payload, "home", home); any = true; }
        if (away != null && !away.isEmpty()) { putSquad(payload, "away", away); any = true; }
        if (!any) return; // nothing to show - don't spend an event on it

        enqueue(streamId, "lineup", UUID.randomUUID().toString(),
                Instant.now().toString(), payload);
    }

    /** One side's squad as the API's {@code [{number, name}]} array. */
    private void putSquad(ObjectNode payload, String side, List<Player> players) {
        var arr = payload.putArray(side);
        int n = 0;
        for (Player p : players) {
            if (p.getName() == null || p.getName().isBlank()) continue;
            if (n++ >= 40) break; // API cap
            ObjectNode row = arr.addObject();
            Integer num = p.getNumber();
            // number is optional, 0-999; skip anything the API would reject.
            if (num != null && num >= 0 && num <= 999) row.put("number", num);
            row.put("name", fullName(p.getName()));
        }
    }

    /**
     * Start a standalone countdown on the overlay (e.g. "12 min do početka") -
     * independent of the match clock. Counts down from {@code seconds} and
     * freezes at 0:00; a new start replaces any running one. The API accepts
     * 1-3600 s, so the value is clamped rather than rejected.
     */
    public void timerStart(Tournaments t, int seconds) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        ObjectNode payload = json.createObjectNode();
        payload.put("duration_seconds", Math.max(1, Math.min(3600, seconds)));
        enqueue(streamId, "timer_start", UUID.randomUUID().toString(),
                Instant.now().toString(), payload);
    }

    /** Clear the countdown - the chip disappears. Safe when none is running. */
    public void timerStop(Tournaments t) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        enqueue(streamId, "timer_stop", UUID.randomUUID().toString(),
                Instant.now().toString(), json.createObjectNode());
    }

    /** Show/hide the match clock on the overlay. The clock keeps running on the
     *  platform; this only controls whether viewers see it. */
    public void clockVisibility(Tournaments t, long matchId, boolean visible) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        ObjectNode payload = json.createObjectNode();
        payload.put("visible", visible);
        enqueue(streamId, "clock_visibility",
                "m" + matchId + "-clock_visibility-" + UUID.randomUUID(),
                Instant.now().toString(), payload);
    }

    /** Free-text overlay message. Random idempotency key — every send is new. */
    public void customMessage(Tournaments t, String text) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        ObjectNode payload = json.createObjectNode();
        payload.put("text", text == null ? "" : text);
        enqueue(streamId, "custom_message", UUID.randomUUID().toString(),
                Instant.now().toString(), payload);
    }

    // ── Internals ───────────────────────────────────────────────────────────

    /** Hand one event to the dispatch thread. Never blocks; if the executor is
     *  shutting down the event is dropped rather than surfaced to the caller.
     *
     *  <p>The connection settings are resolved HERE - on the request thread -
     *  because {@link #base()}/{@link #key()} read the database and the dispatch
     *  thread has no persistence context. The resolved strings travel with the
     *  job, so a settings change mid-flight can't strand an in-queue event. */
    private void enqueue(String streamId, String type, String idempotencyKey,
                         String occurredAt, ObjectNode payload) {
        enqueueResolved(base(), key(), streamId, type, idempotencyKey, occurredAt, payload);
    }

    /** Queue an event whose connection settings the CALLER already resolved -
     *  used by the clock-thread timer, which must not read the database. */
    private void enqueueResolved(String apiBase, String apiKeyNow, String streamId, String type,
                                 String idempotencyKey, String occurredAt, ObjectNode payload) {
        try {
            dispatch.execute(() ->
                    sendWithRetry(apiBase, apiKeyNow, streamId, type, idempotencyKey, occurredAt, payload));
        } catch (RejectedExecutionException ree) {
            LOG.debugf("SpectoStream: dispatch odbijen za event '%s' (stream %s)", type, streamId);
        }
    }

    /** Build + POST the event, with one retry after ~1s on IOException/5xx, then
     *  give up with a WARN. Runs only on the dispatch thread - so it takes the
     *  base URL + key as parameters (resolved by the caller) and never touches
     *  the database itself. */
    private void sendWithRetry(String apiBase, String apiKeyNow,
                               String streamId, String type, String idempotencyKey,
                               String occurredAt, ObjectNode payload) {
        String bodyJson;
        try {
            ObjectNode event = json.createObjectNode();
            event.put("type", type);
            event.put("idempotency_key", idempotencyKey);
            event.put("occurred_at", occurredAt);
            event.set("payload", payload);
            bodyJson = json.writeValueAsString(event);
        } catch (Exception e) {
            LOG.warnf(e, "SpectoStream: serijalizacija eventa '%s' nije uspjela", type);
            return;
        }

        URI uri = URI.create(apiBase + "/v1/streams/" + streamId + "/events");

        for (int attempt = 1; attempt <= 2; attempt++) {
            try {
                HttpRequest req = HttpRequest.newBuilder(uri)
                        .timeout(Duration.ofSeconds(5))
                        .header("Authorization", "Bearer " + apiKeyNow)
                        .header("Content-Type", "application/json")
                        .header("Accept", "application/json")
                        .POST(HttpRequest.BodyPublishers.ofString(bodyJson, StandardCharsets.UTF_8))
                        .build();
                HttpResponse<String> res = http.send(req, HttpResponse.BodyHandlers.ofString());
                int code = res.statusCode();
                if (code >= 200 && code < 300) {
                    return;
                }
                // 5xx is worth one retry; 4xx won't fix itself, so give up now.
                if (code >= 500 && attempt == 1) {
                    sleep(1000);
                    continue;
                }
                LOG.warnf("SpectoStream: event '%s' za stream %s vratio HTTP %d (pokušaj %d): %s",
                        type, streamId, code, attempt, res.body());
                return;
            } catch (IOException ioe) {
                if (attempt == 1) {
                    sleep(1000);
                    continue;
                }
                LOG.warnf(ioe, "SpectoStream: event '%s' za stream %s nije poslan (pokušaj %d)",
                        type, streamId, attempt);
                return;
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                return;
            }
        }
    }

    private static void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /**
     * Scoreboard short code (1-6 chars) for a team name: uppercase, strip
     * diacritics (č→C, š→S, ž→Z, ć→C) via NFD + combining-mark removal, map
     * Croatian đ/Đ (which do not decompose) to D, keep only [A-Z0-9], take the
     * first 4. Falls back to "TIM" when nothing usable remains.
     */
    private static String shortCode(String name) {
        if (name == null || name.isBlank()) return "TIM";
        String s = name.trim().toUpperCase(Locale.ROOT);
        s = s.replace('Đ', 'D').replace('đ', 'D'); // Đ, đ
        s = Normalizer.normalize(s, Normalizer.Form.NFD).replaceAll("\\p{M}+", "");
        s = s.replaceAll("[^A-Z0-9]", "");
        if (s.isEmpty()) return "TIM";
        return s.length() > 4 ? s.substring(0, 4) : s;
    }

    /** Full team name clamped to the API's 1-100 char window; blank falls back
     *  to "TIM" so the required field is never empty. */
    private static String fullName(String name) {
        if (name == null || name.isBlank()) return "TIM";
        String s = name.trim();
        return s.length() > 100 ? s.substring(0, 100) : s;
    }
}
