import { useEffect, useState } from "react"

import { usePolling } from "./usePolling"
import { pingStreamPresence } from "../api/streamPresence"

/* ──────────────────────────────────────────────────────────────────────────
   useStreamPresence - "how many people are watching the stream right now".

   While `active` (the stream is on) and the tab is visible, heartbeats every
   20s with a stable per-tab session id and returns the server's live count.
   usePolling fires immediately, ticks only on a visible tab, and re-fires on
   visibilitychange - so hiding the tab stops the heartbeat and the session
   drops out of the count on the server within one window. Null when inactive.
   ────────────────────────────────────────────────────────────────────────── */

const SESSION_KEY = "futsal-presence-id"

/** A random id kept for the lifetime of this tab (one viewer = one tab). */
function tabSessionId(): string {
    try {
        let id = sessionStorage.getItem(SESSION_KEY)
        if (!id) {
            id = crypto.randomUUID?.() ?? `s-${Date.now()}-${Math.random().toString(36).slice(2)}`
            sessionStorage.setItem(SESSION_KEY, id)
        }
        return id
    } catch {
        // Private-mode / storage disabled - fall back to a per-call id.
        return `s-${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
}

export function useStreamPresence(active: boolean): number | null {
    const [count, setCount] = useState<number | null>(null)

    usePolling(
        () => {
            if (!active) return
            pingStreamPresence(tabSessionId())
                .then(setCount)
                .catch(() => { /* silent - next tick retries */ })
        },
        20_000,
        active,
    )

    // Drop the badge the moment the stream goes off.
    useEffect(() => {
        if (!active) setCount(null)
    }, [active])

    return count
}
