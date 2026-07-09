import { useCallback, useEffect, useRef, useState } from "react"
import { setMatchFouls } from "../api/matchEvents"

/* ──────────────────────────────────────────────────────────────────────────
   useOfflineMatchFouls - offline-first accumulated team fouls for one match.

   The organizer taps +/- on a foul counter repeatedly during play. Each tap
   updates the local counter INSTANTLY and, when the network is down, the new
   target value is QUEUED in localStorage (one entry per team/half). On
   reconnect the queue flushes the FINAL value with an idempotent "set to N"
   call, so many offline taps collapse into a single request and a lost
   response never over-counts.

   Contrast with the ±1 delta endpoint (adjustMatchFouls): a delta resent after
   a dropped response would double-count. Absolute set is safe to replay, which
   is exactly what an offline queue needs.
   ────────────────────────────────────────────────────────────────────────── */

const FIELDS = ["fouls1First", "fouls1Second", "fouls2First", "fouls2Second"] as const
type FoulField = (typeof FIELDS)[number]

/** A match's accumulated team fouls, per team and half (never null here). */
export type FoulCounts = Record<FoulField, number>

const FIELD_META: Record<FoulField, { team: 1 | 2; half: 1 | 2 }> = {
    fouls1First: { team: 1, half: 1 },
    fouls1Second: { team: 1, half: 2 },
    fouls2First: { team: 2, half: 1 },
    fouls2Second: { team: 2, half: 2 },
}

function fieldFor(team: 1 | 2, half: 1 | 2): FoulField {
    return team === 1
        ? half === 1 ? "fouls1First" : "fouls1Second"
        : half === 1 ? "fouls2First" : "fouls2Second"
}

/** Pending sets not yet confirmed by the server: field → target absolute count. */
type FoulQueue = Partial<Record<FoulField, number>>

const KEY = (uuid: string, matchId: number) => `foulq:v1:${uuid}:${matchId}`

function loadFoulQueue(uuid: string, matchId: number): FoulQueue {
    try {
        const raw = localStorage.getItem(KEY(uuid, matchId))
        const parsed = raw ? JSON.parse(raw) : {}
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
    } catch {
        return {}
    }
}
function saveFoulQueue(uuid: string, matchId: number, q: FoulQueue) {
    try {
        if (Object.keys(q).length === 0) localStorage.removeItem(KEY(uuid, matchId))
        else localStorage.setItem(KEY(uuid, matchId), JSON.stringify(q))
    } catch {
        /* storage full / disabled - the in-memory queue still works this session */
    }
}

/** Merge the server snapshot with any pending local targets (pending wins). */
function mergedCounts(server: FoulCounts, queue: FoulQueue): FoulCounts {
    const out = { ...server }
    for (const f of FIELDS) if (queue[f] != null) out[f] = queue[f] as number
    return out
}

