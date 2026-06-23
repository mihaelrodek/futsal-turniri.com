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
    roundNumber: number | null
    team1Id: number | null
    team1Name: string | null
    team2Id: number | null
    team2Name: string | null
    score1: number | null
    score2: number | null
    kickoffAt: string | null
    status: string
}

export type Schedule = ScheduleConfig & {
    slotLengthMin: number
    /** Every match in play order. */
    matches: ScheduledMatch[]
}
