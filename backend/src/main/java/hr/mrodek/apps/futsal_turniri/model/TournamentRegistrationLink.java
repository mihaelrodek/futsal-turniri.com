package hr.mrodek.apps.futsal_turniri.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * A shareable "register your team here" link for one tournament.
 *
 * <p>The organizer generates one, optionally labels it for the club it is
 * meant for, and sends it. Whoever opens it fills the registration form and
 * files a team - <b>without an account</b>. That is deliberate: the person
 * entering a roster is usually a club contact who will never sign up, and
 * requiring a login is exactly what makes an organizer type the roster in by
 * hand instead.
 *
 * <p><b>The token is the credential.</b> Anyone holding it can file a
 * registration against this tournament, so it is a random v4 uuid and
 * {@link #active} is the revocation switch. What it can NOT do is publish
 * anything: every submission lands with {@code pendingApproval = true} and is
 * invisible outside the organizer's screen until they approve it. The blast
 * radius of a leaked link is therefore junk in a review queue, not a fake team
 * in a live draw.
 *
 * <p>A link is never deleted once used - {@code teams.registration_link_id}
 * points back at it, and the audit trail of where a team came from has to
 * outlive the organizer's tidying up.
 */
@Entity
@Table(name = "tournament_registration_links")
@Getter @Setter @NoArgsConstructor
public class TournamentRegistrationLink {

    @Id
    @SequenceGenerator(name = "tournament_registration_links_seq",
            sequenceName = "seq_tournament_registration_links_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "tournament_registration_links_seq")
    private Long id;

    /** Capability token in {@code /prijava-ekipe/{token}}. */
    @Column(name = "token", nullable = false, unique = true)
    private UUID token;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "tournament_id", nullable = false)
    private Tournaments tournament;

    /** Free text that makes the link personal ("NK Sokol"). Shown to the
     *  organizer in the list and to whoever opens the form. */
    @Column(name = "label", length = 200)
    private String label;

    @Column(name = "created_by_uid", length = 64)
    private String createdByUid;

    /** False once the organizer revokes it - the form then refuses to load. */
    @Column(name = "active", nullable = false)
    private boolean active = true;

    /** How many registrations came through this link. A link is deliberately
     *  multi-use: one club link often gets used twice (a second squad, or a
     *  first attempt that was rejected). */
    @Column(name = "use_count", nullable = false)
    private int useCount = 0;

    @CreationTimestamp
    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    @PrePersist
    protected void onCreate() {
        if (token == null) token = UUID.randomUUID();
    }
}
