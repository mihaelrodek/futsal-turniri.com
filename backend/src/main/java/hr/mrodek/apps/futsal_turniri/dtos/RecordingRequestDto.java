package hr.mrodek.apps.futsal_turniri.dtos;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * Wire shape for a match-recording request, including a small embedded
 * match/tournament summary so the profile page can render it standalone.
 */
@Getter @Setter
@NoArgsConstructor @AllArgsConstructor
public class RecordingRequestDto {
    private UUID uuid;
    private Long matchId;
    private UUID tournamentUuid;
    private String tournamentName;
    private String team1Name;
    private String team2Name;
    private OffsetDateTime kickoffAt;
    private String status;        // REQUESTED | APPROVED | REJECTED | DELIVERED | CANCELLED
    private String note;
    private String contactEmail;
    private String adminNote;
    private int priceEurCents;
    /** True when the admin marked the request paid ({@code paidAt != null}). */
    private boolean paid;
    /** True when an mp4 was uploaded to MinIO ({@code videoObjectKey != null}). */
    private boolean hasVideo;
    /**
     * External delivery link. Populated ONLY for the owner when status is
     * DELIVERED, and always for admins; null otherwise (set by the controller,
     * never by the mapper).
     */
    private String deliveryUrl;
    /** Set once an admin links a library recording to this request. Null otherwise. */
    private UUID recordingUuid;
    private String recordingFileName;
    private Long recordingSizeBytes;
    private OffsetDateTime createdAt;
    private OffsetDateTime updatedAt;
}
