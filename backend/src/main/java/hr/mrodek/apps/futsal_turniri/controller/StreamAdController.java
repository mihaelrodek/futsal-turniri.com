package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.dtos.StreamAdDto;
import hr.mrodek.apps.futsal_turniri.model.Resources;
import hr.mrodek.apps.futsal_turniri.model.StreamAds;
import hr.mrodek.apps.futsal_turniri.repository.ResourcesRepository;
import hr.mrodek.apps.futsal_turniri.repository.StreamAdsRepository;
import hr.mrodek.apps.futsal_turniri.services.StorageService;
import io.minio.MinioClient;
import io.minio.RemoveObjectArgs;
import jakarta.annotation.security.RolesAllowed;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.DELETE;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import org.jboss.resteasy.reactive.RestForm;
import org.jboss.resteasy.reactive.multipart.FileUpload;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * Admin-only CRUD for the home-page stream ad library. Each ad is an image or a
 * short video stored in MinIO (via {@link StorageService#uploadAd}); the
 * site-wide stream banner references the active one while it's in ADS mode
 * (see {@link StreamBannerController}). Reads/writes are all admin-gated - the
 * public only ever sees the single active ad through the banner endpoint.
 */
@Path("/stream-ads")
@Produces(MediaType.APPLICATION_JSON)
public class StreamAdController {

    @Inject StreamAdsRepository adsRepo;
    @Inject ResourcesRepository resourcesRepo;
    @Inject StorageService storage;
    @Inject MinioClient minio;

    /** The library for one purpose (AD default, or OVERLAY), newest first. */
    @GET
    @RolesAllowed("admin")
    public List<StreamAdDto> list(@QueryParam("purpose") String purpose) {
        return adsRepo.findByPurposeNewestFirst(normalizePurpose(purpose))
                .stream().map(StreamAdController::toDto).toList();
    }

    /** Upload a new media item (image or video). The kind is decided by the
     *  file's magic bytes; {@code purpose} is AD (default) or OVERLAY. */
    @POST
    @RolesAllowed("admin")
    @Consumes(MediaType.MULTIPART_FORM_DATA)
    @Transactional
    public StreamAdDto upload(
            @RestForm("file") FileUpload file,
            @RestForm("label") String label,
            @RestForm("purpose") String purpose) {
        if (file == null || file.size() == 0) {
            throw new BadRequestException("Missing 'file' part");
        }
        Resources r = storage.uploadAd(file);
        StreamAds ad = new StreamAds();
        ad.setResource(r);
        ad.setMediaType(
                r.getContentType() != null && r.getContentType().startsWith("video/") ? "VIDEO" : "IMAGE");
        ad.setPurpose(normalizePurpose(purpose));
        ad.setLabel(label != null && !label.isBlank() ? label.trim() : null);
        ad.setCreatedAt(OffsetDateTime.now());
        adsRepo.persist(ad);
        return toDto(ad);
    }

    private static String normalizePurpose(String p) {
        return "OVERLAY".equalsIgnoreCase(p) ? "OVERLAY" : "AD";
    }

    /** Delete an ad + its MinIO blob. If it was the active banner ad, the
     *  public banner just falls back to the default sponsor image. */
    @DELETE
    @Path("/{id}")
    @RolesAllowed("admin")
    @Transactional
    public Response delete(@PathParam("id") Long id) {
        StreamAds ad = adsRepo.findByIdOptional(id).orElse(null);
        if (ad == null) return Response.noContent().build();

        Resources r = ad.getResource();
        adsRepo.delete(ad);
        if (r != null) {
            // Best-effort blob + row cleanup - the ad row is already gone, so a
            // MinIO/DB hiccup here just leaves an orphan, never a broken ad.
            try {
                minio.removeObject(RemoveObjectArgs.builder()
                        .bucket(r.getBucketName()).object(r.getObjectKey()).build());
            } catch (Exception ignored) { /* orphaned blob, harmless */ }
            try {
                resourcesRepo.delete(r);
            } catch (Exception ignored) { /* orphaned row, harmless */ }
        }
        return Response.noContent().build();
    }

    static StreamAdDto toDto(StreamAds a) {
        Long rid = a.getResource() != null ? a.getResource().getId() : null;
        String url = rid != null ? "/api/resources/" + rid + "/image" : null;
        return new StreamAdDto(
                a.getId(),
                a.getMediaType(),
                url,
                a.getLabel(),
                a.getCreatedAt() != null ? a.getCreatedAt().toString() : null);
    }
}
