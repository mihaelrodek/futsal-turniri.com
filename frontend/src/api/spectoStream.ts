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

/**
 * Attach an EXISTING stream (created directly on the platform) to the
 * tournament by its id - no provisioning. Blank id clears the link.
 */
export async function linkSpectoStream(uuid: string, streamId: string): Promise<SpectoStatus> {
    const { data } = await http.post<SpectoStatus>(
        `/tournaments/${uuid}/specto/link`,
        { streamId },
        { successMessage: "Stream je povezan s turnirom." } as any,
    )
    return data
}

/* ── Admin: site-wide connection settings ───────────────────────────────────
   The platform URL + API key normally live in the server's .env
   (`specto.base-url` / `specto.api-key`). Saving them here stores them in the
   database instead, where they WIN over the config and apply immediately - no
   restart. The key is WRITE-ONLY: the server never sends it back, only whether
   one is set, where it came from, and its last four characters. Admin-only. */

/** Effective SpectoStream connection, as reported by the server. */
export type SpectoConnection = {
    /** Platform base URL currently in effect. */
    baseUrl: string
    /** Whether ANY key is in effect (from the database or .env). */
    apiKeySet: boolean
    /** True when the effective key comes from the database (this form), false
     *  when it falls back to the server's .env config. */
    apiKeyFromDb: boolean
    /** Last four characters of the effective key ("…a1b2"), or null. */
    apiKeyHint: string | null
    /** The `specto.enabled` master switch. */
    enabled: boolean
}

/** Current effective connection settings. */
export async function fetchSpectoConnection(): Promise<SpectoConnection> {
    const { data } = await http.get<SpectoConnection>("/specto-admin/connection")
    return data
}

/**
 * Save the connection. Leave `apiKey` empty to KEEP the stored key (so the
 * form can be saved without re-typing the secret); pass `clearApiKey` to drop
 * it and fall back to the server's .env value.
 */
export async function saveSpectoConnection(body: {
    baseUrl: string
    apiKey?: string
    clearApiKey?: boolean
}): Promise<SpectoConnection> {
    const { data } = await http.put<SpectoConnection>("/specto-admin/connection", body, {
        successMessage: "Postavke streama su spremljene.",
    } as any)
    return data
}

/** Check the saved connection can actually reach a given stream. */
export async function verifySpectoStream(streamId: string): Promise<{ ok: boolean; reason: string | null }> {
    const { data } = await http.post<{ ok: boolean; reason: string | null }>(
        "/specto-admin/verify",
        { streamId },
        { silent: true } as any,
    )
    return data
}

/* ── Broadcast on/off (home-page banner + overlay camera state) ─────────── */

/** Whether this tournament's stream is the one currently live on the home page. */
export type SpectoBroadcast = {
    streamId: string | null
    /** True when the home-page banner is STREAMING *and* points at this stream. */
    broadcasting: boolean
    /** Public HLS manifest the banner plays. */
    playbackUrl: string | null
}

/** Current broadcast status for one tournament. */
export async function fetchSpectoBroadcast(tournamentUuid: string): Promise<SpectoBroadcast> {
    const { data } = await http.get<SpectoBroadcast>("/specto-admin/broadcast", {
        params: { tournamentUuid },
    })
    return data
}

/**
 * START: tell the platform the camera is live (announcing the next fixture on
 * the overlay) AND put this stream on the home page.
 */
export async function startSpectoBroadcast(tournamentUuid: string): Promise<SpectoBroadcast> {
    const { data } = await http.post<SpectoBroadcast>(
        "/specto-admin/broadcast/start",
        { tournamentUuid },
        { successMessage: "Stream je pokrenut i prikazuje se na glavnoj." } as any,
    )
    return data
}

/** STOP: camera off on the overlay + take the banner out of STREAMING. */
export async function stopSpectoBroadcast(tournamentUuid: string): Promise<SpectoBroadcast> {
    const { data } = await http.post<SpectoBroadcast>(
        "/specto-admin/broadcast/stop",
        { tournamentUuid },
        { successMessage: "Stream je zaustavljen." } as any,
    )
    return data
}

/* ── Lineups + standalone countdown ─────────────────────────────────────── */

/**
 * Push the squads of the tournament's CURRENT match (the live one, else the
 * next scheduled) onto the overlay. Rosters come from the Ekipe tab.
 */
export async function sendSpectoLineup(tournamentUuid: string): Promise<void> {
    await http.post("/specto-admin/lineup", { tournamentUuid }, {
        successMessage: "Sastavi su poslani na stream.",
    } as any)
}

/** Start / restart the standalone countdown chip (1-3600 s). */
export async function startSpectoTimer(tournamentUuid: string, seconds: number): Promise<void> {
    await http.post("/specto-admin/timer/start", { tournamentUuid, seconds }, {
        successMessage: "Odbrojavanje je pokrenuto.",
    } as any)
}

/** Clear the countdown chip. Also backs "pauza" - the caller restarts it with
 *  the remaining seconds, since the platform API has no pause of its own. */
export async function stopSpectoTimer(tournamentUuid: string, silent = false): Promise<void> {
    await http.post("/specto-admin/timer/stop", { tournamentUuid },
        (silent ? { silent: true } : { successMessage: "Odbrojavanje je zaustavljeno." }) as any)
}

/** Push a short text message onto the tournament's live-stream overlay. */
export async function sendSpectoMessage(uuid: string, text: string): Promise<void> {
    await http.post(
        `/tournaments/${uuid}/specto/message`,
        { text },
        { successMessage: "Poruka je poslana na stream." } as any,
    )
}
