import { http } from "./http"
import type {
    CreateMatchEventRequest,
    MatchEventDto,
    MatchLiveMode,
} from "../types/matchEvents"

/* ──────────────────────────────────────────────────────────────────────────
   Live-match API.

   Drives the SCHEDULED → LIVE → FINISHED lifecycle and the per-match event
   log (goals + cards). Mutations are organizer-only on the backend. All calls
   go through the shared axios instance so they inherit the Firebase auth
   header + toast interceptors.
   ────────────────────────────────────────────────────────────────────── */

/**
 * Transition a scheduled match to LIVE so events can be recorded.
 *
 * The organizer picks a live mode up front:
 *  - TIMER  — a running match clock is shown.
 *  - SIMPLE — only a LIVE badge; the organizer uses their own timer.
 */
export async function startMatch(
    tournamentUuid: string,
    matchId: number,
    mode: MatchLiveMode,
): Promise<void> {
    await http.post(
        `/tournaments/${tournamentUuid}/matches/${matchId}/start`,
        { mode },
        { successMessage: "Utakmica je pokrenuta uživo." } as any,
    )
}

/** Transition a live match to FINISHED. */
export async function finishMatch(
    tournamentUuid: string,
    matchId: number,
): Promise<void> {
    await http.post(
        `/tournaments/${tournamentUuid}/matches/${matchId}/finish`,
        undefined,
        { successMessage: "Utakmica je završena." } as any,
    )
}

/**
 * Start the 2nd half of a LIVE match.
 *
 * Sets {@code secondHalfStartedAt} to now on the backend so the TIMER clock
 * can switch from halftime to the 2nd-half running clock. Organizer-only;
 * the match must currently be LIVE.
 */
export async function startSecondHalf(
    tournamentUuid: string,
    matchId: number,
): Promise<void> {
    await http.post(
        `/tournaments/${tournamentUuid}/matches/${matchId}/second-half`,
        undefined,
        { successMessage: "Drugo poluvrijeme je započelo." } as any,
    )
}

/** List every event recorded for a match, in backend (chronological) order. */
export async function fetchMatchEvents(
    tournamentUuid: string,
    matchId: number,
): Promise<MatchEventDto[]> {
    const { data } = await http.get<MatchEventDto[]>(
        `/tournaments/${tournamentUuid}/matches/${matchId}/events`,
        { silent: true } as any,
    )
    return data
}

/** Record a new event (goal or card). Adding a GOAL recomputes the score. */
export async function addMatchEvent(
    tournamentUuid: string,
    matchId: number,
    payload: CreateMatchEventRequest,
): Promise<MatchEventDto> {
    const { data } = await http.post<MatchEventDto>(
        `/tournaments/${tournamentUuid}/matches/${matchId}/events`,
        payload,
        { successMessage: "Događaj je dodan." } as any,
    )
    return data
}

/** Remove a previously recorded event. Removing a GOAL recomputes the score. */
export async function deleteMatchEvent(
    tournamentUuid: string,
    matchId: number,
    eventId: number,
): Promise<void> {
    await http.delete(
        `/tournaments/${tournamentUuid}/matches/${matchId}/events/${eventId}`,
        { successMessage: "Događaj je uklonjen." } as any,
    )
}
