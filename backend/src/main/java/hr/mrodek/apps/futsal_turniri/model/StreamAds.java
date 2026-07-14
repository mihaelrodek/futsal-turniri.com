package hr.mrodek.apps.futsal_turniri.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

/**
 * One advertisement in the admin's home-page stream ad library. Backed by a
 * MinIO {@link Resources} blob (an image or a video). While the site-wide
 * stream banner is in ADS mode, the selected ad fills the hero slot - an image
 * shown statically, a video looped.
 */
@Entity
@Table(name = "stream_ads")
@Getter
@Setter
@NoArgsConstructor
public class StreamAds {

    @Id
    @SequenceGenerator(name = "stream_ads_seq", sequenceName = "seq_stream_ads_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "stream_ads_seq")
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "resource_id", nullable = false)
    private Resources resource;

    /** IMAGE | VIDEO - how the public banner renders the blob. */
    @Column(name = "media_type", length = 16, nullable = false)
    private String mediaType;

    /** AD (replaces the stream in ADS mode) | OVERLAY (drawn centred over the
     *  live video, toggled by the admin). */
    @Column(name = "purpose", length = 16, nullable = false)
    private String purpose;

    @Column(name = "label", length = 200)
    private String label;

    @CreationTimestamp
    @Column(name = "created_at")
    private OffsetDateTime createdAt;
}
