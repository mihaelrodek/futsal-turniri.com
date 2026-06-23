package hr.mrodek.apps.futsal_turniri.mappers;

import hr.mrodek.apps.futsal_turniri.dtos.TeamRequestDto;
import hr.mrodek.apps.futsal_turniri.model.TeamRequest;
import org.mapstruct.*;

import java.util.List;

@Mapper(componentModel = "cdi", unmappedTargetPolicy = ReportingPolicy.IGNORE)
public interface TeamRequestMapper {

    @Mappings({
            @Mapping(target = "uuid", source = "uuid"),
            @Mapping(target = "tournamentUuid", source = "tournament.uuid"),
            @Mapping(target = "tournamentSlug", source = "tournament.slug"),
            @Mapping(target = "tournamentName", source = "tournament.name"),
            @Mapping(target = "tournamentLocation", source = "tournament.location"),
            @Mapping(target = "tournamentStartAt", source = "tournament.startAt"),
            @Mapping(target = "playerName", source = "playerName"),
            @Mapping(target = "phone", source = "phone"),
            @Mapping(target = "note", source = "note"),
            @Mapping(target = "status", expression = "java(r.getStatus() == null ? null : r.getStatus().name())"),
            @Mapping(target = "createdAt", source = "createdAt"),
            @Mapping(target = "createdByUid", source = "createdByUid"),
    })
    TeamRequestDto toDto(TeamRequest r);

    List<TeamRequestDto> toDtoList(List<TeamRequest> list);
}
