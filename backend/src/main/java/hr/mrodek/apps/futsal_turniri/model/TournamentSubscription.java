package hr.mrodek.apps.futsal_turniri.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.OffsetDateTime;

/**
 * One user's opt-in to receive Web Push notifications for a single
 * tournament's live events (goals, second-half kickoff, finished matches).
 *
 * <p>Identity is the {@code (user_uid, tournament_id)} pair - a uniqueness
 * constraint on those two columns makes the subscribe endpoint idempotent
 * regardless of how many times the bell is tapped. Cascade-deleted with
 * the parent tournament; {@code user_uid} is the Firebase UID (plain
 * string, no FK - see {@code push_subscriptions} for the same convention).
 */
@Entity
@Table(name = "tournament_subscriptions")
@Getter @Setter @NoArgsConstructor
public class TournamentSubscription {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /**
     * Firebase UID of the follower, or {@code null} for an ANONYMOUS follow.
     * Exactly one of {@code userUid} / {@code pushEndpoint} is set (DB XOR
     * check): logged-in follows carry the uid, anonymous follows carry the
     * endpoint.
     */
    @Column(name = "user_uid", length = 128)
    private String userUid;

    /**
     * For an ANONYMOUS follow: the browser's Web Push endpoint (a plain-string
     * copy of {@code push_subscriptions.endpoint}, no FK - same convention as
     * {@code userUid}). {@code null} for logged-in follows. Fan-out resolves an
     * anonymous row straight to this endpoint's {@link PushSubscription}.
     */
    @Column(name = "push_endpoint", columnDefinition = "text")
    private String pushEndpoint;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "tournament_id", nullable = false)
    private Tournaments tournament;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) createdAt = OffsetDateTime.now();
    }
}
