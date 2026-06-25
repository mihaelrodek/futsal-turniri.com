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

/** A team eligible for the bracket (qualifier / all-teams picker). */
export type BracketCandidate = { id: number; name: string }

/** Eligible teams for the manual draw + whether the group stage is done. */
export type BracketQualifiers = {
    groupStageComplete: boolean
    teams: BracketCandidate[]
}

/** Teams that may enter the bracket (group qualifiers, or all teams for
 *  KNOCKOUT_ONLY) + whether the group stage is complete. */
export async function fetchBracketQualifiers(
    tournamentUuid: string,
): Promise<BracketQualifiers> {
    const { data } = await http.get<BracketQualifiers>(
        `/tournaments/${tournamentUuid}/bracket/qualifiers`,
        { silent: true } as any,
    )
    return data
}

/** One round-one match in a manual draw (either side may be a bye = null). */
export type ManualBracketPairing = { team1Id: number | null; team2Id: number | null }

/** Build (or rebuild) the bracket from organizer-supplied first-round pairings. */
export async function generateBracketManual(
    tournamentUuid: string,
    pairs: ManualBracketPairing[],
): Promise<Bracket> {
    const { data } = await http.post<Bracket>(
        `/tournaments/${tournamentUuid}/bracket/generate-manual`,
        { pairs },
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
