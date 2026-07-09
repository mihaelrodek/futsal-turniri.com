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
 *  - TIMER  - a running match clock (elapsed time from {@code liveStartedAt}).
 *  - SIMPLE - just marked live; the organizer uses their own external timer.
 */
export type MatchLiveMode = "TIMER" | "SIMPLE"

/** The kind of thing that happened during a live match.
 *
 *  OWN_GOAL is a goal into one's OWN net: the event's `teamId` is the
 *  BENEFICIARY (the side whose score went up); `playerId` - when named -
 *  belongs to the other team. Own goals count in the score but never in
 *  the scorer stats.
 *
 *  PENALTY_GOAL / PENALTY_MISSED record an individual knockout
 *  penalty-shootout kick (who shot + whether it scored); they never affect
 *  the match score or scorer stats - the shootout total lives in the
 *  match's penalties1/2. */
export type MatchEventType =
    | "GOAL"
    | "OWN_GOAL"
    | "YELLOW_CARD"
    | "RED_CARD"
    | "PENALTY_GOAL"
    | "PENALTY_MISSED"

/** A single recorded event in a live (or finished) match. */
export type MatchEventDto = {
    id: number
    type: MatchEventType
    /** Null for an unattributed event (player not named). */
    playerId: number | null
    /** Null for an unattributed event (player not named). */
    playerName: string | null
    /** The side the event belongs to on the timeline. For OWN_GOAL this is
     *  the beneficiary - the side whose score went up. */
    teamId: number
    minute: number
    /** Set only for GOAL events that had an assist; null otherwise. */
    assistPlayerId: number | null
    assistPlayerName: string | null
    /** Client idempotency key (UUID) echoed by the backend. Present for events
     *  created through the offline-aware path; used to reconcile an optimistic
     *  (offline) event with its persisted server row. */
    clientEventId?: string | null
}

/** Request body for creating a new match event. */
export type CreateMatchEventRequest = {
    type: MatchEventType
    /** May be null for any event recorded without naming the player
     *  (unknown scorer / carded player / penalty taker). For OWN_GOAL a
     *  named player is the one who put it into his OWN net. */
    playerId: number | null
    /** Required (instead of playerId) when recording an event with no named
     *  player - names the side. For OWN_GOAL this is the COMMITTING team
     *  (the goal counts for the opponent). Ignored when playerId is set. */
    teamId?: number | null
    minute: number
    /** Optional - only meaningful for GOAL events. */
    assistPlayerId?: number | null
    /** Optional client idempotency key (UUID). When set, the backend dedupes a
     *  resent event so an offline-queued goal isn't inserted twice on replay. */
    clientEventId?: string | null
}
