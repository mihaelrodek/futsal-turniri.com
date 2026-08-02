package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.AdminSentMail;
import io.quarkus.panache.common.Page;
import io.quarkus.panache.common.Sort;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.List;

@ApplicationScoped
public class AdminSentMailRepository implements AppRepository<AdminSentMail, Long> {

    /**
     * Newest-first page of the manual-mail audit log. Always paged: this table
     * only grows, and the admin screen never needs more than the last screenful
     * of sends.
     */
    public List<AdminSentMail> findRecent(int limit) {
        int size = Math.max(1, Math.min(limit, 200));
        return findAll(Sort.by("createdAt", Sort.Direction.Descending)
                        .and("id", Sort.Direction.Descending))
                .page(Page.ofSize(size))
                .list();
    }
}
