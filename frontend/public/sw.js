/*
 * Service worker - exists primarily so Chrome / Edge / Samsung Internet fire
 * the `beforeinstallprompt` event (no SW → the browser refuses the install
 * prompt even with a perfect manifest), and to give the installed PWA a useful
 * offline story for a tournament organizer at a venue with flaky Wi-Fi:
 *
 *   - SPA navigations: network-first, fall back to the cached app shell so a
 *     cold launch offline still boots index.html instead of the browser's
 *     "no internet" page.
 *   - API reads (GET /api/*): network-first, fall back to the LAST cached
 *     snapshot. Online it's always fresh (and the snapshot is refreshed); the
 *     cache is served ONLY when the network is unreachable. That lets the live
 *     console open - and survive a reload - offline, pairing with the
 *     localStorage write queues (goals/fouls) so scoring keeps working with no
 *     signal and syncs on reconnect. Network-first is the key: there's no
 *     stale-JSON surprise while connected.
 *   - Writes (POST/PUT/PATCH/DELETE): never touched - straight to the network.
 *
 * Note: authenticated GET responses land in the API cache. That's fine on the
 * single-user device this PWA is installed on, and only ever served offline.
 */

const CACHE = "futsal-shell-v2";
const API_CACHE = "futsal-api-v1";
const SHELL = ["/", "/index.html", "/manifest.webmanifest"];
// Cap the runtime API cache so a long-running install can't grow it unbounded.
const API_CACHE_LIMIT = 80;

self.addEventListener("install", (event) => {
    // Pre-cache the SPA shell so a cold offline launch from the home-screen
    // icon shows index.html instead of the browser's "no internet" page.
    event.waitUntil(
        caches.open(CACHE).then((cache) => cache.addAll(SHELL)).catch(() => {})
    );
    // Skip waiting so a fresh deploy activates on the next page load instead
    // of waiting for every tab to close.
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    // Wipe any caches that aren't in the current whitelist (old shell versions);
    // keep the shell AND the runtime API-snapshot cache.
    const keep = new Set([CACHE, API_CACHE]);
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    const req = event.request;
    // Only intercept GETs - POST/PUT/PATCH/DELETE go straight to the network.
    if (req.method !== "GET") return;

    const url = new URL(req.url);
    // Leave cross-origin (Firebase, fonts, map tiles) to the browser. Hashed
    // assets under /assets/* are already cached by the browser's HTTP cache
    // (Caddy serves them `immutable`), so the SW doesn't need to touch them -
    // and not touching them avoids the class of bug where a failed fetch +
    // cache miss resolved to `undefined` and crashed the worker with
    // "Failed to convert value to 'Response'".
    if (url.origin !== self.location.origin) return;

    // API reads: network-first with a last-snapshot fallback (see file header).
    if (url.pathname.startsWith("/api/")) {
        event.respondWith(apiNetworkFirst(req));
        return;
    }

    // Everything else the SW owns is a top-level SPA navigation.
    if (req.mode !== "navigate") return;
    event.respondWith(navigationNetworkFirst(req));
});

// Network-first for GET /api/*: serve fresh when online (and refresh the
// snapshot), fall back to the last cached snapshot offline. respondWith ALWAYS
// resolves to a real Response - never undefined - so offline never crashes the
// worker.
async function apiNetworkFirst(req) {
    let cache = null;
    try { cache = await caches.open(API_CACHE); } catch (_) { /* private mode */ }
    try {
        const resp = await fetch(req);
        // Cache only clean, complete, same-origin 200s - never errors, 206
        // partials or opaque responses (those would poison the snapshot).
        if (cache && resp && resp.status === 200 && resp.type === "basic") {
            const copy = resp.clone();
            cache.put(req, copy)
                .then(() => trimCache(cache, API_CACHE_LIMIT))
                .catch(() => {});
        }
        return resp;
    } catch (_) {
        if (cache) {
            const hit = await cache.match(req);
            if (hit) return hit;
        }
        // No snapshot yet - reply in a shape axios rejects (503) so the app's
        // offline write-queues keep buffering instead of rendering bad data.
        return new Response(
            JSON.stringify({ offline: true }),
            {
                status: 503,
                headers: { "Content-Type": "application/json; charset=utf-8" },
            }
        );
    }
}

