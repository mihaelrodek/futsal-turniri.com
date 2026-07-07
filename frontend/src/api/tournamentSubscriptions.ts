import { http } from "./http"

/* ──────────────────────────────────────────────────────────────────────────
   Per-tournament push-notification subscriptions.

   A logged-in user can subscribe to a tournament. Whenever the organizer
   records a goal, starts second half, or finishes a match, the backend
   sends a Web Push to every subscriber. See PushService.sendToTournament-
   Subscribers on the backend.

   Endpoints - all under /tournaments/{uuid}:
     GET  /subscription  →  { subscribed: boolean }   (authenticated)
     POST /subscribe                                   (authenticated)
     DEL  /subscribe                                   (authenticated)
   ────────────────────────────────────────────────────────────────────── */

export async function fetchTournamentSubscription(
    uuid: string,
): Promise<{ subscribed: boolean }> {
    try {
        const { data } = await http.get<{ subscribed: boolean }>(
            `/tournaments/${uuid}/subscription`,
            // Silent so a logged-out viewer browsing a tournament page
            // doesn't see a 401 error toast just because they can't subscribe.
            { silent: true, silentErrorStatuses: [401] } as any,
        )
        return data
    } catch {
        return { subscribed: false }
    }
}

export async function subscribeToTournament(uuid: string): Promise<void> {
    await http.post(
        `/tournaments/${uuid}/subscribe`,
        undefined,
        { successMessage: "Primaš obavijesti o turniru." } as any,
    )
}

export async function unsubscribeFromTournament(uuid: string): Promise<void> {
    await http.delete(
        `/tournaments/${uuid}/subscribe`,
        { successMessage: "Više ne primaš obavijesti." } as any,
    )
}
