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
    /** FULL_MATCH (whole match, 20 €) | GOAL (single goal clip, 5 €). */
    private String kind;
    /** The requested goal's event id - only for kind = GOAL, null otherwise. */
    private Long matchEventId;
    /** Snapshot of the requested goal's minute (kind = GOAL). */
    private Integer goalMinute;
    /** Readable snapshot of the requested goal, e.g. "12' - M. Rodek (Ekipa A)". */
    private String goalLabel;
    private String note;
    private String contactEmail;
    private String adminNote;
    private int priceEurCents;
    /** True when the admin marked the request paid ({@code paidAt != null}). */
    private boolean paid;
    /** Stripe Checkout session id (cs_...) of the payment; null for a manual paid toggle. */
    private String stripeSessionId;
    /** Email the payer entered on Stripe Checkout - may differ from contactEmail. */
    private String payerEmail;
    /** True when an mp4 was uploaded to MinIO ({@code videoObjectKey != null}). */
    private boolean hasVideo;
    /** Set once an admin links a library recording to this request. Null otherwise. */
    private UUID recordingUuid;
    private String recordingFileName;
    private Long recordingSizeBytes;
    private OffsetDateTime createdAt;
    private OffsetDateTime updatedAt;
}
