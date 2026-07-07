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
 *  - TIMER  - a running match clock is shown.
 *  - SIMPLE - only a LIVE badge; the organizer uses their own timer.
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
 * Reset a match back to SCHEDULED - wipes live state, score, fouls and all
 * events so it can be started again cleanly (e.g. after a timer mishap).
 */
export async function resetMatch(
    tournamentUuid: string,
    matchId: number,
): Promise<void> {
    await http.post(
        `/tournaments/${tournamentUuid}/matches/${matchId}/reset`,
        undefined,
        { successMessage: "Utakmica je resetirana." } as any,
    )
}

/**
 * End the 1st half of a LIVE match - moves it into the half-time "pauza".
 *
 * Sets {@code firstHalfEndedAt} to now on the backend so the clock freezes and
 * the scoreboard shows half-time until the 2nd half is started. Organizer-only;
 * the match must currently be LIVE.
 */
export async function endFirstHalf(
    tournamentUuid: string,
    matchId: number,
): Promise<void> {
    await http.post(
        `/tournaments/${tournamentUuid}/matches/${matchId}/first-half-end`,
        undefined,
        { successMessage: "Prvo poluvrijeme je završeno." } as any,
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

/** Record a new event (goal or card). Adding a GOAL recomputes the score.
 *  Pass `{ silent: true }` to skip the success toast - used when recording a
 *  batch of penalty-shootout kicks so the screen isn't flooded with toasts. */
export async function addMatchEvent(
    tournamentUuid: string,
    matchId: number,
    payload: CreateMatchEventRequest,
    opts?: { silent?: boolean },
): Promise<MatchEventDto> {
    const { data } = await http.post<MatchEventDto>(
        `/tournaments/${tournamentUuid}/matches/${matchId}/events`,
        payload,
        (opts?.silent
            ? { silent: true }
            : { successMessage: "Događaj je dodan." }) as any,
    )
    return data
}

/** A match's accumulated team fouls, per team and half. */
export type MatchFouls = {
    fouls1First: number
    fouls1Second: number
    fouls2First: number
    fouls2Second: number
}

/**
 * Adjust a team's accumulated foul count for one half. `delta` is +1 / -1.
 * Silent (no toast) since it's tapped repeatedly during a match. Returns the
 * updated tallies.
 */
export async function adjustMatchFouls(
    tournamentUuid: string,
    matchId: number,
    team: 1 | 2,
    half: 1 | 2,
    delta: number,
): Promise<MatchFouls> {
    const { data } = await http.post<MatchFouls>(
        `/tournaments/${tournamentUuid}/matches/${matchId}/fouls`,
        { team, half, delta },
        { silent: true } as any,
    )
    return data
}

/** Reset both teams' accumulated fouls for one half back to 0. */
export async function resetMatchFouls(
    tournamentUuid: string,
    matchId: number,
    half: 1 | 2,
): Promise<MatchFouls> {
    const { data } = await http.post<MatchFouls>(
        `/tournaments/${tournamentUuid}/matches/${matchId}/fouls/reset?half=${half}`,
        undefined,
        { silent: true } as any,
    )
    return data
}

/** Remove a previously recorded event. Removing a GOAL recomputes the score.
 *  Pass `{ silent: true }` to skip the toast - used when clearing a batch of
 *  old penalty-shootout kicks before re-recording the edited ones. */
export async function deleteMatchEvent(
    tournamentUuid: string,
    matchId: number,
    eventId: number,
    opts?: { silent?: boolean },
): Promise<void> {
    await http.delete(
        `/tournaments/${tournamentUuid}/matches/${matchId}/events/${eventId}`,
        (opts?.silent
            ? { silent: true }
            : { successMessage: "Događaj je uklonjen." }) as any,
    )
}
