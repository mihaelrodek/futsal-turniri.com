import { http } from "./http"
import type { MatchLiveMode } from "../types/matchEvents"

/* ──────────────────────────────────────────────────────────────────────────
   Live-matches API.

   Lists every match currently in progress across all tournaments. Used by
   the NavBar "LIVE" popover and the full /uzivo page to show a SofaScore-
   style live scoreboard. The call is polled on an interval, so it goes
   through with { silent: true } to keep it from spamming toasts.
   ────────────────────────────────────────────────────────────────────── */

/** A single match currently LIVE, with everything the live UIs need. */
export type LiveMatch = {
    matchId: number
    tournamentUuid: string
    tournamentSlug: string
    tournamentName: string
    team1Name: string | null
    team2Name: string | null
    score1: number | null
    score2: number | null
    liveMode: MatchLiveMode | null
    liveStartedAt: string | null
    /** ISO timestamp the 2nd half was started; null until the organizer starts it. */
    secondHalfStartedAt?: string | null
    /** Mirror of `tournaments.featured_at`. Non-null when this match's
     *  tournament is the admin-curated daily highlight — used to
     *  promote the right match into the home-page hero and the /uzivo
     *  featured slot. */
    tournamentFeaturedAt?: string | null
}

/** Sort live matches with the admin-featured tournament's match first,
 *  then by liveStartedAt ascending (oldest live first → most-progress
 *  first). Returns a new array; doesn't mutate. */
export function pickFeaturedFirst(matches: LiveMatch[]): LiveMatch[] {
    return [...matches].sort((a, b) => {
        const af = a.tournamentFeaturedAt ? 1 : 0
        const bf = b.tournamentFeaturedAt ? 1 : 0
        if (af !== bf) return bf - af
        // Both featured (different tournaments featured at different
        // times) — most-recently featured wins.
        if (a.tournamentFeaturedAt && b.tournamentFeaturedAt) {
            const at = new Date(a.tournamentFeaturedAt).getTime()
            const bt = new Date(b.tournamentFeaturedAt).getTime()
            if (at !== bt) return bt - at
        }
        const al = a.liveStartedAt ? new Date(a.liveStartedAt).getTime() : 0
        const bl = b.liveStartedAt ? new Date(b.liveStartedAt).getTime() : 0
        return al - bl
    })
}

/** List every match currently in progress across all tournaments. */
export async function fetchLiveMatches(): Promise<LiveMatch[]> {
    const { data } = await http.get<LiveMatch[]>(
        "/tournaments/live",
        { silent: true } as any,
    )
    return data
}

/** A SCHEDULED match with a concrete kickoff time, across all tournaments. */
export type UpcomingMatch = {
    matchId: number
    tournamentUuid: string
    tournamentSlug: string
    tournamentName: string
    team1Name: string | null
    team2Name: string | null
    kickoffAt: string
    tableNo: number | null
}

/** Upcoming matches across every tournament, soonest-first (max 40). */
export async function fetchUpcomingMatches(): Promise<UpcomingMatch[]> {
    const { data } = await http.get<UpcomingMatch[]>(
        "/tournaments/upcoming-matches",
        { silent: true } as any,
    )
    return data
}
