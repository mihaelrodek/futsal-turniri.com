package hr.mrodek.apps.futsal_turniri.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;

@Entity
@Table(name = "user_profiles")
@Getter @Setter @NoArgsConstructor
public class UserProfile {

    /** Firebase UID, used as the primary key - one row per user. */
    @Id
    @Column(name = "user_uid", length = 64)
    private String userUid;

    @Column(name = "phone_country", length = 8)
    private String phoneCountry;

    @Column(name = "phone", length = 50)
    private String phone;

    /** Mirrored from Firebase on every /user/me/sync - used to label public profiles. */
    @Column(name = "display_name", length = 200)
    private String displayName;

    /** First name, captured at registration. The username/slug defaults to
     *  {@code firstName-lastName}. Backfilled from displayName for older rows. */
    @Column(name = "first_name", length = 120)
    private String firstName;

    /** Last name, captured at registration (may be null for single-name accounts). */
    @Column(name = "last_name", length = 120)
    private String lastName;

    /**
     * Email address, mirrored from the Firebase ID token's {@code email} claim
     * on every /user/me/sync. Used to send tournament-notification emails.
     * Null for older rows synced before this was captured, or if the token
     * carries no email (rare).
     */
    @Column(name = "email", length = 320)
    private String email;

    /**
     * Public, URL-safe handle used at /profile/{slug}. Derived from displayName
     * with auto-numbered collision (-2, -3) and made unique by an index.
     */
    @Column(name = "slug", length = 200)
    private String slug;

    /**
     * Optional profile picture. Lazy because most callers don't need the
     * Resources row's bytes/metadata; the SPA only needs the proxied URL,
     * which is computed from the resource id alone.
     */
    @ManyToOne(fetch = FetchType.LAZY, optional = true)
    @JoinColumn(name = "avatar_resource_id")
    private Resources avatar;

    /**
     * Per-user theme preference - "light" or "dark". Null means the
     * user hasn't picked one yet; the frontend defaults to light. We
     * sync this on login so the choice survives across devices.
     */
    @Column(name = "color_mode", length = 10)
    private String colorMode;

    /**
     * Per-user UI language preference - "hr", "en" or "sl". Null means the
     * user hasn't explicitly picked one on this account; the frontend then
     * falls back to its own browser-detected/localStorage default. Synced on
     * login the same way {@link #colorMode} is.
     */
    @Column(name = "language", length = 2)
    private String language;

    /**
     * "Nisam igrač" - the person said they don't play, so the automatic
     * "is this you?" prompt stops being offered. Stored here rather than in
     * localStorage because the answer has to hold on every device, and a
     * namesake appearing on some roster years later must not resurrect the
     * prompt. Silences suggestions only: the manual, admin-approved request
     * flow stays available, and clearing this re-enables everything.
     */
    @Column(name = "player_claim_opt_out", nullable = false)
    private boolean playerClaimOptOut = false;

    /**
     * "Promotivne poruke i novosti na e-mail" - the account-wide marketing /
     * announcement opt-in for e-mail.
     *
     * <p><b>This is NOT the notification bell.</b> Per-tournament and per-match
     * follows live in their own tables ({@code tournament_subscriptions},
     * {@code match_subscriptions}) and are completely independent: switching
     * this off must never stop a goal, half-time, final-whistle, schedule or
     * team-approval message for something the user explicitly followed. It
     * governs only broadcast-style promo / general announcements.
     *
     * <p>Defaults to {@code true} (opted in) so existing accounts keep getting
     * what they get today; the column is NOT NULL with a DB default.
     */
    @Column(name = "promo_email", nullable = false)
    private boolean promoEmail = true;

    /**
     * Push counterpart of {@link #promoEmail} - the account-wide marketing /
     * announcement opt-in for web push. Same rule: independent of the
     * per-tournament / per-match bells, which keep firing regardless.
     */
    @Column(name = "promo_push", nullable = false)
    private boolean promoPush = true;

    /**
     * Mirror of the Firebase {@code role} custom claim, refreshed on every
     * {@code /user/me/sync}. Exists for exactly ONE reason: to answer "which
     * UIDs should receive an admin-facing notification", because admins are not
     * otherwise listed anywhere in the database (the role lives only in the
     * Firebase token).
     *
     * <p><b>SECURITY - this column is NEVER an authorization source.</b> No
     * endpoint, filter or service may read it to decide whether a caller is
     * allowed to do something. Authorization stays exactly where it is today:
     * {@code @RolesAllowed("admin")} evaluated against the cryptographically
     * verified JWT, whose {@code role} claim Quarkus OIDC maps into the
     * SecurityIdentity ({@code quarkus.oidc.roles.role-claim-path=role}). This
     * row is ordinary, mutable application data: a stale value (role revoked in
     * Firebase since the user's last login) or a tampered/hand-edited row must
     * not be able to grant access to anything - the worst it can ever cause is
     * a notification delivered to the wrong inbox.
     *
     * <p>Self-healing: the value is rewritten from the verified claim on every
     * login, so granting or revoking the role converges on the next sync.
     */
    @Column(name = "admin", nullable = false)
    private boolean admin = false;

    /** Maintained by Hibernate on every flush. The annotation used to sit
     *  above `playerClaimOptOut` (a boolean), so this column was never
     *  actually refreshed. */
    @UpdateTimestamp
    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
