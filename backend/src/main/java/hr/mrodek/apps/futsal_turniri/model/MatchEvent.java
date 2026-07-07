package hr.mrodek.apps.futsal_turniri.model;

import hr.mrodek.apps.futsal_turniri.enums.MatchEventType;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

/**
 * A single timeline event of a live match - a goal, a card, or a knockout
 * penalty-shootout kick (PENALTY_GOAL / PENALTY_MISSED). Goals (optionally with
 * an assist) drive the match score; cards are disciplinary records; penalty
 * kicks never affect the score (the shootout total lives on the match). Rows
 * cascade-delete with their parent match.
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

    /**
     * The scorer (for a goal), the carded player, or the penalty taker.
     * Required for goals/cards (enforced in the controller); may be null for
     * a penalty-shootout kick whose taker wasn't named - then {@link #team}
     * carries the side instead.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "player_id")
    private Player player;

    /**
     * The event's team. Only set (and only needed) when {@link #player} is
     * null - an unattributed penalty kick. When a player is present the team
     * is derived from the player, so this stays null.
     */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "team_id")
    private Teams team;

    @Column(name = "minute", nullable = false)
    private Integer minute;

    /** Assisting player - set only for goals, and even then optional. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "assist_player_id")
    private Player assistPlayer;

    /**
     * Insertion timestamp - gives a stable tiebreaker for events that
     * share the same minute when listing the timeline.
     */
    @CreationTimestamp
    @Column(name = "created_at")
    private OffsetDateTime createdAt;
}
