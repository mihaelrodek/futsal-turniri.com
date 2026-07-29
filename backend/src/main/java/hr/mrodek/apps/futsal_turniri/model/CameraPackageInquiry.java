package hr.mrodek.apps.futsal_turniri.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.SequenceGenerator;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;

import java.time.OffsetDateTime;

/**
 * A lead for the "custom camera package" pricing tier (/cjenik) - price is
 * on request, so this just captures the inquiry (name + contact + optional
 * tournament/message) for an admin to follow up manually. No lifecycle,
 * status, or payment - just a record + an admin email notification.
 */
@Entity
@Table(name = "camera_package_inquiries")
@Getter @Setter @NoArgsConstructor
public class CameraPackageInquiry {

    @Id
    @SequenceGenerator(name = "camera_package_inquiries_seq",
            sequenceName = "seq_camera_package_inquiries_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "camera_package_inquiries_seq")
    private Long id;

    @Column(nullable = false, length = 150)
    private String name;

    @Column(name = "contact_email", length = 255)
    private String contactEmail;

    @Column(name = "contact_phone", length = 40)
    private String contactPhone;

    @Column(name = "tournament_name", length = 255)
    private String tournamentName;

    @Column(length = 2000)
    private String message;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;
}
