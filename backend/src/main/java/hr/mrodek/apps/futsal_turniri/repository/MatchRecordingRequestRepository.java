package hr.mrodek.apps.futsal_turniri.repository;

import hr.mrodek.apps.futsal_turniri.enums.RecordingRequestKind;
import hr.mrodek.apps.futsal_turniri.enums.RecordingRequestStatus;
import hr.mrodek.apps.futsal_turniri.model.MatchRecordingRequest;
import io.quarkus.panache.common.Sort;
import jakarta.enterprise.context.ApplicationScoped;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@ApplicationScoped
public class MatchRecordingRequestRepository implements AppRepository<MatchRecordingRequest, Long> {

    public Optional<MatchRecordingRequest> findByUuid(UUID uuid) {
        return find("uuid", uuid).firstResultOptional();
    }

    public List<MatchRecordingRequest> findByCreatedByUid(String uid) {
        return list("createdByUid = ?1", Sort.by("createdAt").descending(), uid);
    }

    public List<MatchRecordingRequest> findAllOrderByCreatedDesc() {
        return list("from MatchRecordingRequest order by createdAt desc");
    }

    public List<MatchRecordingRequest> findByStatus(RecordingRequestStatus status) {
        return list("status = ?1", Sort.by("createdAt").descending(), status);
    }

    /** Requests currently delivered via this library recording - used when re-mapping it to a different match. */
    public List<MatchRecordingRequest> findByRecordingId(Long recordingId) {
        return list("recording.id = ?1", recordingId);
    }

    /**
     * True when the user already has an open (REQUESTED or APPROVED) FULL_MATCH
     * request for this match - used to block duplicate submissions. Goal-clip
     * requests are deliberately excluded: they are deduped per goal by
     * {@link #existsOpenForUserAndGoal}, so asking for a clip never blocks
     * asking for the whole match (or vice versa).
     */
    public boolean existsOpenForUserAndMatch(String uid, Long matchId) {
        return count("createdByUid = ?1 and match.id = ?2 and kind = ?3 and status in ?4",
                uid, matchId, RecordingRequestKind.FULL_MATCH,
                List.of(RecordingRequestStatus.REQUESTED, RecordingRequestStatus.APPROVED)) > 0;
    }

    /**
     * True when the user already has an open (REQUESTED or APPROVED) clip
     * request for this exact goal - one open request per goal per user.
     */
    public boolean existsOpenForUserAndGoal(String uid, Long matchEventId) {
        return count("createdByUid = ?1 and matchEvent.id = ?2 and status in ?3",
                uid, matchEventId,
                List.of(RecordingRequestStatus.REQUESTED, RecordingRequestStatus.APPROVED)) > 0;
    }
}
