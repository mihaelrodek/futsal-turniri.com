package hr.mrodek.apps.futsal_turniri.mappers;

import hr.mrodek.apps.futsal_turniri.dtos.CreateTournamentRequest;
import hr.mrodek.apps.futsal_turniri.dtos.TournamentCardDto;
import hr.mrodek.apps.futsal_turniri.dtos.TournamentDetailsResponse;
import hr.mrodek.apps.futsal_turniri.enums.RewardType;
import hr.mrodek.apps.futsal_turniri.enums.TournamentFormat;
import hr.mrodek.apps.futsal_turniri.enums.TournamentStatus;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import org.mapstruct.*;

import java.math.BigDecimal;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

@Mapper(componentModel = "cdi", unmappedTargetPolicy = ReportingPolicy.IGNORE)
public interface TournamentMapper {

    @Mappings({
            @Mapping(target = "id", source = "id"),
            @Mapping(target = "uuid", source = "uuid"),
            @Mapping(target = "slug", source = "slug"),
            @Mapping(target = "location", source = "location"),
            @Mapping(target = "latitude", source = "latitude"),
            @Mapping(target = "longitude", source = "longitude"),
            @Mapping(target = "startAt", source = "startAt"),
            @Mapping(target = "maxTeams", source = "maxTeams"),
            @Mapping(target = "format", source = "format", qualifiedByName = "enumToName"),
            @Mapping(target = "entryPrice", source = "entryPrice"),
            @Mapping(target = "prizeTotal", expression = "java(prizeTotal(t))"),
            @Mapping(target = "winnerName", source = "winnerName"),
            @Mapping(target = "bannerUrl", expression = "java(publicUrl(t))"),
            @Mapping(target = "registeredTeams",
                    expression = "java(teamCountsByTournamentId.getOrDefault(t.getId(), 0L).intValue())"),
            @Mapping(target = "liveMatch",
                    expression = "java(liveTournamentIds.contains(t.getId()))"),
            @Mapping(target = "hidden", source = "hidden"),
    })
    TournamentCardDto toCard(Tournaments t,
                             @Context Map<Long, Long> teamCountsByTournamentId,
                             @Context java.util.Set<Long> liveTournamentIds);

    List<TournamentCardDto> toCardList(List<Tournaments> list,
                                       @Context Map<Long, Long> teamCountsByTournamentId,
                                       @Context java.util.Set<Long> liveTournamentIds);

    /* ========== Entity -> Full Details DTO ========== */
    @Mappings({
            @Mapping(target = "id", source = "id"),
            @Mapping(target = "uuid", source = "uuid"),
            @Mapping(target = "slug", source = "slug"),
            @Mapping(target = "entryPrice", source = "entryPrice"),
            @Mapping(target = "maxTeams", source = "maxTeams"),
            @Mapping(target = "format", source = "format", qualifiedByName = "enumToName"),
            @Mapping(target = "groupCount", source = "groupCount"),
            @Mapping(target = "advancePerGroup", source = "advancePerGroup"),
            @Mapping(target = "bestThirdCount", source = "bestThirdCount"),
            @Mapping(target = "bracketFill", source = "bracketFill", qualifiedByName = "enumToName"),
            @Mapping(target = "status", source = "status", qualifiedByName = "enumToName"), // <-- NEW
            @Mapping(target = "contactName", source = "contactName"),
            @Mapping(target = "contactPhone", source = "contactPhone"),
            @Mapping(target = "gameSystem", source = "gameSystem"),
            @Mapping(target = "websiteUrl", source = "websiteUrl"),
            @Mapping(target = "rewardType", source = "rewardType", qualifiedByName = "enumToName"),
            @Mapping(target = "rewardFirst", source = "rewardFirst"),
            @Mapping(target = "rewardFirstNote", source = "rewardFirstNote"),
            @Mapping(target = "rewardSecond", source = "rewardSecond"),
            @Mapping(target = "rewardSecondNote", source = "rewardSecondNote"),
            @Mapping(target = "rewardThird", source = "rewardThird"),
            @Mapping(target = "rewardThirdNote", source = "rewardThirdNote"),
            @Mapping(target = "rewardFourth", source = "rewardFourth"),
            @Mapping(target = "rewardFourthNote", source = "rewardFourthNote"),
            @Mapping(target = "additionalOptions", expression = "java(java.util.Collections.emptyList())"),
            @Mapping(target = "teams", expression = "java(java.util.Collections.emptyList())"),
            @Mapping(target = "winnerName", source = "winnerName"),
            // Silver + bronze podium positions. Persisted by the dedicated
            // /podium endpoint after FINISH; auto-mapped here so the SPA
            // can render the full medal stack without a second fetch.
            @Mapping(target = "secondPlaceName", source = "secondPlaceName"),
            @Mapping(target = "thirdPlaceName",  source = "thirdPlaceName"),
            // Individual awards - set via /awards after FINISH.
            @Mapping(target = "bestGoalkeeperName", source = "bestGoalkeeperName"),
            @Mapping(target = "bestPlayerName", source = "bestPlayerName"),
            @Mapping(target = "bestScorerName", source = "bestScorerName"),
            @Mapping(target = "bannerUrl", expression = "java(publicUrl(t))"),
            @Mapping(target = "createdByUid", source = "createdByUid"),
            @Mapping(target = "createdByName", source = "createdByName"),
            // Admin-curated daily highlight. Surfaced on the details DTO
            // so the admin button can label itself "Istakni" vs "Ukloni
            // istaknuto" without a second fetch.
            @Mapping(target = "featuredAt", source = "featuredAt"),
            @Mapping(target = "hidden", source = "hidden"),
    })
    TournamentDetailsResponse toDetails(Tournaments t);