// SPA navigation: network-first, fall back to the cached shell, and as a last
// resort a tiny offline page.
async function navigationNetworkFirst(req) {
    try {
        return await fetch(req);
    } catch (_) {
        const shell =
            (await caches.match("/index.html")) || (await caches.match("/"));
        if (shell) return shell;
        return new Response(
            "<!doctype html><meta charset='utf-8'><title>Offline</title>" +
                "<body style='font-family:sans-serif;padding:2rem'>" +
                "<p>Trenutno nema veze sa serverom. Pokušaj ponovno za koji trenutak.</p>",
            {
                status: 503,
                headers: { "Content-Type": "text/html; charset=utf-8" },
            }
        );
    }
}

// Keep the runtime API cache bounded. Cache.keys() preserves insertion order,
// so the oldest snapshots are at the front - evict from there when over the cap.
async function trimCache(cache, limit) {
    try {
        const keys = await cache.keys();
        const over = keys.length - limit;
        for (let i = 0; i < over; i++) await cache.delete(keys[i]);
    } catch (_) {
        /* best-effort - a full cache just stops growing */
    }
}

// ─────────────────────────────────────────────────────────────────────
//  Web Push: receive + click handling
// ─────────────────────────────────────────────────────────────────────
// `push` fires whenever the browser's push service delivers a message
// signed with our VAPID key. The payload is JSON written by the backend
// (PushService.PushPayload): { title, body, url?, icon?, tag? }.
//
// `notificationclick` fires when the user taps the notification. We focus
// an existing open tab on the target URL if one exists, otherwise we open
// a new tab. This is the standard PWA re-engagement pattern.

self.addEventListener("push", (event) => {
    if (!event.data) return;
    let data = {};
    try {
        data = event.data.json();
    } catch {
        // Backend always sends JSON, but fall back to plain text just in
        // case a debug curl came through.
        data = { title: "Futsal turniri", body: event.data.text() };
    }
    const title = data.title || "Futsal turniri";
    const options = {
        body: data.body || "",
        icon: data.icon || "/futsal-turniri-symbol.png",
        badge: "/futsal-turniri-symbol.png",
        // `tag` groups notifications so a new one with the same tag replaces
        // the previous (avoids stacking 5 "approved" toasts if the organizer
        // batch-approves a queue). Most flows leave it undefined.
        tag: data.tag,
        data: { url: data.url || "/" },
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const targetUrl = (event.notification.data && event.notification.data.url) || "/";
    // Resolve to an absolute URL - clients.navigate and url comparison
    // both want the full form.
    //
    // Origin guard: the push payload's `url` is server-controlled today,
    // but a compromised backend OR an unsigned push (some browsers don't
    // validate VAPID strictly) could attempt a `javascript:` URI or a
    // cross-origin URL to hijack the SW. Reject anything that doesn't
    // resolve to OUR origin before any client.navigate / openWindow /
    // postMessage call below.
    let targetAbs;
    try {
        const resolved = new URL(targetUrl, self.location.origin);
        if (resolved.origin !== self.location.origin) {
            targetAbs = self.location.origin + "/";
        } else {
            targetAbs = resolved.href;
        }
    } catch (_) {
        targetAbs = self.location.origin + "/";
    }

    event.waitUntil((async () => {
        const all = await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true,
        });

        for (const client of all) {
            if (!client.url) continue;
            let clientUrl;
            try {
                clientUrl = new URL(client.url);
            } catch (_) {
                continue;
            }
            if (clientUrl.origin !== self.location.origin) continue;

            // Bring the existing PWA window to focus regardless of path.
            try { await client.focus(); } catch (_) {}

            // Already at the target URL - nothing more to do.
            if (client.url === targetAbs) return;

            // Same path, just different query (e.g. /tournaments/X →
            // /tournaments/X?bill=42): let the SPA handle it via
            // react-router so we keep app state. PushBootstrap listens
            // for "futsal:navigate" and calls navigate(url) on receipt.
            if (clientUrl.pathname === new URL(targetAbs).pathname) {
                client.postMessage({ type: "futsal:navigate", url: targetUrl });
                return;
            }

            // Different path. On iOS cold-start the window is freshly
            // launched at start_url and React isn't mounted yet, so a
            // postMessage would race with the listener wiring. Use
            // client.navigate(targetAbs) instead - that forces the URL
            // to update before React mounts, so our useState initializer
            // sees the deep-link params on first render. Falls back to
            // postMessage if navigate() isn't supported.
            if ("navigate" in client) {
                try {
                    await client.navigate(targetAbs);
                    return;
                } catch (_) {
                    // Fall through to postMessage.
                }
            }
            client.postMessage({ type: "futsal:navigate", url: targetUrl });
            return;
        }

        // No existing window - open one at the target URL. iOS PWAs
        // honour this on a notificationclick gesture.
        await self.clients.openWindow(targetUrl);
    })());
});
