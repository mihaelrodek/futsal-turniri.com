import { http } from "./http"
import type { AdMediaType } from "./streamAds"

/* ──────────────────────────────────────────────────────────────────────────
   Site-wide live-stream banner (Veo court camera on the HOME page).

   GET is public and served with Cache-Control: no-store - the banner must
   flip on/off the moment the admin changes it, so neither the browser HTTP
   cache nor the service worker may hold a copy (the SW is network-first for
   /api reads; no-store keeps the HTTP cache out of the loop too). The home
   page additionally polls this while open.

   The banner may be LINKED to a tournament (tournamentUuid): when it is, the
   home page shows that tournament's currently-live match + its group table
   under the video. Unlinked, it falls back to the globally-featured match.

   PUT is admin-only (dashboard).
   ────────────────────────────────────────────────────────────────────── */

/** The banner's mode. STREAMING plays the video; PAUSED shows a "paused"
 *  placeholder; ADS shows the sponsor banner; OFF shows the normal promo hero.
 *  The url is kept across all of them (OFF no longer deletes it). */
export type StreamState = "STREAMING" | "PAUSED" | "ADS" | "OFF"

export type StreamBanner = {
    url: string | null
    /** Convenience derived flag (state === "STREAMING"). */
    live: boolean
    /** The current mode - drives what the home hero slot renders. */
    state: StreamState
    /** Tournament this stream is linked to (immutable uuid), or null. */
    tournamentUuid: string | null
    /** Linked tournament's display name (for the admin card), or null. */
    tournamentName: string | null
    /** Active ad (ADS mode): its id, media proxy url + IMAGE|VIDEO, or null. */
    adId: number | null
    adUrl: string | null
    adMediaType: AdMediaType | null
    /** Overlay currently shown OVER the video (any state), or null when hidden. */
    overlayId: number | null
    overlayUrl: string | null
    overlayMediaType: AdMediaType | null
}

/** Current banner state. Silent - polled in the background from the home page. */
export async function fetchStreamBanner(): Promise<StreamBanner> {
    const { data } = await http.get<StreamBanner>(
        "/stream-banner",
        { silent: true } as any,
    )
    return (
        data ?? {
            url: null,
            live: false,
            state: "OFF",
            tournamentUuid: null,
            tournamentName: null,
            adId: null,
            adUrl: null,
            adMediaType: null,
            overlayId: null,
            overlayUrl: null,
            overlayMediaType: null,
        }
    )
}

/* ── Synchronous first-paint hint ──────────────────────────────────────────
   The banner GET is no-store + polled, so on a fresh load `streamBanner` state
   starts null → the home page briefly shows the promo hero before the fetch
   resolves, THEN swaps to the stream. That flash is jarring.

   react-query's persisted cache can't help here: PersistQueryClientProvider
   restores ASYNCHRONOUSLY, so it isn't available in the first render's
   useState initializer. So we keep our own tiny snapshot in localStorage and
   read it SYNCHRONOUSLY on first paint - the home page then renders the right
   hero immediately and the background poll confirms/updates it a beat later.

   A timestamp + max-age guard stops a long-stale snapshot from resurrecting a
   stream that's since been turned off (it just falls back to the promo hero
   until the poll says otherwise). */
const HINT_KEY = "futsal-stream-hint"
const HINT_MAX_AGE_MS = 60 * 60_000 // 1h - matches the react-query persist maxAge

/** Last-known banner state, read synchronously for the first paint. Returns
 *  null when there's no (fresh) snapshot. */
export function readStreamBannerHint(): StreamBanner | null {
    try {
        const raw = localStorage.getItem(HINT_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw) as { at?: number; banner?: StreamBanner }
        if (!parsed || typeof parsed.at !== "number") return null
        if (Date.now() - parsed.at > HINT_MAX_AGE_MS) return null
        return parsed.banner ?? null
    } catch {
        return null
    }
}

/** Persist the latest banner state for the next load's first paint. */
export function writeStreamBannerHint(banner: StreamBanner): void {
    try {
        localStorage.setItem(HINT_KEY, JSON.stringify({ at: Date.now(), banner }))
    } catch {
        /* quota / private mode - the hint is best-effort */
    }
}

/** Admin: set the camera url, the mode (state), and the linked tournament
 *  (uuid/slug; null = not linked). The url is kept regardless of state. */
export async function setStreamBanner(
    url: string | null,
    state: StreamState,
    tournamentUuid: string | null,
    adId: number | null = null,
    overlayId: number | null = null,
): Promise<StreamBanner> {
    const { data } = await http.put<StreamBanner>(
        "/stream-banner",
        { url, state, tournamentUuid, adId, overlayId },
        {
            successMessage:
                state === "STREAMING" ? "Prijenos uživo je pokrenut."
                    : state === "PAUSED" ? "Prijenos je pauziran."
                        : state === "ADS" ? "Uključene su reklame."
                            : "Prijenos je ugašen.",
        } as any,
    )
    return data
}
