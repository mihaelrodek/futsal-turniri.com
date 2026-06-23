import { http } from "./http"
import type { Group, DrawRequest } from "../types/groups"

/** Live group tables for a tournament. Empty array before the draw. */
export async function fetchGroups(tournamentUuid: string): Promise<Group[]> {
    const { data } = await http.get<Group[]>(`/tournaments/${tournamentUuid}/groups`)
    return data
}

/** Run the group draw (AUTO or MANUAL) and generate the round-robin fixtures. */
export async function drawGroups(
    tournamentUuid: string,
    req: DrawRequest,
): Promise<Group[]> {
    const { data } = await http.post<Group[]>(
        `/tournaments/${tournamentUuid}/groups/draw`,
        req,
        { successMessage: "Ždrijeb je obavljen." } as any,
    )
    return data
}

/** Record a group-match result (a draw is allowed). Returns the updated groups. */
export async function recordGroupResult(
    tournamentUuid: string,
    matchId: number,
    score1: number,
    score2: number,
): Promise<Group[]> {
    const { data } = await http.post<Group[]>(
        `/tournaments/${tournamentUuid}/groups/matches/${matchId}/result`,
        { score1, score2 },
        { successMessage: "Rezultat je spremljen." } as any,
    )
    return data
}
