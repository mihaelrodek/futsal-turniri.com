package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.dtos.DaySchedule;
import hr.mrodek.apps.futsal_turniri.dtos.ScheduleConfigRequest;
import hr.mrodek.apps.futsal_turniri.dtos.ScheduleDto;
import hr.mrodek.apps.futsal_turniri.dtos.ScheduledMatchDto;
import hr.mrodek.apps.futsal_turniri.dtos.SchedulePlanInfoDto;
import hr.mrodek.apps.futsal_turniri.dtos.SchedulePlanRequest;
import hr.mrodek.apps.futsal_turniri.dtos.SchedulePreviewDto;
import hr.mrodek.apps.futsal_turniri.enums.MatchStage;
import hr.mrodek.apps.futsal_turniri.enums.MatchStatus;
import hr.mrodek.apps.futsal_turniri.enums.TournamentFormat;
import hr.mrodek.apps.futsal_turniri.model.Matches;
import hr.mrodek.apps.futsal_turniri.model.Teams;
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
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * Match scheduler (Phase E4). One court - every match is played sequentially.
 *
 * <p>Each match occupies a fixed slot whose length is
 * {@code halfCount*halfLength + halftimeBreak + breakBetweenMatches + buffer}
 * minutes; matches are laid out back-to-back from the tournament's start
 * time. Individual kickoff times can be overridden afterwards.
 */
@ApplicationScoped
public class SchedulingService {

    @Inject MatchesRepository matchesRepo;
    @Inject GroupStageService groupStageService;
    @Inject KnockoutService knockoutService;

    /** Play order: matchday/round number, then knockout stage, then id. */
    private static final Comparator<Matches> MATCH_ORDER = Comparator
            .comparingInt((Matches m) -> m.getRound() != null ? m.getRound().getNumber() : 0)
            .thenComparingInt(m -> stageRank(m.getStage()))
            .thenComparingLong(m -> m.getId() != null ? m.getId() : 0L);

    /**
     * Sort rank for a stage. Mirrors the enum order EXCEPT the third-place
     * playoff is placed right BEFORE the final - it's played first, so the
     * final stays the closing match of the tournament. (The enum ordinal
     * keeps THIRD_PLACE last for other purposes, so we don't reorder it.)
     */
    private static int stageRank(MatchStage s) {
        if (s == null) return 0;
        if (s == MatchStage.THIRD_PLACE) return MatchStage.FINAL.ordinal() * 2 - 1;
        return s.ordinal() * 2;
    }

    /**
     * Store the match-format config and lay out every match's kickoff time
     * sequentially from the tournament start. Re-runnable.
     */
    @Transactional
    public void generateSchedule(Tournaments t, ScheduleConfigRequest cfg) {
        if (t.getStartAt() == null) {
            throw new BadRequestException("Tournament has no start time");
        }

        // Generating the schedule is what creates the group fixtures - the
        // draw only places teams into groups. No-op if already generated, or
        // for KNOCKOUT_ONLY (which has no group matches).
        if (t.getFormat() == TournamentFormat.GROUPS_KNOCKOUT) {
            groupStageService.generateFixtures(t);
        }

        t.setHalfCount(cfg.halfCount() != null ? cfg.halfCount() : 2);
        // A half length is mandatory for the TIMER clock to cap/freeze at the
        // end of a half - never store null/0; fall back to the futsal default.
        t.setHalfLengthMin(
                cfg.halfLengthMin() != null && cfg.halfLengthMin() > 0
                        ? cfg.halfLengthMin()
                        : 10);
        t.setHalftimeBreakMin(cfg.halftimeBreakMin());
        t.setBreakBetweenMatchesMin(cfg.breakBetweenMatchesMin());
        t.setBufferMin(cfg.bufferMin());

        int slot = slotLength(t);
        if (slot <= 0) {
            throw new BadRequestException("The match format must total more than 0 minutes");
        }

        // Single court → matches are played back-to-back. Order: group matches
        // round-robin INTERLEAVED across groups (one A, one B, one C, one D,
        // then around again), then the knockout matches by stage.
        OffsetDateTime cursor = t.getStartAt();
        for (Matches m : orderForSingleCourt(t)) {
            m.setKickoffAt(cursor);
            cursor = cursor.plusMinutes(slot);
        }
    }

    /* ─────────────────── multi-day scheduling ─────────────────── */

