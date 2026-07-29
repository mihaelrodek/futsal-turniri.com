package hr.mrodek.apps.futsal_turniri.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;

/**
 * A default kit (jersey + shorts colour) remembered for a cross-tournament
 * team IDENTITY - one row per distinct colour combination ever saved for
 * that identity (1:N; a club may have a home and an away kit). Keyed by
 * {@link #normalizedName} ({@link hr.mrodek.apps.futsal_turniri.services.TeamNameNormalizer#normalize})
 * rather than a Teams FK, because team identity itself is name-based (the
 * same club is a fresh {@code Teams} row in every tournament it enters).
 *
 * <p>Populated automatically: whenever an organizer sets a team's jersey or
 * shorts colour on the Ekipe tab, the resulting full kit is upserted here
 * (see {@code TournamentController#setTeamJerseyColor/setTeamShortsColor}).
 * Read back when a team NAME is picked from the cross-tournament
 * autocomplete, so a returning club's kit pre-fills automatically - see
 * {@code GET /teams/default-kits}.
 */
@Entity
@Table(name = "team_default_kits")
@Getter @Setter @NoArgsConstructor
public class TeamDefaultKit {

    @Id
    @SequenceGenerator(name = "team_default_kits_seq", sequenceName = "seq_team_default_kits_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "team_default_kits_seq")
    private Long id;

    /** Lookup key - {@code TeamNameNormalizer.normalize(teamName)}. */
    @Column(name = "normalized_name", length = 200, nullable = false)
    private String normalizedName;

    /** Last-seen display spelling for this identity - purely for admin readability. */
    @Column(name = "team_name", length = 200, nullable = false)
    private String teamName;

    /** Lowercase {@code #rrggbb}; null = this saved kit has no jersey colour. */
    @Column(name = "jersey_color", length = 9)
    private String jerseyColor;

    /** Lowercase {@code #rrggbb}; null = this saved kit has no shorts colour. */
    @Column(name = "shorts_color", length = 9)
    private String shortsColor;

    @CreationTimestamp
    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
