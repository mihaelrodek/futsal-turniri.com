package hr.mrodek.apps.futsal_turniri.model;

import hr.mrodek.apps.futsal_turniri.enums.RecordingRequestStatus;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * One paid request for the video recording of a single match (~20 EUR).
 * Delivery is exclusively a {@link #recording} linked in from the admin's
 * recording library - no external links are accepted. The admin never
 * uploads a file directly against a request; uploads happen in the library
 * ({@link MatchRecording}) and get linked here.
 */
@Entity
@Table(name = "match_recording_requests")
@Getter @Setter @NoArgsConstructor
public class MatchRecordingRequest {

    @Id
    @SequenceGenerator(name = "match_recording_requests_seq",
            sequenceName = "seq_match_recording_requests_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "match_recording_requests_seq")
    private Long id;

    @Column(nullable = false, unique = true)
    private UUID uuid;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "match_id", nullable = false)
    private Matches match;

    /** Firebase UID of the requester. */
    @Column(name = "created_by_uid", length = 64, nullable = false)
    private String createdByUid;

    @Column(name = "contact_email", length = 255)
    private String contactEmail;

    @Column(name = "note", length = 1000)
    private String note;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 20, nullable = false)
    private RecordingRequestStatus status = RecordingRequestStatus.REQUESTED;

    @Column(name = "admin_note", length = 1000)
    private String adminNote;

    /** Price in euro cents; default 2000 = 20 EUR. */
    @Column(name = "price_eur_cents", nullable = false)
    private Integer priceEurCents = 2000;

    /** Set when the admin marks the request as paid; null = unpaid. */
    @Column(name = "paid_at")
    private OffsetDateTime paidAt;

    /** Library recording linked in by an admin as this request's delivery. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "recording_id")
    private MatchRecording recording;

    @CreationTimestamp
    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        if (uuid == null) uuid = UUID.randomUUID();
        if (status == null) status = RecordingRequestStatus.REQUESTED;
        if (priceEurCents == null) priceEurCents = 2000;
    }
}