    /**
     * How many matches the whole tournament will have, so the multi-day
     * generate UI can show "still to schedule". Group matches come from the
     * drawn groups (round-robin); knockout is the predicted bracket size
     * (elimination + third place), reserved even before the bracket is drawn.
     */
    @Transactional
    public SchedulePlanInfoDto planInfo(Tournaments t) {
        int groupMatches = t.getFormat() == TournamentFormat.GROUPS_KNOCKOUT
                ? groupStageService.plannedGroupFixtures(t).size()
                : 0;
        int knockoutMatches = knockoutService.plannedKnockoutMatchCount(t);
        return new SchedulePlanInfoDto(groupMatches, knockoutMatches, groupMatches + knockoutMatches);
    }

    /**
     * Compute the multi-day schedule WITHOUT persisting anything ("Skiciraj").
     * Lays every match (group fixtures interleaved, then the knockout - real if
     * a bracket exists, else placeholders) across the day plan and groups the
     * result by day. Matches that don't fit the plan are counted as unscheduled.
     */
    @Transactional
    public SchedulePreviewDto previewMultiDay(Tournaments t, SchedulePlanRequest req) {
        int slot = slotFromRequest(req);
        if (slot <= 0) {
            throw new BadRequestException("The match format must total more than 0 minutes");
        }

        record Plan(String stage, String group, String t1, String t2, boolean known) {}
        List<Plan> plan = new ArrayList<>();

        int groupMatches = 0;
        if (t.getFormat() == TournamentFormat.GROUPS_KNOCKOUT) {
            for (Teams[] pair : groupStageService.plannedGroupFixtures(t)) {
                String gn = pair[0].getGroup() != null ? pair[0].getGroup().getName() : null;
                plan.add(new Plan("GROUP", gn, pair[0].getName(), pair[1].getName(), true));
                groupMatches++;
            }
        }

        int knockoutMatches;
        List<Matches> existingKo = matchesRepo.list(
                "tournament = ?1 and stage <> ?2", t, MatchStage.GROUP);
        if (!existingKo.isEmpty()) {
            existingKo.sort(Comparator
                    .comparingInt((Matches m) -> stageRank(m.getStage()))
                    .thenComparingLong(m -> m.getId() != null ? m.getId() : 0L));
            for (Matches m : existingKo) {
                boolean known = m.getTeam1() != null && m.getTeam2() != null;
                plan.add(new Plan(
                        m.getStage() != null ? m.getStage().name() : null, null,
                        m.getTeam1() != null ? m.getTeam1().getName() : null,
                        m.getTeam2() != null ? m.getTeam2().getName() : null, known));
            }
            knockoutMatches = existingKo.size();
        } else {
            List<MatchStage> stages = knockoutService.plannedKnockoutStages(t);
            for (MatchStage st : stages) plan.add(new Plan(st.name(), null, null, null, false));
            knockoutMatches = stages.size();
        }

        int total = plan.size();
        List<OffsetDateTime> times = layoutTimes(total, req.days(), slot);

        Map<String, List<SchedulePreviewDto.Match>> byDay = new LinkedHashMap<>();
        int scheduled = 0;
        for (int i = 0; i < total; i++) {
            OffsetDateTime k = times.get(i);
            if (k == null) continue; // didn't fit the day plan
            scheduled++;
            Plan p = plan.get(i);
            byDay.computeIfAbsent(k.toLocalDate().toString(), d -> new ArrayList<>())
                    .add(new SchedulePreviewDto.Match(k, p.stage(), p.group(), p.t1(), p.t2(), p.known()));
        }
        List<SchedulePreviewDto.Day> days = new ArrayList<>();
        for (Map.Entry<String, List<SchedulePreviewDto.Match>> e : byDay.entrySet()) {
            days.add(new SchedulePreviewDto.Day(e.getKey(), e.getValue()));
        }
        return new SchedulePreviewDto(
                total, groupMatches, knockoutMatches, scheduled, total - scheduled, slot, days);
    }

    /**
     * Persist the multi-day schedule ("Potvrdi"). Stores the format config,
     * creates the group fixtures + the knockout placeholder skeleton (so the
     * elimination has reserved slots), then lays out every match's kickoff per
     * the day plan. Re-runnable. For KNOCKOUT_ONLY the existing bracket matches
     * are simply laid out across the days.
     */
    @Transactional
    public void generateMultiDay(Tournaments t, SchedulePlanRequest req) {
        if (req == null || req.days() == null || req.days().isEmpty()) {
            throw new BadRequestException("No day plan provided");
        }
        t.setHalfCount(req.halfCount() != null ? req.halfCount() : 2);
        t.setHalfLengthMin(
                req.halfLengthMin() != null && req.halfLengthMin() > 0 ? req.halfLengthMin() : 10);
        t.setHalftimeBreakMin(req.halftimeBreakMin());
        t.setBreakBetweenMatchesMin(req.breakBetweenMatchesMin());
        t.setBufferMin(req.bufferMin());

        int slot = slotLength(t);
        if (slot <= 0) {
            throw new BadRequestException("The match format must total more than 0 minutes");
        }

        if (t.getFormat() == TournamentFormat.GROUPS_KNOCKOUT) {
            groupStageService.generateFixtures(t);  // group matches (idempotent)
            knockoutService.createSkeleton(t);       // knockout placeholders (no-op if bracket exists)
        }

        List<Matches> ordered = orderForSingleCourt(t);
        List<OffsetDateTime> times = layoutTimes(ordered.size(), req.days(), slot);
        for (int i = 0; i < ordered.size(); i++) {
            ordered.get(i).setKickoffAt(times.get(i)); // null → beyond the plan (left unscheduled)
        }
    }

