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
 * future pushes to it. Idempotent — re-subscribing the same endpoint
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
            // No success toast — this is background plumbing the user
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
