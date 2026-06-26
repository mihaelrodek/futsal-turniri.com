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

/** Wipe the group stage (delete all group matches + the draw). */
export async function resetGroups(tournamentUuid: string): Promise<Group[]> {
    const { data } = await http.post<Group[]>(
        `/tournaments/${tournamentUuid}/groups/reset`,
        undefined,
        { successMessage: "Grupna faza je resetirana." } as any,
    )
    return data
}

/**
 * Manually reorder a finished group's standings (tiebreaker override).
 * `teamIds` lists every team of the group, best first. Returns updated groups.
 */
export async function reorderGroup(
    tournamentUuid: string,
    groupId: number,
    teamIds: number[],
): Promise<Group[]> {
    const { data } = await http.post<Group[]>(
        `/tournaments/${tournamentUuid}/groups/${groupId}/reorder`,
        { teamIds },
        { successMessage: "Poredak skupine je spremljen." } as any,
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
