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
 *  match's penalties1/2.
 *
 *  An IN-GAME penalty (awarded during regulation play) is different: a
 *  SCORED one is a plain GOAL with `penalty: true` on the event (counts in
 *  the score + scorer stats like any goal), a MISSED one is
 *  PENALTY_MISSED_LIVE - a timeline-only record.
 *
 *  EXCLUSION is a futsal 2-minute suspension ("isključenje 2 min") -
 *  timeline-only; unlike a red card it does NOT lock the player out.
 *
 *  FOUL is one accumulated TEAM foul, written alongside the fouls counters so
 *  the timeline can show when it happened. Carries no player (nobody enters
 *  who committed it) and is rendered only while the tournament has
 *  `showFoulsInTimeline` on. */
export type MatchEventType =
    | "GOAL"
    | "OWN_GOAL"
    | "YELLOW_CARD"
    | "RED_CARD"
    | "PENALTY_GOAL"
    | "PENALTY_MISSED"
    | "PENALTY_MISSED_LIVE"
    | "EXCLUSION"
    | "FOUL"

/** A single recorded event in a live (or finished) match. */
export type MatchEventDto = {
    id: number
    type: MatchEventType
    /** Which half it happened in (1/2) when RECORDED rather than inferred from
     *  the minute; null for older rows and for the types that still infer it.
     *  Set for FOUL, because the minute rule is ambiguous exactly at the half
     *  boundary - minute 10 of a 2x10 match belongs to the first half but
     *  satisfies "minute >= half length". */
    half?: number | null
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
    /** True only for a GOAL scored from an in-game penalty - rendered with a
     *  "(pen.)" tag. Optional: older cached rows / optimistic rows may omit it. */
    penalty?: boolean
    /** Client idempotency key (UUID) echoed by the backend. Present for events
     *  created through the offline-aware path; used to reconcile an optimistic
     *  (offline) event with its persisted server row. */
    clientEventId?: string | null
    /** Server wall-clock time the event was recorded (ISO-8601). Drives the
     *  broadcast-delay hold on public timelines - see hooks/useBroadcastDelay.
     *  Optional: optimistic (offline) rows have none until they sync. */
    createdAt?: string | null
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
    /** Optional; honoured only for GOAL: marks an in-game penalty goal. The
     *  goal still counts as a regular goal in the score and scorer stats. */
    penalty?: boolean
    /** Optional client idempotency key (UUID). When set, the backend dedupes a
     *  resent event so an offline-queued goal isn't inserted twice on replay. */
    clientEventId?: string | null
}
