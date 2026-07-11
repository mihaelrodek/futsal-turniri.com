package hr.mrodek.apps.futsal_turniri.model;

import hr.mrodek.apps.futsal_turniri.enums.BracketFill;
import hr.mrodek.apps.futsal_turniri.enums.RewardType;
import hr.mrodek.apps.futsal_turniri.enums.ScorerScope;
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
// this entity - list, find-by-id, joins, count(), the works. Marking a
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

    /** Maximum number of teams. Null means "no cap" (unlimited) - the organizer
     *  left it blank on create/edit. Not defaulted to a number, so blank stays
     *  unlimited instead of silently becoming a 16-team ceiling. */
    @Column(name = "max_teams")
    private Integer maxTeams;

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
     * How many best next-placed teams also advance to the bracket, on top of
     * the {@code advancePerGroup} per-group qualifiers. With the common
     * "2 advance per group" this is the number of best THIRD-placed teams
     * (e.g. 12 teams / 3 groups: 2×3=6 qualifiers + 2 best thirds = 8).
     * They are ranked across groups by points, then goal difference, then
     * goals scored. 0 (or null) = off. Only meaningful for GROUPS_KNOCKOUT.
     */
    @Column(name = "best_third_count", nullable = false)
    private Integer bestThirdCount = 0;

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

    /** Length of one half, in minutes. Defaults to the futsal-standard 10 so a
     *  TIMER match clock always has a length to count to (and freeze at) rather
     *  than free-running; the organizer can change it in the schedule config. */
    @Column(name = "half_length_min")
    private Integer halfLengthMin = 10;

    /** Halftime break between the halves, in minutes. */
    @Column(name = "halftime_break_min")
    private Integer halftimeBreakMin;

    /** "Pauza između utakmica" - break between consecutive matches, in minutes. */
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

    // Futsal play system, e.g. "4+1", "5+1", "3vs3", or a free-text custom value.
    @Column(name = "game_system", length = 40)
    private String gameSystem;

    // External organizer link (Facebook event, club page, …). Shown as a
    // clickable link on the tournament detail page.
    @Column(name = "website_url", length = 500)
    private String websiteUrl;

    /**
     * Public organizer display name ("npr. udruga, klub…"). Optional. When
     * set, the detail page (and the SSR preview) shows THIS as the organizer
     * instead of the creator's account name ({@link #createdByName}).
     * Permissions still key off {@link #createdByUid}.
     */
    @Column(name = "organizer_name", length = 120)
    private String organizerName;

    // rewards
    // rewardType is legacy (FIXED | PERCENTAGE). The percent/fixed toggle was
    // dropped - every prize is now a plain amount + an optional free-text
    // note ("Ostalo": Pehar, Prijelazni pehar, Utješna nagrada, …). The
    // column stays for back-compat; new tournaments are always FIXED.
    @Enumerated(EnumType.STRING)
    @Column(name = "reward_type", length = 20)
    private RewardType rewardType;

    @Column(name = "reward_first", precision = 10, scale = 2)
    private BigDecimal rewardFirst;
    @Column(name = "reward_first_note", length = 200)
    private String rewardFirstNote;

    @Column(name = "reward_second", precision = 10, scale = 2)
    private BigDecimal rewardSecond;
    @Column(name = "reward_second_note", length = 200)
    private String rewardSecondNote;

    @Column(name = "reward_third", precision = 10, scale = 2)
    private BigDecimal rewardThird;
    @Column(name = "reward_third_note", length = 200)
    private String rewardThirdNote;

    @Column(name = "reward_fourth", precision = 10, scale = 2)
    private BigDecimal rewardFourth;
    @Column(name = "reward_fourth_note", length = 200)
    private String rewardFourthNote;

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
     * after the tournament finishes. Nullable - the organiser can
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
     * Admin-set "not publicly visible" flag. A hidden tournament is excluded
     * from every public read (lists, details, sitemap, live, previews) for
     * everyone EXCEPT its creator and admins, who see it flagged and greyed
     * out in the SPA. Unlike {@link #deleted} this is reversible curation,
     * not removal - set via POST/DELETE /admin/tournaments/{uuid}/hidden.
     */
    @Column(name = "is_hidden", nullable = false)
    private boolean hidden = false;

    /**
     * Which goals count toward the best-scorer race (ranking + award
     * suggestion). Default {@link ScorerScope#KNOCKOUT} = group-stage goals
     * don't count; the organizer can widen/narrow it on the Statistika tab.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "scorer_scope", length = 20, nullable = false)
    private ScorerScope scorerScope = ScorerScope.KNOCKOUT;

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
        // maxTeams left null on purpose = unlimited; do NOT coerce to a number.
        if (format == null) format = TournamentFormat.GROUPS_KNOCKOUT;
        if (entryPrice == null) entryPrice = BigDecimal.ZERO;
        if (scorerScope == null) scorerScope = ScorerScope.KNOCKOUT;
    }

    /**
     * Flip DRAFT → STARTED the first time a match of this tournament is played -
     * whether it was started live or just had a result recorded. No-op once the
     * tournament is already STARTED or FINISHED, so it never rewinds the status.
     */
    public void markStartedIfDraft() {
        if (status == TournamentStatus.DRAFT) {
            status = TournamentStatus.STARTED;
        }
    }
}
