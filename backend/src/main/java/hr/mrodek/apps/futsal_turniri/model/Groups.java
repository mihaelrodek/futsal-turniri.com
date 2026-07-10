package hr.mrodek.apps.futsal_turniri.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * A group within a GROUPS_KNOCKOUT tournament's group stage. Teams are drawn
 * into groups; within a group every team plays every other once (single
 * round-robin). The teams that finish high enough advance to the knockout
 * bracket.
 *
 * <p>Table is named {@code tournament_groups} rather than {@code groups}
 * because {@code GROUPS} is a reserved word in standard SQL.
 */
@Entity
@Table(
        name = "tournament_groups",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_group_tournament_ordinal",
                columnNames = {"tournament_id", "ordinal"}
        )
)
@Getter @Setter @NoArgsConstructor
public class Groups {

    @Id
    @SequenceGenerator(name = "groups_seq", sequenceName = "seq_groups_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "groups_seq")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "tournament_id", nullable = false)
    private Tournaments tournament;

    /** Display label - "A", "B", "C", … */
    @Column(name = "name", length = 10, nullable = false)
    private String name;

    /** 0-based position for stable ordering (A=0, B=1, …). */
    @Column(name = "ordinal", nullable = false)
    private int ordinal;

    /**
     * Per-group override for how many teams advance from THIS group to the
     * knockout bracket. {@code null} = use the tournament's uniform
     * {@code advancePerGroup}. Lets an uneven draw advance a second team from
     * the bigger group (e.g. one group of 4 among groups of 3).
     */
    @Column(name = "advance_count")
    private Integer advanceCount;

    public Groups(Tournaments tournament, String name, int ordinal) {
        this.tournament = tournament;
        this.name = name;
        this.ordinal = ordinal;
    }
}
