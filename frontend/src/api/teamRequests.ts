import { http } from "./http"

/** Wire shape returned by the backend (TeamRequestDto). */
export type TeamRequest = {
    uuid: string
    tournamentUuid: string
    /** Pretty URL slug; null on legacy rows pre-backfill. */
    tournamentSlug?: string | null
    tournamentName: string
    tournamentLocation?: string | null
    tournamentStartAt?: string | null
    playerName: string
    phone: string
    note?: string | null
    status: "OPEN" | "MATCHED"
    createdAt: string
    /** Firebase UID of the original poster - used to gate Spareno/Delete. */
    createdByUid?: string | null
}

export type CreateTeamRequestPayload = {
    playerName: string
    phone: string
    note?: string | null
}

/** Create a new team-finding request for a specific tournament. */
export async function createTeamRequest(
    tournamentUuid: string,
    payload: CreateTeamRequestPayload,
): Promise<TeamRequest> {
    const { data } = await http.post<TeamRequest>(
        `/team-requests/by-tournament/${tournamentUuid}`,
        payload,
    )
    return data
}

/** List all team-finding requests, optionally filtered by status. */
export async function listTeamRequests(
    status?: "open" | "matched",
): Promise<TeamRequest[]> {
    const { data } = await http.get<TeamRequest[]>("/team-requests", {
        params: status ? { status } : undefined,
    })
    return data
}

/** List requests for a single tournament. */
export async function listTeamRequestsForTournament(
    tournamentUuid: string,
): Promise<TeamRequest[]> {
    const { data } = await http.get<TeamRequest[]>(
        `/team-requests/by-tournament/${tournamentUuid}`,
    )
    return data
}

/** Edit an existing request (only the original poster or an admin can do this). */
export async function updateTeamRequest(
    requestUuid: string,
    payload: CreateTeamRequestPayload,
): Promise<TeamRequest> {
    const { data } = await http.put<TeamRequest>(
        `/team-requests/${requestUuid}`,
        payload,
    )
    return data
}

/** Mark a request as matched (the seeker found a partner). */
export async function matchTeamRequest(requestUuid: string): Promise<TeamRequest> {
    const { data } = await http.post<TeamRequest>(
        `/team-requests/${requestUuid}/match`,
    )
    return data
}

/** Remove a request entirely. */
export async function deleteTeamRequest(requestUuid: string): Promise<void> {
    await http.delete(`/team-requests/${requestUuid}`)
}
