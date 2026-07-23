package hr.mrodek.apps.futsal_turniri.integrations.spectostream;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
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
import java.util.Locale;
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

    /** True when streaming is enabled AND an API key is present. Off = every
     *  event send is a silent no-op and {@link #provisionTournament} refuses. */
    public boolean isConfigured() {
        return enabled && apiKey.filter(k -> !k.isBlank()).isPresent();
    }

    /** The key to send, or "" when unset - only ever reached behind
     *  {@link #isConfigured()}, so an empty value can't hit the wire. */
    private String key() {
        return apiKey.orElse("");
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

        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + "/v1/tournaments/" + uuid))
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
                    ? baseUrl + "/v1/streams/" + streamId + "/master.m3u8"
                    : (playback.startsWith("http") ? playback : baseUrl + playback);
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

    // ── Fire-and-forget events ──────────────────────────────────────────────
    // Every method below: no-op when !isConfigured() or the tournament isn't
    // linked; read the stream id on the request thread; never throw; never block.

    /** Start of a match — resets the scoreboard, so it MUST precede its period. */
    public void matchStart(Tournaments t, long matchId, String homeName, String awayName) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        ObjectNode payload = json.createObjectNode();
        payload.put("home_name", fullName(homeName));
        payload.put("home_short", shortCode(homeName));
        payload.put("away_name", fullName(awayName));
        payload.put("away_short", shortCode(awayName));
        enqueue(streamId, "match_start", "m" + matchId + "-match_start",
                Instant.now().toString(), payload);
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

    /** Freeze the overlay clock right where it is, now — the half-time-style
     *  break used for an operator PAUSE. Distinct idempotency key per call, so
     *  a pause never collides with the period's real end. */
    public void periodEnd(Tournaments t, long matchId) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        Instant now = Instant.now();
        enqueue(streamId, "period_end",
                "m" + matchId + "-period_end-" + now.getEpochSecond(),
                now.toString(), json.createObjectNode());
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
        sendPeriodEndExact(streamId, matchId, period, clockSeconds, occurredAt);
    }

    /**
     * Arm the AUTOMATIC end of a period: at {@code endAt} the overlay clock is
     * frozen at {@code clockSeconds} without anyone touching the app. Replaces
     * any timer already armed for this match. A boundary already in the past
     * fires immediately.
     *
     * <p>Reads the stream id on the CALLER's thread (JPA off-thread rule) —
     * the timer body only ever sees strings.
     */
    public void schedulePeriodEnd(Tournaments t, long matchId, int period, long clockSeconds, Instant endAt) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        cancelPeriodEnd(matchId);
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
                    () -> sendPeriodEndExact(streamId, matchId, period, clockSeconds, endAt),
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

    private void sendPeriodEndExact(String streamId, long matchId, int period, long clockSeconds, Instant occurredAt) {
        String at = occurredAt.toString();
        ObjectNode sync = json.createObjectNode();
        sync.put("clock_seconds", clockSeconds);
        enqueue(streamId, "clock_sync", "m" + matchId + "-p" + period + "-end-sync", at, sync);
        enqueue(streamId, "period_end", "m" + matchId + "-p" + period + "-end", at, json.createObjectNode());
    }

    /** End of a match — clock freezes, status = ended. Also disarms the
     *  automatic period end: a match finished early must not get a period_end
     *  minutes later, when the half it never played out would have expired. */
    public void matchEnd(Tournaments t, long matchId) {
        if (!isConfigured()) return;
        String streamId = t.getSpectoStreamId();
        if (streamId == null) return;

        cancelPeriodEnd(matchId);
        enqueue(streamId, "match_end", "m" + matchId + "-match_end",
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
     *  shutting down the event is dropped rather than surfaced to the caller. */
    private void enqueue(String streamId, String type, String idempotencyKey,
                         String occurredAt, ObjectNode payload) {
        try {
            dispatch.execute(() -> sendWithRetry(streamId, type, idempotencyKey, occurredAt, payload));
        } catch (RejectedExecutionException ree) {
            LOG.debugf("SpectoStream: dispatch odbijen za event '%s' (stream %s)", type, streamId);
        }
    }

    /** Build + POST the event, with one retry after ~1s on IOException/5xx, then
     *  give up with a WARN. Runs only on the dispatch thread. */
    private void sendWithRetry(String streamId, String type, String idempotencyKey,
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

        URI uri = URI.create(baseUrl + "/v1/streams/" + streamId + "/events");

        for (int attempt = 1; attempt <= 2; attempt++) {
            try {
                HttpRequest req = HttpRequest.newBuilder(uri)
                        .timeout(Duration.ofSeconds(5))
                        .header("Authorization", "Bearer " + key())
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
