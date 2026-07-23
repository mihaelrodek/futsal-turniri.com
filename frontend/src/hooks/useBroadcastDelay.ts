import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { SPECTO_BASE_URL } from "../api/spectoStream"
import { useSpectoStreamId } from "./useSpectoStreamId"

/* ──────────────────────────────────────────────────────────────────────────
   Broadcast delay - keeps this site's live surfaces from spoiling the stream.

   SpectoStream deliberately holds every event back by `delay_offset_ms` so the
   overlay reveals a goal exactly when the (a few seconds behind) video does.
   Our own timeline had no such notion: the moment the organizer tapped "gol"
   the site showed it - ahead of the broadcast the viewer is watching.

   These helpers re-align the two: read the platform's own delay for the
   tournament's stream, then withhold events until `createdAt + delay`.

   Fails OPEN: no stream, unreachable platform or an event with no timestamp
   means zero delay, i.e. exactly the old behaviour. A viewer must never lose
   events because the delay lookup broke.
   ────────────────────────────────────────────────────────────────────── */

/** Minimal shape we read from the platform's public stream state. */
type SpectoState = { delay_offset_ms?: number; stream?: { status?: string } }

/**
 * The tournament's broadcast delay in ms, or 0 when nothing is being broadcast
 * right now. Public + CORS-open on the platform, so it's read straight from
 * there - the same origin the embedded player already loads from.
 *
 * Two conditions, both required. A LINKED tournament is not enough: a linked
 * stream keeps its configured delay (15s on this deployment) even while the
 * camera is off, and holding the timeline back by 15s for a match nobody is
 * watching would be a plain bug. So the delay applies only while the stream's
 * own status is "live". Polled, not cached long: the camera can start or stop
 * mid-match and the timeline has to follow within seconds, not minutes.
 */
export function useBroadcastDelayMs(uuid: string | null | undefined): number {
    const streamId = useSpectoStreamId(uuid)
    const { data } = useQuery({
        queryKey: ["spectoDelay", streamId ?? "none"],
        queryFn: async (): Promise<number> => {
            const res = await fetch(`${SPECTO_BASE_URL}/v1/streams/${streamId}/state`)
            if (!res.ok) return 0
            const body: SpectoState = await res.json()
            if (body?.stream?.status !== "live") return 0
            const ms = Number(body?.delay_offset_ms)
            return Number.isFinite(ms) && ms > 0 ? ms : 0
        },
        enabled: !!streamId,
        staleTime: 15_000,
        refetchInterval: 30_000,
    })
    return data ?? 0
}

/**
 * A clock that ticks every second while `active`, so a delayed event appears
 * on its own the moment its hold expires - without it the list would only
 * update on the next poll.
 */
export function useTick(active: boolean): number {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        if (!active) return
        const id = window.setInterval(() => setNow(Date.now()), 1000)
        return () => window.clearInterval(id)
    }, [active])
    return now
}

/**
 * Is this event still being withheld from the viewer?
 *
 * `createdAt` is SERVER time, `now` is the visitor's own clock, so the two can
 * disagree. A device whose clock lags makes every fresh event look like it is
 * in the future - and a naive "hide until now - delay" would then hide goals
 * for as long as the skew lasts, i.e. potentially the whole match. Hence the
 * lower bound: once an event looks more than 2x the delay into the future, the
 * clock is plainly wrong rather than the event being new, and we FAIL OPEN and
 * show it. Losing a few seconds of sync beats losing the goal entirely.
 */
function isHeldBack(createdAt: string | null | undefined, delayMs: number, now: number): boolean {
    if (!createdAt) return false
    const t = Date.parse(createdAt)
    if (!Number.isFinite(t)) return false
    const age = now - t
    if (age >= delayMs) return false          // broadcast has caught up
    if (age < -2 * delayMs) return false      // clock skew, not a new event
    return true
}

/**
 * The broadcast-adjusted score for one side.
 *
 * SUBTRACTS the goals still on hold from the authoritative score rather than
 * counting the visible ones. That distinction matters: a score can also be
 * typed in by hand ("unesi samo rezultat"), overridden by an organizer, or
 * carry goals recorded before this feature existed - none of which have
 * matching events. Counting visible events would show 0 for all of those;
 * subtracting only ever removes goals we are certain are being withheld, so
 * every other path keeps its real number.
 *
 * `teamId` is the side the goal is credited to - which is what an OWN_GOAL
 * event already stores (the beneficiary), so own goals need no special case.
 * Shootout kicks (PENALTY_*) never move this score and are ignored.
 */
export function visibleScore(
    score: number | null | undefined,
    teamId: number | null | undefined,
    events: { type: string; teamId: number; createdAt?: string | null }[],
    delayMs: number,
    now: number,
): number | null {
    if (score == null) return score ?? null
    if (delayMs <= 0 || teamId == null) return score
    let held = 0
    for (const e of events) {
        if (e.teamId !== teamId) continue
        if (e.type !== "GOAL" && e.type !== "OWN_GOAL") continue
        if (isHeldBack(e.createdAt, delayMs, now)) held++
    }
    return Math.max(0, score - held)
}

/**
 * Drop events the broadcast hasn't reached yet. `delayMs <= 0` returns the
 * list untouched (identity), and an event without a `createdAt` is always
 * shown - old rows predate the field, and hiding them forever would be worse
 * than a momentary spoiler.
 */
export function withinBroadcast<T extends { createdAt?: string | null }>(
    events: T[],
    delayMs: number,
    now: number,
): T[] {
    if (delayMs <= 0) return events
    return events.filter((e) => !isHeldBack(e.createdAt, delayMs, now))
}
