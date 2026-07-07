import { useEffect, useRef } from "react"

/* ──────────────────────────────────────────────────────────────────────────
   usePolling - run a callback immediately, then on an interval, but ONLY
   while the tab is visible.

   Why: several always-mounted components (live nav item, mobile bottom nav,
   the /uzivo page, embeds) used to poll `/tournaments/live` every 30s
   forever - including in background tabs nobody was looking at. That's
   wasted server load + battery. This hook:

     • fires the callback once on mount,
     • ticks every `intervalMs` while `document.visibilityState === "visible"`,
     • skips ticks while the tab is hidden,
     • fires once more the moment the tab becomes visible again (so the data
       is fresh the instant the user returns).

   The callback is kept in a ref so changing its identity between renders
   doesn't restart the interval.
   ────────────────────────────────────────────────────────────────────── */

export function usePolling(
    callback: () => void,
    intervalMs: number,
    enabled = true,
) {
    const cbRef = useRef(callback)
    useEffect(() => {
        cbRef.current = callback
    })

    useEffect(() => {
        if (!enabled || intervalMs <= 0) return

        const run = () => cbRef.current()

        // Immediate first load.
        run()

        const tick = () => {
            if (document.visibilityState === "visible") run()
        }
        const id = window.setInterval(tick, intervalMs)

        // Refresh the instant the tab regains focus.
        const onVisible = () => {
            if (document.visibilityState === "visible") run()
        }
        document.addEventListener("visibilitychange", onVisible)

        return () => {
            clearInterval(id)
            document.removeEventListener("visibilitychange", onVisible)
        }
    }, [intervalMs, enabled])
}