    /* ========== Create DTO -> Entity ========== */
    @Mappings({
            @Mapping(target = "id", ignore = true),
            @Mapping(target = "uuid", ignore = true),
            @Mapping(target = "slug", ignore = true),
            @Mapping(target = "createdAt", ignore = true),
            @Mapping(target = "updatedAt", ignore = true),

            @Mapping(target = "name", source = "name"),
            @Mapping(target = "location", source = "location"),
            @Mapping(target = "details", source = "details"),
            @Mapping(target = "startAt", source = "startAt"),

            @Mapping(target = "maxTeams", source = "maxTeams"),

            @Mapping(target = "format", source = "format"),
            @Mapping(target = "groupCount", source = "groupCount"),
            @Mapping(target = "advancePerGroup", source = "advancePerGroup"),
            @Mapping(target = "bracketFill", source = "bracketFill"),

            @Mapping(target = "entryPrice", source = "entryPrice"),

            @Mapping(target = "contactName", source = "contactName"),
            @Mapping(target = "contactPhone", source = "contactPhone"),
            @Mapping(target = "gameSystem", source = "gameSystem"),
            @Mapping(target = "websiteUrl", source = "websiteUrl"),

            @Mapping(target = "rewardType", source = "rewardType", qualifiedByName = "nameToRewardType"),
            @Mapping(target = "rewardFirst", source = "rewardFirst"),
            @Mapping(target = "rewardFirstNote", source = "rewardFirstNote"),
            @Mapping(target = "rewardSecond", source = "rewardSecond"),
            @Mapping(target = "rewardSecondNote", source = "rewardSecondNote"),
            @Mapping(target = "rewardThird", source = "rewardThird"),
            @Mapping(target = "rewardThirdNote", source = "rewardThirdNote"),
            @Mapping(target = "rewardFourth", source = "rewardFourth"),
            @Mapping(target = "rewardFourthNote", source = "rewardFourthNote"),

            // status may come from request later; default in @AfterMapping
            @Mapping(target = "status", ignore = true)
    })
    Tournaments toEntity(CreateTournamentRequest req);

