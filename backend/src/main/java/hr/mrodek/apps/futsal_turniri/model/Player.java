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
     * Stable ordering within a team's roster. Defaults to a created-order
     * value so the list renders consistently across reloads.
     */
    @Column(name = "sort_order")
    private Integer sortOrder;

    @CreationTimestamp
    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
