package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.enums.RecordingRequestStatus;
import hr.mrodek.apps.futsal_turniri.model.MatchRecordingRequest;
import hr.mrodek.apps.futsal_turniri.repository.MatchRecordingRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

import java.time.OffsetDateTime;

/**
 * Called the instant a request becomes paid (Stripe webhook or the admin's
 * manual "Označi plaćeno" toggle) to close the gap between payment and
 * delivery automatically:
 *
 * <ul>
 *   <li>If the library ALREADY has a recording for this request's match
 *       (an admin uploaded it ahead of time, or for an earlier request on the
 *       same match), the newest one is linked immediately and the requester
 *       gets the download-ready email within the same request/webhook - no
 *       admin action needed.</li>
 *   <li>If none exists yet, this is a no-op: the request stays APPROVED/paid
 *       until an admin uploads to "Baza snimki" and links it manually via
 *       {@code RecordingRequestController#linkRecording}, which sends the same
 *       email at that point instead.</li>
 * </ul>
 *
 * Must be called from within the caller's own transaction (both call sites
 * are {@code @Transactional}) - it reads/writes the managed {@code r} entity
 * directly rather than re-fetching it.
 */
@ApplicationScoped
public class RecordingAutoLinkService {

    @Inject MatchRecordingRepository recordingRepo;
    @Inject RecordingRequestNotifier notifier;

    /** Auto-link the newest library recording for this match if one exists and none is linked yet, then email if delivered. */
    public void autoLinkAndNotify(MatchRecordingRequest r) {
        if (r.getRecording() == null) {
            var candidates = recordingRepo.findByMatchId(r.getMatch().getId());
            if (!candidates.isEmpty()) {
                r.setRecording(candidates.get(0)); // newest first (see MatchRecordingRepository#findByMatchId)
                r.setStatus(RecordingRequestStatus.DELIVERED);
                r.setUpdatedAt(OffsetDateTime.now());
            }
        }
        if (r.getRecording() != null) {
            notifier.notifyDownloadReady(r);
        }
    }
}
