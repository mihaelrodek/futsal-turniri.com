// Knockout bracket types (Phase E3).

import type { MatchLiveMode } from "./matchEvents"

export type BracketMatch = {
    matchId: number
    stage: string
    team1Id: number | null
    team1Name: string | null
    team2Id: number | null
    team2Name: string | null
    score1: number | null
    score2: number | null
    penalties1: number | null
    penalties2: number | null
    winnerTeamId: number | null
    status: string
    /** Set while/after the match is LIVE - which live mode was chosen. */
    liveMode?: MatchLiveMode | null
    /** ISO timestamp the match was started LIVE; drives the TIMER clock. */
    liveStartedAt?: string | null
    /** ISO timestamp the 1st half was ended (match in half-time "pauza"); null otherwise. */
    firstHalfEndedAt?: string | null
    /** ISO timestamp the 2nd half was started; null until the organizer starts it. */
    secondHalfStartedAt?: string | null
    /** Scheduled kickoff; null until the schedule is generated/confirmed. A
     *  match can't be started live before it has one. */
    kickoffAt?: string | null
    /** Accumulated team fouls per half (futsal "deveterac" tracking). */
    fouls1First?: number | null
    fouls1Second?: number | null
    fouls2First?: number | null
    fouls2Second?: number | null
}

export type BracketRound = {
    stage: string
    title: string
    matches: BracketMatch[]
}

export type Bracket = {
    /** Rounds ordered earliest → final. Empty before the bracket is generated. */
    rounds: BracketRound[]
    thirdPlace: BracketMatch | null
}

export type KnockoutResult = {
    score1: number
    score2: number
    /** Required (and must differ) only when score1 === score2. */
    penalties1?: number | null
    penalties2?: number | null
}
