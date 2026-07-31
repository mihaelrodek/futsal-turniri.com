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

    @UpdateTimestamp
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

    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
