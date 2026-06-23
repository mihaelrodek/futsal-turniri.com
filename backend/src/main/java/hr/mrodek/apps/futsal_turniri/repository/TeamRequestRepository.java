package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.enums.TeamRequestStatus;
import hr.mrodek.apps.futsal_turniri.model.TeamRequest;
import io.quarkus.panache.common.Sort;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@ApplicationScoped
public class TeamRequestRepository implements AppRepository<TeamRequest, Long> {

    public Optional<TeamRequest> findByUuid(UUID uuid) {
        return find("uuid", uuid).firstResultOptional();
    }

    public List<TeamRequest> findAllOrderByCreatedDesc() {
        return list("from TeamRequest order by createdAt desc");
    }

    public List<TeamRequest> findByStatus(TeamRequestStatus status) {
        return list("status = ?1", Sort.by("createdAt").descending(), status);
    }

    public List<TeamRequest> findByTournament_Id(Long tournamentId) {
        return list("tournament.id = ?1", Sort.by("createdAt").descending(), tournamentId);
    }
}
