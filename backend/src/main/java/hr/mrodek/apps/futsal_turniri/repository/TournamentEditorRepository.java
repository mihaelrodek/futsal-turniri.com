package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.TournamentEditor;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.List;

@ApplicationScoped
public class TournamentEditorRepository implements AppRepository<TournamentEditor, Long> {

    /** True if {@code uid} has an editor grant on the tournament. */
    public boolean isEditor(Long tournamentId, String uid) {
        if (tournamentId == null || uid == null) return false;
        return count("tournament.id = ?1 and userUid = ?2", tournamentId, uid) > 0;
    }

    /** Editor grants of a tournament (order stable by id = grant order). */
    public List<TournamentEditor> findByTournament_Id(Long tournamentId) {
        return list("tournament.id = ?1 order by id", tournamentId);
    }

    /** UIDs of every editor of a tournament. */
    public List<String> uidsForTournament(Long tournamentId) {
        return findByTournament_Id(tournamentId).stream()
                .map(TournamentEditor::getUserUid)
                .toList();
    }

    /** Remove a user's editor grant. Returns the number of rows deleted. */
    public long removeByTournamentAndUid(Long tournamentId, String uid) {
        return delete("tournament.id = ?1 and userUid = ?2", tournamentId, uid);
    }
}
