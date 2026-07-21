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
        applyKnockoutFormat(t, cfg.koHalfLengthMin(), cfg.koHalftimeBreakMin(), cfg.koBreakBetweenMatchesMin());

        int slot = slotLength(t);
        if (slot <= 0) {
            throw new BadRequestException("The match format must total more than 0 minutes");
        }

        // Single court → matches are played back-to-back. Order: group matches
        // round-robin INTERLEAVED across groups (one A, one B, one C, one D,
        // then around again), then the knockout matches by stage. Each match
        // advances the cursor by ITS OWN slot - the knockout may be longer.
        OffsetDateTime cursor = t.getStartAt();
        for (Matches m : orderForSingleCourt(t)) {
            m.setKickoffAt(cursor);
            cursor = cursor.plusMinutes(slotFor(t, m.getStage()));
        }
    }

    /**
     * Store the knockout format override. An absent/non-positive half length
     * means "the knockout plays like the groups" and clears ALL THREE fields,
     * so turning the override off never leaves a stale halftime break or
     * break-between-matches behind.
     */
    private static void applyKnockoutFormat(Tournaments t, Integer koHalfLength, Integer koHalftimeBreak,
                                             Integer koBreakBetweenMatches) {
        if (koHalfLength != null && koHalfLength > 0) {
            t.setKoHalfLengthMin(koHalfLength);
            t.setKoHalftimeBreakMin(koHalftimeBreak);
            t.setKoBreakBetweenMatchesMin(koBreakBetweenMatches);
        } else {
            t.setKoHalfLengthMin(null);
            t.setKoHalftimeBreakMin(null);
            t.setKoBreakBetweenMatchesMin(null);
        }
    }

    /* ─────────────────── multi-day scheduling ─────────────────── */

    /**
     * How many matches the whole tournament will have, so the multi-day
     * generate UI can show "still to schedule". Group matches come from the
     * drawn groups (round-robin); knockout is the predicted bracket size
     * (elimination + third place), reserved even before the bracket is drawn.
     *
     * <p>{@code remainingGroupMatches} / {@code remainingKnockoutMatches} are the
     * PERSISTED matches that still need a slot: everything that is neither played
     * (LIVE or FINISHED) nor a bye. Mid-tournament the planner lays out only these
     * (see {@link #previewMultiDay}/{@link #generateMultiDay}), so the counters
     * mirror that. Both are 0 for a stage whose matches don't exist yet or are all
     * already played, whereas the predicted totals above stay unchanged.
     */
    @Transactional
    public SchedulePlanInfoDto planInfo(Tournaments t) {
        int groupMatches = t.getFormat() == TournamentFormat.GROUPS_KNOCKOUT
                ? groupStageService.plannedGroupFixtures(t).size()
                : 0;
        int knockoutMatches = knockoutService.plannedKnockoutMatchCount(t);

        // The matches actually left to (re)schedule: not played (LIVE/FINISHED),
        // not a bye. Same remaining set the preview/generate plans range over.
        int remainingGroupMatches = 0;
        int remainingKnockoutMatches = 0;
        for (Matches m : matchesRepo.findByTournament_Id(t.getId())) {
            if (m.isKnockoutBye() || isPlayed(m)) continue;
            if (m.getStage() == MatchStage.GROUP) remainingGroupMatches++;
            else remainingKnockoutMatches++;
        }

        return new SchedulePlanInfoDto(groupMatches, knockoutMatches, groupMatches + knockoutMatches,
                remainingGroupMatches, remainingKnockoutMatches);
    }

    /**
     * Compute the multi-day schedule WITHOUT persisting anything ("Skiciraj").
     * Lays the REMAINING matches (group fixtures interleaved, then the knockout -
     * real if a bracket exists, else placeholders) across the day plan and groups
     * the result by day. Already-played (LIVE / FINISHED) matches and byes are
     * excluded - their kickoffs are never touched - so re-opening the planner
     * mid-tournament only sketches what is still to be played. The plan rows,
     * planHash and day-capacity all range over this remaining list, built with the
     * same filter + sort {@link #generateMultiDay} uses so the drag indices stay
     * aligned. Matches that don't fit the plan are counted as unscheduled; when
     * nothing remains the result is simply an empty-day plan (no error).
     */
    @Transactional
    public SchedulePreviewDto previewMultiDay(Tournaments t, SchedulePlanRequest req) {
        validateBreaks(req.breaks());
        // Knockout-only: the plan covers just the knockout matches, so the group
        // rows are skipped below and the whole ordered list is knockout-only.
        boolean koOnly = Boolean.TRUE.equals(req.koOnly());
        int slot = slotFromRequest(req, false);
        int koSlot = slotFromRequest(req, true);
        if (slot <= 0 || koSlot <= 0) {
            throw new BadRequestException("The match format must total more than 0 minutes");
        }

        record Plan(String stage, String group, String t1, String t2, boolean known,
                    Long id1, Long id2,
                    String slot1Label, String slot2Label,
                    String slot1PredictedName, String slot2PredictedName) {}
        List<Plan> plan = new ArrayList<>();

        int groupMatches = 0;
        // koOnly leaves the group stage entirely out of the plan (its kickoffs
        // are never touched); only the knockout block below builds the rows.
        if (!koOnly && t.getFormat() == TournamentFormat.GROUPS_KNOCKOUT) {
            // Once fixtures exist (e.g. re-planning after a partial clear kept
            // played matches), generateMultiDay reuses them (generateFixtures
            // no-ops) - so the preview must line up with the PERSISTED list,
            // not a recompute, or the drag order would address wrong matches.
            //
            // The persisted-vs-planned choice is by EXISTENCE, not by how many
            // remain: persistedGroupFixturesInPlayOrder already drops the played
            // matches, so it can come back empty even though fixtures exist. We
            // must NOT then fall back to the planned pairings (that would re-add
            // played group matches), hence the explicit count() existence check.
            boolean groupFixturesExist =
                    matchesRepo.count("tournament = ?1 and stage = ?2", t, MatchStage.GROUP) > 0;
            if (groupFixturesExist) {
                for (Matches m : persistedGroupFixturesInPlayOrder(t)) {
                    plan.add(new Plan("GROUP",
                            m.getGroup() != null ? m.getGroup().getName() : null,
                            m.getTeam1() != null ? m.getTeam1().getName() : null,
                            m.getTeam2() != null ? m.getTeam2().getName() : null,
                            m.getTeam1() != null && m.getTeam2() != null,
                            m.getTeam1() != null ? m.getTeam1().getId() : null,
                            m.getTeam2() != null ? m.getTeam2().getId() : null,
                            null, null, null, null)); // group rows are never labeled
                    groupMatches++;
                }
            } else {
                for (Teams[] pair : groupStageService.plannedGroupFixtures(t)) {
                    String gn = pair[0].getGroup() != null ? pair[0].getGroup().getName() : null;
                    plan.add(new Plan("GROUP", gn, pair[0].getName(), pair[1].getName(), true,
                            pair[0].getId(), pair[1].getId(), null, null, null, null));
                    groupMatches++;
                }
            }
        }

        int knockoutMatches;
        List<Matches> existingKo = matchesRepo.list(
                "tournament = ?1 and stage <> ?2", t, MatchStage.GROUP);
        // "Bracket exists" = real knockout rows are persisted. Decided BEFORE the
        // filters below so an all-played bracket still counts as existing - we then
        // lay out its zero REMAINING matches instead of the placeholder skeleton.
        boolean bracketExists = !existingKo.isEmpty();
        // BYEs are never played - they don't belong in the schedule at all.
        existingKo.removeIf(Matches::isKnockoutBye);
        // Already-played (LIVE / FINISHED) knockout matches keep their kickoff too;
        // the plan ranges over the REMAINING knockout only. Same filter + sort as
        // knockoutMatchesInPlayOrder (the koOnly generate list) so indices align.
        existingKo.removeIf(SchedulingService::isPlayed);
        if (bracketExists) {
            // Predicted-pairing labels for the persisted bracket/skeleton, keyed
            // by match id (labels only where a team is still null; empty for
            // KNOCKOUT_ONLY). Same source of truth as the bracket/schedule DTOs.
            Map<Long, KnockoutService.SlotLabels> koLabels = knockoutService.knockoutSlotLabels(t);
            existingKo.sort(Comparator
                    .comparingInt((Matches m) -> stageRank(m.getStage()))
                    .thenComparingLong(m -> m.getId() != null ? m.getId() : 0L));
            for (Matches m : existingKo) {
                boolean known = m.getTeam1() != null && m.getTeam2() != null;
                KnockoutService.SlotLabels sl = koLabels.get(m.getId());
                plan.add(new Plan(
                        m.getStage() != null ? m.getStage().name() : null, null,
                        m.getTeam1() != null ? m.getTeam1().getName() : null,
                        m.getTeam2() != null ? m.getTeam2().getName() : null, known,
                        m.getTeam1() != null ? m.getTeam1().getId() : null,
                        m.getTeam2() != null ? m.getTeam2().getId() : null,
                        sl != null ? sl.slot1Label() : null,
                        sl != null ? sl.slot2Label() : null,
                        sl != null ? sl.slot1PredictedName() : null,
                        sl != null ? sl.slot2PredictedName() : null));
            }
            knockoutMatches = existingKo.size();
        } else {
            // No bracket yet: placeholder rows, plus their COMBINATORIAL labels
            // (aligned 1:1 with plannedKnockoutStages) so the first sketch also
            // shows "A1 – H2" / "Pobj. ČF1". Teams stay unknown (known = false).
            List<MatchStage> stages = knockoutService.plannedKnockoutStages(t);
            List<KnockoutService.SlotLabels> plannedLabels = knockoutService.plannedSlotLabels(t);
            for (int si = 0; si < stages.size(); si++) {
                KnockoutService.SlotLabels sl = si < plannedLabels.size() ? plannedLabels.get(si) : null;
                plan.add(new Plan(stages.get(si).name(), null, null, null, false, null, null,
                        sl != null ? sl.slot1Label() : null,
                        sl != null ? sl.slot2Label() : null,
                        sl != null ? sl.slot1PredictedName() : null,
                        sl != null ? sl.slot2PredictedName() : null));
            }
            knockoutMatches = stages.size();
        }

        List<String> fingerprintParts = new ArrayList<>();
        for (Plan p : plan) fingerprintParts.add(p.stage() + "|" + p.id1() + "|" + p.id2());
        String planHash = planFingerprint(fingerprintParts);

        int total = plan.size();
        // Group rows carry the group slot, knockout rows the knockout slot.
        List<Integer> slots = new ArrayList<>(total);
        for (Plan p : plan) {
            slots.add("GROUP".equals(p.stage()) ? slot : koSlot);
        }
        List<OffsetDateTime> times = layoutTimes(slots, req.days(), req.breaks());

        Map<String, List<SchedulePreviewDto.Match>> byDay = new LinkedHashMap<>();
        int scheduled = 0;
        for (int i = 0; i < total; i++) {
            OffsetDateTime k = times.get(i);
            if (k == null) continue; // didn't fit the day plan
            scheduled++;
            Plan p = plan.get(i);
            byDay.computeIfAbsent(k.toLocalDate().toString(), d -> new ArrayList<>())
                    .add(new SchedulePreviewDto.Match(k, p.stage(), p.group(), p.t1(), p.t2(),
                            p.known(), p.slot1Label(), p.slot2Label(),
                            p.slot1PredictedName(), p.slot2PredictedName(), i));
        }
        List<SchedulePreviewDto.Day> days = new ArrayList<>();
        for (Map.Entry<String, List<SchedulePreviewDto.Match>> e : byDay.entrySet()) {
            days.add(new SchedulePreviewDto.Day(e.getKey(), e.getValue()));
        }
        return new SchedulePreviewDto(
                total, groupMatches, knockoutMatches, scheduled, total - scheduled, slot,
                planHash, days);
    }

    /**
     * Persist the multi-day schedule ("Potvrdi"). Stores the format config,
     * creates the group fixtures + the knockout placeholder skeleton (so the
     * elimination has reserved slots), then lays out the REMAINING matches'
     * kickoffs per the day plan. Already-played (LIVE / FINISHED) matches and byes
     * are excluded from the layout - their kickoffs stay put - so re-opening the
     * planner mid-tournament re-times only what is still to be played, over the
     * exact same remaining list (same filter + sort) {@link #previewMultiDay}
     * showed, keeping the drag order/planHash/stage-order guard aligned.
     * Re-runnable. For KNOCKOUT_ONLY the existing bracket matches are laid out
     * across the days. When nothing remains to schedule this is a no-op.
     */
    @Transactional
    public void generateMultiDay(Tournaments t, SchedulePlanRequest req) {
        if (req == null || req.days() == null || req.days().isEmpty()) {
            throw new BadRequestException("No day plan provided");
        }
        validateBreaks(req.breaks());
        boolean koOnly = Boolean.TRUE.equals(req.koOnly());

        if (koOnly) {
            // Knockout-only replan: the group schedule keeps its own stored
            // format, so we DON'T overwrite the group-format fields (halfCount,
            // halfLengthMin, halftimeBreakMin, breakBetweenMatchesMin, bufferMin).
            // Only the ko* overrides are (re)applied - applyKnockoutFormat sets
            // them when a positive koHalfLengthMin is given and otherwise clears
            // them, i.e. "the knockout plays like the (stored) groups". The KO
            // slot then resolves via slotFor(t, stage) exactly as elsewhere: the
            // ko override when present, the stored group format as the fallback.
            applyKnockoutFormat(t, req.koHalfLengthMin(), req.koHalftimeBreakMin(), req.koBreakBetweenMatchesMin());
        } else {
            t.setHalfCount(req.halfCount() != null ? req.halfCount() : 2);
            t.setHalfLengthMin(
                    req.halfLengthMin() != null && req.halfLengthMin() > 0 ? req.halfLengthMin() : 10);
            t.setHalftimeBreakMin(req.halftimeBreakMin());
            t.setBreakBetweenMatchesMin(req.breakBetweenMatchesMin());
            t.setBufferMin(req.bufferMin());
            applyKnockoutFormat(t, req.koHalfLengthMin(), req.koHalftimeBreakMin(), req.koBreakBetweenMatchesMin());
        }

        // koOnly only lays out knockout matches, so only the knockout slot must
        // be positive; the group slot is irrelevant (its schedule is untouched).
        boolean formatInvalid = koOnly
                ? slotFor(t, MatchStage.FINAL) <= 0
                : (slotLength(t) <= 0 || slotFor(t, MatchStage.FINAL) <= 0);
        if (formatInvalid) {
            throw new BadRequestException("The match format must total more than 0 minutes");
        }

        if (t.getFormat() == TournamentFormat.GROUPS_KNOCKOUT) {
            // koOnly skips the group fixtures entirely (they already exist and
            // stay untouched) but still ensures the knockout skeleton is present.
            if (!koOnly) {
                groupStageService.generateFixtures(t);  // group matches (idempotent)
            }
            knockoutService.createSkeleton(t);           // knockout placeholders (no-op if bracket exists)
        }

        // koOnly lays out ONLY the knockout matches, in the SAME order the
        // preview used (knockoutMatchesInPlayOrder mirrors the preview's KO list),
        // so planIndex/order/planHash line up and no GROUP match is ever retimed.
        List<Matches> ordered = koOnly ? knockoutMatchesInPlayOrder(t) : orderForSingleCourt(t);
        // Slots are per PLAY POSITION. A custom drag order is only allowed to
        // permute matches within a stage (validated below), so the stage - and
        // therefore the slot - at position j is the same either way.
        List<OffsetDateTime> times = layoutTimes(slotsFor(t, ordered), req.days(), req.breaks());

        // The preview's drag-and-drop sends the plan indices in the desired
        // play order: the j-th listed match takes the j-th time slot. The
        // preview rows and orderForSingleCourt line up positionally (the
        // preview builds its plan from the same sources), so the indices
        // address `ordered` directly.
        List<Integer> order = req.order();
        if (order != null && !order.isEmpty()) {
            int scheduledCount = 0;
            for (OffsetDateTime k : times) if (k != null) scheduledCount++;
            if (order.size() != scheduledCount) {
                // The fixture list changed since the sketch (roster / bracket
                // edit) - the previewed order no longer maps onto it.
                throw new BadRequestException(
                        "Schedule changed since the preview - sketch it again");
            }
            // Must be a permutation of the scheduled prefix 0..scheduledCount-1.
            java.util.Set<Integer> seen = new java.util.HashSet<>();
            for (Integer idx : order) {
                if (idx == null || idx < 0 || idx >= order.size() || !seen.add(idx)) {
                    throw new BadRequestException("Invalid match order");
                }
            }
            // Staleness guard: the fixtures the sketch showed must fingerprint
            // the same now - a concurrent redraw / roster edit / advance-count
            // change would silently re-target the dragged indices otherwise.
            if (req.planHash() != null) {
                List<String> parts = new ArrayList<>();
                for (Matches m : ordered) {
                    parts.add((m.getStage() != null ? m.getStage().name() : null) + "|"
                            + (m.getTeam1() != null ? m.getTeam1().getId() : null) + "|"
                            + (m.getTeam2() != null ? m.getTeam2().getId() : null));
                }
                if (!req.planHash().equals(planFingerprint(parts))) {
                    throw new BadRequestException(
                            "Schedule changed since the preview - sketch it again");
                }
            }
            // Stage order must survive the permutation (groups before the
            // knockout, quarterfinals before semis, third place before the
            // final). The UI enforces this; reject direct API calls that
            // don't - the bracket generator later re-applies reserved slots
            // in stage order and would silently revert a cross-stage swap.
            int prevRank = -1;
            for (Integer idx : order) {
                int rank = stageRank(ordered.get(idx).getStage());
                if (rank < prevRank) {
                    throw new BadRequestException("Invalid match order - stage order must be kept");
                }
                prevRank = rank;
            }
            OffsetDateTime[] assigned = new OffsetDateTime[ordered.size()];
            for (int j = 0; j < order.size(); j++) {
                assigned[order.get(j)] = times.get(j);
            }
            for (int i = 0; i < ordered.size(); i++) {
                ordered.get(i).setKickoffAt(assigned[i]); // null → beyond the plan
            }
            return;
        }

        for (int i = 0; i < ordered.size(); i++) {
            ordered.get(i).setKickoffAt(times.get(i)); // null → beyond the plan (left unscheduled)
        }
    }

    /**
     * Assign kickoff times for {@code total} matches over the day plan: each day
     * places its {@code matches} back-to-back from that day's first kickoff,
     * {@code slot} minutes apart. Returns a list of length {@code total}; any
     * match beyond the plan's capacity gets a null time.
     *
     * <p>{@code breaks} are draggable pauses (Feature C): before placing the
     * match at a given 0-based play-order position, the cursor is advanced by the
     * summed pause minutes for that position. A pause consumes TIME only, never a
     * match slot - the day still places its {@code matches} count, the pause just
     * pushes their kickoffs (and everything after) later. Capacity is therefore
     * still counted in matches, so a match beyond the day counts falls off the
     * plan exactly as before. With {@code breaks} null/empty this is
     * bit-identical to the pre-Feature-C layout.
     */
    private List<OffsetDateTime> layoutTimes(List<Integer> slots, List<DaySchedule> days,
                                             List<SchedulePlanRequest.Break> breaks) {
        int total = slots.size();
        List<OffsetDateTime> times = new ArrayList<>();
        if (days != null) {
            for (DaySchedule d : days) {
                if (d == null || d.firstKickoff() == null) continue;
                OffsetDateTime cursor = OffsetDateTime.parse(d.firstKickoff());
                int cnt = Math.max(0, d.matches());
                for (int i = 0; i < cnt && times.size() < total; i++) {
                    int pos = times.size();
                    // A pause in front of this play-order position shifts this and
                    // every later kickoff without taking a match slot.
                    int pause = breakMinutesBefore(breaks, pos);
                    if (pause > 0) cursor = cursor.plusMinutes(pause);
                    // Each match occupies its own slot - a knockout match with a
                    // longer format pushes the rest of the day back accordingly.
                    int slot = slots.get(pos);
                    times.add(cursor);
                    cursor = cursor.plusMinutes(slot);
                }
            }
        }
        while (times.size() < total) times.add(null);
        return times;
    }

    /** Total pause minutes to insert BEFORE play-order position {@code pos} -
     *  the additive sum of every break that targets it. 0 when there are none,
     *  which keeps the layout walk bit-identical to the pre-Feature-C behavior. */
    private static int breakMinutesBefore(List<SchedulePlanRequest.Break> breaks, int pos) {
        if (breaks == null || breaks.isEmpty()) return 0;
        int sum = 0;
        for (SchedulePlanRequest.Break b : breaks) {
            if (b != null && b.beforeOrderPos() != null && b.beforeOrderPos() == pos) {
                sum += nz(b.minutes());
            }
        }
        return sum;
    }

    /**
     * Validate the draggable pauses (Feature C): every break needs a
     * non-negative {@code beforeOrderPos} and {@code minutes} in 1..24*60.
     * A null/empty list is fine (no pauses). 400 on any violation.
     */
    private static void validateBreaks(List<SchedulePlanRequest.Break> breaks) {
        if (breaks == null) return;
        for (SchedulePlanRequest.Break b : breaks) {
            if (b == null) continue;
            if (b.beforeOrderPos() == null || b.beforeOrderPos() < 0) {
                throw new BadRequestException("Break position must be >= 0");
            }
            if (b.minutes() == null || b.minutes() < 1 || b.minutes() > 24 * 60) {
                throw new BadRequestException("Break minutes must be between 1 and 1440");
            }
        }
    }

    /**
     * Slot length straight from an unsaved request - the preview must do the
     * same per-stage maths as the persisted layout. {@code ko} selects the
     * knockout format when the request carries an override.
     */
    private static int slotFromRequest(SchedulePlanRequest req, boolean ko) {
        boolean koOverride = ko && req.koHalfLengthMin() != null && req.koHalfLengthMin() > 0;
        int hc = req.halfCount() != null ? req.halfCount() : 2;
        int hl = koOverride
                ? req.koHalfLengthMin()
                : (req.halfLengthMin() != null && req.halfLengthMin() > 0 ? req.halfLengthMin() : 10);
        int ht = koOverride && req.koHalftimeBreakMin() != null
                ? req.koHalftimeBreakMin()
                : nz(req.halftimeBreakMin());
        int pb = koOverride && req.koBreakBetweenMatchesMin() != null
                ? req.koBreakBetweenMatchesMin()
                : nz(req.breakBetweenMatchesMin());
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
        Matches lastScheduled = null;
        List<Matches> missing = new ArrayList<>();
        for (Matches m : all) {
            if (m.getKickoffAt() != null) {
                if (lastKickoff == null || m.getKickoffAt().isAfter(lastKickoff)) {
                    lastKickoff = m.getKickoffAt();
                    lastScheduled = m;
                }
            } else if (!m.isKnockoutBye()) { // a BYE never needs a slot
                missing.add(m);
            }
        }
        if (missing.isEmpty()) return;

        // The gap after the last scheduled match is ITS slot - that match is
        // the one still being played when the first missing one should start.
        OffsetDateTime cursor;
        if (lastKickoff != null) {
            int lastSlot = slotFor(t, lastScheduled.getStage());
            if (lastSlot <= 0) lastSlot = 30; // no stored config yet - sensible default
            cursor = lastKickoff.plusMinutes(lastSlot);
        } else {
            cursor = t.getStartAt();
        }
        if (cursor == null) {
            throw new BadRequestException("Tournament has no start time");
        }

        // Earlier knockout stages first (… SEMIFINAL, THIRD_PLACE, FINAL), then id.
        missing.sort(Comparator
                .comparingInt((Matches m) -> stageRank(m.getStage()))
                .thenComparingLong(m -> m.getId() != null ? m.getId() : 0L));
        for (Matches m : missing) {
            m.setKickoffAt(cursor);
            int slot = slotFor(t, m.getStage());
            if (slot <= 0) slot = 30;
            cursor = cursor.plusMinutes(slot);
        }
    }

    /**
     * The single-court play order of the REMAINING matches: group matches
     * interleaved across groups (A1, B1, C1, D1, A2, B2, …), then knockout matches
     * by stage then id. Byes and already-played (LIVE / FINISHED) matches are
     * excluded - the latter keep their kickoff and are never relaid - so this is
     * the full-mode generate list the preview mirrors.
     */
    private List<Matches> orderForSingleCourt(Tournaments t) {
        List<Matches> all = matchesRepo.findByTournament_Id(t.getId());

        // Split into per-group buckets (group matches) and the knockout rest.
        Map<Long, List<Matches>> byGroup = new LinkedHashMap<>();
        List<Matches> knockout = new ArrayList<>();
        for (Matches m : all) {
            if (m.isKnockoutBye()) continue; // never played, never scheduled
            if (isPlayed(m)) continue;       // LIVE / FINISHED - kickoff frozen, out of the plan
            if (m.getStage() == MatchStage.GROUP && m.getGroup() != null) {
                byGroup.computeIfAbsent(m.getGroup().getId(), k -> new ArrayList<>()).add(m);
            } else {
                knockout.add(m);
            }
        }

        List<Matches> result = interleaveGroupBuckets(byGroup);

        // Knockout after all group matches, ordered by stage (third-place
        // before the final) then id.
        knockout.sort(Comparator
                .comparingInt((Matches m) -> stageRank(m.getStage()))
                .thenComparingLong(m -> m.getId() != null ? m.getId() : 0L));
        result.addAll(knockout);
        return result;
    }

    /**
     * Merge per-group match buckets into the single-court play order: within a
     * group matchday (round number) then id, then interleaved one match per
     * group per cycle (A1, B1, C1, A2, …), groups in ordinal (A, B, C…) order.
     */
    private static List<Matches> interleaveGroupBuckets(Map<Long, List<Matches>> byGroup) {
        Comparator<Matches> within = Comparator
                .comparingInt((Matches m) -> m.getRound() != null ? m.getRound().getNumber() : 0)
                .thenComparingLong(m -> m.getId() != null ? m.getId() : 0L);
        for (List<Matches> bucket : byGroup.values()) bucket.sort(within);

        List<Long> groupIds = new ArrayList<>(byGroup.keySet());
        groupIds.sort(Comparator.comparingInt(id -> {
            var g = byGroup.get(id).get(0).getGroup();
            return g != null ? g.getOrdinal() : 0;
        }));

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
        return result;
    }

    /**
     * The PERSISTED, still-to-play group fixtures in single-court play order -
     * exactly the group prefix of {@link #orderForSingleCourt}. The multi-day
     * preview uses this when fixtures already exist, because generate will reuse
     * them (generateFixtures no-ops) rather than recompute the planned pairings.
     * Already-played (LIVE / FINISHED) group matches are dropped BEFORE the
     * interleave (matching {@code orderForSingleCourt}), so filtering-then-
     * interleaving produces the identical remaining sequence on both sides. May
     * return empty even when fixtures exist (all played) - callers decide
     * planned-vs-persisted by existence, not by this being empty.
     */
    private List<Matches> persistedGroupFixturesInPlayOrder(Tournaments t) {
        Map<Long, List<Matches>> byGroup = new LinkedHashMap<>();
        for (Matches m : matchesRepo.list("tournament = ?1 and stage = ?2", t, MatchStage.GROUP)) {
            if (m.getGroup() != null && !isPlayed(m)) {
                byGroup.computeIfAbsent(m.getGroup().getId(), k -> new ArrayList<>()).add(m);
            }
        }
        return interleaveGroupBuckets(byGroup);
    }

    /**
     * The PERSISTED, still-to-play knockout matches (stage != GROUP, byes and
     * already-played matches excluded) in play order - the same list, built the
     * same way, that the multi-day preview's knockout block walks (query
     * "stage &lt;&gt; GROUP", drop byes, drop LIVE / FINISHED, sort by stage rank
     * then id). Used by the koOnly generate so its ordered list lines up 1:1 with
     * the preview's knockout-only plan and no played match is ever relaid.
     */
    private List<Matches> knockoutMatchesInPlayOrder(Tournaments t) {
        List<Matches> ko = matchesRepo.list("tournament = ?1 and stage <> ?2", t, MatchStage.GROUP);
        ko.removeIf(Matches::isKnockoutBye);
        ko.removeIf(SchedulingService::isPlayed);
        ko.sort(Comparator
                .comparingInt((Matches m) -> stageRank(m.getStage()))
                .thenComparingLong(m -> m.getId() != null ? m.getId() : 0L));
        return ko;
    }

    /**
     * Order-sensitive 64-bit FNV-1a fingerprint of the plan rows, hex-encoded
     * (a raw long would lose precision as a JS number). Detects that the
     * fixture list changed between "Skiciraj" and "Potvrdi i generiraj".
     */
    private static String planFingerprint(List<String> parts) {
        long h = 0xcbf29ce484222325L;
        for (String s : parts) {
            for (int i = 0; i < s.length(); i++) {
                h ^= s.charAt(i);
                h *= 0x100000001b3L;
            }
            h ^= '\n';
            h *= 0x100000001b3L;
        }
        return Long.toHexString(h);
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

    /** Override one match's kickoff time (scoped to its tournament). */
    @Transactional
    public void updateKickoff(Long tournamentId, Long matchId, OffsetDateTime kickoffAt) {
        Matches m = matchesRepo.findByIdOptional(matchId)
                .orElseThrow(() -> new NotFoundException("Match not found"));
        // Scope guard: the match MUST belong to the authorized tournament
        // (prevents cross-tournament IDOR on kickoff times).
        if (m.getTournament() == null || !m.getTournament().getId().equals(tournamentId)) {
            throw new NotFoundException("Match not found");
        }
        m.setKickoffAt(kickoffAt);
    }

    /** The full schedule - config, slot length, and every match in play order. */
    @Transactional
    public ScheduleDto schedule(Tournaments t) {
        List<Matches> all = matchesRepo.findByTournament_Id(t.getId());
        // BYEs are never played - they don't belong in the raspored at all.
        all.removeIf(Matches::isKnockoutBye);
        all.sort(MATCH_ORDER);
        // Predicted-pairing labels so a knockout match still to be decided shows
        // "A1 – D2" (or "Pobj. ČF1") instead of TBD. Keyed by match id; group
        // matches simply aren't in the map. Empty for KNOCKOUT_ONLY.
        Map<Long, KnockoutService.SlotLabels> labels = knockoutService.knockoutSlotLabels(t);
        List<ScheduledMatchDto> dtos = new ArrayList<>();
        for (Matches m : all) dtos.add(toDto(m, labels));
        return new ScheduleDto(
                t.getHalfCount(),
                t.getHalfLengthMin(),
                t.getHalftimeBreakMin(),
                t.getBreakBetweenMatchesMin(),
                t.getBufferMin(),
                t.getKoHalfLengthMin(),
                t.getKoHalftimeBreakMin(),
                t.getKoBreakBetweenMatchesMin(),
                slotLength(t),
                slotFor(t, MatchStage.FINAL),
                dtos);
    }

    /**
     * Slot length for a match in {@code stage}. The knockout may play a longer
     * format than the groups (e.g. 2x6 → 2x8), so a tournament no longer has
     * ONE slot - every layout walks matches in play order and advances the
     * cursor by that match's own slot.
     */
    private static int slotFor(Tournaments t, MatchStage stage) {
        int hc = t.getHalfCount() != null ? t.getHalfCount() : 2;
        int hl = nz(t.halfLengthForStage(stage));
        int ht = nz(t.halftimeBreakForStage(stage));
        int pb = nz(t.breakBetweenMatchesForStage(stage));
        int bf = nz(t.getBufferMin());
        return hc * hl + ht + pb + bf;
    }

    /** Per-position slot lengths for matches already in play order. */
    private static List<Integer> slotsFor(Tournaments t, List<Matches> ordered) {
        List<Integer> slots = new ArrayList<>(ordered.size());
        for (Matches m : ordered) slots.add(slotFor(t, m.getStage()));
        return slots;
    }

    /** The group-stage slot. Kept as the tournament's headline slot length. */
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

    /**
     * A match is "played" once it is LIVE or FINISHED - it has (or is having) its
     * moment on the court, so the scheduler must never touch its kickoff. Every
     * multi-day plan (preview + generate, full + koOnly) ranges over the REMAINING
     * matches, i.e. those for which this returns false (SCHEDULED or statusless).
     */
    private static boolean isPlayed(Matches m) {
        return m.getStatus() == MatchStatus.LIVE || m.getStatus() == MatchStatus.FINISHED;
    }

    private ScheduledMatchDto toDto(Matches m, Map<Long, KnockoutService.SlotLabels> labels) {
        KnockoutService.SlotLabels sl = labels.get(m.getId());
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
                m.getPenalties1(), m.getPenalties2(),
                m.getFouls1First(), m.getFouls1Second(),
                m.getFouls2First(), m.getFouls2Second(),
                sl != null ? sl.slot1Label() : null,
                sl != null ? sl.slot2Label() : null,
                sl != null ? sl.slot1PredictedName() : null,
                sl != null ? sl.slot2PredictedName() : null);
    }
}
