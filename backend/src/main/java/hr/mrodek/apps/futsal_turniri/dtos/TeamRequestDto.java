package hr.mrodek.apps.futsal_turniri.dtos;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.OffsetDateTime;
import java.util.UUID;

/** Wire shape for a team-finding request, including a small embedded tournament summary. */
@Getter @Setter
@NoArgsConstructor @AllArgsConstructor
public class TeamRequestDto {
    private UUID uuid;
    private UUID tournamentUuid;
    /** Pretty URL slug for tournament-detail links; null on legacy rows. */
    private String tournamentSlug;
    private String tournamentName;
    private String tournamentLocation;
    private OffsetDateTime tournamentStartAt;
    private String playerName;
    private String phone;
    private String note;
    private String status;       // OPEN | MATCHED
    private OffsetDateTime createdAt;
    /** Firebase UID of the original poster (used to gate match/delete). */
    private String createdByUid;
}
