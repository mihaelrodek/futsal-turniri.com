package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.Resources;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.Optional;

@ApplicationScoped
public class ResourcesRepository implements AppRepository<Resources, Long> {

    public Optional<Resources> findByBucketNameAndObjectKey(String bucket, String key) {
        return find("bucketName = ?1 and objectKey = ?2", bucket, key).firstResultOptional();
    }
}
