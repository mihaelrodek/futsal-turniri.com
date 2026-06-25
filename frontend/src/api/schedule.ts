import { http } from "./http"
import type { Schedule, ScheduleConfig } from "../types/schedule"

/** The tournament schedule — config + every match in play order. */
export async function fetchSchedule(tournamentUuid: string): Promise<Schedule> {
    const { data } = await http.get<Schedule>(`/tournaments/${tournamentUuid}/schedule`)
    return data
}

/** Store the match-format config and lay out all kickoff times. */
export async function generateSchedule(
    tournamentUuid: string,
    cfg: ScheduleConfig,
): Promise<Schedule> {
    const { data } = await http.post<Schedule>(
        `/tournaments/${tournamentUuid}/schedule/generate`,
        cfg,
        { successMessage: "Raspored je generiran." } as any,
    )
    return data
}

/** Fill in kickoff times for matches that don't have one yet (e.g. knockout
 *  matches drawn after the group schedule), continuing after the last
 *  scheduled match. Existing times are left untouched. */
export async function confirmSchedule(tournamentUuid: string): Promise<Schedule> {
    const { data } = await http.post<Schedule>(
        `/tournaments/${tournamentUuid}/schedule/confirm`,
        undefined,
        { successMessage: "Raspored je potvrđen." } as any,
    )
    return data
}

/** Override a single match's kickoff time (ISO string). */
export async function updateKickoff(
    tournamentUuid: string,
    matchId: number,
    kickoffAt: string,
): Promise<Schedule> {
    const { data } = await http.patch<Schedule>(
        `/tournaments/${tournamentUuid}/schedule/matches/${matchId}`,
        { kickoffAt },
        { successMessage: "Vrijeme je spremljeno." } as any,
    )
    return data
}
