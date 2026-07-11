import { http } from "./http"

/* ──────────────────────────────────────────────────────────────────────────
   Live-viewer presence for the home stream.

   A Veo/HLS court camera exposes no viewer count, so we count viewers on OUR
   site: every open stream tab heartbeats with a random per-tab session id and
   the server reports how many sessions are currently active. Silent + never
   cached (polled while the stream is on).
   ────────────────────────────────────────────────────────────────────────── */

/** Send a heartbeat for this session and get the current live-viewer count. */
export async function pingStreamPresence(sessionId: string): Promise<number> {
    const { data } = await http.post<{ count: number }>(
        "/stream-presence/ping",
        { sessionId },
        { silent: true } as any,
    )
    return data?.count ?? 0
}
