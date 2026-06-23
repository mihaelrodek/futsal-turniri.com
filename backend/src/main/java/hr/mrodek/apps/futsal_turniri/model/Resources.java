package hr.mrodek.apps.futsal_turniri.model;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.annotations.UpdateTimestamp;
import org.hibernate.type.SqlTypes;

import java.time.OffsetDateTime;

@Entity
@Table(name = "resources",
        uniqueConstraints = @UniqueConstraint(name = "uq_resources_bucket_object",
                columnNames = {"bucket_name","object_key"}))
@Getter @Setter @NoArgsConstructor
public class Resources {

    @Id
    @SequenceGenerator(name = "resources_seq", sequenceName = "seq_resources_id", allocationSize = 1)
    @GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "resources_seq")
    private Long id;

    @Column(name = "bucket_name", length = 120, nullable = false)
    private String bucketName;

    @Column(name = "object_key", length = 512, nullable = false)
    private String objectKey;

    @Column(name = "content_type", length = 120)
    private String contentType;

    @Column(name = "size_bytes")
    private Long sizeBytes;

    @Column(name = "etag", length = 128)
    private String etag;

    @Column(name = "public_url", columnDefinition = "text")
    private String publicUrl;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "metadata", columnDefinition = "jsonb")
    private JsonNode metadata;   // was String metadataJson


    @CreationTimestamp
    @Column(name = "created_at")
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at")
    private OffsetDateTime updatedAt;
}
