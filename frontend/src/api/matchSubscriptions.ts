import { http } from "./http"

/* ──────────────────────────────────────────────────────────────────────────
   Per-match push-notification subscriptions.

   A logged-in user can subscribe to a single match. When the organizer
   starts that match (it goes LIVE), the backend sends a Web Push to every
   subscriber. See PushService.sendToMatchSubscribers + the /start endpoint.

   Endpoints - all under /tournaments/{uuid}/matches/{matchId}:
     GET  /subscription  →  { subscribed: boolean }   (authenticated)
     POST /subscribe                                   (authenticated)
     DEL  /subscribe                                   (authenticated)
   ────────────────────────────────────────────────────────────────────── */

export async function fetchMatchSubscription(
    tournamentUuid: string,
    matchId: number,
): Promise<{ subscribed: boolean }> {
    try {
        const { data } = await http.get<{ subscribed: boolean }>(
            `/tournaments/${tournamentUuid}/matches/${matchId}/subscription`,
            { silent: true, silentErrorStatuses: [401] } as any,
        )
        return data
    } catch {
        return { subscribed: false }
    }
}

export async function subscribeToMatch(
    tournamentUuid: string,
    matchId: number,
): Promise<void> {
    await http.post(
        `/tournaments/${tournamentUuid}/matches/${matchId}/subscribe`,
        undefined,
        { successMessage: "Primit ćeš obavijest kad utakmica počne." } as any,
    )
}

export async function unsubscribeFromMatch(
    tournamentUuid: string,
    matchId: number,
): Promise<void> {
    await http.delete(
        `/tournaments/${tournamentUuid}/matches/${matchId}/subscribe`,
        { successMessage: "Više ne primaš obavijest za ovu utakmicu." } as any,
    )
}
