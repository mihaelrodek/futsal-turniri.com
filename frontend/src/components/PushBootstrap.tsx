import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { usePushSubscription } from "../hooks/usePushSubscription"

/**
 * Mounted once at the app root. Two responsibilities:
 *
 *   1. Auto-subscribe the logged-in user to Web Push (via the hook).
 *   2. Listen for {@code futsal:navigate} postMessage events that the
 *      service worker dispatches when the user clicks a notification.
 *      The SW resolves to an existing open tab and asks it to route
 *      to the target URL - we honour that with a client-side navigate
 *      instead of a hard reload so the SPA state survives.
 */
export default function PushBootstrap() {
    usePushSubscription()
    const navigate = useNavigate()

    useEffect(() => {
        if (!("serviceWorker" in navigator)) return
        function onMessage(e: MessageEvent) {
            const data = e?.data
            if (data && data.type === "futsal:navigate" && typeof data.url === "string") {
                navigate(data.url)
            }
        }
        navigator.serviceWorker.addEventListener("message", onMessage)
        return () => navigator.serviceWorker.removeEventListener("message", onMessage)
    }, [navigate])

    return null
}
