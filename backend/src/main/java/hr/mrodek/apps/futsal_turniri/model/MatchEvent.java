package hr.mrodek.apps.futsal_turniri.model;

import hr.mrodek.apps.futsal_turniri.enums.MatchEventType;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

/**
 * A single timeline event of a live match — a goal or a card. Goals
 * (optionally with an assist) drive the match score; cards are purely
 * disciplinary records. Rows cascade-delete with their parent match.
 */
@Entity
@Table(name = "match_events")
@Getter @Setter @NoArgsConstructor
public class MatchEvent {

    @Id
    @SequenceGenerator(name = "match_events_seq", sequenceName = "seq_match_events_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "match_events_seq")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "match_id", nullable = false)
    private Matches match;

    @Enumerated(EnumType.STRING)
    @Column(name = "type", length = 20, nullable = false)
    private MatchEventType type;

    /** The scorer (for a goal) or the carded player. Never null. */
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "player_id", nullable = false)
    private Player player;

    @Column(name = "minute", nullable = false)
    private Integer minute;

    /** Assisting player — set only for goals, and even then optional. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "assist_player_id")
    private Player assistPlayer;

    /**
     * Insertion timestamp — gives a stable tiebreaker for events that
     * share the same minute when listing the timeline.
     */
    @CreationTimestamp
    @Column(name = "created_at")
    private OffsetDateTime createdAt;
}
