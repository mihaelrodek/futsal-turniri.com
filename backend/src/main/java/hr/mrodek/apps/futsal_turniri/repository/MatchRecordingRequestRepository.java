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

    /** Every row created from one /cjenik cart checkout - the Stripe webhook marks them all paid together. */
    public List<MatchRecordingRequest> findByCartGroupId(UUID cartGroupId) {
        return list("cartGroupId", cartGroupId);
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

    /**
     * Same duplicate guard as {@link #existsOpenForUserAndMatch}, but keyed by
     * contact email instead of a Firebase UID - used for anonymous requests,
     * which have no {@code createdByUid}. Case-insensitive since the email is
     * stored lowercased but a defensive lower() keeps this correct either way.
     */
    public boolean existsOpenForEmailAndMatch(String email, Long matchId) {
        return count("lower(contactEmail) = ?1 and match.id = ?2 and kind = ?3 and status in ?4",
                email == null ? null : email.toLowerCase(), matchId, RecordingRequestKind.FULL_MATCH,
                List.of(RecordingRequestStatus.REQUESTED, RecordingRequestStatus.APPROVED)) > 0;
    }

    /**
     * Same duplicate guard as {@link #existsOpenForUserAndGoal}, but keyed by
     * contact email - used for anonymous goal-clip requests.
     */
    public boolean existsOpenForEmailAndGoal(String email, Long matchEventId) {
        return count("lower(contactEmail) = ?1 and matchEvent.id = ?2 and status in ?3",
                email == null ? null : email.toLowerCase(), matchEventId,
                List.of(RecordingRequestStatus.REQUESTED, RecordingRequestStatus.APPROVED)) > 0;
    }
}
