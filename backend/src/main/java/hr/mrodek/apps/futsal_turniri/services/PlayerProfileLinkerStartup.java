package hr.mrodek.apps.futsal_turniri.services;

import io.quarkus.runtime.StartupEvent;
import io.smallrye.mutiny.infrastructure.Infrastructure;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.event.Observes;
import jakarta.inject.Inject;
import org.jboss.logging.Logger;

/**
 * Runs the roster ⇄ profile linking pass once at boot.
 *
 * <p>This is what back-fills history: every tournament played before the
 * feature existed gets attached to the matching profiles on the first start
 * after deploy, without anyone having to log in or an admin having to click
 * anything. Idempotent and cheap at grassroots data sizes (already-linked
 * rows are skipped), so later boots are near-no-ops.
 *
 * <p>Failures are logged, never rethrown: a linking hiccup must not stop the
 * application from starting.
 */
@ApplicationScoped
public class PlayerProfileLinkerStartup {

    private static final Logger LOG = Logger.getLogger(PlayerProfileLinkerStartup.class);

    @Inject PlayerProfileLinker linker;

    /**
     * Kill switch. The pass is idempotent and runs off-thread, but a boot-time
     * job that touches every roster row deserves a way to be turned off from
     * config alone - no redeploy - if it ever misbehaves on a big database.
     */
    @ConfigProperty(name = "futsal.player-link.backfill-at-start", defaultValue = "true")
    boolean backfillAtStart;

    void onStart(@Observes StartupEvent ev) {
        if (!backfillAtStart) {
            LOG.info("Player-profile backfill at startup disabled by config");
            return;
        }
        // OFF the startup thread on purpose: Quarkus only opens the HTTP port
        // once every StartupEvent observer has returned, so doing the whole
        // pass inline would make the app answer 502 through the reverse proxy
        // for as long as it takes. Nothing depends on it having finished.
        //
        // Runs on Quarkus's Mutiny worker pool, NOT a bare `new Thread(...)`:
        // linkPlayerById is @Transactional, and the Narayana JTA interceptor
        // needs an active CDI request context to open a transaction. A raw
        // thread has none - ArcContainer.getActiveContext returns null and
        // every call throws, silently swallowed by the catch below (so the
        // backfill "ran" but linked nothing). The worker pool is a
        // Quarkus-managed thread, so the context exists.
        Infrastructure.getDefaultWorkerPool().execute(this::runQuietly);
    }

    private void runQuietly() {
        try {
            linker.backfillAll();
        } catch (RuntimeException e) {
            LOG.warn("Player-profile backfill at startup failed - continuing", e);
        }
    }
}
