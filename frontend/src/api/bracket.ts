import { http } from "./http"
import type { Bracket, KnockoutResult } from "../types/bracket"

/** The knockout bracket. Empty rounds before it is generated.
 *  Pass `{ silent: true }` for background polling (no error toasts). */
export async function fetchBracket(
    tournamentUuid: string,
    opts?: { silent?: boolean },
): Promise<Bracket> {
    const { data } = await http.get<Bracket>(
        `/tournaments/${tournamentUuid}/bracket`,
        (opts?.silent ? { silent: true } : undefined) as any,
    )
    return data
}

/** Build (or rebuild) the knockout bracket from the qualifiers. `byeTeamIds`
 *  (optional) chooses who advances directly (round-one bye) when the qualifier
 *  count isn't a power of two; omit for automatic (best seeds get the byes). */
export async function generateBracket(
    tournamentUuid: string,
    byeTeamIds?: number[],
    shuffleRest?: boolean,
): Promise<Bracket> {
    const hasByes = !!byeTeamIds && byeTeamIds.length > 0
    const body =
        hasByes || shuffleRest
            ? { byeTeamIds: hasByes ? byeTeamIds : undefined, shuffleRest: !!shuffleRest }
            : undefined
    const { data } = await http.post<Bracket>(
        `/tournaments/${tournamentUuid}/bracket/generate`,
        body,
        { successMessage: "Eliminacijska ljestvica je generirana." } as any,
    )
    return data
}

/** Wipe the knockout bracket (delete all elimination matches). */
export async function resetBracket(tournamentUuid: string): Promise<Bracket> {
    const { data } = await http.post<Bracket>(
        `/tournaments/${tournamentUuid}/bracket/reset`,
        undefined,
        { successMessage: "Eliminacijska ljestvica je resetirana." } as any,
    )
    return data
}

/** Confirm the knockout draw once the group stage is over - unlocks starting
 *  the knockout matches / recording their results. Returns the (now confirmed)
 *  bracket. */
export async function confirmBracket(tournamentUuid: string): Promise<Bracket> {
    const { data } = await http.post<Bracket>(
        `/tournaments/${tournamentUuid}/bracket/confirm`,
        undefined,
        { successMessage: "Ždrijeb završnice je potvrđen." } as any,
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

/** Persist the organizer's manual seed order (nositelji) for a KNOCKOUT_ONLY
 *  bracket - `teamIds` best seed first. Returns the re-ordered candidates. The
 *  auto draw then yields the same bracket every time (deterministic). */
export async function setBracketSeeds(
    tournamentUuid: string,
    teamIds: number[],
): Promise<BracketQualifiers> {
    const { data } = await http.post<BracketQualifiers>(
        `/tournaments/${tournamentUuid}/bracket/seeds`,
        { teamIds },
        { successMessage: "Redoslijed nosilaca je spremljen." } as any,
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

/** One round-one match in a POSITION draw (GROUPS_KNOCKOUT): each side is a
 *  position label ("A1", "B2", "3-1") or null for a bye. */
export type ManualPositionPairing = { slot1: string | null; slot2: string | null }

/** Persist the organizer's position-based first-round pairings. The skeleton is
 *  re-labelled from these (bracket + schedule + sketch labels update), and the
 *  positions resolve into real teams at "Potvrdi ždrijeb". Allowed anytime after
 *  the groups are drawn; the backend answers 409 BRACKET_ALREADY_DRAWN once real
 *  teams exist (reset the bracket first). */
export async function setManualBracketPositions(
    tournamentUuid: string,
    pairs: ManualPositionPairing[],
): Promise<Bracket> {
    const { data } = await http.post<Bracket>(
        `/tournaments/${tournamentUuid}/bracket/manual-positions`,
        { pairs },
        { successMessage: "Parovi završnice su spremljeni." } as any,
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