    /**
     * Assign kickoff times for {@code total} matches over the day plan: each day
     * places its {@code matches} back-to-back from that day's first kickoff,
     * {@code slot} minutes apart. Returns a list of length {@code total}; any
     * match beyond the plan's capacity gets a null time.
     */
    private List<OffsetDateTime> layoutTimes(int total, List<DaySchedule> days, int slot) {
        List<OffsetDateTime> times = new ArrayList<>();
        if (days != null) {
            for (DaySchedule d : days) {
                if (d == null || d.firstKickoff() == null) continue;
                OffsetDateTime cursor = OffsetDateTime.parse(d.firstKickoff());
                int cnt = Math.max(0, d.matches());
                for (int i = 0; i < cnt && times.size() < total; i++) {
                    times.add(cursor);
                    cursor = cursor.plusMinutes(slot);
                }
            }
        }
        while (times.size() < total) times.add(null);
        return times;
    }

    private static int slotFromRequest(SchedulePlanRequest req) {
        int hc = req.halfCount() != null ? req.halfCount() : 2;
        int hl = req.halfLengthMin() != null && req.halfLengthMin() > 0 ? req.halfLengthMin() : 10;
        int ht = nz(req.halftimeBreakMin());
        int pb = nz(req.breakBetweenMatchesMin());
        int bf = nz(req.bufferMin());
        return hc * hl + ht + pb + bf;
    }

    /**
     * Assign kickoff times to matches that don't have one yet - e.g. the
     * knockout matches generated after the group schedule was already laid
     * out - continuing right after the last already-scheduled match. Existing
     * kickoffs are left untouched, so manual edits and a day-split layout
     * (group stage day 1, knockout day 2) survive; the organizer can then
     * shift the freshly-scheduled matches to the right time/day by hand.
     */
    @Transactional
    public void confirmSchedule(Tournaments t) {
        List<Matches> all = matchesRepo.findByTournament_Id(t.getId());
        OffsetDateTime lastKickoff = null;
        List<Matches> missing = new ArrayList<>();
        for (Matches m : all) {
            if (m.getKickoffAt() != null) {
                if (lastKickoff == null || m.getKickoffAt().isAfter(lastKickoff)) {
                    lastKickoff = m.getKickoffAt();
                }
            } else {
                missing.add(m);
            }
        }
        if (missing.isEmpty()) return;

        int slot = slotLength(t);
        if (slot <= 0) slot = 30; // no stored config yet - sensible default

        OffsetDateTime cursor = lastKickoff != null
                ? lastKickoff.plusMinutes(slot)
                : t.getStartAt();
        if (cursor == null) {
            throw new BadRequestException("Tournament has no start time");
        }

        // Earlier knockout stages first (… SEMIFINAL, THIRD_PLACE, FINAL), then id.
        missing.sort(Comparator
                .comparingInt((Matches m) -> stageRank(m.getStage()))
                .thenComparingLong(m -> m.getId() != null ? m.getId() : 0L));
        for (Matches m : missing) {
            m.setKickoffAt(cursor);
            cursor = cursor.plusMinutes(slot);
        }
    }

