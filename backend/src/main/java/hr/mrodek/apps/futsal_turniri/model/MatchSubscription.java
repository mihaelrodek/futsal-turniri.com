package hr.mrodek.apps.futsal_turniri.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.OffsetDateTime;

/**
 * One user's opt-in to receive a Web Push when a single match goes live.
 *
 * <p>Identity is the {@code (user_uid, match_id)} pair — a uniqueness
 * constraint on those two columns makes the subscribe endpoint idempotent
 * regardless of how many times the bell is tapped. Cascade-deleted with the
 * parent match; {@code user_uid} is the Firebase UID (plain string, no FK —
 * same convention as {@link TournamentSubscription}).
 */
@Entity
@Table(name = "match_subscriptions")
@Getter @Setter @NoArgsConstructor
public class MatchSubscription {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_uid", nullable = false, length = 128)
    private String userUid;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "match_id", nullable = false)
    private Matches match;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) createdAt = OffsetDateTime.now();
    }
}
