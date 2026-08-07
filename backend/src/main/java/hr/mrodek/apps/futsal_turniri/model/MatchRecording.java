package hr.mrodek.apps.futsal_turniri.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * One uploaded video in the admin's recording library, tied to a single
 * match. Independent of any paid request - an admin uploads it once here and
 * links it into one or more {@link MatchRecordingRequest} rows for that match.
 */
@Entity
@Table(name = "match_recordings")
@Getter @Setter @NoArgsConstructor
public class MatchRecording {

    @Id
    @SequenceGenerator(name = "match_recordings_seq",
            sequenceName = "seq_match_recordings_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "match_recordings_seq")
    private Long id;

    @Column(nullable = false, unique = true)
    private UUID uuid;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "match_id", nullable = false)
    private Matches match;

    /** MinIO object key, e.g. {@code recordings/library/<uuid>.mp4}. */
    @Column(name = "video_object_key", length = 255, nullable = false)
    private String videoObjectKey;

    @Column(name = "video_size_bytes")
    private Long videoSizeBytes;

    /** Human-readable download filename, admin-editable at any time. */
    @Column(name = "file_name", length = 255)
    private String fileName;

    /** Firebase UID of the admin who uploaded it. */
    @Column(name = "uploaded_by_uid", length = 64)
    private String uploadedByUid;

    /**
     * Capability token behind the permanent share link
     * ({@code GET /match-recordings/share/{token}}), which mints a fresh
     * presigned URL per click so a copied link never expires.
     *
     * <p><b>The token IS the credential.</b> Anyone holding it downloads the
     * video without an account, until an admin rotates it. Deliberately a
     * SECOND random uuid rather than a reuse of {@link #uuid}: the row's own
     * id travels through admin URLs and DTOs, and a shared link must be
     * revocable without changing the identity of the recording.
     */
    @Column(name = "share_token", nullable = false, unique = true)
    private UUID shareToken;

    /**
     * When {@link #shareToken} was (re)issued - the anchor for the share
     * link's 48h validity window (see MatchRecordingController#share).
     * Rotating the token ({@code rotateShareToken}) resets this; it is
     * deliberately separate from {@link #createdAt}, which never changes.
     */
    @Column(name = "share_token_created_at", nullable = false)
    private OffsetDateTime shareTokenCreatedAt;

    @CreationTimestamp
    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        if (uuid == null) uuid = UUID.randomUUID();
        if (shareToken == null) shareToken = UUID.randomUUID();
        if (shareTokenCreatedAt == null) shareTokenCreatedAt = OffsetDateTime.now();
    }
}
