package hr.mrodek.apps.futsal_turniri.services;

import com.fasterxml.jackson.databind.ObjectMapper;
import hr.mrodek.apps.futsal_turniri.model.Resources;
import hr.mrodek.apps.futsal_turniri.repository.ResourcesRepository;
import io.minio.MinioClient;
import io.minio.errors.MinioException;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;

import java.nio.file.Files;
import java.time.OffsetDateTime;
import java.util.UUID;

@ApplicationScoped
public class StorageService {

    @Inject MinioClient minio;
    @Inject ResourcesRepository resourcesRepo;
    @Inject ObjectMapper objectMapper;

    @ConfigProperty(name = "minio.bucket")
    String bucket;

    /**
     * Hard cap on poster size (bytes). The global Quarkus body-size limit is
     * 15 MiB, but a tournament poster has no business being more than a few
     * MB even at high resolution. Defense-in-depth check that stops a
     * logged-in user from filling MinIO with 15 MB images repeatedly.
     */
    private static final long MAX_POSTER_BYTES = 6L * 1024 * 1024;

    /**
     * Hard cap on avatar size (bytes). Same intent as MAX_POSTER_BYTES - a
     * profile picture has no reason to be larger than a few MB.
     */
    private static final long MAX_AVATAR_BYTES = 5L * 1024 * 1024;

    /** Longest edge after recompression, per kind. Posters render at most
     *  ~800 CSS px wide (2× for retina → 1600); avatars are small circles. */
    private static final int MAX_POSTER_DIM = 1600;
    private static final int MAX_AVATAR_DIM = 512;

    /** Hard cap on an ad VIDEO (bytes). Bounded by the global body limit
     *  (quarkus.http.limits.max-body-size) - keep the two in step. Image ads
     *  reuse the poster cap + pipeline. */
    private static final long MAX_AD_VIDEO_BYTES = 50L * 1024 * 1024;

    /** Tournament poster upload - keyed under {@code posters/...}. */
    public Resources uploadPoster(org.jboss.resteasy.reactive.multipart.FileUpload file) {
        return uploadImage(file, "poster", "posters", MAX_POSTER_BYTES, MAX_POSTER_DIM);
    }

    /** User avatar upload - keyed under {@code avatars/...}. */
    public Resources uploadAvatar(org.jboss.resteasy.reactive.multipart.FileUpload file) {
        return uploadImage(file, "avatar", "avatars", MAX_AVATAR_BYTES, MAX_AVATAR_DIM);
    }

    /**
     * Stream-ad upload - keyed under {@code ads/...}. Accepts an IMAGE
     * (jpg/png/webp → the same downscale pipeline as posters) OR a VIDEO
     * (mp4/webm → stored verbatim). The kind is decided by magic bytes, not the
     * filename. The caller reads the returned resource's content-type to know
     * which it got.
     */
    public Resources uploadAd(org.jboss.resteasy.reactive.multipart.FileUpload file) {
        java.nio.file.Path path = file.uploadedFile();
        String videoExt = sniffVideoExt(path);
        if (videoExt != null) {
            return uploadVideoAd(file, path, videoExt);
        }
        // Not a recognised video → try the image pipeline (jpg/png/webp).
        return uploadImage(file, "ad", "ads", MAX_POSTER_BYTES, MAX_POSTER_DIM);
    }

    /** Identify a video by magic bytes: MP4/MOV ("ftyp" box at offset 4) or
     *  WebM/Matroska (EBML header {@code 1A 45 DF A3}). Null when neither. */
    private String sniffVideoExt(java.nio.file.Path path) {
        byte[] head = new byte[16];
        try (java.io.InputStream in = java.nio.file.Files.newInputStream(path)) {
            int read = in.read(head);
            if (read < 12) return null;
        } catch (Exception e) {
            return null;
        }
        if (head[4] == 'f' && head[5] == 't' && head[6] == 'y' && head[7] == 'p') return "mp4";
        if ((head[0] & 0xff) == 0x1a && (head[1] & 0xff) == 0x45
                && (head[2] & 0xff) == 0xdf && (head[3] & 0xff) == 0xa3) return "webm";
        return null;
    }

