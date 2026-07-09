package hr.mrodek.apps.futsal_turniri.dtos;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.*;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

@Getter @Setter
@NoArgsConstructor @AllArgsConstructor
public class TournamentCardDto {
    private Long id;                 // numeric PK
    private UUID uuid;               // public id
    /** Pretty URL slug (may be null for legacy rows pre-backfill). */
    private String slug;
    private String name;
    private String location;
    private Double latitude;
    private Double longitude;
    private String bannerUrl;
    private OffsetDateTime startAt;
    private Integer maxTeams;
    private String format;
    private BigDecimal entryPrice;
    /** Sum of the prize amounts (1st+2nd+3rd+4th), in euros. Null when the
     *  organizer set no prize fund. Shown on the card as "ukupna nagrada". */
    private BigDecimal prizeTotal;
    private String winnerName;
    private Integer registeredTeams;
    /** Tournament lifecycle status (DRAFT / STARTED / FINISHED). Lets the home
     *  list show "u tijeku" for a started tournament even between live matches. */
    private String status;
    /** True when this tournament has at least one match in progress (status LIVE). */
    private boolean liveMatch;
    /** Set when an admin has featured this tournament; null otherwise. The home
     *  list sorts featured tournaments to the very front (before live ones). */
    private OffsetDateTime featuredAt;
    /** Admin-set "not publicly visible". Only ever true for the creator/admin
     *  (public readers never receive hidden rows) - the SPA greys the card out
     *  and badges it. */
    private boolean hidden;
}
