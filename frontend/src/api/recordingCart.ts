import { http } from "./http"

/**
 * /cjenik cart checkout - pays for one or more cart items in a single Stripe
 * Checkout Session, no admin-approval gate (backend RecordingRequestController#cartCheckout).
 */
export type CartTier = "MATCH" | "HATTRICK" | "PETARDA" | "TEAM"

/** How many matches each multi-match tier takes. The cart configurator and the
 *  backend's `resolveMatches` must agree on this count exactly - a cart the
 *  server refuses is worse than one that cannot be assembled. */
export const TIER_MATCH_COUNT: Partial<Record<CartTier, number>> = {
    HATTRICK: 3,
    PETARDA: 5,
}

export type CartCheckoutItem = {
    tier: CartTier
    tournamentUuid: string
    /** Exactly 1 match for MATCH, 3 (distinct) for HATTRICK, 5 for PETARDA,
     *  ignored for TEAM (resolved server-side from `teamId`). */
    matchIds: number[]
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
 * TEAM_NO_MATCHES / DUPLICATE / NO_LIVESTREAM - callers branch on
 * err.response.data.code and show their own message.
 */
export async function createCartCheckout(payload: CartCheckoutPayload): Promise<CartCheckoutSession> {
    const { data } = await http.post<CartCheckoutSession>(
        "/recording-requests/cart-checkout",
        payload,
        { silent: true, silentErrorStatuses: [409] },
    )
    return data
}