    /** Store a video blob verbatim (no recompression) under {@code ads/...}. */
    private Resources uploadVideoAd(
            org.jboss.resteasy.reactive.multipart.FileUpload file,
            java.nio.file.Path path,
            String ext) {
        try {
            if (file.size() > MAX_AD_VIDEO_BYTES) {
                throw new IllegalArgumentException(
                        "Video je prevelik. Maksimum: " + (MAX_AD_VIDEO_BYTES / (1024 * 1024)) + " MB.");
            }
            boolean exists = minio.bucketExists(
                    io.minio.BucketExistsArgs.builder().bucket(bucket).build());
            if (!exists) {
                minio.makeBucket(io.minio.MakeBucketArgs.builder().bucket(bucket).build());
            }

            byte[] body = Files.readAllBytes(path);
            String objectKey = buildObjectKey("ads", ext);
            String safeContentType = "webm".equals(ext) ? "video/webm" : "video/mp4";

            var put = io.minio.PutObjectArgs.builder()
                    .bucket(bucket)
                    .object(objectKey)
                    .contentType(safeContentType)
                    .extraHeaders(java.util.Map.of(
                            "Content-Disposition", "inline",
                            "X-Content-Type-Options", "nosniff"
                    ))
                    .stream(new java.io.ByteArrayInputStream(body), body.length, -1)
                    .build();

            var result = minio.putObject(put);

            Resources r = new Resources();
            r.setBucketName(bucket);
            r.setObjectKey(objectKey);
            r.setContentType(safeContentType);
            r.setSizeBytes((long) body.length);
            r.setEtag(result.etag());
            r.setCreatedAt(OffsetDateTime.now());
            r.setUpdatedAt(OffsetDateTime.now());

            com.fasterxml.jackson.databind.node.ObjectNode meta = objectMapper.createObjectNode();
            if (file.fileName() != null) meta.put("originalFilename", file.fileName());
            meta.put("kind", "ad");
            meta.put("uploadedAt", OffsetDateTime.now().toString());
            r.setMetadata(meta);

            return resourcesRepo.save(r);
        } catch (MinioException me) {
            throw new RuntimeException("MinIO error: " + me.getMessage(), me);
        } catch (IllegalArgumentException iae) {
            throw iae;
        } catch (Exception e) {
            throw new RuntimeException("Failed to upload video ad", e);
        }
    }

