import { http } from "./http"

/* ──────────────────────────────────────────────────────────────────────────
   Pending-work counters for the /admin dashboard badges.

   One cheap aggregate read instead of three list calls: the dashboard only
   needs "how many items are waiting", never the rows themselves. The keys are
   deliberately the same strings as the matching `AdminModuleKey`s
   (`src/admin/modules.tsx`), so a card can look its own count up by
   `module.key` without a translation table.
   ────────────────────────────────────────────────────────────────────── */

/** Wire shape of GET /admin/pending-counts. */
export type AdminPendingCounts = {
    /** Recording requests still awaiting an admin decision. */
    zahtjeviSnimke: number
    /** Player-claim requests still awaiting an admin decision. */
    zahtjeviIgraci: number
    /** Camera-package inquiries (quote leads) not handled yet. */
    ponude: number
    /** Contact-form messages (/kontakt) nobody has answered yet. */
    poruke: number
    /** Tournaments archived on an organizer's deletion request, awaiting the
     *  admin's confirm-or-restore in "Upravljanje turnirima". */
    turniri: number
}

/**
 * Query key for the dashboard counters. Exported here rather than added to
 * `qk` (queryClient.ts) so every consumer - dashboard cards, navbar indicator -
 * shares ONE cache entry without that file becoming a merge point.
 */
export const ADMIN_PENDING_COUNTS_KEY = ["admin", "pendingCounts"] as const

/**
 * Badge counters for the admin dashboard.
 *
 * Fails QUIETLY on purpose (`silent: true`): this is a background read fired
 * on every visit to /admin, and a 403 (admin claim not propagated yet) or a
 * 5xx must never pop a red toast over the dashboard. Callers render no badge
 * when the query rejects.
 */
export async function getAdminPendingCounts(): Promise<AdminPendingCounts> {
    const { data } = await http.get<AdminPendingCounts>("/admin/pending-counts", {
        silent: true,
    })
    return data
}
