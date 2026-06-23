package hr.mrodek.apps.futsal_turniri.model;

import hr.mrodek.apps.futsal_turniri.enums.RoundStatus;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import jakarta.persistence.*;
import jakarta.persistence.Table;
import lombok.*;
import org.hibernate.annotations.*;
import java.time.OffsetDateTime; import java.util.UUID;

@Entity @Table(name = "rounds")
@Getter @Setter @NoArgsConstructor
public class Rounds {

    @Id
    @SequenceGenerator(name = "rounds_seq", sequenceName = "seq_rounds_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "rounds_seq")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "tournament_id")
    private Tournaments tournament;

    @Column(nullable = false)
    private int number;                  // unique per tournament

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 20)
    private RoundStatus status = RoundStatus.IN_PROGRESS;

    @CreationTimestamp @Column(name = "created_at")
    private OffsetDateTime createdAt;
    @Column(name = "locked_at") private OffsetDateTime lockedAt;
    @Column(name = "completed_at") private OffsetDateTime completedAt;
}
