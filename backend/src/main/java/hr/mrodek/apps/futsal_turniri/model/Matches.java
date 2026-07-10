package hr.mrodek.apps.futsal_turniri.model;

import hr.mrodek.apps.futsal_turniri.enums.MatchLiveMode;
import hr.mrodek.apps.futsal_turniri.enums.MatchStage;
import hr.mrodek.apps.futsal_turniri.enums.MatchStatus;
import jakarta.persistence.*;
import lombok.*;
import java.util.UUID;

@Entity @Table(name = "matches")
@Getter @Setter @NoArgsConstructor
public class Matches {

    @Id
    @SequenceGenerator(name = "matches_seq", sequenceName = "seq_matches_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "matches_seq")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "tournament_id")
    private Tournaments tournament;

    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "round_id", nullable = false)
    private Rounds round;

    /** Which stage this match belongs to - GROUP or a knockout round. */
    @Enumerated(EnumType.STRING)
    @Column(name = "stage", length = 20, nullable = false)
    private MatchStage stage = MatchStage.GROUP;

    /** The group this match belongs to. Null for knockout matches. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "group_id")
    private Groups group;

    @Column(name = "table_no")
    private Integer tableNo;

    /** Scheduled kickoff time, assigned by the scheduling generator (Phase E4). */
    @Column(name = "kickoff_at")
    private java.time.OffsetDateTime kickoffAt;

    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "team1_id")
    private Teams team1;

    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "team2_id")
    private Teams team2;

    private Integer score1;
    private Integer score2;

    @ManyToOne(fetch = FetchType.LAZY) @JoinColumn(name = "winner_team_id")
    private Teams winnerTeam;

    // --- Knockout bracket linkage (Phase E3) ---
    /** The match the winner of this match advances into. Null for the final and group matches. */
    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "next_match_id")
    private Matches nextMatch;

    /** Which slot (1 or 2) of {@link #nextMatch} the winner of this match fills. */
    @Column(name = "next_slot")
    private Integer nextSlot;

    /** Penalty-shootout score - set only when a knockout match is level after regulation. */
    @Column(name = "penalties1")
    private Integer penalties1;

    @Column(name = "penalties2")
    private Integer penalties2;

    /**
     * Accumulated team fouls per half. Reset implicitly by reading the half's
     * own column. From a team's 5th foul in a half the opponent earns a
     * "deveterac" (10 m free kick); each further foul is another one. The kick
     * isn't stored - only the running count, shown on the fullscreen display.
     */
    @Column(name = "fouls1_first")
    private Integer fouls1First = 0;

    @Column(name = "fouls1_second")
    private Integer fouls1Second = 0;

    @Column(name = "fouls2_first")
    private Integer fouls2First = 0;

    @Column(name = "fouls2_second")
    private Integer fouls2Second = 0;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", length = 20)
    private MatchStatus status = MatchStatus.SCHEDULED;

    /**
     * How this match is run while LIVE - a counting {@code TIMER} or a
     * {@code SIMPLE} manual scoreboard. Null until the match is started.
     */
    @Enumerated(EnumType.STRING)
    @Column(name = "live_mode", length = 10)
    private MatchLiveMode liveMode;

    /** Wall-clock instant the match went LIVE. Null until started. */
    @Column(name = "live_started_at")
    private java.time.OffsetDateTime liveStartedAt;

    /**
     * Wall-clock instant the organizer ended the 1st half (match entered the
     * half-time "pauza"). Null until set. Together with {@link #liveStartedAt},
     * {@link #secondHalfStartedAt} and {@link #status} this makes the live half
     * flow an explicit state machine - the phase is no longer inferred from the
     * running clock, so the clock freezes at the end of a half and waits.
     */
    @Column(name = "first_half_ended_at")
    private java.time.OffsetDateTime firstHalfEndedAt;

    /** Wall-clock instant the 2nd half kicked off. Null until set. */
    @Column(name = "second_half_started_at")
    private java.time.OffsetDateTime secondHalfStartedAt;

    /**
     * Wall-clock instant the organizer PAUSED the live clock (ball out of
     * play, injury, ...). Null while the clock runs. While set, every clock
     * renders {@code pausedAt - halfStart} instead of {@code now - halfStart}
     * so the display freezes. Resuming shifts the current half's start
     * instant forward by the pause duration and clears this - so the rest of
     * the clock math never has to know a pause happened.
     */
    @Column(name = "live_paused_at")
    private java.time.OffsetDateTime livePausedAt;

    /**
     * A knockout BYE - auto-FINISHED at bracket generation with a single team
     * that advances without playing. Never a real fixture: excluded from the
     * schedule, the multi-day preview and the kickoff layout so it doesn't
     * appear in the raspored or eat a time slot.
     */
    public boolean isKnockoutBye() {
        return stage != MatchStage.GROUP
                && status == MatchStatus.FINISHED
                && (team1 == null || team2 == null);
    }

}
