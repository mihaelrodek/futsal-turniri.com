package hr.mrodek.apps.futsal_turniri.services;

import jakarta.enterprise.context.ApplicationScoped;

import java.util.concurrent.ConcurrentHashMap;

/**
 * Best-effort "who is watching the stream right now" counter.
 *
 * <p>Each browser tab that has the live stream open sends a heartbeat every few
 * seconds carrying a random, per-tab session id. We remember the last time we
 * saw each id; the live count is simply how many ids we've heard from inside a
 * short sliding window (a tab that stops heartbeating - closed, hidden,
 * navigated away - drops out on its own once the window passes).
 *
 * <p>State is intentionally in-memory and ephemeral: it is a vanity metric, so
 * it needn't survive a restart (it rebuilds within one heartbeat window) and
 * needn't be exact. NOTE: this assumes a single backend instance - horizontal
 * scaling would need a shared store (e.g. Redis) to sum across instances.
 */
@ApplicationScoped
public class StreamPresenceService {

    /** How long a session counts as "watching" after its last heartbeat. Must
     *  be comfortably longer than the client's heartbeat interval (~20s). */
    private static final long WINDOW_MS = 45_000;

    /** sessionId → last-seen epoch millis. */
    private final ConcurrentHashMap<String, Long> lastSeen = new ConcurrentHashMap<>();

    /** Record a heartbeat for {@code sessionId} and return the current count. */
    public int heartbeat(String sessionId) {
        long now = System.currentTimeMillis();
        if (sessionId != null && !sessionId.isBlank()) {
            String id = sessionId.length() > 64 ? sessionId.substring(0, 64) : sessionId;
            lastSeen.put(id, now);
        }
        return purgeAndCount(now);
    }

    /** Current live-viewer count (read-only; also purges stale entries). */
    public int count() {
        return purgeAndCount(System.currentTimeMillis());
    }

    private int purgeAndCount(long now) {
        long cutoff = now - WINDOW_MS;
        // Weakly-consistent view; safe to mutate concurrently with heartbeats.
        lastSeen.values().removeIf(seen -> seen < cutoff);
        return lastSeen.size();
    }
}
