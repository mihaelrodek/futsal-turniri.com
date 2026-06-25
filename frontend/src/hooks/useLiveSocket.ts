import { useEffect, useRef } from "react"

/** A realtime "live data changed" push from the backend (see LiveSocket.java). */
export type LiveUpdate = {
    type: string
    tournamentUuid: string | null
    matchId: number | null
}

/**
 * Subscribe to the realtime live channel (`/ws/live`). `onUpdate` fires with
 * the parsed message whenever the server pushes a change (goal, card, start,
 * finish, half, fouls, recorded result), so the page can refetch instantly
 * instead of waiting for its poll.
 *
 * The socket reconnects with backoff and cleans up on unmount. Polling is kept
 * elsewhere as a fallback, so if the socket can't connect (old browser, proxy
 * stripping the upgrade) the page still updates — just a few seconds slower.
 *
 * The path `/ws/live` is independent of the `/api` REST root: Caddy proxies
 * `/ws/*` in production and the Vite dev server proxies it in development.
 */
export function useLiveSocket(
    onUpdate: (msg: LiveUpdate) => void,
    enabled = true,
): void {
    // Keep the latest callback without re-running the connect effect.
    const cbRef = useRef(onUpdate)
    cbRef.current = onUpdate

    useEffect(() => {
        if (!enabled) return
        if (typeof window === "undefined" || !("WebSocket" in window)) return

        let socket: WebSocket | null = null
        let disposed = false
        let attempt = 0
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null

        const wsUrl = () => {
            const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
            return `${proto}//${window.location.host}/ws/live`
        }

        const scheduleReconnect = () => {
            if (disposed) return
            attempt += 1
            // 1s, 2s, 4s, 8s … capped at 15s.
            const delay = Math.min(15000, 500 * 2 ** Math.min(attempt, 5))
            reconnectTimer = setTimeout(connect, delay)
        }

        function connect() {
            if (disposed) return
            try {
                socket = new WebSocket(wsUrl())
            } catch {
                scheduleReconnect()
                return
            }
            socket.onopen = () => {
                attempt = 0
            }
            socket.onmessage = (ev) => {
                try {
                    cbRef.current(JSON.parse(ev.data) as LiveUpdate)
                } catch {
                    /* ignore malformed frames */
                }
            }
            socket.onclose = () => {
                if (!disposed) scheduleReconnect()
            }
            socket.onerror = () => {
                // Let onclose drive the reconnect.
                try {
                    socket?.close()
                } catch {
                    /* noop */
                }
            }
        }

        connect()

        return () => {
            disposed = true
            if (reconnectTimer) clearTimeout(reconnectTimer)
            try {
                socket?.close()
            } catch {
                /* noop */
            }
        }
    }, [enabled])
}
