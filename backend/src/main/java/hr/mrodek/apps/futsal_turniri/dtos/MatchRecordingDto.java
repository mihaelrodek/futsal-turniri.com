package hr.mrodek.apps.futsal_turniri.dtos;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.OffsetDateTime;
import java.util.UUID;

/** Wire shape for one library recording, with an embedded match/tournament summary. */
@Getter @Setter
@NoArgsConstructor @AllArgsConstructor
public class MatchRecordingDto {
    private UUID uuid;
    private Long matchId;
    private UUID tournamentUuid;
    private String tournamentName;
    private String team1Name;
    private String team2Name;
    private OffsetDateTime kickoffAt;
    private String fileName;
    private Long videoSizeBytes;
    private String uploadedByUid;
    private OffsetDateTime createdAt;
    /** Capability token for the permanent share link - admin-only surface;
     *  see {@code MatchRecording#shareToken}. */
    private UUID shareToken;
}