export function useOfflineMatchFouls(
    uuid: string,
    matchId: number,
    server: FoulCounts,
) {
    // Refs are the source of truth (read synchronously inside taps/flush loop);
    // the state mirrors just trigger re-renders. Seed once from localStorage -
    // this component re-renders every clock tick, so don't re-read per render.
    const localRef = useRef<FoulCounts>(server)
    const queueRef = useRef<FoulQueue>({})
    const initRef = useRef(false)
    if (!initRef.current) {
        initRef.current = true
        queueRef.current = loadFoulQueue(uuid, matchId)
        localRef.current = mergedCounts(server, queueRef.current)
    }
    const [local, setLocalState] = useState<FoulCounts>(() => localRef.current)
    const [queue, setQueueState] = useState<FoulQueue>(() => queueRef.current)
    const [online, setOnline] = useState<boolean>(
        typeof navigator === "undefined" ? true : navigator.onLine,
    )
    const [syncing, setSyncing] = useState(false)
    const flushingRef = useRef(false)

    const commitLocal = useCallback((next: FoulCounts) => {
        localRef.current = next
        setLocalState(next)
    }, [])
    const commitQueue = useCallback(
        (next: FoulQueue) => {
            queueRef.current = next
            setQueueState(next)
            saveFoulQueue(uuid, matchId, next)
        },
        [uuid, matchId],
    )

    // Drain the queue: send each field's FINAL target with an idempotent set.
    // A network failure stops the drain (fields stay queued for the next
    // online tick); a server rejection drops that poison field and continues.
    const flush = useCallback(async () => {
        if (flushingRef.current) return
        if (Object.keys(queueRef.current).length === 0) return
        flushingRef.current = true
        setSyncing(true)
        try {
            // eslint-disable-next-line no-constant-condition
            while (true) {
                const field = (Object.keys(queueRef.current) as FoulField[])[0]
                if (!field) break
                const target = queueRef.current[field] as number
                const { team, half } = FIELD_META[field]
                try {
                    const res = await setMatchFouls(uuid, matchId, team, half, target)
                    // Clear only if unchanged during the await - a newer tap
                    // re-queued a fresher value we must still flush.
                    if (queueRef.current[field] === target) {
                        const nq = { ...queueRef.current }
                        delete nq[field]
                        commitQueue(nq)
                        commitLocal({ ...localRef.current, [field]: res[field] })
                    }
                } catch (err: any) {
                    if (err?.response) {
                        // Server REJECTED it (4xx/5xx) - won't succeed on retry,
                        // so drop this poison field and keep draining the rest.
                        const nq = { ...queueRef.current }
                        delete nq[field]
                        commitQueue(nq)
                        continue
                    }
                    // Genuine network error - stop; retry on the next online tick.
                    break
                }
            }
        } finally {
            flushingRef.current = false
            setSyncing(false)
        }
    }, [uuid, matchId, commitQueue, commitLocal])

    // Re-init when the match changes: reload its queue, re-merge over the server
    // snapshot, and try to flush anything left over from a previous outage.
    useEffect(() => {
        const q = loadFoulQueue(uuid, matchId)
        queueRef.current = q
        setQueueState(q)
        const merged = mergedCounts(server, q)
        localRef.current = merged
        setLocalState(merged)
        if (navigator.onLine) void flush()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uuid, matchId])

    // Adopt fresh server values (e.g. a live-socket update) for any field that
    // isn't mid-edit, so counts from another source flow in when we're idle.
    useEffect(() => {
        const q = queueRef.current
        const next = { ...localRef.current }
        let changed = false
        for (const f of FIELDS) {
            if (q[f] == null && next[f] !== server[f]) {
                next[f] = server[f]
                changed = true
            }
        }
        if (changed) commitLocal(next)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [server.fouls1First, server.fouls1Second, server.fouls2First, server.fouls2Second])

    // Replay as soon as connectivity returns.
    useEffect(() => {
        const goOnline = () => { setOnline(true); void flush() }
        const goOffline = () => setOnline(false)
        window.addEventListener("online", goOnline)
        window.addEventListener("offline", goOffline)
        return () => {
            window.removeEventListener("online", goOnline)
            window.removeEventListener("offline", goOffline)
        }
    }, [flush])

    /** Add/subtract one foul for a team's current half. Shows instantly; sends
     *  now if online, else queues the new target for reconnect. */
    const bump = useCallback(
        (team: 1 | 2, half: 1 | 2, delta: number) => {
            const field = fieldFor(team, half)
            const next = Math.max(0, (localRef.current[field] ?? 0) + delta)
            commitLocal({ ...localRef.current, [field]: next })
            commitQueue({ ...queueRef.current, [field]: next })
            if (navigator.onLine) void flush()
        },
        [commitLocal, commitQueue, flush],
    )

    /** Zero both teams' fouls for one half (queued as two idempotent sets). */
    const reset = useCallback(
        (half: 1 | 2) => {
            const f1 = fieldFor(1, half)
            const f2 = fieldFor(2, half)
            commitLocal({ ...localRef.current, [f1]: 0, [f2]: 0 })
            commitQueue({ ...queueRef.current, [f1]: 0, [f2]: 0 })
            if (navigator.onLine) void flush()
        },
        [commitLocal, commitQueue, flush],
    )

    return {
        /** Optimistic counts, ready to render. */
        fouls: local,
        /** Number of team/half counters awaiting sync. */
        pending: Object.keys(queue).length,
        /** Live navigator.onLine, kept in sync with online/offline events. */
        online,
        /** True while the queue is flushing. */
        syncing,
        bump,
        reset,
    }
}
