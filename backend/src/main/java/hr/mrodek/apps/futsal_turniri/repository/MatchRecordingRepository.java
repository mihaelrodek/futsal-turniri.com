package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.model.MatchRecording;
import io.quarkus.panache.common.Sort;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@ApplicationScoped
public class MatchRecordingRepository implements AppRepository<MatchRecording, Long> {

    public Optional<MatchRecording> findByUuid(UUID uuid) {
        return find("uuid", uuid).firstResultOptional();
    }

    /** Lookup behind the PUBLIC permanent share link - the token is the
     *  capability, so this is the only query that may be reached unauthenticated. */
    public Optional<MatchRecording> findByShareToken(UUID shareToken) {
        if (shareToken == null) return Optional.empty();
        return find("shareToken", shareToken).firstResultOptional();
    }

    public List<MatchRecording> findByMatchId(Long matchId) {
        return list("match.id = ?1", Sort.by("createdAt").descending(), matchId);
    }

    /** Full library, newest first - the admin tab filters client-side (small dataset). */
    public List<MatchRecording> findAllOrderByCreatedDesc() {
        return list("from MatchRecording order by createdAt desc");
    }
}
