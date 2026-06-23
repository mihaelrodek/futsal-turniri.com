package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.Rounds;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import io.quarkus.panache.common.Sort;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.List;
import java.util.Optional;

@ApplicationScoped
public class RoundsRepository implements AppRepository<Rounds, Long> {

    public List<Rounds> findByTournamentOrderByNumberAsc(Tournaments t) {
        return list("tournament", Sort.by("number").ascending(), t);
    }

    public Optional<Rounds> findTopByTournamentOrderByNumberDesc(Tournaments t) {
        return find("tournament", Sort.by("number").descending(), t).firstResultOptional();
    }

    public List<Rounds> findByTournament_Id(Long tournamentId) {
        return list("tournament.id", tournamentId);
    }

    public List<Rounds> findByTournament_IdOrderByNumberAsc(Long tournamentId) {
        return list("tournament.id", Sort.by("number").ascending(), tournamentId);
    }

    public void deleteByTournament(Tournaments t) {
        delete("tournament", t);
    }
}
