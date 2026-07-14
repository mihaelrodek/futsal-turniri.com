import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
    addMatchEvent,
    deleteMatchEvent,
    fetchMatchEvents,
} from "../api/matchEvents"
import type { CreateMatchEventRequest, MatchEventDto, MatchEventType } from "../types/matchEvents"

/* ──────────────────────────────────────────────────────────────────────────
   useOfflineMatchEvents - offline-first live scoring for one match.

   Goals/cards are recorded OPTIMISTICALLY (shown instantly, score derives from
   them) and, when the network is down, QUEUED in localStorage. On reconnect the
   queue replays in order. Each queued add carries a client UUID; the backend
   dedupes on it, so a resend never doubles a goal.

   The rendered `events` are a merge of the last server snapshot with the still-
   pending local ops, so a reload mid-outage keeps everything the organizer
   entered. Scope: match EVENTS (goals/cards/own-goals) add + delete - fouls,
   half transitions and the final result still need the network.
   ────────────────────────────────────────────────────────────────────────── */

/** Display fields the caller already knows, so an offline event renders
 *  correctly (the server DTO isn't available until it syncs). For OWN_GOAL
 *  `teamId` is the beneficiary side (where it shows on the timeline). */
export type OptimisticDisplay = {
    type: MatchEventType
    playerId: number | null
    playerName: string | null
    teamId: number
    minute: number
    assistPlayerId?: number | null
    assistPlayerName?: string | null
}

type AddOp = {
    kind: "add"
    clientEventId: string
    payload: CreateMatchEventRequest
    display: OptimisticDisplay
    seq: number
}
type DelOp = { kind: "del"; eventId: number; seq: number }
type Op = AddOp | DelOp

const KEY = (uuid: string, matchId: number) => `liveq:v1:${uuid}:${matchId}`

