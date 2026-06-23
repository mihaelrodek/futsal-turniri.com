package hr.mrodek.apps.futsal_turniri.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * A team-name preset saved by an end user. Each row is scoped to a single
 * Firebase UID — the controller filters by that on every read/write so users
 * never see each other's presets.
 */
@Entity
@Table(name = "user_team_presets")
@Getter @Setter @NoArgsConstructor
public class UserTeamPreset {

    @Id
    @SequenceGenerator(name = "user_team_presets_seq", sequenceName = "seq_user_team_presets_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "user_team_presets_seq")
    private Long id;

    @Column(nullable = false, unique = true)
    private UUID uuid;

    @Column(name = "user_uid", length = 64, nullable = false)
    private String userUid;

    @Column(name = "name", length = 200, nullable = false)
    private String name;

    /**
     * When true, public profile views (anyone other than the owner)
     * skip tournaments where this user played as a team with this name.
     * The owner viewing their own profile still sees everything —
     * it's a display-time visibility knob, not a delete.
     */
    @Column(name = "hidden", nullable = false)
    private boolean hidden = false;

    /**
     * Opaque random token embedded in the share URL
     * (/claim-name/{token}). Stable for the preset's lifetime — same
     * link works forever. Set when the row is created and on backfill
     * for pre-sharing presets.
     */
    @Column(name = "claim_token", length = 48, unique = true)
    private String claimToken;

    /**
     * Firebase UID of the partner who claimed co-ownership via the
     * share link. When set, every tournament where the primary
     * played as a team with this name shows up on the partner's
     * profile too (via the widened findMyParticipations query).
     * Locks the preset against unilateral deletion — use the
     * archive-request flow instead.
     */
    @Column(name = "co_owner_uid", length = 64)
    private String coOwnerUid;

    /**
     * Set when one owner has filed an archive request and the other
     * hasn't responded yet. Null while no request is pending. Holds
     * the requester's Firebase UID so the partner knows who's asking.
     */
    @Column(name = "archive_request_by_uid", length = 64)
    private String archiveRequestByUid;

    /**
     * True once both owners agreed to remove the team. The row stays
     * in the DB for historical reference; UI filters it out of both
     * Moji parovi lists.
     */
    @Column(name = "archived", nullable = false)
    private boolean archived = false;

    @Column(name = "archived_at")
    private OffsetDateTime archivedAt;

    @CreationTimestamp
    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        if (uuid == null) uuid = UUID.randomUUID();
    }
}
