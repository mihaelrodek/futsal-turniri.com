import { http } from "./http"
import type { MyTournamentParticipation } from "./userMe"

/** TeamSummary nested type as returned by /public/users/{slug}. */
export type TeamSummary = {
    name: string
    tournamentCount: number
    wins: number
    /**
     * When the team is co-owned via the share-with-partner flow, these
     * point at the OTHER owner from the profile owner's perspective so
     * the chip can render a clickable link to their profile.
     */
    partnerSlug?: string | null
    partnerName?: string | null
}

export type PublicProfile = {
    slug: string
    displayName: string | null
    phoneCountry: string | null
    phone: string | null
    /**
     * True when the user has a phone on file. Anonymous callers always see
     * {@code phone = null} (redacted by the backend), so the SPA uses this
     * flag to decide whether to render the blurred "Prijavi se da vidiš
     * broj" placeholder vs. nothing.
     */
    hasPhone: boolean
    /** Proxied URL for the user's avatar, or null if none. */
    avatarUrl: string | null
    teams: TeamSummary[]
    tournaments: MyTournamentParticipation[]
}

/** Mirrors the backend `MatchStage` enum. Keyed the same as
 *  `components.scheduleTab.stageLabels`, so a value indexes straight into it. */
export type MatchStage =
    | "GROUP"
    | "ROUND_OF_32"
    | "ROUND_OF_16"
    | "QUARTERFINAL"
    | "SEMIFINAL"
    | "FINAL"
    | "THIRD_PLACE"

/** One row of /public/users/{slug}/teams/{teamId}/matches. */
export type TeamMatchRow = {
    /** Lets the profile link straight into /turniri/{ref}/utakmica/{matchId}. */
    matchId: number
    roundNumber: number | null
    /** GROUP | ROUND_OF_32 | … | FINAL - lets a knockout row read
     *  "Četvrtfinale" instead of a meaningless round number. */
    stage: MatchStage | null
    tableNo: number | null
    opponentName: string | null
    ourScore: number | null
    opponentScore: number | null
    status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "FINISHED" | string | null
    won: boolean | null
    isBye: boolean
    /** What THIS profile's own roster player did in the match (0 when nothing). */
    goals: number
    ownGoals: number
    yellowCards: number
    redCards: number
}

export type TeamMatchHistory = {
    teamId: number
    teamName: string
    tournamentName: string | null
    matches: TeamMatchRow[]
}

export async function getPublicProfile(slug: string): Promise<PublicProfile> {
    const { data } = await http.get<PublicProfile>(`/public/users/${encodeURIComponent(slug)}`)
    return data
}

export async function getTeamMatchHistory(slug: string, teamId: number): Promise<TeamMatchHistory> {
    const { data } = await http.get<TeamMatchHistory>(
        `/public/users/${encodeURIComponent(slug)}/teams/${teamId}/matches`,
    )
    return data
}

/* ── Career stats - aggregate W/D/L + goals across every team. ───────── */

export type CareerRecentTournament = {
    tournamentName: string | null
    tournamentSlug: string | null
    teamName: string | null
    startAt: string | null
    /** "Pobjeda", "Eliminacija", "Sudjelovanje". */
    result: string
}

export type CareerStats = {
    tournamentsPlayed: number
    tournamentsWon: number
    /** Tournaments finished 2nd/3rd (by Tournaments.secondPlaceName/thirdPlaceName). */
    tournamentsSecond: number
    tournamentsThird: number
    /** 1/2/3 - best-ever podium finish, or null when never on the podium. */
    bestPlacement: number | null
    matchesPlayed: number
    matchesWon: number
    matchesDrawn: number
    matchesLost: number
    /** TEAM goals (match score sum) - not the same as `playerGoals`. */
    goalsFor: number
    goalsAgainst: number
    /** Goals personally scored by the roster player matching this profile's
     *  own name, across every team the profile owns. */
    playerGoals: number
    topTeamName: string | null
    recent: CareerRecentTournament[]
}

export async function getCareerStats(slug: string): Promise<CareerStats> {
    const { data } = await http.get<CareerStats>(
        `/public/users/${encodeURIComponent(slug)}/career`,
    )
    return data
}
