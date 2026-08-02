package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.CameraPackageInquiry;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.List;

@ApplicationScoped
public class CameraPackageInquiryRepository implements AppRepository<CameraPackageInquiry, Long> {

    public List<CameraPackageInquiry> findAllOrderByCreatedDesc() {
        return list("from CameraPackageInquiry order by createdAt desc");
    }

    /** Leads no admin has ticked off yet - the "ponude" badge on /admin. */
    public long countUnhandled() {
        return count("handledAt is null");
    }
}
