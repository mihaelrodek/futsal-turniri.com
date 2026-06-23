import { http } from "./http"
import type { Bracket, KnockoutResult } from "../types/bracket"

/** The knockout bracket. Empty rounds before it is generated. */
export async function fetchBracket(tournamentUuid: string): Promise<Bracket> {
    const { data } = await http.get<Bracket>(`/tournaments/${tournamentUuid}/bracket`)
    return data
}

/** Build (or rebuild) the knockout bracket from the qualifiers. */
export async function generateBracket(tournamentUuid: string): Promise<Bracket> {
    const { data } = await http.post<Bracket>(
        `/tournaments/${tournamentUuid}/bracket/generate`,
        undefined,
        { successMessage: "Eliminacijska ljestvica je generirana." } as any,
    )
    return data
}

/** Record a knockout-match result; the bracket is returned with the winner advanced. */
export async function recordKnockoutResult(
    tournamentUuid: string,
    matchId: number,
    result: KnockoutResult,
): Promise<Bracket> {
    const { data } = await http.post<Bracket>(
        `/tournaments/${tournamentUuid}/bracket/matches/${matchId}/result`,
        result,
        { successMessage: "Rezultat je spremljen." } as any,
    )
    return data
}
