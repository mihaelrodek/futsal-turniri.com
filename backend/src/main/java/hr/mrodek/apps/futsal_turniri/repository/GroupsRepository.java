package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.Groups;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.List;

@ApplicationScoped
public class GroupsRepository implements AppRepository<Groups, Long> {

    /** All groups of a tournament, ordered A, B, C, … */
    public List<Groups> findByTournamentIdOrderByOrdinal(Long tournamentId) {
        return list("tournament.id = ?1 order by ordinal asc", tournamentId);
    }

    /** Remove every group of a tournament — used when the draw is re-run. */
    public long deleteByTournamentId(Long tournamentId) {
        return delete("tournament.id", tournamentId);
    }
}
