package hr.mrodek.apps.futsal_turniri.services;

import io.minio.GetPresignedObjectUrlArgs;
import io.minio.MinioClient;
import io.minio.RemoveObjectArgs;
import io.minio.StatObjectArgs;
import io.minio.errors.ErrorResponseException;
import io.minio.http.Method;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.util.Map;
import java.util.Optional;

/**
 * Presigned-URL access to MinIO for match-recording delivery: the admin
 * uploads an mp4 straight to the bucket via presigned PUT (bypassing the
 * 60 MB request-body limit of the backend), the requester downloads it via
 * presigned GET.
 *
 * <p>Why a SECOND MinioClient: an S3 presigned URL's signature covers the
 * Host header, so a URL signed against the internal endpoint (e.g.
 * {@code http://minio:9000} inside the compose network) is invalid when the
 * browser hits it through the public endpoint. When
 * {@code minio.public-endpoint} is configured we sign with a client pinned to
 * that public endpoint; otherwise we fall back to the internal
 * {@code minio.endpoint} (fine in dev where both are localhost).
 * {@code statObject} keeps using the injected internal client - it's a
 * server-side call, no browser involved.
 */
@ApplicationScoped
public class RecordingStorageService {

    /** Internal client (from {@link hr.mrodek.apps.futsal_turniri.config.MinioConfig}) - server-side calls only. */
    @Inject MinioClient minio;

    @ConfigProperty(name = "minio.endpoint")
    String endpoint;

    @ConfigProperty(name = "minio.accessKey")
    String accessKey;

    @ConfigProperty(name = "minio.secretKey")
    String secretKey;

    @ConfigProperty(name = "minio.bucket")
    String bucket;

    /** Browser-reachable MinIO endpoint; empty/absent = sign against {@code minio.endpoint}. */
    @ConfigProperty(name = "minio.public-endpoint")
    Optional<String> publicEndpoint;

    /** Lazily-built signing client pinned to the public endpoint (see class javadoc). */
    private volatile MinioClient signingClient;

    private MinioClient signer() {
        MinioClient c = signingClient;
        if (c == null) {
            synchronized (this) {
                if (signingClient == null) {
                    String ep = publicEndpoint.filter(s -> !s.isBlank()).orElse(endpoint);
                    signingClient = MinioClient.builder()
                            .endpoint(ep)
                            .credentials(accessKey, secretKey)
                            .build();
                }
                c = signingClient;
            }
        }
        return c;
    }

    /** Presigned PUT URL for uploading {@code objectKey}, valid {@code expirySeconds}. */
    public String presignedPut(String objectKey, int expirySeconds) {
        return presign(Method.PUT, objectKey, expirySeconds);
    }

    /**
     * Presigned GET URL for downloading {@code objectKey}, valid {@code expirySeconds}.
     * The browser saves the file as {@code downloadFileName} regardless of the
     * (UUID-based) object key, via a signed {@code response-content-disposition}
     * override - standard S3 GetObject behaviour, no server-side rename needed.
     */
    public String presignedGet(String objectKey, int expirySeconds, String downloadFileName) {
        try {
            var builder = GetPresignedObjectUrlArgs.builder()
                    .method(Method.GET)
                    .bucket(bucket)
                    .object(objectKey)
                    .expiry(expirySeconds);
            if (downloadFileName != null && !downloadFileName.isBlank()) {
                builder.extraQueryParams(Map.of(
                        "response-content-disposition",
                        "attachment; filename=\"" + sanitizeHeaderValue(downloadFileName) + "\""));
            }
            return signer().getPresignedObjectUrl(builder.build());
        } catch (Exception e) {
            throw new RuntimeException("Failed to presign GET for " + objectKey, e);
        }
    }

    /** Strips characters that would break the quoted Content-Disposition value. */
    private static String sanitizeHeaderValue(String value) {
        return value.replaceAll("[\\r\\n\"]", "").trim();
    }

    private String presign(Method method, String objectKey, int expirySeconds) {
        try {
            return signer().getPresignedObjectUrl(
                    GetPresignedObjectUrlArgs.builder()
                            .method(method)
                            .bucket(bucket)
                            .object(objectKey)
                            .expiry(expirySeconds)
                            .build());
        } catch (Exception e) {
            throw new RuntimeException("Failed to presign " + method + " for " + objectKey, e);
        }
    }

    /**
     * Object size in bytes, or empty when the object doesn't exist (MinIO
     * answers stat-of-missing-key with an S3 error response).
     */
    public Optional<Long> statSize(String objectKey) {
        try {
            var stat = minio.statObject(
                    StatObjectArgs.builder().bucket(bucket).object(objectKey).build());
            return Optional.of(stat.size());
        } catch (ErrorResponseException e) {
            // NoSuchKey / NoSuchBucket -> the object simply isn't there.
            return Optional.empty();
        } catch (Exception e) {
            throw new RuntimeException("Failed to stat object " + objectKey, e);
        }
    }

    /** Removes an object from the bucket; a no-op (no error) if it's already gone. */
    public void deleteObject(String objectKey) {
        try {
            minio.removeObject(RemoveObjectArgs.builder().bucket(bucket).object(objectKey).build());
        } catch (Exception e) {
            throw new RuntimeException("Failed to delete object " + objectKey, e);
        }
    }
}
