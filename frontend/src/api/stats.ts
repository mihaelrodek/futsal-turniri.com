import { http } from "./http"

/* ──────────────────────────────────────────────────────────────────────────
   Tournament statistics API.

   Aggregated stats for a tournament - currently the top-scorers list shown
   under the "Statistika" section of the tournament page.
   ────────────────────────────────────────────────────────────────────── */

/** One row in the top-scorers ranking. The list is returned already sorted. */
export type ScorerDto = {
    playerId: number
    playerName: string
    teamName: string
    goals: number
}

/** Fetch the top-scorers ranking for a tournament (most goals first). */
export async function fetchScorers(uuid: string): Promise<ScorerDto[]> {
    const { data } = await http.get<ScorerDto[]>(
        `/tournaments/${uuid}/stats/scorers`,
        { silent: true } as any,
    )
    return data
}
