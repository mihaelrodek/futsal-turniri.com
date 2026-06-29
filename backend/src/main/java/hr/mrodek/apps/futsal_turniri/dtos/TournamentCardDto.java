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
    private String winnerName;
    private Integer registeredTeams;
    /** True when this tournament has at least one match in progress (status LIVE). */
    private boolean liveMatch;
    /** Set when an admin has featured this tournament; null otherwise. The home
     *  list sorts featured tournaments to the very front (before live ones). */
    private OffsetDateTime featuredAt;
}