function loadQueue(uuid: string, matchId: number): Op[] {
    try {
        const raw = localStorage.getItem(KEY(uuid, matchId))
        const parsed = raw ? JSON.parse(raw) : []
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}
function saveQueue(uuid: string, matchId: number, q: Op[]) {
    try {
        if (q.length === 0) localStorage.removeItem(KEY(uuid, matchId))
        else localStorage.setItem(KEY(uuid, matchId), JSON.stringify(q))
    } catch {
        /* storage full / disabled - the in-memory queue still works this session */
    }
}

/** A pending add rendered as a MatchEventDto. Optimistic rows get a NEGATIVE id
 *  (derived from the op seq) so the UI can tell them apart and delete resolves
 *  to "drop the queued op" instead of a server call. */
function optimisticDto(op: AddOp): MatchEventDto {
    return {
        id: -op.seq,
        type: op.display.type,
        playerId: op.display.playerId,
        playerName: op.display.playerName,
        teamId: op.display.teamId,
        minute: op.display.minute,
        assistPlayerId: op.display.assistPlayerId ?? null,
        assistPlayerName: op.display.assistPlayerName ?? null,
        clientEventId: op.clientEventId,
    }
}

function newClientId(): string {
    try {
        if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
    } catch { /* fall through */ }
    return `c-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

export function useOfflineMatchEvents(uuid: string, matchId: number) {
    // Last snapshot fetched from the server (source of truth for synced events).
    const [serverEvents, setServerEvents] = useState<MatchEventDto[]>([])
    const [loaded, setLoaded] = useState(false)
    // The queue REF is the synchronous source of truth; the state mirror only
    // triggers re-renders. This ordering matters: persisting used to happen
    // inside a React setState updater, which runs on the NEXT render - so the
    // replay fired right after addEvent read a stale queue, saw nothing to
    // send, and the goal sat "syncing" until a remount/refresh flushed it.
    const queueRef = useRef<Op[]>(loadQueue(uuid, matchId))
    const [queue, setQueueState] = useState<Op[]>(queueRef.current)
    const [online, setOnline] = useState<boolean>(
        typeof navigator === "undefined" ? true : navigator.onLine,
    )
    const [syncing, setSyncing] = useState(false)
    const seqRef = useRef<number>(
        Math.max(0, ...queueRef.current.map((o) => o.seq)) + 1,
    )
    const replayingRef = useRef(false)
    // A replay was requested while one was in flight → run one more pass when
    // the current one ends, so ops enqueued mid-drain never hang.
    const rerunRef = useRef(false)

    const persist = useCallback(
        (updater: (q: Op[]) => Op[]) => {
            queueRef.current = updater(queueRef.current)
            saveQueue(uuid, matchId, queueRef.current)
            setQueueState(queueRef.current)
        },
        [uuid, matchId],
    )

    // Merge the server snapshot with still-pending local ops:
    //  - drop synced events that have a queued delete,
    //  - append optimistic adds not yet present on the server (by client id).
    const events = useMemo(() => {
        const delIds = new Set(
            queue.filter((o): o is DelOp => o.kind === "del").map((o) => o.eventId),
        )
        const serverClientIds = new Set(
            serverEvents.map((e) => e.clientEventId).filter(Boolean) as string[],
        )
        const base = serverEvents.filter((e) => !delIds.has(e.id))
        const optimistic = queue
            .filter((o): o is AddOp => o.kind === "add" && !serverClientIds.has(o.clientEventId))
            .map(optimisticDto)
        // Stable sort by minute; equal minutes keep server-then-optimistic order.
        return [...base, ...optimistic]
            .map((e, i) => ({ e, i }))
            .sort((a, b) => a.e.minute - b.e.minute || a.i - b.i)
            .map((x) => x.e)
    }, [serverEvents, queue])

    const pending = queue.length

    const refetch = useCallback(async () => {
        try {
            const ev = await fetchMatchEvents(uuid, matchId)
            setServerEvents(ev)
            setLoaded(true)
            return true
        } catch {
            // Offline / server down - keep whatever we have; optimistic rows
            // still render from the queue.
            setLoaded(true)
            return false
        }
    }, [uuid, matchId])

    // Drain the queue in strict order, head-first off the LIVE ref - an op
    // enqueued while a previous one is being sent is picked up by the next
    // loop iteration instead of waiting for a new trigger. A network failure
    // stops the drain (the remaining ops stay queued for the next attempt).
    const replay = useCallback(async () => {
        if (replayingRef.current) {
            rerunRef.current = true
            return
        }
        if (queueRef.current.length === 0) return
        replayingRef.current = true
        setSyncing(true)
        try {
            while (queueRef.current.length > 0) {
                const op = queueRef.current[0]
                try {
                    if (op.kind === "add") {
                        await addMatchEvent(
                            uuid,
                            matchId,
                            { ...op.payload, clientEventId: op.clientEventId },
                            { silent: true },
                        )
                    } else {
                        await deleteMatchEvent(uuid, matchId, op.eventId, { silent: true })
                    }
                    // Op succeeded - remove just this one and keep going.
                    persist((q) => q.filter((x) => x.seq !== op.seq))
                } catch (err: any) {
                    if (err?.response) {
                        // The server REJECTED it (4xx/5xx) - it won't succeed on
                        // retry, so drop this poison op and keep draining the
                        // rest instead of blocking the queue forever.
                        persist((q) => q.filter((x) => x.seq !== op.seq))
                        continue
                    }
                    // Genuine network error - stop; retry on the next online tick.
                    break
                }
            }
        } finally {
            replayingRef.current = false
            setSyncing(false)
            // Re-sync the snapshot so optimistic rows collapse into real ones.
            await refetch()
            // Somebody asked for a replay while this one ran - go again so
            // that op doesn't sit queued until the next external trigger.
            if (rerunRef.current) {
                rerunRef.current = false
                void replay()
            }
        }
    }, [uuid, matchId, persist, refetch])

    // Initial load + reset when the match changes.
    useEffect(() => {
        setServerEvents([])
        setLoaded(false)
        queueRef.current = loadQueue(uuid, matchId)
        setQueueState(queueRef.current)
        seqRef.current = Math.max(0, ...queueRef.current.map((o) => o.seq)) + 1
        void refetch().then(() => { void replay() })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uuid, matchId])

    // Online/offline wiring - replay as soon as connectivity returns.
    useEffect(() => {
        const goOnline = () => { setOnline(true); void replay() }
        const goOffline = () => setOnline(false)
        window.addEventListener("online", goOnline)
        window.addEventListener("offline", goOffline)
        return () => {
            window.removeEventListener("online", goOnline)
            window.removeEventListener("offline", goOffline)
        }
    }, [replay])

    /** Record a goal/card. Shows instantly; sends now if online, else queues. */
    const addEvent = useCallback(
        (payload: CreateMatchEventRequest, display: OptimisticDisplay) => {
            const clientEventId = payload.clientEventId ?? newClientId()
            const op: AddOp = {
                kind: "add",
                clientEventId,
                payload: { ...payload, clientEventId },
                display,
                seq: seqRef.current++,
            }
            persist((q) => [...q, op])
            // Try to flush right away when online; if it fails it stays queued.
            if (navigator.onLine) void replay()
        },
        [persist, replay],
    )

    /** Remove an event. A still-pending optimistic row (negative id) just drops
     *  its queued add; a synced row queues a delete (sent now if online). */
    const deleteEvent = useCallback(
        (ev: MatchEventDto) => {
            if (ev.id < 0) {
                // Optimistic, not yet synced - cancel the queued add outright.
                persist((q) =>
                    q.filter((o) => !(o.kind === "add" && o.clientEventId === ev.clientEventId)),
                )
                return
            }
            persist((q) => [...q, { kind: "del", eventId: ev.id, seq: seqRef.current++ }])
            if (navigator.onLine) void replay()
        },
        [persist, replay],
    )

    return {
        /** Merged optimistic + server events, ready to render. */
        events,
        /** False until the first (successful or failed) load attempt resolves. */
        loaded,
        /** Number of unsynced operations still queued. */
        pending,
        /** Live navigator.onLine, kept in sync with the online/offline events. */
        online,
        /** True while the queue is draining. */
        syncing,
        addEvent,
        deleteEvent,
        /** Force a fresh server fetch (e.g. after a non-event mutation). */
        refetch,
    }
}
