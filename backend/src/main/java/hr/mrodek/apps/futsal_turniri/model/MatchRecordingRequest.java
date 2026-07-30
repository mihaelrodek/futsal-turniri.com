package hr.mrodek.apps.futsal_turniri.model;

import hr.mrodek.apps.futsal_turniri.enums.RecordingRequestKind;
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
 * One paid request for match video. Two flavours, told apart by {@link #kind}:
 * the whole match (~20 EUR) or a clip of a single goal (~5 EUR, with
 * {@link #matchEvent} naming the goal).
 *
 * Delivery is identical for both and is exclusively a {@link #recording} linked
 * in from the admin's recording library - no external links are accepted. The
 * admin never uploads a file directly against a request; uploads happen in the
 * library ({@link MatchRecording}) and get linked here.
 *
 * <p>A request may be made anonymously (no Firebase account): in that case
 * {@link #createdByUid} is null and {@link #contactEmail} is mandatory - the
 * request's {@link #uuid} then acts as the sole capability token for the
 * public status page, Stripe checkout and cancellation.
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

    /** Whole match or a single goal clip. Drives the default price. */
    @Enumerated(EnumType.STRING)
    @Column(name = "kind", length = 20, nullable = false)
    private RecordingRequestKind kind = RecordingRequestKind.FULL_MATCH;

    /**
     * The requested goal - set only for {@link RecordingRequestKind#GOAL}.
     * Nulled (not cascaded) if the event is later deleted, which is why
     * {@link #goalMinute} / {@link #goalLabel} keep a snapshot of it.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "match_event_id")
    private MatchEvent matchEvent;

    /** Snapshot of the goal's minute at request time. */
    @Column(name = "goal_minute")
    private Integer goalMinute;

    /**
     * Human-readable snapshot of the requested goal ("12' - M. Rodek (Ekipa A)"),
     * taken at request time so the row still reads correctly after the organizer
     * corrects or deletes the underlying event.
     */
    @Column(name = "goal_label", length = 255)
    private String goalLabel;

    /** Firebase UID of the requester; null for an anonymous request (see {@link #contactEmail}). */
    @Column(name = "created_by_uid", length = 64)
    private String createdByUid;

    @Column(name = "contact_email", length = 255)
    private String contactEmail;

    /** Mandatory (validated) for an anonymous /cjenik cart order; null for the original per-match request flow. */
    @Column(name = "contact_phone", length = 40)
    private String contactPhone;

    @Column(name = "note", length = 1000)
    private String note;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 20, nullable = false)
    private RecordingRequestStatus status = RecordingRequestStatus.REQUESTED;

    @Column(name = "admin_note", length = 1000)
    private String adminNote;

    /**
     * Price in euro cents. Left null on a new row so {@link #onCreate()} can
     * derive it from {@link #kind} (2000 = 20 EUR whole match, 500 = 5 EUR goal
     * clip); once persisted it is authoritative and a later price change never
     * rewrites it.
     */
    @Column(name = "price_eur_cents", nullable = false)
    private Integer priceEurCents;

    /** Set when the admin marks the request as paid; null = unpaid. */
    @Column(name = "paid_at")
    private OffsetDateTime paidAt;

    /**
     * Stripe Checkout session id (cs_...) of the completed payment - the
     * reference for finding the charge in the Stripe dashboard. Null for a
     * manual paid toggle (cash / bank transfer).
     */
    @Column(name = "stripe_session_id", length = 255)
    private String stripeSessionId;

    /**
     * Email the payer entered on the Stripe Checkout page. May differ from
     * {@link #contactEmail}: the status link is a capability, so someone else
     * (a teammate, a parent) can legitimately pay the request.
     */
    @Column(name = "payer_email", length = 255)
    private String payerEmail;

    /**
     * Shared by every row created from ONE /cjenik cart checkout (Hattrick = 3
     * rows, Zlatna kopačka = one row per team match) so the Stripe webhook can
     * mark them all paid from a single Checkout Session. Null for a request
     * filed the old way (one row, its own {@code uuid} is the sole capability).
     */
    @Column(name = "cart_group_id")
    private UUID cartGroupId;

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
        if (kind == null) kind = RecordingRequestKind.FULL_MATCH;
        if (priceEurCents == null) priceEurCents = kind.defaultPriceEurCents();
    }
}
