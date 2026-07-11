import { http } from "./http"

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

export type StreamBanner = {
    url: string | null
    live: boolean
    /** Tournament this stream is linked to (immutable uuid), or null. */
    tournamentUuid: string | null
    /** Linked tournament's display name (for the admin card), or null. */
    tournamentName: string | null
}

/** Current banner state. Silent - polled in the background from the home page. */
export async function fetchStreamBanner(): Promise<StreamBanner> {
    const { data } = await http.get<StreamBanner>(
        "/stream-banner",
        { silent: true } as any,
    )
    return data ?? { url: null, live: false, tournamentUuid: null, tournamentName: null }
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

/** Admin: set the camera url, the "camera is on" switch, and the linked
 *  tournament (uuid/slug; null = not linked). */
export async function setStreamBanner(
    url: string | null,
    live: boolean,
    tournamentUuid: string | null,
): Promise<StreamBanner> {
    const { data } = await http.put<StreamBanner>(
        "/stream-banner",
        { url, live, tournamentUuid },
        {
            successMessage: live
                ? "Prijenos uživo je pokrenut."
                : url
                    ? "Prijenos je zaustavljen."
                    : "Prijenos je uklonjen.",
        } as any,
    )
    return data
}