    /**
     * Shared upload pipeline. The caller picks a {@code kind} (recorded in
     * metadata), an object-key {@code prefix} (e.g. {@code posters},
     * {@code avatars}), and a max-size cap. Everything else - content-type
     * validation, magic-byte / extension safety, MinIO put - is identical.
     */
    private Resources uploadImage(
            org.jboss.resteasy.reactive.multipart.FileUpload file,
            String kind,
            String prefix,
            long maxBytes,
            int maxDim) {
        try {
            // Per-image size cap, separate from the global body limit. We
            // check before reading bytes so a large file is rejected as
            // cheaply as possible.
            if (file.size() > maxBytes) {
                throw new IllegalArgumentException(
                        "Slika je prevelika. Maksimum: " + (maxBytes / (1024 * 1024)) + " MB.");
            }

            // Ensure bucket exists (no-op if it already does)
            boolean exists = minio.bucketExists(
                    io.minio.BucketExistsArgs.builder().bucket(bucket).build()
            );
            if (!exists) {
                minio.makeBucket(io.minio.MakeBucketArgs.builder().bucket(bucket).build());
            }

            java.nio.file.Path path = file.uploadedFile();
            // Magic-byte sniff - reject before we open a streaming
            // upload to MinIO. Stops a `evil.exe.jpg` renamed file from
            // landing in the bucket and being served with an image
            // content-type. nosniff blocks browser execution anyway, but
            // we want the bucket to actually contain images, and link
            // previews on social platforms to render properly.
            String magicExt = sniffMagicExt(path);
            if (magicExt == null) {
                throw new IllegalArgumentException(
                        "Unsupported image type. Allowed: jpg, jpeg, png, webp.");
            }
            // Reject "decompression bombs" BEFORE recompress() decodes the full
            // raster. A few-hundred-KB PNG/JPEG (under the byte cap) can declare
            // e.g. 25000x25000 and force a ~2.5 GB BufferedImage allocation ->
            // OutOfMemoryError (an Error, so not caught below) crashing the JVM.
            // We read only the header dimensions (no pixel decode) and cap area.
            assertImageDimensionsSane(path);
            {
                String originalName = file.fileName();
                // The bytes' actual (sniffed) type always wins over the
                // client-declared filename extension.
                String ext = magicExt;

                // Downscale + recompress before storing. A phone-camera JPEG is
                // 3-6 MB / 4000 px but renders at ≤800 CSS px - serving it
                // verbatim was the single biggest mobile LCP cost. WebP inputs
                // are passed through (ImageIO can't decode WebP without native
                // plugins, and they're already efficiently encoded).
                byte[] body;
                if ("webp".equals(ext)) {
                    body = java.nio.file.Files.readAllBytes(path);
                } else {
                    byte[] recompressed = recompress(path, ext, maxDim);
                    byte[] original = java.nio.file.Files.readAllBytes(path);
                    // Keep whichever is smaller - recompressing an already-tiny
                    // image can inflate it.
                    body = (recompressed != null && recompressed.length < original.length)
                            ? recompressed
                            : original;
                }

                String objectKey = buildObjectKey(prefix, ext);

                // SECURITY: derive the stored Content-Type from the validated extension
                // - never trust the client-supplied file.contentType().
                String safeContentType = contentTypeForExt(ext);

                var put = io.minio.PutObjectArgs.builder()
                        .bucket(bucket)
                        .object(objectKey)
                        .contentType(safeContentType)
                        .extraHeaders(java.util.Map.of(
                                "Content-Disposition", "inline",
                                "X-Content-Type-Options", "nosniff"
                        ))
                        .stream(new java.io.ByteArrayInputStream(body), body.length, -1)
                        .build();

                var result = minio.putObject(put);

                Resources r = new Resources();
                r.setBucketName(bucket);
                r.setObjectKey(objectKey);
                r.setContentType(safeContentType);
                r.setSizeBytes((long) body.length);
                r.setEtag(result.etag());
                r.setCreatedAt(OffsetDateTime.now());
                r.setUpdatedAt(OffsetDateTime.now());

                com.fasterxml.jackson.databind.node.ObjectNode meta = objectMapper.createObjectNode();
                if (originalName != null) meta.put("originalFilename", originalName);
                meta.put("kind", kind);
                meta.put("uploadedAt", OffsetDateTime.now().toString());
                r.setMetadata(meta);

                return resourcesRepo.save(r);
            }
        } catch (MinioException me) {
            throw new RuntimeException("MinIO error: " + me.getMessage(), me);
        } catch (IllegalArgumentException iae) {
            // Don't wrap - let the IllegalArgumentExceptionMapper turn this into 400.
            throw iae;
        } catch (Exception e) {
            throw new RuntimeException("Failed to upload " + kind, e);
        }
    }

