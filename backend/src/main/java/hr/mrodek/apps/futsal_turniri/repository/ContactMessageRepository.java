package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.ContactMessage;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.List;

@ApplicationScoped
public class ContactMessageRepository implements AppRepository<ContactMessage, Long> {

    public List<ContactMessage> findAllOrderByCreatedDesc() {
        return list("from ContactMessage order by createdAt desc");
    }

    /** Messages no admin has answered yet - the "poruke" badge on /admin. */
    public long countUnhandled() {
        return count("handledAt is null");
    }
}
