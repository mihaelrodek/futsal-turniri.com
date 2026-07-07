import {http} from "./http"
import type { RoundDto, MatchDto } from "../types/round"

export async function fetchRounds(uuid: string): Promise<RoundDto[]> {
    const { data } = await http.get<RoundDto[]>(`/tournaments/${uuid}/rounds`)
    return data
}

export async function drawRound(uuid: string): Promise<RoundDto> {
    const { data } = await http.post<RoundDto>(`/tournaments/${uuid}/rounds/draw`)
    return data
}

/** One entry in the manual round body - team2Id null means BYE. */
export type ManualMatchInput = {
    team1Id: number
    team2Id: number | null
    tableNo: number
}

/**
 * Manual round generation - bypasses the random pairing logic by sending
 * the exact list of matches the organiser wants. Used in the late stage
 * of a small bracket where auto-draw doesn't team the way the organiser
 * wants. Backend validates the request and returns 400 with a
 * descriptive message if any team is already eliminated, appears twice,
 * or doesn't belong to this tournament.
 */
export async function drawManualRound(
    uuid: string,
    matches: ManualMatchInput[],
): Promise<RoundDto> {
    const { data } = await http.post<RoundDto>(
        `/tournaments/${uuid}/rounds/manual`,
        { matches },
        { successMessage: "Kolo generirano." } as any,
    )
    return data
}

export async function updateMatchScore(
    uuid: string,
    roundId: number,
    matchId: number,
    body: { score1: number | null; score2: number | null }
): Promise<MatchDto> {
    const { data } = await http.put<MatchDto>(
        `/tournaments/${uuid}/rounds/${roundId}/matches/${matchId}`,
        body
    )
    return data
}

/** Prefer deleting the whole round if your backend supports it; otherwise delete only matches. */
export async function hardResetRound(uuid: string, roundId: number): Promise<void> {
    try {
        await http.delete(`/tournaments/${uuid}/rounds/${roundId}`)
    } catch {
        await http.delete(`/tournaments/${uuid}/rounds/${roundId}/matches`)
    }
}

export async function finishRound(tournamentUuid: string, roundId: number): Promise<RoundDto> {
    const { data } = await http.put<RoundDto>(`/tournaments/${tournamentUuid}/rounds/${roundId}/finish`)
    return data
}

export async function overrideMatchScore(
    uuid: string,
    roundId: number,
    matchId: number,
    payload: { score1: number | null; score2: number | null }
): Promise<RoundDto> {
    const res = await http.patch<RoundDto>(
        `/tournaments/${uuid}/rounds/${roundId}/matches/${matchId}/override-score`,
        payload
    )
    return res.data
}