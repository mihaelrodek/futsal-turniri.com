package hr.mrodek.apps.futsal_turniri.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;

@Entity
@Table(name = "players")
@Getter @Setter @NoArgsConstructor
public class Player {

    @Id
    @SequenceGenerator(name = "players_seq", sequenceName = "seq_players_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "players_seq")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "team_id", nullable = false)
    private Teams team;

    @Column(name = "name", length = 200, nullable = false)
    private String name;

    /** Jersey number - optional, players may not have one assigned. */
    @Column(name = "number")
    private Integer number;

    /**
     * True for the team's captain. Enforced one-per-team by the service
     * layer: setting captain=true on one player clears it on every other
     * player of the same team in the same operation.
     */
    @Column(name = "captain", nullable = false)
    private boolean captain = false;

    /**
     * True for a goalkeeper ("GK"). Independent of {@link #captain} in both
     * directions - a player may be both, either or neither - and deliberately
     * NOT one-per-team the way the captain is: a roster routinely carries a
     * backup keeper, so marking a second one must not unmark the first.
     */
    @Column(name = "goalkeeper", nullable = false)
    private boolean goalkeeper = false;

    /**
     * Stable ordering within a team's roster. Defaults to a created-order
     * value so the list renders consistently across reloads.
     */
    @Column(name = "sort_order")
    private Integer sortOrder;

    /**
     * True for players seeded as part of a showcase/demo tournament
     * ("Pokazni turnir"). Demo players are excluded from the global
     * player-name autocomplete (they must never be offered while editing
     * a real roster) and the flag makes them easy to bulk-delete later:
     * DELETE FROM players WHERE is_demo.
     */
    @Column(name = "is_demo", nullable = false)
    private boolean demo = false;

    /**
     * Firebase UID of the registered user this roster row IS, or null when
     * nobody is linked. Set automatically when the name unambiguously matches
     * exactly one profile (see {@code PlayerProfileLinker}), or by an admin
     * approving a manual claim request.
     *
     * <p>Identity only: it makes the appearance show up on that person's
     * profile and grants NO rights. Editing a team still requires one of the
     * submitter slots on {@link Teams}, which is also why this can't live
     * there - a team has two such slots, a roster has eleven names.
     */
    @Column(name = "claimed_by_uid", length = 64)
    private String claimedByUid;

    @CreationTimestamp
    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
