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
