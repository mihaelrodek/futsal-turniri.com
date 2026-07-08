package hr.mrodek.apps.futsal_turniri.mappers;

import hr.mrodek.apps.futsal_turniri.dtos.MatchEventDto;
import hr.mrodek.apps.futsal_turniri.model.MatchEvent;
import org.mapstruct.*;

import java.util.List;

@Mapper(componentModel = "cdi", unmappedTargetPolicy = ReportingPolicy.IGNORE)
public interface MatchEventMapper {

    @Mappings({
            @Mapping(target = "type", expression = "java(e.getType() == null ? null : e.getType().name())"),
            @Mapping(target = "playerId", source = "player.id"),
            @Mapping(target = "playerName", source = "player.name"),
            // The event's own team wins when set - for an OWN_GOAL it holds the
            // BENEFICIARY (the side whose score went up; the named player is on
            // the other team), and for unattributed events it names the side.
            // Otherwise the team derives from the player.
            @Mapping(target = "teamId", expression = "java(e.getTeam() != null ? e.getTeam().getId() : (e.getPlayer() != null ? e.getPlayer().getTeam().getId() : null))"),
            @Mapping(target = "assistPlayerId", source = "assistPlayer.id"),
            @Mapping(target = "assistPlayerName", source = "assistPlayer.name")
    })
    MatchEventDto toDto(MatchEvent e);

    List<MatchEventDto> toDtoList(List<MatchEvent> list);
}
