package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.StreamAds;
import io.quarkus.panache.common.Sort;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.List;

@ApplicationScoped
public class StreamAdsRepository implements AppRepository<StreamAds, Long> {

    /** The whole ad library, newest first. */
    public List<StreamAds> findAllNewestFirst() {
        return listAll(Sort.by("createdAt").descending().and("id").descending());
    }

    /** The library for one purpose (AD | OVERLAY), newest first. */
    public List<StreamAds> findByPurposeNewestFirst(String purpose) {
        return list("purpose = ?1", Sort.by("createdAt").descending().and("id").descending(), purpose);
    }
}
