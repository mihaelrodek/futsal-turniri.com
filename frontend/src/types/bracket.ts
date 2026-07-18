// Knockout bracket types (Phase E3).

import type { MatchLiveMode } from "./matchEvents"

export type BracketMatch = {
    matchId: number
    stage: string
    team1Id: number | null
    team1Name: string | null
    team2Id: number | null
    team2Name: string | null
    /** Predicted-pairing labels shown before a slot's team is decided:
     *  `slotNLabel` is the short code ("A1", "D2", "Pobj. ČF1"); once that group
     *  finishes the real team lands in `teamNName`. `slotNPredictedName` carries
     *  the group-position team name where the backend can already resolve it.
     *  All null for KNOCKOUT_ONLY brackets (no predictions). */
    slot1Label: string | null
    slot2Label: string | null
    slot1PredictedName: string | null
    slot2PredictedName: string | null
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
    /** ISO timestamp the live clock was paused; null while it runs. */
    livePausedAt?: string | null
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
    /** ISO timestamp the organizer confirmed the knockout draw; null until
     *  confirmed. While null (and `confirmationRequired`) the knockout can't
     *  start matches or record results. */
    confirmedAt: string | null
    /** Whether this bracket needs an explicit confirmation step once the group
     *  stage ends before the knockout can start. False for KNOCKOUT_ONLY. */
    confirmationRequired: boolean
}

export type KnockoutResult = {
    score1: number
    score2: number
    /** Required (and must differ) only when score1 === score2. */
    penalties1?: number | null
    penalties2?: number | null
}