    /**
     * The single-court play order: group matches interleaved across groups
     * (A1, B1, C1, D1, A2, B2, …), then knockout matches by stage then id.
     */
    private List<Matches> orderForSingleCourt(Tournaments t) {
        List<Matches> all = matchesRepo.findByTournament_Id(t.getId());

        // Split into per-group buckets (group matches) and the knockout rest.
        Map<Long, List<Matches>> byGroup = new LinkedHashMap<>();
        List<Matches> knockout = new ArrayList<>();
        for (Matches m : all) {
            if (m.getStage() == MatchStage.GROUP && m.getGroup() != null) {
                byGroup.computeIfAbsent(m.getGroup().getId(), k -> new ArrayList<>()).add(m);
            } else {
                knockout.add(m);
            }
        }

        // Within a group: matchday (round number) then id.
        Comparator<Matches> within = Comparator
                .comparingInt((Matches m) -> m.getRound() != null ? m.getRound().getNumber() : 0)
                .thenComparingLong(m -> m.getId() != null ? m.getId() : 0L);
        for (List<Matches> bucket : byGroup.values()) bucket.sort(within);

        // Iterate groups in A, B, C… order (by group ordinal).
        List<Long> groupIds = new ArrayList<>(byGroup.keySet());
        groupIds.sort(Comparator.comparingInt(id -> {
            var g = byGroup.get(id).get(0).getGroup();
            return g != null ? g.getOrdinal() : 0;
        }));

        // Round-robin merge: one match from each group per cycle.
        List<Matches> result = new ArrayList<>();
        boolean any = true;
        for (int idx = 0; any; idx++) {
            any = false;
            for (Long id : groupIds) {
                List<Matches> q = byGroup.get(id);
                if (idx < q.size()) {
                    result.add(q.get(idx));
                    any = true;
                }
            }
        }

        // Knockout after all group matches, ordered by stage (third-place
        // before the final) then id.
        knockout.sort(Comparator
                .comparingInt((Matches m) -> stageRank(m.getStage()))
                .thenComparingLong(m -> m.getId() != null ? m.getId() : 0L));
        result.addAll(knockout);
        return result;
    }

    /**
     * Clear the laid-out schedule. The generated group fixtures (created by
     * generating the schedule) are DELETED - keeping the groups/draw - so the
     * tournament returns to the pre-schedule state and can be regenerated. Any
     * other matches (e.g. an elimination bracket, which is generated elsewhere)
     * just lose their kickoff slot. Played matches are left untouched.
     */
    @Transactional
    public void clearSchedule(Tournaments t) {
        if (t.getFormat() == TournamentFormat.GROUPS_KNOCKOUT) {
            groupStageService.clearFixtures(t);
        }
        for (Matches m : matchesRepo.findByTournament_Id(t.getId())) {
            if (m.getStatus() != MatchStatus.LIVE && m.getStatus() != MatchStatus.FINISHED) {
                m.setKickoffAt(null);
            }
        }
    }

    /**
     * Reorder the schedule by drag-and-drop. The time slots stay fixed - we
     * take the existing kickoff times of the reordered matches, sort them
     * ascending, and hand the i-th slot to the match now in the i-th position.
     * Moving a match up therefore swaps its kickoff with the one above it.
     * Only this tournament's not-yet-played matches that already have a slot are
     * touched; LIVE / FINISHED matches and untimed matches are ignored.
     */
    @Transactional
    public void reorderSchedule(Tournaments t, List<Long> orderedMatchIds) {
        if (orderedMatchIds == null || orderedMatchIds.isEmpty()) return;
        Map<Long, Matches> byId = matchesRepo.findByTournament_Id(t.getId()).stream()
                .collect(Collectors.toMap(Matches::getId, x -> x));
        List<Matches> ordered = new ArrayList<>();
        for (Long id : orderedMatchIds) {
            Matches m = byId.get(id);
            if (m == null || m.getKickoffAt() == null) continue;
            if (m.getStatus() == MatchStatus.LIVE || m.getStatus() == MatchStatus.FINISHED) continue;
            ordered.add(m);
        }
        if (ordered.size() < 2) return;
        List<OffsetDateTime> slots = ordered.stream()
                .map(Matches::getKickoffAt)
                .sorted()
                .collect(Collectors.toList());
        for (int i = 0; i < ordered.size(); i++) {
            ordered.get(i).setKickoffAt(slots.get(i));
        }
    }

    /** Override one match's kickoff time. */
    @Transactional
    public void updateKickoff(Long matchId, OffsetDateTime kickoffAt) {
        Matches m = matchesRepo.findByIdOptional(matchId)
                .orElseThrow(() -> new NotFoundException("Match not found"));
        m.setKickoffAt(kickoffAt);
    }

    /** The full schedule - config, slot length, and every match in play order. */
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
                m.getGroup() != null ? m.getGroup().getName() : null,
                m.getRound() != null ? m.getRound().getNumber() : null,
                m.getTeam1() != null ? m.getTeam1().getId() : null,
                m.getTeam1() != null ? m.getTeam1().getName() : null,
                m.getTeam2() != null ? m.getTeam2().getId() : null,
                m.getTeam2() != null ? m.getTeam2().getName() : null,
                m.getScore1(), m.getScore2(),
                m.getKickoffAt(),
                m.getStatus() != null ? m.getStatus().name() : null,
                m.getWinnerTeam() != null ? m.getWinnerTeam().getId() : null,
                m.getPenalties1(), m.getPenalties2());
    }
}
