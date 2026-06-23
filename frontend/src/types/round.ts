// src/api/rounds.ts
export type MatchDto = {
    id: number
    tableNo: number
    team1Id?: number
    team1Name?: string
    team2Id?: number
    team2Name?: string
    score1?: number
    score2?: number
    winnerTeamId?: number
    status: "SCHEDULED" | "FINISHED"
}

export type RoundDto = {
    id: number
    number: number
    status: "IN_PROGRESS" | "COMPLETED"
    matches: MatchDto[]
}