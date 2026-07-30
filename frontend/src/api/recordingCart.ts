import { http } from "./http"

/**
 * /cjenik cart checkout - pays for one or more cart items in a single Stripe
 * Checkout Session, no admin-approval gate (backend RecordingRequestController#cartCheckout).
 */
export type CartTier = "GOAL" | "MATCH" | "HATTRICK" | "TEAM"

export type CartCheckoutItem = {
    tier: CartTier
    tournamentUuid: string
    /** Exactly 1 match for GOAL/MATCH, exactly 3 (distinct) for HATTRICK, ignored for TEAM. */
    matchIds: number[]
    /** Required only for GOAL. */
    matchEventId?: number | null
    /** Required only for TEAM. */
    teamId?: number | null
}

export type CartCheckoutPayload = {
    items: CartCheckoutItem[]
    contactEmail?: string | null
    /** Mandatory (validated server-side) for an anonymous order. */
    contactPhone?: string | null
}

export type CartCheckoutSession = {
    url: string
}

/**
 * Starts the combined Stripe Checkout session for the whole cart. Redirect the
 * browser to the returned url. 409 {"code": ...} for NOT_CONFIGURED /
 * GOAL_REQUESTS_DISABLED / MATCH_NOT_FINISHED / TEAM_NO_MATCHES / DUPLICATE -
 * callers branch on err.response.data.code and show their own message.
 */
export async function createCartCheckout(payload: CartCheckoutPayload): Promise<CartCheckoutSession> {
    const { data } = await http.post<CartCheckoutSession>(
        "/recording-requests/cart-checkout",
        payload,
        { silent: true, silentErrorStatuses: [409] },
    )
    return data
}
