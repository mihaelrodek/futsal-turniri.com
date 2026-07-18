import { http } from "./http"
import type {
    Schedule,
    ScheduleConfig,
    SchedulePlanInfo,
    SchedulePlanRequest,
    SchedulePreview,
} from "../types/schedule"

/** The tournament schedule - config + every match in play order. */
export async function fetchSchedule(tournamentUuid: string): Promise<Schedule> {
    const { data } = await http.get<Schedule>(`/tournaments/${tournamentUuid}/schedule`)
    return data
}

/** Predicted total match count (group + knockout), for the multi-day planner's
 *  "matches remaining to schedule" counter. */
export async function fetchPlanInfo(tournamentUuid: string): Promise<SchedulePlanInfo> {
    const { data } = await http.get<SchedulePlanInfo>(
        `/tournaments/${tournamentUuid}/schedule/plan-info`,
    )
    return data
}

/** Compute (but do NOT persist) the multi-day schedule for a day plan -
 *  the "Skiciraj" preview the organizer reviews before generating. */
export async function previewSchedule(
    tournamentUuid: string,
    req: SchedulePlanRequest,
): Promise<SchedulePreview> {
    const { data } = await http.post<SchedulePreview>(
        `/tournaments/${tournamentUuid}/schedule/preview`,
        req,
        { silent: true } as any,
    )
    return data
}

/** Actually generate the multi-day schedule from the confirmed day plan. */
export async function generateMultiDaySchedule(
    tournamentUuid: string,
    req: SchedulePlanRequest,
): Promise<Schedule> {
    const { data } = await http.post<Schedule>(
        `/tournaments/${tournamentUuid}/schedule/generate-multiday`,
        req,
        { successMessage: "Raspored je generiran." } as any,
    )
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

/** Clear the laid-out schedule - wipe every kickoff time. Fixtures (groups /
 *  bracket) stay; only the slots are removed so the organizer can start over. */
export async function clearSchedule(tournamentUuid: string): Promise<Schedule> {
    const { data } = await http.post<Schedule>(
        `/tournaments/${tournamentUuid}/schedule/clear`,
        undefined,
        { successMessage: "Raspored je očišćen." } as any,
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
