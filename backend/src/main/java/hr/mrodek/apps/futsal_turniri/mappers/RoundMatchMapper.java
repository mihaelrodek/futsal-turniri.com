package hr.mrodek.apps.futsal_turniri.mappers;

import hr.mrodek.apps.futsal_turniri.dtos.MatchDto;
import hr.mrodek.apps.futsal_turniri.dtos.RoundDto;
import hr.mrodek.apps.futsal_turniri.model.Matches;
import hr.mrodek.apps.futsal_turniri.model.Rounds;
import org.mapstruct.*;

import java.util.List;

@Mapper(componentModel = "cdi", unmappedTargetPolicy = ReportingPolicy.IGNORE)
public interface RoundMatchMapper {

    @Mappings({
            @Mapping(target = "team1Id", source = "team1.id"),
            @Mapping(target = "team1Name", source = "team1.name"),
            @Mapping(target = "team2Id", source = "team2.id"),
            @Mapping(target = "team2Name", source = "team2.name"),
            @Mapping(target = "winnerTeamId", source = "winnerTeam.id"),
            @Mapping(target = "status", expression = "java(m.getStatus() == null ? null : m.getStatus().name())")
    })
    MatchDto toMatchDto(Matches m);

    List<MatchDto> toMatchDtoList(List<Matches> list);

    @Mappings({
            @Mapping(target = "status", expression = "java(r.getStatus() == null ? null : r.getStatus().name())"),
            @Mapping(target = "matches", ignore = true) // set manually when assembling the RoundDto
    })
    RoundDto toRoundDto(Rounds r);
}