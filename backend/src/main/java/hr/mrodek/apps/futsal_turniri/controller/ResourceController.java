package hr.mrodek.apps.futsal_turniri.controller;

import hr.mrodek.apps.futsal_turniri.model.Resources;
import hr.mrodek.apps.futsal_turniri.repository.ResourcesRepository;
import io.minio.GetObjectArgs;
import io.minio.MinioClient;
import jakarta.inject.Inject;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.core.StreamingOutput;
import org.jboss.logging.Logger;

import java.io.InputStream;

/**
 * Anonymous-readable image proxy for poster blobs stored in MinIO.
 *
 * <p>Why we proxy through the backend instead of pointing browsers straight
 * at MinIO:
 * <ul>
 *   <li><b>MinIO bucket stays private.</b> Only the backend (inside the
 *       compose / k8s network) holds the access key. We don't have to expose
 *       MinIO on the public internet, set bucket policies, or worry about
 *       leaked credentials.</li>
 *   <li><b>Stable URLs.</b> {@code /api/resources/<id>/image} never expires;
 *       presigned URLs would have to be regenerated on every tournament
 *       fetch and would invalidate cached image tags every few minutes.</li>
 *   <li><b>Browser caching just works.</b> Resource ids and object keys are
 *       immutable once stored, so we serve {@code Cache-Control: immutable}
 *       and the browser hits the backend at most once per blob.</li>
 * </ul>
 *
 * <p>Bandwidth cost: a poster is at most ~6 MB ({@code MAX_POSTER_BYTES} in
 * {@code StorageService}), and the {@code immutable} header means each one
 * crosses the wire once per browser. For 100 users/day this is invisible.
 */
@Path("/resources")
public class ResourceController {

    private static final Logger LOG = Logger.getLogger(ResourceController.class);

    @Inject
    ResourcesRepository repo;

    @Inject
    MinioClient minio;

    @GET
    @Path("/{id}/image")
    public Response getImage(@PathParam("id") Long id) {
        Resources r = repo.findByIdOptional(id)
                .orElseThrow(() -> new NotFoundException("Resource not found: " + id));

        // Stream MinIO's response straight to the client - never buffer the
        // whole blob in memory. The MinIO client's GetObjectResponse is an
        // InputStream-compatible wrapper, so transferTo() copies bytes without
        // an intermediate byte[].
        StreamingOutput body = out -> {
            try (InputStream in = minio.getObject(GetObjectArgs.builder()
                    .bucket(r.getBucketName())
                    .object(r.getObjectKey())
                    .build())) {
                in.transferTo(out);
            } catch (Exception e) {
                LOG.errorf(e, "Failed to stream resource %d (%s/%s) from MinIO",
                        id, r.getBucketName(), r.getObjectKey());
                throw new RuntimeException("Failed to fetch image", e);
            }
        };

        String ct = (r.getContentType() != null && !r.getContentType().isBlank())
                ? r.getContentType()
                : MediaType.APPLICATION_OCTET_STREAM;

        return Response.ok(body)
                // Use the stored, sanitized Content-Type - set by StorageService
                // from the validated extension, not from any client header.
                .header("Content-Type", ct)
                // Resource rows are immutable: bucket + objectKey never change
                // after creation, so the URL→blob mapping is stable. One-year
                // immutable cache keeps repeat visits free.
                .header("Cache-Control", "public, max-age=31536000, immutable")
                // Defense-in-depth - even if Content-Type were ever wrong, the
                // browser must not sniff the bytes as HTML/JS.
                .header("X-Content-Type-Options", "nosniff")
                .header("Content-Disposition", "inline")
                .build();
    }
}
