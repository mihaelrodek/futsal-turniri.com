import { useMemo } from "react"
import type { ReactNode } from "react"
import {
    CartProvider as RucCartProvider,
    useCart as useRucCart,
    type Item as RucItem,
} from "react-use-cart"
import type { CartTier } from "../api/recordingCart"

/* ──────────────────────────────────────────────────────────────────────────
   Real, persisted /cjenik shopping cart - a thin adapter over `react-use-cart`
   (which owns the state + localStorage persistence) exposing the SAME public
   surface the app already consumes (NavBar badge, /cjenik, /kosarica):
   `useCart()` with items/itemCount/totalEurCents/allConfigured/
   addTier/removeItem/setItemConfig/clear/hasTier.

   An item is added abstractly (just its tier + price) from the pricing cards;
   it then gets CONFIGURED (which tournament, match(es) or team) in the cart
   drawer or on /kosarica before checkout is possible.

   Mapping onto react-use-cart's `Item` ({id, price, quantity, ...custom}):
   `price` = EUR cents, `quantity` always 1 (a second "Tekma" is a second line,
   never quantity 2), and `tier`/`label`/`config` ride along as custom fields
   (`updateItem` merges arbitrary fields, which is exactly `setItemConfig`).
   ────────────────────────────────────────────────────────────────────── */

export type CartItemConfig =
    | { kind: "MATCH"; tournamentUuid: string; tournamentName: string; matchId: number; matchLabel: string }
    | { kind: "HATTRICK"; tournamentUuid: string; tournamentName: string; matchIds: number[]; matchLabels: string[] }
    | { kind: "PETARDA"; tournamentUuid: string; tournamentName: string; matchIds: number[]; matchLabels: string[] }
    | { kind: "TEAM"; tournamentUuid: string; tournamentName: string; teamId: number; teamName: string }

export type CartItem = {
    /** Client-side identity - stable across re-renders, never sent to the backend. */
    id: string
    tier: CartTier
    label: string
    priceEurCents: number
    /** null until the organiser picks which tournament/match(es)/team this item is for. */
    config: CartItemConfig | null
}

export const TIER_INFO: Record<CartTier, { label: string; priceEurCents: number }> = {
    MATCH: { label: "Tekma", priceEurCents: 2000 },
    HATTRICK: { label: "Hattrick", priceEurCents: 5000 },
    PETARDA: { label: "Petarda", priceEurCents: 7500 },
    TEAM: { label: "Premium", priceEurCents: 10000 },
}

function newId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function toCartItem(it: RucItem): CartItem {
    return {
        id: it.id,
        tier: it.tier as CartTier,
        label: it.label as string,
        priceEurCents: it.price,
        config: (it.config ?? null) as CartItemConfig | null,
    }
}

type CartContextValue = {
    items: CartItem[]
    itemCount: number
    totalEurCents: number
    /** True once every item has a config attached - the only state checkout is allowed from. */
    allConfigured: boolean
    addTier: (tier: CartTier) => void
    removeItem: (id: string) => void
    setItemConfig: (id: string, config: CartItemConfig) => void
    clear: () => void
    hasTier: (tier: CartTier) => boolean
}

export function CartProvider({ children }: { children: ReactNode }) {
    return <RucCartProvider id="futsal-cart">{children}</RucCartProvider>
}

export function useCart(): CartContextValue {
    const ruc = useRucCart()
    return useMemo<CartContextValue>(() => {
        // A cart persisted BEFORE a tier was withdrawn (the "Gol" package) still
        // holds that line in localStorage. Left in, it renders with no icon, no
        // summary and no checkout payload, and the server would reject the
        // order - so an unknown tier is dropped on read, and the total is
        // recomputed from what survived rather than taken from `cartTotal`,
        // which still counts the dropped line.
        const items = ruc.items.map(toCartItem).filter((it) => it.tier in TIER_INFO)
        const totalEurCents = items.reduce((sum, it) => sum + it.priceEurCents, 0)
        return {
            items,
            itemCount: items.length,
            totalEurCents,
            allConfigured: items.length > 0 && items.every((it) => it.config != null),
            addTier: (tier) => {
                const info = TIER_INFO[tier]
                ruc.addItem({ id: newId(), price: info.priceEurCents, tier, label: info.label, config: null })
            },
            removeItem: (id) => ruc.removeItem(id),
            setItemConfig: (id, config) => ruc.updateItem(id, { config }),
            clear: () => ruc.emptyCart(),
            hasTier: (tier) => items.some((it) => it.tier === tier),
        }
    }, [ruc])
}
