package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.AdminPendingCountsDto;
import hr.mrodek.apps.futsal_turniri.repository.CameraPackageInquiryRepository;
import hr.mrodek.apps.futsal_turniri.repository.ContactMessageRepository;
import hr.mrodek.apps.futsal_turniri.repository.MatchRecordingRequestRepository;
import hr.mrodek.apps.futsal_turniri.repository.PlayerClaimRequestRepository;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

/**
 * Feeds the badges on the /admin console: the module cards each show how
 * many items are still waiting for an admin, so one request has to answer
 * for every module at once.
 *
 * <p>Every number comes from a {@code count(...)} query - the lists behind
 * these badges are unbounded and this endpoint is polled, so loading them
 * just to call {@code size()} would be the obvious way to make the admin
 * dashboard slow.
 *
 * Routes:
 *   GET /admin/pending-counts - {"zahtjeviSnimke":n,"zahtjeviIgraci":n,"ponude":n,"poruke":n}
 */
@Path("/admin/pending-counts")
@RolesAllowed("admin")
@Produces(MediaType.APPLICATION_JSON)
public class AdminPendingCountsController {

    @Inject MatchRecordingRequestRepository recordingRequests;
    @Inject PlayerClaimRequestRepository claimRequests;
    @Inject CameraPackageInquiryRepository cameraInquiries;
    @Inject ContactMessageRepository contactMessages;

    @GET
    @Transactional
    public AdminPendingCountsDto pendingCounts() {
        return new AdminPendingCountsDto(
                recordingRequests.countRequested(),
                claimRequests.countPending(),
                cameraInquiries.countUnhandled(),
                contactMessages.countUnhandled());
    }
}
