package hr.mrodek.apps.futsal_turniri.mappers;

import hr.mrodek.apps.futsal_turniri.dtos.RecordingRequestDto;
import hr.mrodek.apps.futsal_turniri.model.MatchRecordingRequest;
import org.mapstruct.*;

import java.util.List;

@Mapper(componentModel = "cdi", unmappedTargetPolicy = ReportingPolicy.IGNORE)
public interface RecordingRequestMapper {

    @Mappings({
            @Mapping(target = "uuid", source = "uuid"),
            @Mapping(target = "matchId", source = "match.id"),
            @Mapping(target = "tournamentUuid", source = "match.tournament.uuid"),
            @Mapping(target = "tournamentName", source = "match.tournament.name"),
            // Nested-path mappings are null-safe in MapStruct: a knockout match
            // with an undecided slot simply yields a null team name.
            @Mapping(target = "team1Name", source = "match.team1.name"),
            @Mapping(target = "team2Name", source = "match.team2.name"),
            @Mapping(target = "kickoffAt", source = "match.kickoffAt"),
            @Mapping(target = "status", expression = "java(r.getStatus() == null ? null : r.getStatus().name())"),
            @Mapping(target = "kind", expression = "java(r.getKind() == null ? null : r.getKind().name())"),
            @Mapping(target = "matchEventId", source = "matchEvent.id"),
            @Mapping(target = "goalMinute", source = "goalMinute"),
            @Mapping(target = "goalLabel", source = "goalLabel"),
            @Mapping(target = "note", source = "note"),
            @Mapping(target = "contactEmail", source = "contactEmail"),
            @Mapping(target = "adminNote", source = "adminNote"),
            @Mapping(target = "priceEurCents", source = "priceEurCents"),
            @Mapping(target = "paid", expression = "java(r.getPaidAt() != null)"),
            @Mapping(target = "hasVideo", expression = "java(r.getRecording() != null)"),
            @Mapping(target = "recordingUuid", source = "recording.uuid"),
            @Mapping(target = "recordingFileName", source = "recording.fileName"),
            @Mapping(target = "recordingSizeBytes", source = "recording.videoSizeBytes"),
            @Mapping(target = "createdAt", source = "createdAt"),
            @Mapping(target = "updatedAt", source = "updatedAt"),
    })
    RecordingRequestDto toDto(MatchRecordingRequest r);

    List<RecordingRequestDto> toDtoList(List<MatchRecordingRequest> list);
}
