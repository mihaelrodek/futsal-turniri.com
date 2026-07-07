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

    @Column(name = "user_uid", nullable = false, length = 128)
    private String userUid;

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
