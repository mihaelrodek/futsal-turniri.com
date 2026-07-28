import { http } from "./http"

/* ──────────────────────────────────────────────────────────────────────────
   Tournament statistics API.

   Aggregated stats for a tournament - currently the top-scorers list shown
   under the "Statistika" section of the tournament page.
   ────────────────────────────────────────────────────────────────────── */

/** One row in the top-scorers ranking. The list is returned already sorted
 *  by `goals` (the tally inside the organizer's scorer scope - default:
 *  knockout only). `goalsAll` is the full tally including the group stage;
 *  equal to `goals` when the scope is ALL. */
export type ScorerDto = {
    playerId: number
    playerName: string
    teamName: string
    goals: number
    goalsAll: number
}

/** Fetch the top-scorers ranking for a tournament (most goals first). */
export async function fetchScorers(uuid: string): Promise<ScorerDto[]> {
    const { data } = await http.get<ScorerDto[]>(
        `/tournaments/${uuid}/stats/scorers`,
        { silent: true } as any,
    )
    return data
}

/* ── Cross-tournament (all-time) stats ──────────────────────────────── */

/** One row of the all-time team medal table ("Ekipe" tab on /statistika) -
 *  how many times a team finished 1st / 2nd / 3rd across every tournament
 *  it's ever played. Name is the normalized uppercase team name. */
export type TeamMedalsDto = {
    name: string
    gold: number
    silver: number
    bronze: number
}

/** All-time team medal table, already sorted (gold → silver → bronze → name). */
export async function fetchTeamMedals(): Promise<TeamMedalsDto[]> {
    const { data } = await http.get<TeamMedalsDto[]>(`/stats/team-medals`)
    return data
}
