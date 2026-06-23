package hr.mrodek.apps.futsal_turniri.mappers;

import hr.mrodek.apps.futsal_turniri.dtos.PlayerDto;
import hr.mrodek.apps.futsal_turniri.model.Player;
import org.mapstruct.*;

import java.util.List;

@Mapper(componentModel = "cdi", unmappedTargetPolicy = ReportingPolicy.IGNORE)
public interface PlayerMapper {

    /* Entity -> DTO */
    @Mappings({
            @Mapping(target = "id",      source = "id"),
            @Mapping(target = "name",    source = "name"),
            @Mapping(target = "number",  source = "number"),
            @Mapping(target = "captain", source = "captain"),
    })
    PlayerDto toDto(Player entity);

    List<PlayerDto> toDtoList(List<Player> entities);
}
