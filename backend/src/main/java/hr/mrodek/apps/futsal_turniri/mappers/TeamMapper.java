package hr.mrodek.apps.futsal_turniri.mappers;

import hr.mrodek.apps.futsal_turniri.dtos.TeamDto;
import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.model.UserProfile;
import org.mapstruct.*;

import java.util.List;
import java.util.Map;

@Mapper(componentModel = "cdi", unmappedTargetPolicy = ReportingPolicy.IGNORE)
public interface TeamMapper {

    /* Entity -> DTO (basic, no enrichment) */
    @Mappings({
            @Mapping(target = "id",               source = "id"),
            @Mapping(target = "name",             source = "name"),
            @Mapping(target = "isEliminated",     source = "eliminated"),
            @Mapping(target = "submittedByUid",   source = "submittedByUid"),
            @Mapping(target = "pendingApproval",  source = "pendingApproval"),
            @Mapping(target = "coSubmittedByUid", source = "coSubmittedByUid"),
            @Mapping(target = "claimToken",       source = "claimToken"),
    })
    TeamDto toDto(Teams entity);

    List<TeamDto> toDtoList(List<Teams> entities);

    /* DTO (partial) -> existing Entity (update)
     *
     * IMPORTANT: MapStruct auto-maps every matching-name field by default,
     * even those not listed in @Mappings. That means submittedByUid /
     * pendingApproval / submittedBySlug / submittedByName / coSubmittedByUid
     * / claimToken would silently get overwritten with whatever the client
     * sent (typically null, since the editor UI doesn't surface those
     * fields). The result is that saving the teams list strips the
     * "Prijavio: …" display info and shareable claim token from
     * self-registered teams.
     *
     * Lock those down explicitly. The controller is responsible for
     * setting submittedByUid / pendingApproval / claimToken / coSubmittedByUid
     * at the right moments (self-register, approve, claim).
     */
    @Mappings({
            // id & tournament are managed by the controller/repo; do not touch
            // wins/losses are internal entity-only counters - never set from a DTO
            @Mapping(target = "name",                source = "name"),
            @Mapping(target = "eliminated",          source = "isEliminated"),
            @Mapping(target = "wins",                ignore = true),
            @Mapping(target = "losses",              ignore = true),
            @Mapping(target = "submittedByUid",      ignore = true),
            @Mapping(target = "pendingApproval",     ignore = true),
            @Mapping(target = "claimToken",          ignore = true),
            @Mapping(target = "coSubmittedByUid",    ignore = true),
            @Mapping(target = "createdAt",           ignore = true),
            @Mapping(target = "updatedAt",           ignore = true)
    })
    void updateEntity(@MappingTarget Teams entity, TeamDto dto);

    /**
     * Enrich an entity into a DTO that also carries submitter + co-owner
     * display name + slug for clickable "Prijavio: …" / co-owner links.
     * Pass a pre-fetched profile map (UID → UserProfile) to avoid N+1
     * queries - see TournamentController#fetchSubmitterProfiles which
     * already collects both submittedByUid and coSubmittedByUid.
     *
     * Pass {@code includeClaimToken=true} only when the caller has
     * verified the viewer is allowed to see / share the token
     * (primary submitter or organizer/admin). Otherwise null is returned
     * so the share link doesn't leak in team lists rendered to other
     * tournament participants.
     */
    default TeamDto toDtoEnriched(Teams e, Map<String, UserProfile> profilesByUid,
                                   boolean includeClaimToken) {
        UserProfile prof = e.getSubmittedByUid() != null && profilesByUid != null
                ? profilesByUid.get(e.getSubmittedByUid())
                : null;
        UserProfile co = e.getCoSubmittedByUid() != null && profilesByUid != null
                ? profilesByUid.get(e.getCoSubmittedByUid())
                : null;
        return new TeamDto(
                e.getId() == null ? null : e.getId().intValue(),
                e.getName(),
                e.isEliminated(),
                e.getSubmittedByUid(),
                e.isPendingApproval(),
                prof == null ? null : prof.getSlug(),
                prof == null ? null : prof.getDisplayName(),
                e.getCoSubmittedByUid(),
                co == null ? null : co.getSlug(),
                co == null ? null : co.getDisplayName(),
                includeClaimToken ? e.getClaimToken() : null
        );
    }

    /** Backwards-compat overload - never includes the claim token. */
    default TeamDto toDtoEnriched(Teams e, Map<String, UserProfile> profilesByUid) {
        return toDtoEnriched(e, profilesByUid, false);
    }

    default List<TeamDto> toDtoListEnriched(List<Teams> entities, Map<String, UserProfile> profilesByUid) {
        return entities.stream().map(e -> toDtoEnriched(e, profilesByUid, false)).toList();
    }

    /**
     * List variant that emits the claim token for teams where the viewer
     * is the primary submitter (so they can copy the share link). Pass
     * the viewer's UID; tokens for teams they don't own are null.
     */
    default List<TeamDto> toDtoListEnrichedForViewer(
            List<Teams> entities,
            Map<String, UserProfile> profilesByUid,
            String viewerUid,
            boolean viewerIsOrganizerOrAdmin
    ) {
        return entities.stream().map(e -> {
            boolean canSeeToken = viewerIsOrganizerOrAdmin
                    || (viewerUid != null && viewerUid.equals(e.getSubmittedByUid()));
            return toDtoEnriched(e, profilesByUid, canSeeToken);
        }).toList();
    }
}
