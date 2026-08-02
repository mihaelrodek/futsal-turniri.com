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

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Audit row for one email sent by hand from the admin "Pošalji mail" module
 * ({@link hr.mrodek.apps.futsal_turniri.controller.AdminMailController}).
 *
 * <p>Transactional email is fire-and-forget everywhere else in this codebase
 * (see {@link hr.mrodek.apps.futsal_turniri.services.EmailService}), which is
 * fine for an automatic notification but useless for an admin who is manually
 * re-sending a mail that silently failed the first time: without a record
 * there is no way to tell whether the second attempt even happened. This table
 * is that record - it is written only by the admin mailer, never by the
 * automatic notifiers.
 *
 * <p><b>No FK to the recording request.</b> {@link #recordingRequestUuid} is a
 * plain uuid column for the same reason
 * {@link UserNotification#getMatchId()} is a plain id: the audit trail has to
 * outlive whatever it is about, and the write path must never touch a lazy
 * association. Everything stored here is a plain value resolved by the caller
 * on the request thread.
 *
 * <p>{@link #ok} records only whether the send was <em>accepted</em> - the
 * SMTP hand-off itself is asynchronous, so a true here means "handed to the
 * mailer without a precondition failure", not "landed in the inbox".
 */
@Entity
@Table(name = "admin_sent_mails")
@Getter @Setter @NoArgsConstructor
public class AdminSentMail {

    /** Longest body snippet kept for the log list - see {@link #bodyPreview}. */
    public static final int BODY_PREVIEW_MAX = 500;

    @Id
    @SequenceGenerator(name = "admin_sent_mails_seq",
            sequenceName = "seq_admin_sent_mails_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "admin_sent_mails_seq")
    private Long id;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now();

    /** Firebase UID of the admin who pressed send. */
    @Column(name = "sent_by_uid", length = 64)
    private String sentByUid;

    @Column(name = "to_email", length = 255, nullable = false)
    private String toEmail;

    /** Name of the {@code AdminMailController.MailTemplateKey} that was used. */
    @Column(name = "template_key", length = 40, nullable = false)
    private String templateKey;

    @Column(name = "subject", length = 255, nullable = false)
    private String subject;

    /** First {@value #BODY_PREVIEW_MAX} characters of the sent body, tags
     *  stripped - enough to recognise the mail in the log without storing a
     *  second copy of every email the platform ever sent. */
    @Column(name = "body_preview", length = BODY_PREVIEW_MAX)
    private String bodyPreview;

    /** The recording request this mail was about; null for a free-form mail. */
    @Column(name = "recording_request_uuid")
    private UUID recordingRequestUuid;

    @Column(name = "ok", nullable = false)
    private boolean ok = true;

    @Column(name = "error_message", length = 500)
    private String errorMessage;
}
