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

/** One row of /public/users/{slug}/teams/{teamId}/matches. */
export type TeamMatchRow = {
    roundNumber: number | null
    tableNo: number | null
    opponentName: string | null
    ourScore: number | null
    opponentScore: number | null
    status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "FINISHED" | string | null
    won: boolean | null
    isBye: boolean
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
    matchesPlayed: number
    matchesWon: number
    matchesDrawn: number
    matchesLost: number
    goalsFor: number
    goalsAgainst: number
    topTeamName: string | null
    recent: CareerRecentTournament[]
}

export async function getCareerStats(slug: string): Promise<CareerStats> {
    const { data } = await http.get<CareerStats>(
        `/public/users/${encodeURIComponent(slug)}/career`,
    )
    return data
}
