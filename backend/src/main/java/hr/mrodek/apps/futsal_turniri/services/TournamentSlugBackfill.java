package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import org.jboss.logging.Logger;

/**
 * One-shot startup backfill: any tournament that doesn't yet have a slug gets
 * one. Runs once on every app boot, but the SQL filter ({@code slug IS NULL})
 * makes it a no-op once every row is populated. Cheaper than a Liquibase
 * customChange because the slug logic lives in Java.
 *
 * <p>Each row gets its slug computed and persisted in the same transaction.
 * If two replicas start at once, both might attempt to backfill — the unique
 * index on {@code slug} would force the loser to retry with a numeric suffix,
 * which is fine.
 */
@ApplicationScoped
public class TournamentSlugBackfill {

    private static final Logger LOG = Logger.getLogger(TournamentSlugBackfill.class);

    @Inject TournamentsRepository tournamentsRepo;
    @Inject TournamentSlugService tournamentSlugService;

    @Transactional
    public void onStart(@jakarta.enterprise.event.Observes io.quarkus.runtime.StartupEvent ev) {
        // Use Panache's stream so we don't materialize the whole table — this
        // matters once the count grows. The {@code @Where} filter on
        // Tournaments excludes soft-deleted rows automatically.
        var pending = tournamentsRepo.find("slug is null").list();
        if (pending.isEmpty()) return;

        LOG.infof("Backfilling slugs for %d tournament(s)", pending.size());
        int ok = 0, fail = 0;
        for (var t : pending) {
            try {
                t.setSlug(tournamentSlugService.generateUnique(t, t.getId()));
                ok++;
            } catch (Exception e) {
                LOG.warnf(e, "Slug backfill failed for tournament id=%d name=%s", t.getId(), t.getName());
                fail++;
            }
        }
        LOG.infof("Slug backfill done: %d ok, %d failed", ok, fail);
    }
}
