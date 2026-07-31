package hr.mrodek.apps.futsal_turniri.services;

import io.quarkus.runtime.StartupEvent;
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

    void onStart(@Observes StartupEvent ev) {
        try {
            linker.backfillAll();
        } catch (RuntimeException e) {
            LOG.warn("Player-profile backfill at startup failed - continuing", e);
        }
    }
}
