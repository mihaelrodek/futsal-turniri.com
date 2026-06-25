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
            // Team derives from the player; for an unattributed penalty kick
            // (player == null) it falls back to the event's own team.
            @Mapping(target = "teamId", expression = "java(e.getPlayer() != null ? e.getPlayer().getTeam().getId() : (e.getTeam() != null ? e.getTeam().getId() : null))"),
            @Mapping(target = "assistPlayerId", source = "assistPlayer.id"),
            @Mapping(target = "assistPlayerName", source = "assistPlayer.name")
    })
    MatchEventDto toDto(MatchEvent e);

    List<MatchEventDto> toDtoList(List<MatchEvent> list);
}
