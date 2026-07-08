package hr.mrodek.apps.futsal_turniri.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;

@Entity
@Table(name = "teams")
@Getter @Setter @NoArgsConstructor
public class Teams {

    @Id
    @SequenceGenerator(name = "teams_seq", sequenceName = "seq_teams_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "teams_seq")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tournament_id", nullable = false)
    private Tournaments tournament;

    /**
     * The group this team was drawn into (GROUPS_KNOCKOUT group stage).
     * Null before the draw, and for KNOCKOUT_ONLY tournaments.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "group_id")
    private Groups group;

    /**
     * Manual group-standings position (0-based within the group). Null = use
     * the computed ranking; set when the organizer overrides the order by
     * hand (e.g. to settle a tiebreaker) after the group is finished.
     */
    @Column(name = "manual_rank")
    private Integer manualRank;

    /**
     * The team's 0-based position within its group as arranged in the draw
     * board (the order the organizer dragged the teams in). Set at draw time
     * and used to order the round-robin fixtures so the generated schedule
     * matches the arrangement the organizer made, rather than an arbitrary
     * database order. Null for teams drawn before this field existed.
     */
    @Column(name = "draw_position")
    private Integer drawPosition;

    @Column(name = "name", length = 200, nullable = false)
    private String name;

    @Column(name = "is_eliminated", nullable = false)
    private boolean eliminated = false;

    /**
     * Internal win/loss counters. NOT exposed in TeamDto - they exist
     * only so the round-draw / score-update logic in RoundService can
     * recompute each team's {@link #eliminated} flag (a team is out
     * after its first loss). Orphaned DB columns from the bela origin.
     */
    @Column(name = "wins", nullable = false)
    private int wins = 0;

    @Column(name = "losses", nullable = false)
    private int losses = 0;

    /** Firebase UID of the user who self-registered this team (null if added by organizer). */
    @Column(name = "submitted_by_uid", length = 64)
    private String submittedByUid;

    /** True while waiting for the organizer to confirm a self-registered team. */
    @Column(name = "pending_approval", nullable = false)
    private boolean pendingApproval = false;

    /**
     * Opaque random token embedded in the team-sharing URL
     * (/claim-team/{token}). Set when a team is self-registered or
     * backfilled for existing teams. Stable - the same primary can
     * keep sharing the same link.
     */
    @Column(name = "claim_token", length = 48, unique = true)
    private String claimToken;

    /**
     * Firebase UID of the partner who claimed co-ownership of this
     * team via the share link. Equal-participant view: appears on
     * their profile, receives push notifications, sees own invoices.
     * Team-internal edits (name, etc.) stay
     * organizer-only.
     */
    @Column(name = "co_submitted_by_uid", length = 64)
    private String coSubmittedByUid;

    @CreationTimestamp
    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
