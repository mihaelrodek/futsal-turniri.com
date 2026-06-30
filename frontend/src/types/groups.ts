// Group-stage types (Phase E2).

import type { MatchLiveMode } from "./matchEvents"

export type GroupStandingRow = {
    teamId: number
    teamName: string
    played: number
    won: number
    drawn: number
    lost: number
    goalsFor: number
    goalsAgainst: number
    goalDiff: number
    points: number
    /** Up to the last 5 finished results, chronological — "W" | "D" | "L". */
    form?: string[]
}

export type GroupMatch = {
    matchId: number
    team1Id: number | null
    team1Name: string | null
    team2Id: number | null
    team2Name: string | null
    score1: number | null
    score2: number | null
    status: string
    /** Set while/after the match is LIVE — which live mode was chosen. */
    liveMode?: MatchLiveMode | null
    /** ISO timestamp the match was started LIVE; drives the TIMER clock. */
    liveStartedAt?: string | null
    /** ISO timestamp the 1st half was ended (match in half-time "pauza"); null otherwise. */
    firstHalfEndedAt?: string | null
    /** ISO timestamp the 2nd half was started; null until the organizer starts it. */
    secondHalfStartedAt?: string | null
    /** Scheduled kickoff (set when the schedule is generated); null before. */
    kickoffAt?: string | null
    /** Accumulated team fouls per half (futsal "deveterac" tracking). */
    fouls1First?: number | null
    fouls1Second?: number | null
    fouls2First?: number | null
    fouls2Second?: number | null
}

export type Group = {
    id: number
    name: string
    ordinal: number
    /** Ordered best team first (points → UEFA head-to-head → GD → GF). */
    standings: GroupStandingRow[]
    /** The group's fixtures, for result entry. */
    matches: GroupMatch[]
}

export type DrawMode = "AUTO" | "MANUAL"

/** Places one team into the group at the given 0-based ordinal (A=0, B=1, …). */
export type DrawAssignment = {
    teamId: number
    groupOrdinal: number
}

export type DrawRequest = {
    mode: DrawMode
    /** Chosen at draw time (no longer at tournament creation). */
    groupCount?: number | null
    advancePerGroup?: number | null
    /** Required when mode is MANUAL; ignored for AUTO. */
    assignments?: DrawAssignment[] | null
}