    /**
     * Downscale to {@code maxDim} on the longest edge and re-encode (JPEG at
     * quality 0.85; PNG stays PNG to preserve alpha). Returns {@code null} on
     * any decode/encode failure so the caller falls back to the original bytes
     * - a picture we can't decode is stored verbatim rather than rejected.
     */
    /**
     * Guard against image "decompression bombs": read ONLY the header
     * dimensions via an ImageReader (no raster decode / no big allocation) and
     * reject anything above a generous megapixel budget. Real phone photos are
     * ~12-108 MP; 40 MP is a safe ceiling that still blocks the 25000x25000
     * (~625 MP) style attack. Formats ImageIO can't read (e.g. WebP) fall
     * through - they aren't decoded here anyway and stay bounded by the byte cap.
     */
    private void assertImageDimensionsSane(java.nio.file.Path path) {
        final long MAX_PIXELS = 40_000_000L; // ~40 megapixels
        javax.imageio.stream.ImageInputStream iis = null;
        javax.imageio.ImageReader reader = null;
        try {
            iis = javax.imageio.ImageIO.createImageInputStream(path.toFile());
            if (iis == null) return;
            java.util.Iterator<javax.imageio.ImageReader> readers =
                    javax.imageio.ImageIO.getImageReaders(iis);
            if (!readers.hasNext()) return;
            reader = readers.next();
            reader.setInput(iis, true, true);
            long w = reader.getWidth(0);
            long h = reader.getHeight(0);
            if (w > 0 && h > 0 && w * h > MAX_PIXELS) {
                throw new IllegalArgumentException(
                        "Slika ima previše piksela (najviše ~40 MP). Smanji razlučivost pa pokušaj ponovno.");
            }
        } catch (IllegalArgumentException iae) {
            throw iae;
        } catch (Exception e) {
            // Header unreadable → let recompress()/passthrough handle it; the
            // byte-size cap already bounds truly huge files.
        } finally {
            if (reader != null) reader.dispose();
            if (iis != null) {
                try { iis.close(); } catch (Exception ignored) { }
            }
        }
    }

    private byte[] recompress(java.nio.file.Path path, String ext, int maxDim) {
        try {
            var out = new java.io.ByteArrayOutputStream(256 * 1024);
            net.coobird.thumbnailator.Thumbnails.of(path.toFile())
                    .size(maxDim, maxDim)          // fits within, keeps aspect, never upscales beyond source
                    .outputFormat("png".equals(ext) ? "png" : "jpg")
                    .outputQuality(0.85)
                    .toOutputStream(out);
            return out.toByteArray();
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Read the first 12 bytes of the uploaded file and identify it by
     * magic number, returning our canonical extension ("jpg" / "png" /
     * "webp") or {@code null} when the content is not an accepted image.
     *
     * <p>Why this matters: previously we trusted the filename extension
     * only - an attacker could upload {@code evil.exe} renamed to
     * {@code evil.jpg}, the bucket would store the EXE blob with
     * {@code Content-Type: image/jpeg}, and downstream consumers
     * (browsers under nosniff are safe, but social-media link preview
     * crawlers, image-thumbnail pipelines, etc. may not be) could fetch
     * it as an image when it isn't.
     */
    private String sniffMagicExt(java.nio.file.Path path) {
        byte[] head = new byte[12];
        try (java.io.InputStream in = java.nio.file.Files.newInputStream(path)) {
            int read = in.read(head);
            if (read < 4) return null;
        } catch (Exception e) {
            return null;
        }
        // JPEG: FF D8 FF
        if ((head[0] & 0xff) == 0xff && (head[1] & 0xff) == 0xd8 && (head[2] & 0xff) == 0xff) {
            return "jpg";
        }
        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if ((head[0] & 0xff) == 0x89 && head[1] == 'P' && head[2] == 'N' && head[3] == 'G') {
            return "png";
        }
        // WebP: "RIFF" .... "WEBP"
        if (head[0] == 'R' && head[1] == 'I' && head[2] == 'F' && head[3] == 'F'
                && head[8] == 'W' && head[9] == 'E' && head[10] == 'B' && head[11] == 'P') {
            return "webp";
        }
        return null;
    }

    /**
     * Map our internal extension token to the Content-Type we want stored on the
     * MinIO object. Decoupled from request input so a malicious client can't
     * trick us into serving uploaded bytes as HTML/JS/SVG.
     */
    private String contentTypeForExt(String ext) {
        return switch (ext) {
            case "jpg" -> "image/jpeg";
            case "png" -> "image/png";
            case "webp" -> "image/webp";
            // Should be unreachable - uploadImage() rejects "bin" before this point.
            default -> "application/octet-stream";
        };
    }

    private String buildObjectKey(String prefix, String ext) {
        // e.g. posters/ab/uuid.jpg or avatars/ab/uuid.jpg
        String id = UUID.randomUUID().toString();
        return "%s/%s/%s.%s".formatted(prefix, id.substring(0, 2), id, ext);
    }
}
