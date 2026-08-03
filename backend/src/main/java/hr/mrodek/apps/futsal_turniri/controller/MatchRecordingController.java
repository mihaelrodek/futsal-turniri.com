package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.MatchRecordingDto;
import hr.mrodek.apps.futsal_turniri.enums.RecordingRequestStatus;
import hr.mrodek.apps.futsal_turniri.mappers.MatchRecordingMapper;
import hr.mrodek.apps.futsal_turniri.model.MatchRecording;
import hr.mrodek.apps.futsal_turniri.model.Matches;
import hr.mrodek.apps.futsal_turniri.repository.MatchRecordingRepository;
import hr.mrodek.apps.futsal_turniri.repository.MatchRecordingRequestRepository;
import hr.mrodek.apps.futsal_turniri.repository.MatchesRepository;
import hr.mrodek.apps.futsal_turniri.services.RecordingStorageService;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.validation.constraints.Size;
import jakarta.ws.rs.*;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.eclipse.microprofile.jwt.JsonWebToken;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Admin-only library of match recordings, decoupled from any one paid
 * request: an admin uploads a video for a match here, straight to MinIO via
 * presigned PUT, then links it into one or more
 * {@link hr.mrodek.apps.futsal_turniri.model.MatchRecordingRequest} rows for
 * that match (see {@link RecordingRequestController#linkRecording}).
 *
 * Routes:
 *   GET    /match-recordings?matchId=&tournamentUuid=&q=   - list/search
 *   POST   /match-recordings/by-match/{matchId}/upload-url - presigned PUT for a new entry
 *   POST   /match-recordings/{uuid}/upload-complete         - verify the upload
 *   PUT    /match-recordings/{uuid}/file-name               - rename
 *   PUT    /match-recordings/{uuid}/match                   - re-map to a different match
 *   DELETE /match-recordings/{uuid}                         - remove (DB row + MinIO object)
 *   GET    /match-recordings/{uuid}/download-link           - presigned GET (admin verification)
 *   POST   /match-recordings/{uuid}/share-token             - rotate the share token (revokes the old link)
 *   GET    /match-recordings/share/{token}                  - PUBLIC permanent link -> 302 to a fresh presigned GET
 */
@Path("/match-recordings")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
@RolesAllowed("admin")
public class MatchRecordingController {

    /** Presigned PUT validity for the admin's upload. */
    private static final int UPLOAD_EXPIRY_SECONDS = 3600;
    /** Presigned GET validity when an admin fetches a link to verify a file. */
    private static final int DOWNLOAD_EXPIRY_SECONDS = 172_800;

    @Inject MatchRecordingRepository repo;
    @Inject MatchRecordingRequestRepository requestRepo;
    @Inject MatchesRepository matchesRepo;
    @Inject MatchRecordingMapper mapper;
    @Inject RecordingStorageService recordingStorage;
    @Inject JsonWebToken jwt;

    public record UploadUrlBody(@Size(max = 255) String fileName) {}

    public record UploadUrlResponse(String uploadUrl, UUID uuid, String objectKey, int expiresInSeconds) {}

    public record UploadCompleteBody(@Size(max = 255) String fileName) {}

    public record FileNameBody(@Size(max = 255) String fileName) {}

    public record MatchIdBody(Long matchId) {}

    public record DownloadLinkResponse(String url, int expiresInSeconds) {}

    /** Strips path separators / control characters a filename must never contain. */
    private static String sanitizeFileName(String raw) {
        if (raw == null) return null;
        String cleaned = raw.trim().replaceAll("[\\\\/\\r\\n\\t\"]", "").trim();
        if (cleaned.isBlank()) return null;
        return cleaned.length() > 200 ? cleaned.substring(0, 200) : cleaned;
    }

    /** "Team A - Team B" with graceful fallbacks for undecided knockout slots. */
    private static String matchLabel(Matches m) {
        String t1 = m.getTeam1() != null ? m.getTeam1().getName() : "TBD";
        String t2 = m.getTeam2() != null ? m.getTeam2().getName() : "TBD";
        return t1 + " - " + t2;
    }

    @GET
    public List<MatchRecordingDto> list(
            @QueryParam("matchId") Long matchId,
            @QueryParam("tournamentUuid") UUID tournamentUuid,
            @QueryParam("q") String query) {
        List<MatchRecording> all = matchId != null
                ? repo.findByMatchId(matchId)
                : repo.findAllOrderByCreatedDesc();

        String q = query == null ? null : query.trim().toLowerCase();
        return all.stream()
                .filter(r -> tournamentUuid == null
                        || (r.getMatch().getTournament() != null
                                && tournamentUuid.equals(r.getMatch().getTournament().getUuid())))
                .filter(r -> q == null || q.isBlank() || matchesQuery(r, q))
                .map(mapper::toDto)
                .toList();
    }

    private static boolean matchesQuery(MatchRecording r, String q) {
        var m = r.getMatch();
        String haystack = String.join(" ",
                m.getTournament() != null ? m.getTournament().getName() : "",
                m.getTeam1() != null ? m.getTeam1().getName() : "",
                m.getTeam2() != null ? m.getTeam2().getName() : "",
                r.getFileName() != null ? r.getFileName() : "").toLowerCase();
        return haystack.contains(q);
    }

    @POST
    @Path("/by-match/{matchId}/upload-url")
    @Transactional
    public Response uploadUrl(@PathParam("matchId") Long matchId, UploadUrlBody body) {
        Matches match = matchesRepo.findByIdOptional(matchId).orElse(null);
        if (match == null) return Response.status(Response.Status.NOT_FOUND).build();

        var rec = new MatchRecording();
        rec.setMatch(match);
        rec.setUploadedByUid(jwt != null ? jwt.getSubject() : null);
        String fileName = body == null ? null : sanitizeFileName(body.fileName());
        rec.setFileName(fileName != null ? fileName : defaultFileName(match));

        String objectKey = "recordings/library/" + UUID.randomUUID() + ".mp4";
        rec.setVideoObjectKey(objectKey);
        repo.save(rec);

        String url = recordingStorage.presignedPut(objectKey, UPLOAD_EXPIRY_SECONDS);
        return Response.ok(new UploadUrlResponse(url, rec.getUuid(), objectKey, UPLOAD_EXPIRY_SECONDS)).build();
    }

    private static String defaultFileName(Matches m) {
        String tournament = m.getTournament() != null ? m.getTournament().getName() : "Turnir";
        return sanitizeFileName(tournament + "-" + matchLabel(m).replace(" - ", "_vs_")) + ".mp4";
    }

    @POST
    @Path("/{uuid}/upload-complete")
    @Transactional
    public Response uploadComplete(@PathParam("uuid") UUID uuid, UploadCompleteBody body) {
        var rec = repo.findByUuid(uuid).orElse(null);
        if (rec == null) return Response.status(Response.Status.NOT_FOUND).build();

        var size = recordingStorage.statSize(rec.getVideoObjectKey());
        if (size.isEmpty()) {
            return conflict("NO_OBJECT");
        }
        rec.setVideoSizeBytes(size.get());
        String fileName = body == null ? null : sanitizeFileName(body.fileName());
        if (fileName != null) rec.setFileName(fileName);

        return Response.ok(mapper.toDto(rec)).build();
    }

    @PUT
    @Path("/{uuid}/file-name")
    @Transactional
    public Response rename(@PathParam("uuid") UUID uuid, FileNameBody body) {
        var rec = repo.findByUuid(uuid).orElse(null);
        if (rec == null) return Response.status(Response.Status.NOT_FOUND).build();

        String fileName = body == null ? null : sanitizeFileName(body.fileName());
        if (fileName == null) throw new BadRequestException("fileName is required");
        rec.setFileName(fileName);
        return Response.ok(mapper.toDto(rec)).build();
    }

    /**
     * Re-map a recording to a different match (e.g. it was uploaded against
     * the wrong one). Any request currently DELIVERED via this recording was
     * necessarily linked under the OLD match ({@link RecordingRequestController#linkRecording}
     * enforces match equality) - so it's unlinked and reverted to APPROVED,
     * rather than left pointing at a video for a match it no longer matches.
     */
    @PUT
    @Path("/{uuid}/match")
    @Transactional
    public Response reassignMatch(@PathParam("uuid") UUID uuid, MatchIdBody body) {
        var rec = repo.findByUuid(uuid).orElse(null);
        if (rec == null) return Response.status(Response.Status.NOT_FOUND).build();
        if (body == null || body.matchId() == null) {
            throw new BadRequestException("matchId is required");
        }

        Matches match = matchesRepo.findByIdOptional(body.matchId()).orElse(null);
        if (match == null) return Response.status(Response.Status.NOT_FOUND).build();

        if (!match.getId().equals(rec.getMatch().getId())) {
            for (var linked : requestRepo.findByRecordingId(rec.getId())) {
                linked.setRecording(null);
                linked.setStatus(RecordingRequestStatus.APPROVED);
                linked.setUpdatedAt(OffsetDateTime.now());
            }
            rec.setMatch(match);
        }
        return Response.ok(mapper.toDto(rec)).build();
    }

    @GET
    @Path("/{uuid}/download-link")
    public Response downloadLink(@PathParam("uuid") UUID uuid) {
        var rec = repo.findByUuid(uuid).orElse(null);
        if (rec == null) return Response.status(Response.Status.NOT_FOUND).build();
        String url = recordingStorage.presignedGet(
                rec.getVideoObjectKey(), DOWNLOAD_EXPIRY_SECONDS, rec.getFileName());
        return Response.ok(new DownloadLinkResponse(url, DOWNLOAD_EXPIRY_SECONDS)).build();
    }

    /**
     * The permanent share link: PUBLIC, and the token is the whole credential.
     *
     * <p>Redirects to a freshly presigned MinIO URL on every hit, which is the
     * entire point - the copied link outlives any single presigned URL, while
     * the object itself is never served from a bucket URL an admin pasted
     * somewhere and cannot take back. Rotating the token
     * ({@link #rotateShareToken}) kills the old link instantly.
     *
     * <p>{@code @PermitAll} deliberately overrides the class-level
     * {@code @RolesAllowed("admin")} - a link that only works while logged in
     * as an admin is not a link an admin can send to anyone.
     *
     * <p>302 rather than streaming the bytes through the app: MinIO does the
     * Range/resume handling, and the video never occupies a Quarkus worker
     * thread for the length of a download.
     */
    @GET
    @Path("/share/{token}")
    @jakarta.annotation.security.PermitAll
    public Response share(@PathParam("token") UUID token) {
        var rec = repo.findByShareToken(token).orElse(null);
        // Same 404 for "no such token" and "revoked" - a probe learns nothing.
        if (rec == null) return Response.status(Response.Status.NOT_FOUND).build();
        String url = recordingStorage.presignedGet(
                rec.getVideoObjectKey(), DOWNLOAD_EXPIRY_SECONDS, rec.getFileName());
        return Response.seeOther(java.net.URI.create(url)).build();
    }

    /**
     * Issues a NEW share token, which revokes the previous link the moment it
     * commits. The only way back from "I pasted that link in the wrong chat".
     */
    @POST
    @Path("/{uuid}/share-token")
    @Transactional
    public Response rotateShareToken(@PathParam("uuid") UUID uuid) {
        var rec = repo.findByUuid(uuid).orElse(null);
        if (rec == null) return Response.status(Response.Status.NOT_FOUND).build();
        rec.setShareToken(UUID.randomUUID());
        return Response.ok(mapper.toDto(rec)).build();
    }

    @DELETE
    @Path("/{uuid}")
    @Transactional
    public Response delete(@PathParam("uuid") UUID uuid) {
        var rec = repo.findByUuid(uuid).orElse(null);
        if (rec == null) return Response.status(Response.Status.NOT_FOUND).build();
        recordingStorage.deleteObject(rec.getVideoObjectKey());
        repo.delete(rec);
        return Response.noContent().build();
    }

    private static Response conflict(String code) {
        return Response.status(Response.Status.CONFLICT).entity(Map.of("code", code)).build();
    }
}
