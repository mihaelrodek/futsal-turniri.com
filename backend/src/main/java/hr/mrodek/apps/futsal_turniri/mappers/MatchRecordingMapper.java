package hr.mrodek.apps.futsal_turniri.mappers;

import hr.mrodek.apps.futsal_turniri.dtos.MatchRecordingDto;
import hr.mrodek.apps.futsal_turniri.model.MatchRecording;
import org.mapstruct.*;

import java.util.List;

@Mapper(componentModel = "cdi", unmappedTargetPolicy = ReportingPolicy.IGNORE)
public interface MatchRecordingMapper {

    @Mappings({
            @Mapping(target = "uuid", source = "uuid"),
            @Mapping(target = "matchId", source = "match.id"),
            @Mapping(target = "tournamentUuid", source = "match.tournament.uuid"),
            @Mapping(target = "tournamentName", source = "match.tournament.name"),
            @Mapping(target = "team1Name", source = "match.team1.name"),
            @Mapping(target = "team2Name", source = "match.team2.name"),
            @Mapping(target = "kickoffAt", source = "match.kickoffAt"),
            @Mapping(target = "fileName", source = "fileName"),
            @Mapping(target = "videoSizeBytes", source = "videoSizeBytes"),
            @Mapping(target = "uploadedByUid", source = "uploadedByUid"),
            @Mapping(target = "createdAt", source = "createdAt"),
            @Mapping(target = "shareToken", source = "shareToken"),
    })
    MatchRecordingDto toDto(MatchRecording r);

    List<MatchRecordingDto> toDtoList(List<MatchRecording> list);
}
