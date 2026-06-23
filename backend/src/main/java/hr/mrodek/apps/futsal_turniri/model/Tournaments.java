package hr.mrodek.apps.futsal_turniri.model;

import hr.mrodek.apps.futsal_turniri.enums.BracketFill;
import hr.mrodek.apps.futsal_turniri.enums.RewardType;
import hr.mrodek.apps.futsal_turniri.enums.TournamentFormat;
import hr.mrodek.apps.futsal_turniri.enums.TournamentStatus;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.annotations.Where;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

@Entity
@Table(name = "tournaments")
// Auto-filter soft-deleted rows from every query Hibernate runs against
// this entity — list, find-by-id, joins, count(), the works. Marking a
// tournament deleted is a single-field update; once the flag flips, the
// row vanishes from every read path without us having to audit every
// repository method.
@Where(clause = "is_deleted = false")
@Getter @Setter @NoArgsConstructor
public class Tournaments {

    @Id
    @SequenceGenerator(name = "tournaments_seq", sequenceName = "seq_tournaments_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "tournaments_seq")
    private Long id;

    @Column(nullable = false, unique = true)
    private UUID uuid; // DB default via gen_random_uuid(); or set in @PrePersist if you prefer

    /**
     * Human-readable URL slug, e.g. {@code "1st-futsal-open-22-04-2026"}.
     * Generated from name + startAt on insert/update by SlugGenerator.
     * Nullable in the DB only because legacy rows are backfilled lazily on
     * application startup; new rows always have a slug.
     */
    @Column(length = 220, unique = true)
    private String slug;

    @Column(nullable = false, length = 200)
    private String name;

    @Column(length = 200)
    private String location;

    @Column(columnDefinition = "text")
    private String details;

    @Column(name = "start_at")
    private OffsetDateTime startAt;

    @Enumerated(EnumType.STRING)
    @Column(length = 20, nullable = false)
    private TournamentStatus status = TournamentStatus.DRAFT;

    @Column(name = "max_teams", nullable = false)
    private Integer maxTeams = 16;

    // --- Format (Phase E) ---
    /** Structural format of the tournament. See {@link TournamentFormat}. */
    @Enumerated(EnumType.STRING)
    @Column(name = "format", length = 20, nullable = false)
    private TournamentFormat format = TournamentFormat.GROUPS_KNOCKOUT;

    /** Number of groups in the group stage. Null for KNOCKOUT_ONLY. */
    @Column(name = "group_count")
    private Integer groupCount;

    /** How many teams advance from each group. Null for KNOCKOUT_ONLY. */
    @Column(name = "advance_per_group")
    private Integer advancePerGroup;

    /**
     * How the knockout bracket is filled when qualifiers aren't a power of
     * two. Null for KNOCKOUT_ONLY. See {@link BracketFill}.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "bracket_fill", length = 20)
    private BracketFill bracketFill;

    // --- Scheduling / match format (Phase E4) ---
    /** Number of halves per match (futsal is normally 2). */
    @Column(name = "half_count")
    private Integer halfCount = 2;

    /** Length of one half, in minutes. */
    @Column(name = "half_length_min")
    private Integer halfLengthMin;

    /** Halftime break between the halves, in minutes. */
    @Column(name = "halftime_break_min")
    private Integer halftimeBreakMin;

    /** "Pauza između utakmica" — break between consecutive matches, in minutes. */
    @Column(name = "break_between_matches_min")
    private Integer breakBetweenMatchesMin;

    /** Extra buffer added to each match slot, in minutes. */
    @Column(name = "buffer_min")
    private Integer bufferMin;

    @Column(name = "entry_price", precision = 10, scale = 2, nullable = false)
    private BigDecimal entryPrice = BigDecimal.ZERO;

    // contact
    @Column(name = "contact_name", length = 120)
    private String contactName;

    @Column(name = "contact_phone", length = 60)
    private String contactPhone;

    // rewards
    @Enumerated(EnumType.STRING)
    @Column(name = "reward_type", length = 20)
    private RewardType rewardType;

    @Column(name = "reward_first", precision = 10, scale = 2)
    private BigDecimal rewardFirst;

    @Column(name = "reward_second", precision = 10, scale = 2)
    private BigDecimal rewardSecond;

    @Column(name = "reward_third", precision = 10, scale = 2)
    private BigDecimal rewardThird;

    // media
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "resource_id")
    private Resources resource;

    @CreationTimestamp
    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;

    @Column(name = "winner_name", length = 200)
    private String winnerName;   // <- NEW

    /**
     * Silver-place team name, set by the organiser from the Ekipe tab
     * after the tournament finishes. Nullable — the organiser can
     * leave the podium incomplete (small tournaments may not have a
     * meaningful 2nd or 3rd place). Free-text string rather than a FK
     * to {@link Teams} so we can also paste in a historical name for
     * legacy/imported tournaments where the team entity isn't present.
     */
    @Column(name = "second_place_name", length = 200)
    private String secondPlaceName;

    /** Bronze-place team name. Same semantics as {@link #secondPlaceName}. */
    @Column(name = "third_place_name", length = 200)
    private String thirdPlaceName;

    /**
     * Individual awards set by the organiser at/after finish. Free-text
     * (uppercased) player names so they work even for legacy tournaments
     * without Player rows. {@link #bestScorerName} additionally feeds a
     * tiebreaker on the all-time scorer list.
     */
    @Column(name = "best_goalkeeper_name", length = 200)
    private String bestGoalkeeperName;

    @Column(name = "best_player_name", length = 200)
    private String bestPlayerName;

    @Column(name = "best_scorer_name", length = 200)
    private String bestScorerName;

    /** Firebase UID of the user who created the tournament (null for legacy rows). */
    @Column(name = "created_by_uid", length = 64)
    private String createdByUid;

    /** Display name copied from the creator's Firebase profile at create-time. */
    @Column(name = "created_by_name", length = 200)
    private String createdByName;

    // --- Geocoding (populated by GeocodeService when location is set) ---
    @Column(name = "latitude")
    private Double latitude;

    @Column(name = "longitude")
    private Double longitude;

    @Column(name = "geocoded_at")
    private OffsetDateTime geocodedAt;

    /**
     * Soft-delete marker. Set by an admin via DELETE /tournaments/{uuid}.
     * Combined with the class-level {@code @Where(clause = "is_deleted = false")},
     * once this flips to {@code true} the row disappears from every read.
     */
    @Column(name = "is_deleted", nullable = false)
    private boolean deleted = false;

    /**
     * Admin-curated "tournament of the day" highlight. When non-null, this
     * is the timestamp at which an admin promoted the tournament to the
     * daily hero shown on /uzivo. The public lookup picks the row with
     * the highest featured_at that hasn't finished yet, so clearing the
     * feature is just setting this back to {@code null}.
     */
    @Column(name = "featured_at")
    private OffsetDateTime featuredAt;

    @PrePersist
    protected void onCreate() {
        if (uuid == null) uuid = UUID.randomUUID();     // 👈 generate server-side
        if (status == null) status = TournamentStatus.DRAFT;
        if (maxTeams == null) maxTeams = 16;
        if (format == null) format = TournamentFormat.GROUPS_KNOCKOUT;
        if (entryPrice == null) entryPrice = BigDecimal.ZERO;
    }
}
