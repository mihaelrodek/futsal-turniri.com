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

/* ── Multi-day scheduling ─────────────────────────────────────────────── */

/** Predicted match counts, for the "matches remaining to schedule" counter. */
export type SchedulePlanInfo = {
    groupMatches: number
    knockoutMatches: number
    totalMatches: number
}

/** One day of the plan: the day's first kickoff (ISO offset) + how many
 *  matches play that day. */
export type DaySchedule = {
    firstKickoff: string
    matches: number
}

/** Request for the multi-day preview / generate - format config + day plan. */
export type SchedulePlanRequest = ScheduleConfig & {
    days: DaySchedule[]
}

/** One planned match in the (non-persisted) preview. */
export type SchedulePreviewMatch = {
    kickoff: string
    stage: string
    groupName?: string | null
    team1Name?: string | null
    team2Name?: string | null
    /** False for knockout placeholders (teams decided after the group stage). */
    teamsKnown: boolean
}

/** The computed multi-day schedule shown before confirming. */
export type SchedulePreview = {
    totalMatches: number
    groupMatches: number
    knockoutMatches: number
    scheduled: number
    unscheduled: number
    slotLengthMin: number
    days: { date: string; matches: SchedulePreviewMatch[] }[]
}
