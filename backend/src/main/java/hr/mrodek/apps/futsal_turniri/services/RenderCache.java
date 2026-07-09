package hr.mrodek.apps.futsal_turniri.services;

import jakarta.enterprise.context.ApplicationScoped;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

/**
 * In-memory cache + concurrency limiter for the server-rendered PNGs
 * (share-image, QR, default OG). Those endpoints are anonymous and each render
 * allocates a multi-MB {@code BufferedImage} + PNG-encodes it - a CPU/heap
 * amplification vector (a tiny request forces expensive work).
 *
 * <ul>
 *   <li><b>Cache</b>: keyed by a content-stable string (tournament id +
 *       updatedAt, or the QR URL, or a constant for the static OG card) so a
 *       viral share / crawler storm re-serves cached bytes for ~free. A bounded
 *       LRU keeps memory in check.</li>
 *   <li><b>Semaphore</b>: caps how many renders run at once so a cold burst of
 *       distinct keys queues instead of pinning every CPU core. Fails OPEN on
 *       timeout (renders without a slot) rather than 503-ing a legitimate
 *       social crawler - the per-IP rate limit at the edge already bounds how
 *       many cache-misses can arrive.</li>
 * </ul>
 */
@ApplicationScoped
public class RenderCache {

    private static final int MAX_ENTRIES = 300;
    private static final int MAX_CONCURRENT_RENDERS = 3;
    private static final long ACQUIRE_TIMEOUT_MS = 4000;

    private final Semaphore renderSlots = new Semaphore(MAX_CONCURRENT_RENDERS);

    /** Access-ordered LRU; evicts the least-recently-used entry past the cap. */
    private final Map<String, byte[]> cache = Collections.synchronizedMap(
            new LinkedHashMap<>(64, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(Map.Entry<String, byte[]> eldest) {
                    return size() > MAX_ENTRIES;
                }
            });

    /**
     * Return the cached bytes for {@code key}, or render via {@code renderer}
     * (under the concurrency cap) and cache the result. Returns whatever the
     * renderer returns (may be null); the renderer may throw - the caller maps
     * the exception to a 500.
     */
    public byte[] get(String key, Supplier<byte[]> renderer) {
        byte[] hit = cache.get(key);
        if (hit != null) return hit;

        boolean acquired = false;
        try {
            acquired = renderSlots.tryAcquire(ACQUIRE_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            // Re-check after (maybe) waiting - another thread may have rendered
            // this exact key while we blocked on the semaphore.
            byte[] again = cache.get(key);
            if (again != null) return again;
            return renderAndStore(key, renderer);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return renderAndStore(key, renderer);
        } finally {
            if (acquired) renderSlots.release();
        }
    }

    private byte[] renderAndStore(String key, Supplier<byte[]> renderer) {
        byte[] bytes = renderer.get();
        if (bytes != null) cache.put(key, bytes);
        return bytes;
    }
}
