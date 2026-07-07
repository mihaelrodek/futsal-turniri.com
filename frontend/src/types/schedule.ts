// Match-scheduling types (Phase E4).

export type ScheduleConfig = {
    halfCount: number | null
    halfLengthMin: number | null
    halftimeBreakMin: number | null
    breakBetweenMatchesMin: number | null
    bufferMin: number | null
}

export type ScheduledMatch = {
    matchId: number
    stage: string
    /** Group letter (A, B, …) for GROUP matches; null for knockout. */
    groupName?: string | null
    roundNumber: number | null
    team1Id: number | null
    team1Name: string | null
    team2Id: number | null
    team2Name: string | null
    score1: number | null
    score2: number | null
    kickoffAt: string | null
    status: string
    /** Knockout only - team that advanced (decides win/loss); null for groups. */
    winnerTeamId?: number | null
    /** Penalty-shootout score (knockout level after regulation). */
    penalties1?: number | null
    penalties2?: number | null
}

export type Schedule = ScheduleConfig & {
    slotLengthMin: number
    /** Every match in play order. */
    matches: ScheduledMatch[]
}
