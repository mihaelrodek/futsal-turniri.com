package hr.mrodek.apps.futsal_turniri.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.OffsetDateTime;

/**
 * One Web Push subscription - uniquely identified by the {@code endpoint}
 * URL that the browser vendor's push service hands out. A single Firebase
 * UID can own many rows (one per browser/device); we look them all up when
 * fanning out a notification.
 *
 * <p>The {@code p256dh} and {@code auth} columns are the
 * subscription-specific public key and shared secret that the Web Push
 * protocol uses to encrypt the payload. They're per-subscription, never
 * per-user, and must be stored verbatim from the browser response.
 */
@Entity
@Table(name = "push_subscriptions")
@Getter @Setter @NoArgsConstructor
public class PushSubscription {

    @Id
    @SequenceGenerator(name = "push_subscriptions_seq", sequenceName = "push_subscriptions_id_seq", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_uid", nullable = false, length = 128)
    private String userUid;

    @Column(nullable = false, columnDefinition = "text", unique = true)
    private String endpoint;

    @Column(nullable = false, length = 255)
    private String p256dh;

    @Column(nullable = false, length = 255)
    private String auth;

    /**
     * Best-effort browser/device hint stamped at subscribe-time. Used only
     * for diagnostics in the admin push-debug screen; never read at send.
     */
    @Column(name = "user_agent", length = 512)
    private String userAgent;

    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt = OffsetDateTime.now();

    /**
     * Refreshed on every successful push. Lets us prune subscriptions that
     * haven't received a single delivery in months (probably uninstalled
     * apps the browser hasn't told us about) without waiting for the 410.
     */
    @Column(name = "last_seen_at", nullable = false)
    private OffsetDateTime lastSeenAt = OffsetDateTime.now();
}
