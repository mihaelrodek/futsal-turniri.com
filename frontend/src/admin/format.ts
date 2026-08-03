/* Small formatting helpers shared by the admin screens. They live outside the
   component modules so those can keep exporting components only - Vite's fast
   refresh gives up on a module that mixes the two. */

/** "12.03.2026." for an ISO date, or null when there is nothing to show. */
export function formatDate(iso: string | null): string | null {
    if (!iso) return null
    try {
        return new Intl.DateTimeFormat("hr-HR", {
            day: "2-digit",
            month: "short",
            year: "numeric",
        }).format(new Date(iso))
    } catch {
        return iso
    }
}
