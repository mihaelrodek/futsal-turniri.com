import { http } from "./http"

/**
 * Persisted web-push notifications ("Obavijesti" inbox).
 *
 * Everything the user is pushed (match start/end, goals, schedule changes,
 * team approvals, …) is stored server-side and read back here, grouped by the
 * thing it is about (a match, a tournament) so a 10-goal game is ONE card in
 * the inbox rather than ten rows.
 */

/** Backend enum NotificationKind, wire values. */
export type NotificationKind =
    | "MATCH_START"
    | "MATCH_END"
    | "HALF_TIME"
    | "SECOND_HALF"
    | "GOAL"
    | "TEAM_APPROVED"
    | "SCHEDULE"
    | "BRACKET"
    | "ELIMINATED"
    | "RECORDING"
    /** Something landed in the admin queue (recording request, quote inquiry,
     *  player claim). Only ever delivered to platform admins. */
    | "ADMIN_REQUEST"
    | "GENERIC"

/** One stored notification. */
export type NotificationItem = {
    id: number
    /** Widened to `string` on purpose - an unknown kind added by the backend
     *  must render as a plain item, never crash the inbox. */
    kind: string
    title: string
    body: string
    /** In-app path to open when the item is clicked; null when there is none. */
    url: string | null
    createdAt: string
    readAt: string | null
}

/**
 * A collapsible bucket in the inbox. `key` is stable per subject
 * ("match:123" / "tournament:45" / "other") and is what the page uses to
 * remember which cards are expanded.
 */
export type NotificationGroup = {
    key: string
    matchId: number | null
    tournamentId: number | null
    /** Group heading - the match label or the tournament name. */
    title: string
    url: string | null
    unread: number
    latestAt: string
    items: NotificationItem[]
}

export type NotificationInbox = {
    unreadCount: number
    groups: NotificationGroup[]
}

/**
 * The signed-in user's inbox. Guests get a 401 - that is an expected state
 * here (the page redirects to /prijava), so the generic red toast is
 * suppressed for it rather than for every failure.
 */
export async function getNotifications(): Promise<NotificationInbox> {
    const { data } = await http.get<NotificationInbox>("/notifications", {
        silentErrorStatuses: [401],
    })
    return data
}

/**
 * Mark notifications as read. An EMPTY `ids` array means "mark ALL of mine
 * read" (backend contract). Fire-and-forget from the caller's point of view -
 * no toast, the badge disappearing is the feedback.
 */
export async function markNotificationsRead(ids: number[]): Promise<void> {
    await http.post("/notifications/read", { ids }, { silent: true })
}
