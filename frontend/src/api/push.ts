import { http } from "./http"

/** Wire shape of `GET /push/public-key`. */
export type PushPublicKeyResponse = {
    publicKey: string
    ready: boolean
}

export async function fetchPushPublicKey(): Promise<PushPublicKeyResponse> {
    const { data } = await http.get<PushPublicKeyResponse>("/push/public-key", {
        silent: true,
    } as any)
    return data
}

/**
 * POST a fresh browser subscription to the backend so it can route
 * future pushes to it. Idempotent - re-subscribing the same endpoint
 * just refreshes the crypto material server-side.
 */
export async function registerPushSubscription(sub: PushSubscriptionJSON): Promise<void> {
    await http.post(
        "/push/subscribe",
        {
            endpoint: sub.endpoint,
            p256dh: sub.keys?.p256dh ?? "",
            auth: sub.keys?.auth ?? "",
        },
        {
            // No success toast - this is background plumbing the user
            // already opted in to via the OS permission prompt.
            silent: true,
        } as any,
    )
}

/** Tell the backend we're no longer interested in this endpoint. */
export async function unregisterPushSubscription(endpoint: string): Promise<void> {
    await http.delete("/push/subscribe", {
        params: { endpoint },
        silent: true,
    } as any)
}

/**
 * Browser PushSubscription serialised via `toJSON()`. The native object
 * has methods (unsubscribe, getKey), but the JSON form has just the
 * fields we need to send to the server.
 */
export type PushSubscriptionJSON = {
    endpoint: string
    expirationTime: number | null
    keys?: {
        p256dh?: string
        auth?: string
    }
}

/* ──────────────────────────────────────────────────────────────────────────
   Anonymous (not-logged-in) push helpers.

   The auto-subscribe hook (usePushSubscription) only runs for logged-in
   users, so the notification bell drives the whole flow for anonymous
   viewers: it creates/reads the browser's push subscription on click and
   registers it with the backend. These helpers keep that logic in one place
   and out of the component.
   ────────────────────────────────────────────────────────────────────── */

/** Whether this browser can do Web Push at all. */
export function pushSupported(): boolean {
    return (
        typeof window !== "undefined" &&
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window
    )
}

/**
 * Read the browser's EXISTING push endpoint without prompting or creating
 * anything. Used to answer "is this browser already subscribed?" for an
 * anonymous viewer (the endpoint is the anon identity the backend keys on).
 * Returns null when unsupported, no service worker is registered (e.g. dev
 * mode), or the browser has never subscribed.
 */
export async function getExistingPushEndpoint(): Promise<string | null> {
    if (!pushSupported()) return null
    try {
        const reg = await navigator.serviceWorker.getRegistration()
        if (!reg) return null
        const sub = await reg.pushManager.getSubscription()
        return sub?.endpoint ?? null
    } catch {
        return null
    }
}

/**
 * Get-or-create the browser's push subscription and register it with the
 * backend, returning its serialised form (its `endpoint` is the anon
 * identity). Returns null when push is unsupported, permission isn't granted,
 * no service worker is available, or the backend has no VAPID key.
 *
 * IMPORTANT: this NEVER requests notification permission - that must be done
 * by the caller synchronously inside the click gesture (iOS drops the prompt
 * otherwise). We only proceed once permission is already `granted`.
 */
export async function ensureBrowserPushSubscription(): Promise<PushSubscriptionJSON | null> {
    if (!pushSupported()) return null
    if (Notification.permission !== "granted") return null
    try {
        const reg = await navigator.serviceWorker.getRegistration()
        if (!reg) return null

        let sub = await reg.pushManager.getSubscription()
        if (!sub) {
            const { publicKey, ready } = await fetchPushPublicKey()
            if (!ready || !publicKey) return null
            sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
            })
        }

        const json = sub.toJSON() as PushSubscriptionJSON
        if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return null

        // Register (or refresh) server-side so pushes can route here and so an
        // anon tournament-subscribe can validate the endpoint exists.
        // Best-effort: a 409 (endpoint already owned by a real user - e.g. this
        // browser was logged in before) still means the endpoint EXISTS
        // server-side, which is all the anon follow needs.
        await registerPushSubscription(json).catch(() => {})
        return json
    } catch {
        return null
    }
}

/**
 * Convert a base64url-encoded VAPID public key into the Uint8Array that
 * pushManager.subscribe() requires. (Local copy - the auto-subscribe hook has
 * its own, kept separate to avoid touching that iOS-sensitive code path.)
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
