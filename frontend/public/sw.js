/*
 * Minimal service worker — exists primarily so Chrome / Edge / Samsung Internet
 * fire the `beforeinstallprompt` event. Without an SW the browser refuses to
 * surface the install prompt at all, even with a perfect manifest.
 *
 * It also gives us a network-first fetch handler that:
 *   - Lets every request go to the network normally (no caching surprises).
 *   - Falls back to the cached app shell when the network is unreachable, so
 *     a tournament organizer at a venue with flaky Wi-Fi can still open the
 *     installed app and see *something* (just the SPA shell — API data still
 *     needs the network).
 *
 * Keeping the worker tiny is deliberate: a richer cache strategy is easy to
 * shoot yourself in the foot with (stale React bundle, stale API JSON).
 * Revisit when there's a concrete offline use case.
 */

const CACHE = "futsal-shell-v2";
const SHELL = ["/", "/index.html", "/manifest.webmanifest"];

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
    // Wipe any older shell caches.
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener("fetch", (event) => {
    const req = event.request;
    // Only intercept GETs — POST/PUT/PATCH/DELETE go straight to the network.
    if (req.method !== "GET") return;

    const url = new URL(req.url);
    // Leave cross-origin (Firebase, fonts, map tiles) and ALL /api traffic to
    // the browser. The SW only owns top-level navigations (so an offline /
    // mid-deploy launch still boots the SPA shell). Hashed assets under
    // /assets/* are already cached by the browser's HTTP cache (Caddy serves
    // them `immutable`), so the SW doesn't need to touch them — and not
    // touching them avoids the class of bug where a failed fetch + cache miss
    // resolved to `undefined` and crashed the worker with
    // "Failed to convert value to 'Response'".
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith("/api/")) return;
    if (req.mode !== "navigate") return;

    // SPA navigation: network-first, fall back to the cached shell, and as a
    // last resort a tiny offline page. respondWith ALWAYS resolves to a real
    // Response — never undefined — so a 502 / offline never breaks navigation.
    event.respondWith(
        (async () => {
            try {
                return await fetch(req);
            } catch (_) {
                const shell =
                    (await caches.match("/index.html")) ||
                    (await caches.match("/"));
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
        })()
    );
});

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
    // Resolve to an absolute URL — clients.navigate and url comparison
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

            // Already at the target URL — nothing more to do.
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
            // client.navigate(targetAbs) instead — that forces the URL
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

        // No existing window — open one at the target URL. iOS PWAs
        // honour this on a notificationclick gesture.
        await self.clients.openWindow(targetUrl);
    })());
});
