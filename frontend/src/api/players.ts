import { http } from "./http"
import type { PlayerDto } from "../types/players"

/* ──────────────────────────────────────────────────────────────────────────
   Player roster API.

   Players belong to a team within a tournament. Mutations are
   organizer-only on the backend. All calls go through the shared axios
   instance so they inherit the Firebase auth header + toast interceptors.
   ────────────────────────────────────────────────────────────────────── */

/** List every player on a team's roster. */
export async function fetchPlayers(
    tournamentUuid: string,
    teamId: number,
): Promise<PlayerDto[]> {
    const { data } = await http.get<PlayerDto[]>(
        `/tournaments/${tournamentUuid}/teams/${teamId}/players`,
    )
    return data
}

/** Add a new player to a team's roster. Pass `{ silent: true }` to suppress
 *  the per-player toast (used by the bulk import, which shows one summary). */
export async function createPlayer(
    tournamentUuid: string,
    teamId: number,
    payload: { name: string; number?: number | null },
    opts?: { silent?: boolean },
): Promise<PlayerDto> {
    const { data } = await http.post<PlayerDto>(
        `/tournaments/${tournamentUuid}/teams/${teamId}/players`,
        payload,
        (opts?.silent ? { silent: true } : { successMessage: "Igrač je dodan." }) as any,
    )
    return data
}

/** Update an existing player. Pass `captain: true` to make this player the captain. */
export async function updatePlayer(
    tournamentUuid: string,
    teamId: number,
    playerId: number,
    payload: { name: string; number?: number | null; captain?: boolean },
): Promise<PlayerDto> {
    const { data } = await http.put<PlayerDto>(
        `/tournaments/${tournamentUuid}/teams/${teamId}/players/${playerId}`,
        payload,
        { successMessage: "Igrač je ažuriran." } as any,
    )
    return data
}

/** Remove a player from a team's roster. */
export async function deletePlayer(
    tournamentUuid: string,
    teamId: number,
    playerId: number,
): Promise<void> {
    await http.delete(
        `/tournaments/${tournamentUuid}/teams/${teamId}/players/${playerId}`,
        { successMessage: "Igrač je uklonjen." } as any,
    )
}

/* ── Cross-tournament player endpoints ──────────────────────────────── */

/** Autocomplete: distinct existing (uppercase) player names matching `q`. */
export async function searchPlayers(q: string): Promise<string[]> {
    if (q.trim().length < 2) return []
    const { data } = await http.get<string[]>(
        `/players/search`,
        { params: { q }, silent: true } as any,
    )
    return data
}

/** One row of the all-time scorer list ("vječna lista strijelaca"). */
export type GlobalScorer = {
    name: string
    goals: number
    tournamentsPlayed: number
    /** How many tournaments named this player their best scorer (tiebreaker). */
    bestScorerAwards: number
}

/** All-time scorer list, already sorted (goals → awards → name). */
export async function fetchGlobalScorers(): Promise<GlobalScorer[]> {
    const { data } = await http.get<GlobalScorer[]>(`/players/scorers`)
    return data
}
