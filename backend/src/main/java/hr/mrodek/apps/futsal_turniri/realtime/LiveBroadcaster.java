package hr.mrodek.apps.futsal_turniri.realtime;

import io.quarkus.websockets.next.OpenConnections;
import io.quarkus.websockets.next.WebSocketConnection;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Status;
import jakarta.transaction.Synchronization;
import jakarta.transaction.Transaction;
import jakarta.transaction.TransactionManager;
import org.jboss.logging.Logger;

/**
 * Pushes "this tournament's live data changed" pings to every connected
 * {@link LiveSocket} client. The payload is intentionally tiny - clients
 * refetch the real data over the existing REST endpoints - which keeps this
 * decoupled from every DTO and lets the same fetch/render path drive both the
 * polled fallback and the instant push.
 *
 * <p>The broadcast is deferred to <em>after</em> the surrounding DB
 * transaction commits, so a client that refetches the instant it receives the
 * ping can never read state from before the write landed.
 */
@ApplicationScoped
public class LiveBroadcaster {

    private static final Logger LOG = Logger.getLogger(LiveBroadcaster.class);

    @Inject
    OpenConnections connections;

    @Inject
    TransactionManager txManager;

    /**
     * Notify all live viewers that a match in the given tournament changed.
     * Safe to call from inside a {@code @Transactional} method - the actual
     * send waits for commit. {@code matchId} may be null for tournament-wide
     * changes.
     */
    public void liveUpdate(String tournamentUuid, Long matchId) {
        if (tournamentUuid == null) return;
        final String json = "{\"type\":\"live-update\",\"tournamentUuid\":"
                + jsonString(tournamentUuid) + ",\"matchId\":"
                + (matchId == null ? "null" : matchId.toString()) + "}";

        try {
            Transaction txn = txManager.getTransaction();
            if (txn != null && txn.getStatus() == Status.STATUS_ACTIVE) {
                txn.registerSynchronization(new Synchronization() {
                    @Override
                    public void beforeCompletion() { /* no-op */ }

                    @Override
                    public void afterCompletion(int status) {
                        if (status == Status.STATUS_COMMITTED) send(json);
                    }
                });
                return;
            }
        } catch (Exception e) {
            LOG.debugf(e, "No active transaction for live broadcast; sending immediately");
        }
        send(json);
    }

    private void send(String json) {
        for (WebSocketConnection c : connections) {
            try {
                c.sendText(json).subscribe().with(item -> { }, failure -> { });
            } catch (Exception e) {
                // Connection is closing/closed - skip it.
            }
        }
    }

    /** Minimal JSON string escaping for the uuid value. */
    private static String jsonString(String s) {
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }
}
