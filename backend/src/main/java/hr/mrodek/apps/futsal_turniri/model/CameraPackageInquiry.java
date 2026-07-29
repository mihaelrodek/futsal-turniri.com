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
 * A "zatraži ponudu" lead for the custom camera package (/cjenik) - price is
 * on request, so this just captures the inquiry for an admin to follow up
 * manually. Name, contact email + phone, tournament name and a description
 * are all mandatory (see CameraInquiryController for validation) so an admin
 * always has enough to act on. No lifecycle, status, or payment - just a
 * record + an admin notification + a "received" confirmation to the
 * requester. Submitting doesn't require an account, though the email may
 * happen to belong to one.
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

    @Column(name = "contact_email", nullable = false, length = 255)
    private String contactEmail;

    @Column(name = "contact_phone", nullable = false, length = 40)
    private String contactPhone;

    @Column(name = "tournament_name", nullable = false, length = 255)
    private String tournamentName;

    @Column(nullable = false, length = 2000)
    private String message;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false)
    private OffsetDateTime createdAt;
}