    /* ========== Apply DTO updates onto an existing entity (in place) ==========
       Reuses CreateTournamentRequest as the wire shape - all fields are settable
       except the ones we deliberately ignore: id/uuid/audit timestamps/status
       (status is driven by /start, /finish, /reset endpoints) and the resource
       (poster) which has its own multipart upload flow. */
    @BeanMapping(nullValuePropertyMappingStrategy = NullValuePropertyMappingStrategy.SET_TO_NULL)
    @Mappings({
            @Mapping(target = "id", ignore = true),
            @Mapping(target = "uuid", ignore = true),
            @Mapping(target = "slug", ignore = true),
            @Mapping(target = "createdAt", ignore = true),
            @Mapping(target = "updatedAt", ignore = true),
            @Mapping(target = "status", ignore = true),
            @Mapping(target = "winnerName", ignore = true),
            // Podium fields are set via the /podium endpoint, never via
            // the generic create/update path.
            @Mapping(target = "secondPlaceName", ignore = true),
            @Mapping(target = "thirdPlaceName", ignore = true),
            @Mapping(target = "resource", ignore = true),
            // Format IS editable now (organizer can change it on the detail
            // page). The controller guards against desync: once fixtures
            // exist it restores the previous format config after this mapping.
            @Mapping(target = "format", source = "format"),
            // Group count / advance / bracket fill are chosen at draw time, not
            // via the edit form, so a details update must never overwrite them.
            @Mapping(target = "groupCount", ignore = true),
            @Mapping(target = "advancePerGroup", ignore = true),
            @Mapping(target = "bracketFill", ignore = true),

            @Mapping(target = "name", source = "name"),
            @Mapping(target = "location", source = "location"),
            @Mapping(target = "details", source = "details"),
            @Mapping(target = "startAt", source = "startAt"),

            @Mapping(target = "maxTeams", source = "maxTeams"),

            @Mapping(target = "entryPrice", source = "entryPrice"),

            @Mapping(target = "contactName", source = "contactName"),
            @Mapping(target = "contactPhone", source = "contactPhone"),
            @Mapping(target = "gameSystem", source = "gameSystem"),
            @Mapping(target = "websiteUrl", source = "websiteUrl"),

            @Mapping(target = "rewardType", source = "rewardType", qualifiedByName = "nameToRewardType"),
            @Mapping(target = "rewardFirst", source = "rewardFirst"),
            @Mapping(target = "rewardFirstNote", source = "rewardFirstNote"),
            @Mapping(target = "rewardSecond", source = "rewardSecond"),
            @Mapping(target = "rewardSecondNote", source = "rewardSecondNote"),
            @Mapping(target = "rewardThird", source = "rewardThird"),
            @Mapping(target = "rewardThirdNote", source = "rewardThirdNote"),
            @Mapping(target = "rewardFourth", source = "rewardFourth"),
            @Mapping(target = "rewardFourthNote", source = "rewardFourthNote"),
    })
    void applyUpdate(@MappingTarget Tournaments target, CreateTournamentRequest req);

    /* ===== helpers ===== */
    @Named("enumToName")
    default String enumToName(Enum<?> e) {
        return e == null ? null : e.name();
    }

    /** Total prize fund in euros = sum of the four prize places. Returns null
     *  when nothing is set (so the card can hide the "ukupna nagrada" line). */
    default BigDecimal prizeTotal(Tournaments t) {
        BigDecimal sum = BigDecimal.ZERO;
        if (t.getRewardFirst() != null) sum = sum.add(t.getRewardFirst());
        if (t.getRewardSecond() != null) sum = sum.add(t.getRewardSecond());
        if (t.getRewardThird() != null) sum = sum.add(t.getRewardThird());
        if (t.getRewardFourth() != null) sum = sum.add(t.getRewardFourth());
        return sum.signum() > 0 ? sum : null;
    }

    @Named("nameToRewardType")
    default RewardType nameToRewardType(String s) {
        return (s == null || s.isBlank()) ? null : RewardType.valueOf(s);
    }

    @AfterMapping
    default void applyDefaults(CreateTournamentRequest req, @MappingTarget Tournaments t) {
        if (t.getStatus() == null) t.setStatus(TournamentStatus.DRAFT);
        // maxTeams left null = unlimited (no cap); never coerce it to a number.
        if (t.getFormat() == null) t.setFormat(TournamentFormat.GROUPS_KNOCKOUT);

        if (t.getEntryPrice() == null) t.setEntryPrice(BigDecimal.ZERO);
    }

    /**
     * Stable poster URL for the SPA. Always returns a backend-proxied path
     * ({@code /api/resources/<id>/image}) - never the MinIO direct URL -
     * because the MinIO bucket is private. The proxy controller streams the
     * bytes through with proper Content-Type and a 1-year immutable cache.
     *
     * <p>The legacy {@code Resources.publicUrl} column may still hold MinIO
     * URLs from earlier uploads; we deliberately ignore it and compute the
     * proxied URL from the resource id instead, so old and new rows behave
     * identically without a backfill migration.
     */
    default String publicUrl(Tournaments t) {
        if (t == null || t.getResource() == null) return null;
        Long rid = t.getResource().getId();
        if (rid == null) return null;
        return "/api/resources/" + rid + "/image";
    }
}

// touched to force MapStruct APT regeneration after the details-DTO change
