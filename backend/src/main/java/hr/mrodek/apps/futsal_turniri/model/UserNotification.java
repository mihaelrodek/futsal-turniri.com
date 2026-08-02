package hr.mrodek.apps.futsal_turniri.model;

import hr.mrodek.apps.futsal_turniri.enums.NotificationKind;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.OffsetDateTime;

/**
 * One notification as it was delivered to ONE recipient - the durable half of
 * the Web Push fan-out, which is otherwise fire-and-forget. Every row is
 * written by {@link hr.mrodek.apps.futsal_turniri.services.PushService} at
 * send time, one per recipient UID per event, and is what the "Obavijesti"
 * inbox reads back.
 *
 * <p><b>Why no {@code @ManyToOne} for match / tournament.</b> Both are stored
 * as plain id columns on purpose:
 * <ul>
 *   <li>A notification has to outlive its subject. Deleting a match (or a
 *       whole tournament) must not cascade away the user's history, and an FK
 *       would force either a cascade or a nulling trigger.</li>
 *   <li>The write path runs inside push fan-out, where the caller has already
 *       resolved everything it needs to plain values - see the threading note
 *       on {@link hr.mrodek.apps.futsal_turniri.services.UserNotificationService}.
 *       Storing ids means this entity never touches a lazy association, so it
 *       can be persisted from anywhere without a lazy-init risk.</li>
 * </ul>
 * The inbox resolves the labels it needs (match label, tournament name) at
 * READ time, and falls back to the notification's own title when the row is
 * gone.
 *
 * <p>{@link #matchId} is also the grouping key: ten pushes about one match
 * collapse into a single inbox group.
 */
@Entity
@Table(name = "user_notifications")
@Getter @Setter @NoArgsConstructor
public class UserNotification {

    @Id
    @SequenceGenerator(name = "user_notifications_seq",
            sequenceName = "seq_user_notifications_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "user_notifications_seq")
    private Long id;

    /** Firebase UID of the RECIPIENT. Never null - an anonymous (endpoint-only)
     *  push follower has no identity to show an inbox to, so no row is written. */
    @Column(name = "user_uid", length = 64, nullable = false)
    private String userUid;

    @Enumerated(EnumType.STRING)
    @Column(name = "kind", length = 32, nullable = false)
    private NotificationKind kind = NotificationKind.GENERIC;

    @Column(name = "title", length = 255, nullable = false)
    private String title;

    @Column(name = "body", columnDefinition = "text", nullable = false)
    private String body;

    /** Deep link the push carried ("/turniri/{slug}/utakmica/{id}"), or null. */
    @Column(name = "url", length = 512)
    private String url;

    /** Grouping key - plain id, see the class javadoc. */
    @Column(name = "match_id")
    private Long matchId;

    @Column(name = "tournament_id")
    private Long tournamentId;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now();

    /** Null while unread; stamped by {@code POST /notifications/read}. */
    @Column(name = "read_at")
    private OffsetDateTime readAt;
}
