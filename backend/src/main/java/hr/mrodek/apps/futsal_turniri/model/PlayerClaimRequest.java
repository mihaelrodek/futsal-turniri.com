package hr.mrodek.apps.futsal_turniri.model;

import hr.mrodek.apps.futsal_turniri.enums.PlayerClaimRequestStatus;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;

/**
 * "This roster player is me" - a manual claim awaiting admin approval.
 *
 * <p>The automatic path (name folds to an exact match, team unclaimed) needs
 * none of this: {@code UserMeController.claimPlayerSuggestion} links it right
 * away. This entity backs the fallback for everyone else - a different
 * spelling, a nickname on the roster, a name shared with someone else - where
 * the only safe arbiter is a human. Approving performs exactly the same
 * mutation the automatic path does: the requester becomes the team's
 * {@code coSubmittedByUid}.
 *
 * <p>The name/team/tournament snapshots are stored alongside the FK so an
 * admin still sees what was requested after the organizer renames or deletes
 * the roster row.
 */
@Entity
@Table(name = "player_claim_requests")
@Getter @Setter @NoArgsConstructor
public class PlayerClaimRequest {

    @Id
    @SequenceGenerator(name = "player_claim_requests_seq",
            sequenceName = "seq_player_claim_requests_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "player_claim_requests_seq")
    private Long id;

    /** Firebase UID of the person claiming to be this player. */
    @Column(name = "user_uid", length = 64, nullable = false)
    private String userUid;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "player_id")
    private Player player;

    /** Snapshots taken at request time - survive a rename or a deleted roster row. */
    @Column(name = "player_name", length = 255)
    private String playerName;

    @Column(name = "team_name", length = 255)
    private String teamName;

    @Column(name = "tournament_name", length = 255)
    private String tournamentName;

    /** Why the requester says this is them - mandatory, it's the admin's only evidence. */
    @Column(name = "comment", columnDefinition = "text")
    private String comment;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 20, nullable = false)
    private PlayerClaimRequestStatus status = PlayerClaimRequestStatus.PENDING;

    /** Optional admin reply, shown to the requester on their profile. */
    @Column(name = "admin_note", columnDefinition = "text")
    private String adminNote;

    @Column(name = "decided_by_uid", length = 64)
    private String decidedByUid;

    @Column(name = "decided_at")
    private OffsetDateTime decidedAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
