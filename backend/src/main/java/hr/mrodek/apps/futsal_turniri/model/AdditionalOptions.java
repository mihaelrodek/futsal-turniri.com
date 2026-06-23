package hr.mrodek.apps.futsal_turniri.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import java.util.UUID;

@Entity
@Table(name = "additional_options")
@Getter @Setter @NoArgsConstructor
public class AdditionalOptions {

    @Id
    @SequenceGenerator(name = "additional_options_seq", sequenceName = "seq_additional_options_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "additional_options_seq")
    private Long id;


    @Column(name = "hr_label", length = 120, nullable = false, unique = true)
    private String hrLabel;

    @Column(name = "en_label", length = 120, nullable = false, unique = true)
    private String enLabel;
}
