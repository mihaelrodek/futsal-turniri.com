package hr.mrodek.apps.futsal_turniri.repository;

import io.quarkus.hibernate.orm.panache.PanacheRepositoryBase;

import java.util.ArrayList;
import java.util.List;

/**
 * Shared repository base: Panache + a team of Spring-Data-like shims
 * (save / saveAll) so service code can stay agnostic of whether it's
 * persisting a brand-new entity or mutating a managed one.
 *
 * - save(): delegates to Panache {@code persist()}. For already-managed
 *   entities this is a no-op (per JPA spec), for new entities it inserts.
 * - saveAll(): same, for collections.
 * - findByIdOptional(Id) is inherited from {@link PanacheRepositoryBase}
 *   and is the recommended replacement for Spring Data's Optional-returning
 *   findById().
 */
public interface AppRepository<T, Id> extends PanacheRepositoryBase<T, Id> {

    default T save(T entity) {
        persist(entity);
        return entity;
    }

    default List<T> saveAll(Iterable<T> entities) {
        persist(entities);
        List<T> out = new ArrayList<>();
        entities.forEach(out::add);
        return out;
    }
}
