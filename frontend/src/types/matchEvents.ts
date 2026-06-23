// src/types/matchEvents.ts
/**
 * Live-match event types.
 *
 * A match progresses SCHEDULED → LIVE → FINISHED. While LIVE the organizer
 * records goals and cards as {@link MatchEventDto}s; adding/removing a GOAL
 * makes the backend recompute the match score. See src/api/matchEvents.ts
 * for the endpoint contract.
 */

/** Lifecycle state of a match. */
export type MatchStatus = "SCHEDULED" | "LIVE" | "FINISHED"

/**
 * How a LIVE match is being tracked:
 *  - TIMER  — a running match clock (elapsed time from {@code liveStartedAt}).
 *  - SIMPLE — just marked live; the organizer uses their own external timer.
 */
export type MatchLiveMode = "TIMER" | "SIMPLE"

/** The kind of thing that happened during a live match. */
export type MatchEventType = "GOAL" | "YELLOW_CARD" | "RED_CARD"

/** A single recorded event in a live (or finished) match. */
export type MatchEventDto = {
    id: number
    type: MatchEventType
    playerId: number
    playerName: string
    teamId: number
    minute: number
    /** Set only for GOAL events that had an assist; null otherwise. */
    assistPlayerId: number | null
    assistPlayerName: string | null
}

/** Request body for creating a new match event. */
export type CreateMatchEventRequest = {
    type: MatchEventType
    playerId: number
    minute: number
    /** Optional — only meaningful for GOAL events. */
    assistPlayerId?: number | null
}
