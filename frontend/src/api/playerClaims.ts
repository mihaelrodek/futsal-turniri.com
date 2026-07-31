import { http } from "./http"
import type { PlayerClaimSuggestion } from "./userMe"

/**
 * The MANUAL "this roster player is me" flow - roster search plus a request
 * an admin has to approve.
 *
 * The automatic flow (exact name match on an unclaimed team, no approval
 * needed) lives in `userMe.ts` as getPlayerSuggestions/claimPlayerSuggestion.
 * Everything here is the fallback for when that finds nothing: a different
 * spelling on the roster, a nickname, or a team a teammate registered.
 */

export type PlayerClaimRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"

export type PlayerClaimRequest = {
    id: number
    playerId: number | null
    playerName: string | null
    teamName: string | null
    tournamentName: string | null
    comment: string | null
    status: PlayerClaimRequestStatus
    adminNote: string | null
    createdAt: string
    decidedAt: string | null
    /** Admin list only - never populated on a user's own list. */
    requesterName: string | null
    requesterEmail: string | null
    requesterSlug: string | null
}

/**
 * What the SPA needs to decide what to offer: the exact-name matches (empty
 * when there are none, or when the person answered "nisam igrač") plus the
 * opt-out flag. One call for both the first-run prompt and the profile page.
 */
export type PlayerClaimState = {
    optedOut: boolean
    suggestions: PlayerClaimSuggestion[]
}

/** Silent - callers degrade to "offer nothing" when it fails. */
export async function getPlayerClaimState(): Promise<PlayerClaimState> {
    const { data } = await http.get<PlayerClaimState>("/user/me/player-claim-state", {
        silent: true,
    } as any)
    return data
}

/**
 * "Nisam igrač" (true) / undo (false). Server-side so the answer holds on
 * every device - and it only silences the automatic prompt: the manual
 * request dialog stays reachable either way.
 */
export async function setPlayerClaimOptOut(optedOut: boolean): Promise<PlayerClaimState> {
    const { data } = optedOut
        ? await http.post<PlayerClaimState>("/user/me/player-claim-opt-out", null, { silent: true } as any)
        : await http.delete<PlayerClaimState>("/user/me/player-claim-opt-out", { silent: true } as any)
    return data
}

/** Roster search for the request dialog. Silent - the dialog owns its errors. */
export async function searchClaimablePlayers(q: string): Promise<PlayerClaimSuggestion[]> {
    const { data } = await http.get<PlayerClaimSuggestion[]>("/user/me/claimable-players", {
        params: { q },
        silent: true,
    } as any)
    return data
}

export async function getMyPlayerClaimRequests(): Promise<PlayerClaimRequest[]> {
    const { data } = await http.get<PlayerClaimRequest[]>("/user/me/player-claim-requests", {
        silent: true,
    } as any)
    return data
}

export async function createPlayerClaimRequest(
    playerId: number,
    comment: string,
): Promise<PlayerClaimRequest> {
    const { data } = await http.post<PlayerClaimRequest>(
        "/user/me/player-claim-requests",
        { playerId, comment },
        { silent: true } as any,
    )
    return data
}

export async function cancelPlayerClaimRequest(id: number): Promise<PlayerClaimRequest> {
    const { data } = await http.delete<PlayerClaimRequest>(`/user/me/player-claim-requests/${id}`)
    return data
}

/* ── admin ───────────────────────────────────────────────────────────── */

export async function adminListPlayerClaimRequests(): Promise<PlayerClaimRequest[]> {
    const { data } = await http.get<PlayerClaimRequest[]>("/admin/player-claim-requests")
    return data
}

/**
 * Re-run the roster ⇄ profile matcher over every unlinked roster row. The
 * same pass runs at boot and on every roster/profile write, so this is for
 * "I just fixed a typo, update the profiles now". Idempotent.
 */
export type PlayerLinkBackfillResult = { scanned: number; linked: number; ambiguous: number }

export async function adminBackfillPlayerLinks(): Promise<PlayerLinkBackfillResult> {
    const { data } = await http.post<PlayerLinkBackfillResult>("/admin/player-links/backfill")
    return data
}

export async function adminApprovePlayerClaimRequest(
    id: number,
    note?: string,
): Promise<PlayerClaimRequest> {
    const { data } = await http.post<PlayerClaimRequest>(
        `/admin/player-claim-requests/${id}/approve`,
        { note: note ?? null },
    )
    return data
}

export async function adminRejectPlayerClaimRequest(
    id: number,
    note?: string,
): Promise<PlayerClaimRequest> {
    const { data } = await http.post<PlayerClaimRequest>(
        `/admin/player-claim-requests/${id}/reject`,
        { note: note ?? null },
    )
    return data
}
