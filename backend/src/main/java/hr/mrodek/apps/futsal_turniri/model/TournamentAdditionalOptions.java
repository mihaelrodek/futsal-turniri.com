package hr.mrodek.apps.futsal_turniri.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Entity
@Table(
        name = "tournament_additional_options",
        uniqueConstraints = @UniqueConstraint(
                name = "uq_ta_tournament_additional",
                columnNames = { "tournament_id", "additional_id" }
        )
)
@Getter @Setter @NoArgsConstructor
public class TournamentAdditionalOptions {

    @Id
    @SequenceGenerator(
            name = "tao_seq",
            sequenceName = "seq_tournament_additional_options_id",
            allocationSize = 1
    )
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "tao_seq")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "tournament_id", nullable = false)
    private Tournaments tournament;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "additional_id", nullable = false)
    private AdditionalOptions additionalOption;

    public TournamentAdditionalOptions(Tournaments tournament, AdditionalOptions additionalOption) {
        this.tournament = tournament;
        this.additionalOption = additionalOption;
    }
}