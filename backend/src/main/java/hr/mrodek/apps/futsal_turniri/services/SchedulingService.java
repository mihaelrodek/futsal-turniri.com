package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.dtos.ScheduleConfigRequest;
import hr.mrodek.apps.futsal_turniri.dtos.ScheduleDto;
import hr.mrodek.apps.futsal_turniri.dtos.ScheduledMatchDto;
import hr.mrodek.apps.futsal_turniri.model.Matches;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.repository.MatchesRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotFoundException;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Match scheduler (Phase E4). One court — every match is played sequentially.
 *
 * <p>Each match occupies a fixed slot whose length is
 * {@code halfCount*halfLength + halftimeBreak + breakBetweenMatches + buffer}
 * minutes; matches are laid out back-to-back from the tournament's start
 * time. Individual kickoff times can be overridden afterwards.
 */
@ApplicationScoped
public class SchedulingService {

    @Inject MatchesRepository matchesRepo;

    /** Play order: matchday/round number, then knockout stage, then id. */
    private static final Comparator<Matches> MATCH_ORDER = Comparator
            .comparingInt((Matches m) -> m.getRound() != null ? m.getRound().getNumber() : 0)
            .thenComparingInt(m -> m.getStage() != null ? m.getStage().ordinal() : 0)
            .thenComparingLong(m -> m.getId() != null ? m.getId() : 0L);

    /**
     * Store the match-format config and lay out every match's kickoff time
     * sequentially from the tournament start. Re-runnable.
     */
    @Transactional
    public void generateSchedule(Tournaments t, ScheduleConfigRequest cfg) {
        if (t.getStartAt() == null) {
            throw new BadRequestException("Tournament has no start time");
        }
        t.setHalfCount(cfg.halfCount() != null ? cfg.halfCount() : 2);
        t.setHalfLengthMin(cfg.halfLengthMin());
        t.setHalftimeBreakMin(cfg.halftimeBreakMin());
        t.setBreakBetweenMatchesMin(cfg.breakBetweenMatchesMin());
        t.setBufferMin(cfg.bufferMin());

        int slot = slotLength(t);
        if (slot <= 0) {
            throw new BadRequestException("The match format must total more than 0 minutes");
        }

        List<Matches> all = matchesRepo.findByTournament_Id(t.getId());
        all.sort(MATCH_ORDER);
        OffsetDateTime cursor = t.getStartAt();
        for (Matches m : all) {
            m.setKickoffAt(cursor);
            cursor = cursor.plusMinutes(slot);
        }
    }

    /** Override one match's kickoff time. */
    @Transactional
    public void updateKickoff(Long matchId, OffsetDateTime kickoffAt) {
        Matches m = matchesRepo.findByIdOptional(matchId)
                .orElseThrow(() -> new NotFoundException("Match not found"));
        m.setKickoffAt(kickoffAt);
    }

    /** The full schedule — config, slot length, and every match in play order. */
    @Transactional
    public ScheduleDto schedule(Tournaments t) {
        List<Matches> all = matchesRepo.findByTournament_Id(t.getId());
        all.sort(MATCH_ORDER);
        List<ScheduledMatchDto> dtos = new ArrayList<>();
        for (Matches m : all) dtos.add(toDto(m));
        return new ScheduleDto(
                t.getHalfCount(),
                t.getHalfLengthMin(),
                t.getHalftimeBreakMin(),
                t.getBreakBetweenMatchesMin(),
                t.getBufferMin(),
                slotLength(t),
                dtos);
    }

    private static int slotLength(Tournaments t) {
        int hc = t.getHalfCount() != null ? t.getHalfCount() : 2;
        int hl = nz(t.getHalfLengthMin());
        int ht = nz(t.getHalftimeBreakMin());
        int pb = nz(t.getBreakBetweenMatchesMin());
        int bf = nz(t.getBufferMin());
        return hc * hl + ht + pb + bf;
    }

    private static int nz(Integer v) {
        return v == null ? 0 : v;
    }

    private ScheduledMatchDto toDto(Matches m) {
        return new ScheduledMatchDto(
                m.getId(),
                m.getStage() != null ? m.getStage().name() : null,
                m.getRound() != null ? m.getRound().getNumber() : null,
                m.getTeam1() != null ? m.getTeam1().getId() : null,
                m.getTeam1() != null ? m.getTeam1().getName() : null,
                m.getTeam2() != null ? m.getTeam2().getId() : null,
                m.getTeam2() != null ? m.getTeam2().getName() : null,
                m.getScore1(), m.getScore2(),
                m.getKickoffAt(),
                m.getStatus() != null ? m.getStatus().name() : null);
    }
}
