import { http } from "./http"

/* ──────────────────────────────────────────────────────────────────────────
   Per-tournament push-notification subscriptions.

   Both logged-in AND anonymous (not-logged-in) viewers can subscribe to a
   tournament. Whenever the organizer records a goal, starts second half, or
   finishes a match, the backend sends a Web Push to every subscriber. See
   PushService.sendToTournamentSubscribers on the backend.

   Identity: a logged-in call is keyed by the bearer token (server reads the
   uid); an anonymous call passes the browser's push `endpoint` as the identity
   (query param on GET/DELETE, body on POST). Pass `endpoint` for anon calls,
   omit it for logged-in calls.

   Endpoints - all under /tournaments/{uuid}:
     GET  /subscription[?endpoint]  →  { subscribed: boolean }
     POST /subscribe   (body { endpoint } for anon)
     DEL  /subscribe[?endpoint]
   ────────────────────────────────────────────────────────────────────── */

export async function fetchTournamentSubscription(
    uuid: string,
    endpoint?: string,
): Promise<{ subscribed: boolean }> {
    try {
        const { data } = await http.get<{ subscribed: boolean }>(
            `/tournaments/${uuid}/subscription`,
            // Silent so a logged-out viewer browsing a tournament page
            // doesn't see a 401 error toast just because they can't subscribe.
            {
                params: endpoint ? { endpoint } : undefined,
                silent: true,
                silentErrorStatuses: [401],
            } as any,
        )
        return data
    } catch {
        return { subscribed: false }
    }
}

export async function subscribeToTournament(
    uuid: string,
    endpoint?: string,
): Promise<void> {
    await http.post(
        `/tournaments/${uuid}/subscribe`,
        endpoint ? { endpoint } : undefined,
        { successMessage: "Primaš obavijesti o turniru." } as any,
    )
}

export async function unsubscribeFromTournament(
    uuid: string,
    endpoint?: string,
): Promise<void> {
    await http.delete(`/tournaments/${uuid}/subscribe`, {
        params: endpoint ? { endpoint } : undefined,
        successMessage: "Više ne primaš obavijesti.",
    } as any)
}
