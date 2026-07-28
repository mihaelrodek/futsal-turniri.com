import type { Surface } from "../types/tournaments"

/** Croatian label + accent colour per playing surface - single source of
 *  truth shared by the create/edit dropdown and the detail-page stat tile,
 *  so the two can never drift out of sync. */
export const SURFACE_META: Record<Surface, { label: string; color: string }> = {
    TRAVA: { label: "Trava", color: "#1B4D2E" },
    UMJETNA_TRAVA: { label: "Umjetna trava", color: "#5CB85C" },
    ASFALT: { label: "Asfalt", color: "#2B2E33" },
    DVORANA: { label: "Dvorana", color: "#8B5A2B" },
}

/** Dropdown-ready list, in the order shown to the organizer. */
export const SURFACE_OPTIONS: Array<{ value: Surface; label: string; color: string }> = (
    ["ASFALT", "DVORANA", "TRAVA", "UMJETNA_TRAVA"] as const
).map((value) => ({ value, ...SURFACE_META[value] }))
