import { useEffect, useRef } from "react"
import { useAuth } from "../auth/AuthContext"
import {
    fetchPushPublicKey,
    registerPushSubscription,
    type PushSubscriptionJSON,
} from "../api/push"

/**
 * Auto-subscribe the current user to Web Push as soon as we have:
 *  1. a logged-in user (Firebase uid)
 *  2. browser support for service workers + push
 *  3. notification permission granted (or default — we'll ask)
 *  4. an active service worker registration
 *
 * "On by default for everyone" — per product decision — so this hook
 * actively requests permission on first login.
 *
 * iOS Safari quirk: even inside a PWA installed to the home screen,
 * `Notification.requestPermission()` only works when called *inside a
 * user gesture handler*. Calling it from a `useEffect` silently
 * resolves to "default" forever. So when the current permission is
 * `default`, we don't prompt eagerly — we attach a one-shot listener
 * for the next pointer/touch/click on the document and run the prompt
 * from there. Android tolerates either path; iOS requires the gesture.
 *
 * If permission is already `granted` we run the subscribe flow
 * immediately (no gesture needed once granted), so users who accepted
 * on a previous visit get re-synced on every login.
 */
export function usePushSubscription() {
    const { user, loading } = useAuth()
    const attemptedRef = useRef(false)

    useEffect(() => {
        if (loading) return
        if (!user?.uid) return
        if (attemptedRef.current) return
        attemptedRef.current = true

        // Bail cleanly on browsers that don't support Web Push at all
        // (older Safari, in-app webviews, etc.). The site still works,
        // just without the notification feature.
        if (typeof window === "undefined") return
        if (!("serviceWorker" in navigator)) return
        if (!("PushManager" in window)) return
        if (!("Notification" in window)) return

        // Bail if the user previously denied — we can't reprompt
        // without them changing the browser setting themselves.
        if (Notification.permission === "denied") {
            console.info("[push] permission denied — skipping")
            return
        }

        let cancelled = false

        const runSubscribeFlow = async () => {
            try {
                // Wait for the SW to be ready (it registers in main.tsx
                // after `load`). If it never registers — e.g. in dev
                // mode where the SW is intentionally not shipped — we
                // bail without warning.
                const reg = await navigator.serviceWorker.ready
                if (cancelled) return

                // Ask for permission only if not already decided. On
                // iOS this MUST be called from inside a user gesture
                // (see the listener wiring further down) — by the time
                // we get here, we're already inside that gesture.
                if (Notification.permission === "default") {
                    const result = await Notification.requestPermission()
                    if (cancelled) return
                    if (result !== "granted") {
                        console.info("[push] permission not granted:", result)
                        return
                    }
                } else if (Notification.permission !== "granted") {
                    return
                }

                // Already subscribed? Re-send to the backend in case
                // the server-side row got deleted (rare but possible
                // after a DB wipe). Cheap idempotent upsert.
                const existing = await reg.pushManager.getSubscription()
                if (existing) {
                    const json = existing.toJSON() as PushSubscriptionJSON
                    if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
                        await registerPushSubscription(json).catch(() => {})
                    }
                    console.info("[push] re-synced existing subscription")
                    return
                }

                // Fresh subscription. Need the VAPID public key the
                // backend serves — converted from base64url to the
                // Uint8Array that pushManager.subscribe expects.
                const { publicKey, ready } = await fetchPushPublicKey()
                if (cancelled) return
                if (!ready || !publicKey) {
                    console.warn("[push] backend not configured — skipping")
                    return
                }
                const applicationServerKey = urlBase64ToUint8Array(publicKey)
                const sub = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: applicationServerKey as BufferSource,
                })
                if (cancelled) return
                const json = sub.toJSON() as PushSubscriptionJSON
                if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
                    await registerPushSubscription(json)
                    console.info("[push] subscribed and registered")
                }
            } catch (err) {
                // Permission flow can throw for all kinds of reasons:
                // user denied, autoplay-style "must be in user gesture"
                // restrictions, network failure on the public-key fetch.
                // None of these are fatal — log for the curious and move on.
                console.warn("[push] subscription failed:", err)
            }
        }

        // If permission is already granted, run immediately — no
        // gesture needed, and we want to re-sync the endpoint with
        // the backend on every login (cheap idempotent upsert).
        if (Notification.permission === "granted") {
            void runSubscribeFlow()
            return () => {
                cancelled = true
            }
        }

        // Permission === "default". Defer the prompt to the next
        // user gesture. iOS Safari REQUIRES this; Android tolerates
        // either approach. We listen for the broadest set of gesture
        // events to catch whichever fires first on whichever device.
        const onFirstGesture = () => {
            document.removeEventListener("pointerdown", onFirstGesture, true)
            document.removeEventListener("touchend", onFirstGesture, true)
            document.removeEventListener("click", onFirstGesture, true)
            document.removeEventListener("keydown", onFirstGesture, true)
            void runSubscribeFlow()
        }
        document.addEventListener("pointerdown", onFirstGesture, { capture: true, once: true })
        document.addEventListener("touchend", onFirstGesture, { capture: true, once: true })
        document.addEventListener("click", onFirstGesture, { capture: true, once: true })
        document.addEventListener("keydown", onFirstGesture, { capture: true, once: true })

        return () => {
            cancelled = true
            document.removeEventListener("pointerdown", onFirstGesture, true)
            document.removeEventListener("touchend", onFirstGesture, true)
            document.removeEventListener("click", onFirstGesture, true)
            document.removeEventListener("keydown", onFirstGesture, true)
        }
    }, [user?.uid, loading])
}

/**
 * Convert a base64url-encoded VAPID public key (what our backend ships)
 * into the Uint8Array that pushManager.subscribe() requires. Padding
 * is restored to make atob happy.
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
    const rawData = atob(base64)
    const output = new Uint8Array(rawData.length)
    for (let i = 0; i < rawData.length; ++i) {
        output[i] = rawData.charCodeAt(i)
    }
    return output
}
