package hr.mrodek.apps.futsal_turniri.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.UpdateTimestamp;

import java.time.OffsetDateTime;

/**
 * One site-wide key/value setting, editable from the admin dashboard.
 * First consumer: the home-page live-stream banner
 * ({@code stream_banner_url} / {@code stream_banner_live}).
 */
@Entity
@Table(name = "app_settings")
@Getter @Setter @NoArgsConstructor
public class AppSetting {

    @Id
    @Column(name = "setting_key", length = 80, nullable = false)
    private String key;

    @Column(name = "setting_value", columnDefinition = "text")
    private String value;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;

    public AppSetting(String key, String value) {
        this.key = key;
        this.value = value;
    }
}
