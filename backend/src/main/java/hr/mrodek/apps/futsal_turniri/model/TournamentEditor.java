package hr.mrodek.apps.futsal_turniri.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

/**
 * A co-editor grant on a single tournament: a registered user (by Firebase
 * UID) who may manage this tournament WITHOUT being its owner. The creator
 * ({@link Tournaments#getCreatedByUid()}) stays the owner; each of these rows
 * is one extra person who passes {@code assertCanEdit}. Assigned by an admin
 * from the dashboard; a tournament can have many.
 */
@Entity
@Table(name = "tournament_editors")
@Getter @Setter @NoArgsConstructor
public class TournamentEditor {

    @Id
    @SequenceGenerator(name = "tournament_editors_seq", sequenceName = "seq_tournament_editors_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "tournament_editors_seq")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "tournament_id", nullable = false)
    private Tournaments tournament;

    /** Firebase UID of the granted user. */
    @Column(name = "user_uid", length = 64, nullable = false)
    private String userUid;

    @CreationTimestamp
    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    public TournamentEditor(Tournaments tournament, String userUid) {
        this.tournament = tournament;
        this.userUid = userUid;
    }
}
