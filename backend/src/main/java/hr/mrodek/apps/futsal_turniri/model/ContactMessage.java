package hr.mrodek.apps.futsal_turniri.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

/**
 * A message sent through the public "Kontaktiraj nas" form (/kontakt) - the
 * generic catch-all channel for anything that isn't one of the structured
 * flows (recording requests, camera-package quotes, player claims). Name,
 * email and the message body are mandatory (see ContactController for
 * validation); the subject is optional because most visitors just type.
 *
 * Like {@link CameraPackageInquiry} this carries no status enum: the reply
 * happens off-platform (email), so the only state the app needs is a single
 * {@code handledAt} flag an admin toggles once they've answered.
 * Submitting doesn't require an account, though the sender may happen to be
 * signed in - in which case {@code userUid} is filled from the verified token
 * purely so an admin can see who wrote in.
 */
@Entity
@Table(name = "contact_messages")
@Getter @Setter @NoArgsConstructor
public class ContactMessage {

    @Id
    @SequenceGenerator(name = "contact_messages_seq",
            sequenceName = "seq_contact_messages_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "contact_messages_seq")
    private Long id;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(nullable = false, length = 255)
    private String email;

    /** Optional - the form lets the sender skip it, so most rows are null. */
    @Column(length = 160)
    private String subject;

    /**
     * Why the sender wrote in - one of the fixed keys the form offers (see
     * {@code ContactController.REASONS}), never free text. Stored as the raw
     * key, not a translated label: the admin console and every e-mail resolve
     * it through the message bundles, so the row stays language-neutral.
     * Rows written before the field existed are null; the UI treats that as
     * "OSTALO".
     */
    @Column(length = 40)
    private String reason;

    @Column(nullable = false, length = 4000)
    private String message;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    /**
     * When an admin marked this message as answered. {@code null} = still in
     * the admin's queue, which is what the /admin pending-count badge
     * ({@code poruke}) counts. A manual flag, not a lifecycle: clearing it
     * puts the message straight back in the queue.
     */
    @Column(name = "handled_at")
    private OffsetDateTime handledAt;

    /**
     * Firebase uid of the sender when they happened to be signed in while
     * submitting, otherwise null. INFORMATIONAL ONLY - the form is fully
     * public and nothing about the message is authorized against this.
     */
    @Column(name = "user_uid", length = 128)
    private String userUid;
}
