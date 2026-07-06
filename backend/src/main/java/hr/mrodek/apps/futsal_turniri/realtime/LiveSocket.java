package hr.mrodek.apps.futsal_turniri.realtime;

import io.quarkus.websockets.next.OnOpen;
import io.quarkus.websockets.next.OnTextMessage;
import io.quarkus.websockets.next.WebSocket;

/**
 * Real-time live channel. Clients (the /uzivo page and the fullscreen TV
 * display) open one connection and only listen — the server pushes a tiny
 * {@code {"type":"live-update","tournamentUuid":..,"matchId":..}} message
 * whenever a match's live data changes (goal, card, start/finish, half,
 * fouls). On receipt the client refetches immediately, so updates appear
 * instantly instead of waiting for the next poll. Polling stays as a fallback
 * for clients that can't hold a socket.
 *
 * <p>The path is {@code /ws/live} (not under the {@code /api} REST root-path —
 * websockets-next paths are independent of {@code quarkus.http.root-path}) —
 * WRONG in practice: websockets-next registers the route UNDER the root-path,
 * so the backend actually serves {@code /api/ws/live}. Clients keep the public
 * {@code /ws/live} URL; both proxies rewrite to {@code /api/ws/live}
 * (Caddy in prod, Vite in dev).
 */
@WebSocket(path = "/ws/live")
public class LiveSocket {

    /** Connection opened — nothing to do; the client is a passive listener.
     *  Open connections are tracked by {@code OpenConnections} for broadcast. */
    @OnOpen
    public void onOpen() {
        // no-op
    }

    /** Clients don't send anything meaningful; ignore any inbound text so a
     *  stray keep-alive frame doesn't error the connection. */
    @OnTextMessage
    public void onMessage(String message) {
        // ignore
    }
}
