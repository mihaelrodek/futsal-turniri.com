import { http } from "./http"

/* ──────────────────────────────────────────────────────────────────────────
   SpectoStream integration - per-tournament live-stream overlay.

   Lets an organizer link a tournament to the SpectoStream platform:
   SpectoStream provisions an OBS camera source (server + stream key) and an
   embeddable overlay snippet; in return, the zapisnik (match recorder) pushes
   live score/clock events to the stream automatically, and the organizer can
   push a short text message onto the overlay.

   GET tells us whether the integration is enabled server-side at all
   (`configured` - no API key on the server means the whole feature is
   hidden) and whether THIS tournament is linked (`linked` + its `streamId`).

   POST /provision is idempotent - calling it again (e.g. "Prikaži OBS
   podatke" on an already-linked tournament) just re-returns the same OBS
   server/key/embed snippet, it doesn't re-link or rotate anything. Returns
   503 when the server has no API key configured.

   All endpoints require the caller to be the tournament's organizer -
   enforced server-side; the card that calls this module is only rendered
   for organizers, so no extra client-side check is needed here.
   ────────────────────────────────────────────────────────────────────── */

/** Per-tournament SpectoStream link status. */
export type SpectoStatus = {
    /** Whether the integration is enabled server-side (API key configured).
     *  When false, provisioning/linking isn't reachable at all. */
    configured: boolean
    /** Whether THIS tournament is currently linked to a SpectoStream stream. */
    linked: boolean
    /** The linked stream's id, or null when not linked. */
    streamId: string | null
}

/** The SpectoStream platform's public origin. Shared so the embedded player,
 *  the m3u8 link and the broadcast-delay lookup can't drift apart. */
export const SPECTO_BASE_URL = "https://stream.safeflow.hr"

/** Public per-tournament view: only the stream id, which is all a viewer needs
 *  to mount the platform player. `null` when the tournament isn't linked. */
export type SpectoPublic = { streamId: string | null }

/** OBS camera source + overlay embed data returned by provisioning. */
export type SpectoProvisionInfo = {
    streamId: string
    /** OBS "Server" field for the camera source, or null if not supplied. */
    obsServer: string | null
    /** OBS "Stream Key" field - sensitive, mask it in the UI by default. */
    obsStreamKey: string | null
    /** Public HLS manifest (master.m3u8). This is what the app's own player
     *  (stream banner / hero) consumes - paste it there to show the broadcast
     *  inside futsal-turniri.com. */
    playbackUrl: string | null
    /** Ready-to-embed HTML snippet - only needed for FOREIGN websites; inside
     *  this app use `playbackUrl` instead. */
    embedSnippet: string | null
}

/** Current SpectoStream link status for a tournament. */
export async function fetchSpectoStatus(uuid: string): Promise<SpectoStatus> {
    const { data } = await http.get<SpectoStatus>(`/tournaments/${uuid}/specto`)
    return data
}

/** PUBLIC (no auth) - the tournament's stream id for viewers. Silent: it is
 *  polled/prefetched on public pages, where a failure must never toast. */
export async function fetchSpectoPublic(uuid: string): Promise<SpectoPublic> {
    const { data } = await http.get<SpectoPublic>(
        `/tournaments/${uuid}/specto/public`,
        { silent: true } as any,
    )
    return data ?? { streamId: null }
}

/**
 * Link the tournament to SpectoStream, or - if already linked - just
 * re-fetch its OBS server/key/embed snippet. Idempotent, so it's safe to
 * call again purely to reveal the data (e.g. a "Prikaži OBS podatke" button).
 */
export async function provisionSpecto(uuid: string): Promise<SpectoProvisionInfo> {
    const { data } = await http.post<SpectoProvisionInfo>(
        `/tournaments/${uuid}/specto/provision`,
        undefined,
        { successMessage: "OBS podaci su spremni." } as any,
    )
    return data
}

/** Unlink the tournament from SpectoStream - events stop being sent and the
 *  previously-issued OBS credentials stop working. */
export async function unlinkSpecto(uuid: string): Promise<void> {
    await http.delete(`/tournaments/${uuid}/specto`, {
        successMessage: "Stream je odspojen.",
    } as any)
}

/** Push a short text message onto the tournament's live-stream overlay. */
export async function sendSpectoMessage(uuid: string, text: string): Promise<void> {
    await http.post(
        `/tournaments/${uuid}/specto/message`,
        { text },
        { successMessage: "Poruka je poslana na stream." } as any,
    )
}
