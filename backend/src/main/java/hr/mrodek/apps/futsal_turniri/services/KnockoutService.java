package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.dtos.BracketDto;
import hr.mrodek.apps.futsal_turniri.dtos.BracketMatchDto;
import hr.mrodek.apps.futsal_turniri.dtos.BracketRoundDto;
import hr.mrodek.apps.futsal_turniri.dtos.GroupDto;
import hr.mrodek.apps.futsal_turniri.dtos.GroupMatchDto;
import hr.mrodek.apps.futsal_turniri.dtos.GroupStandingRowDto;
import hr.mrodek.apps.futsal_turniri.dtos.KnockoutResultRequest;
import hr.mrodek.apps.futsal_turniri.dtos.ManualPositionsRequest;
import hr.mrodek.apps.futsal_turniri.dtos.ThirdPlacedTableDto;
import hr.mrodek.apps.futsal_turniri.enums.BracketFill;
import hr.mrodek.apps.futsal_turniri.enums.MatchStage;
import hr.mrodek.apps.futsal_turniri.enums.MatchStatus;
import hr.mrodek.apps.futsal_turniri.enums.TournamentFormat;
import hr.mrodek.apps.futsal_turniri.model.Matches;
import hr.mrodek.apps.futsal_turniri.model.Rounds;
import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.repository.MatchesRepository;
import hr.mrodek.apps.futsal_turniri.repository.RoundsRepository;
import hr.mrodek.apps.futsal_turniri.repository.TeamsRepository;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotFoundException;
import jakarta.ws.rs.WebApplicationException;
import jakarta.ws.rs.core.Response;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import hr.mrodek.apps.futsal_turniri.dtos.ManualBracketRequest;

/**
 * Knockout-bracket engine (Phase E3).
 *
 * <p>Generates a single-elimination bracket from the group qualifiers (or
 * all teams, for KNOCKOUT_ONLY), links each match to the next via
 * {@code nextMatch}/{@code nextSlot}, and propagates winners (and semi-final
 * losers into the third-place match) as results are recorded. A third-place
 * playoff is always created.
 *
 * <p>Seeding: KNOCKOUT_ONLY uses standard cross-seeding of the seed list.
 * GROUPS_KNOCKOUT is fully DETERMINISTIC (same standings → identical bracket,
 * never shuffled): the classic mirror cross-pairing when exactly two advance
 * per group (A1-D2, C1-B2, B1-C2, D1-A2 for four groups), otherwise a
 * constraint-based seeding that forbids same-group pairs in round one and
 * keeps group-mates in opposite bracket halves whenever possible - see
 * {@link #groupRoundOnePairs}.
 */
@ApplicationScoped
public class KnockoutService {

    @Inject TeamsRepository teamsRepo;
    @Inject MatchesRepository matchesRepo;
    @Inject RoundsRepository roundsRepo;
    @Inject TournamentsRepository tournamentsRepo;
    @Inject GroupStageService groupStageService;
    @Inject PushService pushService;

    /**
     * Computed predicted-pairing labels (and, for a finished group, resolved
     * team names) for the two slots of one knockout match. A null field means
     * the slot has no label / no predicted name - the real team is already
     * known, the match is a bye, or the pairing isn't predictable. Purely
     * derived: never persisted, always recomputed from the bracket + standings
     * so it can't diverge from the generator.
     */
    public record SlotLabels(
            String slot1Label,
            String slot2Label,
            String slot1PredictedName,
            String slot2PredictedName) {}

    /** Group-standings ranking used to seed qualifiers within a placement tier. */
    private static final Comparator<GroupStandingRowDto> STANDING_RANK =
            Comparator.comparingInt(GroupStandingRowDto::points).reversed()
                    .thenComparing(Comparator.comparingInt(GroupStandingRowDto::goalDiff).reversed())
                    .thenComparing(Comparator.comparingInt(GroupStandingRowDto::goalsFor).reversed());

    /**
     * Deterministic seed order for KNOCKOUT_ONLY tournaments. Organizer-set
     * manual seeds (manualRank) come first, in that order; teams without a seed
     * fall back to registration order (id). Same teams → same bracket, always -
     * just like Challonge. No randomness.
     */
    private static final Comparator<Teams> SEED_ORDER =
            Comparator.comparing(Teams::getManualRank,
                            Comparator.nullsLast(Comparator.naturalOrder()))
                    .thenComparing(Teams::getId);

    /* ─────────────────────────── generation ──────────────────────────── */

    /**
     * Build (or rebuild) the knockout bracket and return it. Re-runnable -
     * any existing knockout matches are wiped first.
     */
    @Transactional
    public BracketDto generateBracket(Tournaments t) {
        return generateBracket(t, null, false);
    }

    /**
     * Build (or rebuild) the knockout bracket. {@code byeTeamIds} (optional)
     * lets the organizer choose which teams get the round-one bye (direct
     * advance) when the qualifier count isn't a power of two - those teams are
     * moved to the top seeds, which is exactly where standard seeding places the
     * byes. Null/empty → automatic (best seeds get the byes).
     *
     * <p>{@code shuffleRest} randomly reorders the non-bye teams - the
     * automatic draw for KNOCKOUT_ONLY. IGNORED for GROUPS_KNOCKOUT: a bracket
     * built from a finished group stage is always deterministic (same
     * standings → identical bracket).
     */
    @Transactional
    public BracketDto generateBracket(Tournaments t, List<Long> byeTeamIds, boolean shuffleRest) {
        if (t.getFormat() == TournamentFormat.GROUPS_KNOCKOUT) {
            long groupTotal = matchesRepo.count(
                    "tournament = ?1 and stage = ?2", t, MatchStage.GROUP);
            if (groupTotal == 0) {
                throw new BadRequestException("Generiraj raspored grupne faze prvo");
            }
            long unfinished = matchesRepo.count(
                    "tournament = ?1 and stage = ?2 and status <> ?3",
                    t, MatchStage.GROUP, MatchStatus.FINISHED);
            if (unfinished > 0) {
                throw new BadRequestException(
                        "Sve utakmice grupne faze moraju imati upisan rezultat prije eliminacije");
            }
        }

        List<Teams> qs = qualifiers(t);
        if (qs.size() < 2) {
            throw new BadRequestException("Need at least 2 teams for a knockout bracket");
        }
        // Defensive: a duplicated id would silently void the bye pull-front
        // below while groupRoundOnePairs still pinned the team via its bye
        // class - keep the two in agreement by de-duplicating up front.
        if (byeTeamIds != null) {
            byeTeamIds = new ArrayList<>(new LinkedHashSet<>(byeTeamIds));
        }
        // Organizer-chosen byes: pull those teams to the top seeds, where the
        // standard seeding (below) hands out the round-one byes. The non-bye
        // teams keep their seed order; only the KNOCKOUT_ONLY automatic draw
        // may shuffle them - a GROUPS_KNOCKOUT bracket is NEVER shuffled.
        boolean shuffle = shuffleRest && t.getFormat() != TournamentFormat.GROUPS_KNOCKOUT;
        if ((byeTeamIds != null && !byeTeamIds.isEmpty()) || shuffle) {
            Set<Long> byeSet = byeTeamIds == null ? Set.of() : new HashSet<>(byeTeamIds);
            List<Teams> front = new ArrayList<>();
            if (byeTeamIds != null) {
                for (Long id : byeTeamIds) {
                    for (Teams tm : qs) {
                        if (tm.getId().equals(id)) { front.add(tm); break; }
                    }
                }
            }
            List<Teams> rest = new ArrayList<>();
            for (Teams tm : qs) {
                if (!byeSet.contains(tm.getId())) rest.add(tm);
            }
            if (shuffle) Collections.shuffle(rest);
            front.addAll(rest);
            if (front.size() == qs.size()) qs = front;
        }

        // A multi-day schedule reserves kickoff slots on placeholder knockout
        // matches BEFORE the real bracket is drawn (see createSkeleton). Capture
        // those reserved times so the freshly-built bracket inherits them - the
        // day split (group stage on early days, knockout on later days) survives
        // materialization instead of being lost with the wiped placeholders.
        //
        // Read the kickoffs as a SCALAR projection, NOT as entities: loading the
        // old knockout Matches as managed entities here would leave them in the
        // persistence context after the bulk-delete below wipes their rows and
        // their round is removed, so the next autoflush would fail with
        // "TransientObjectException: ... unsaved transient instance of Rounds".
        //
        // Skip bye rows: they are never played, so a slot of theirs (only
        // possible on data created before byes were excluded from the
        // schedule) would shift every real match's reserved time by one.
        // Projected as (stage, kickoffAt) pairs and grouped BY STAGE below: each
        // round keeps its own block of slots. Re-applying per stage - instead of
        // one flat chronological list poured back in stage order - is what lets a
        // CUSTOM round order survive materialization (e.g. an osmina the
        // organizer scheduled before the šesnaestina keeps its earlier slots
        // instead of being silently normalized back to stage order).
        List<Object[]> reservedRows = matchesRepo.getEntityManager()
                .createQuery(
                        "select m.stage, m.kickoffAt from Matches m "
                                + "where m.tournament = ?1 and m.stage <> ?2 "
                                + "and m.kickoffAt is not null "
                                + "and not (m.status = ?3 and (m.team1 is null or m.team2 is null)) "
                                + "order by m.kickoffAt",
                        Object[].class)
                .setParameter(1, t)
                .setParameter(2, MatchStage.GROUP)
                .setParameter(3, MatchStatus.FINISHED)
                .getResultList();
        Map<MatchStage, List<java.time.OffsetDateTime>> reservedKickoffs = new EnumMap<>(MatchStage.class);
        for (Object[] row : reservedRows) {
            reservedKickoffs
                    .computeIfAbsent((MatchStage) row[0], k -> new ArrayList<>())
                    .add((java.time.OffsetDateTime) row[1]);
        }

        // Capture any position-pairing sources the organizer set on the skeleton
        // BEFORE the bulk-delete below wipes those rows - the same scalar-
        // projection reasoning as the kickoffs above (loading the soon-to-be-
        // deleted knockout Matches as managed entities would leave them in the
        // persistence context and break the next autoflush). Both the round-one
        // real-pair sources AND the next-round bye-survivor sources are captured;
        // when present they WIN over the classic/constraint seeding: the bracket
        // is built from the organizer's exact position pairing (byes included).
        Map<MatchStage, List<String[]>> srcByStage = sourcesByStage(
                matchesRepo.getEntityManager()
                        .createQuery(
                                "select m.stage, m.slot1Source, m.slot2Source from Matches m "
                                        + "where m.tournament = ?1 and m.stage <> ?2 order by m.id",
                                Object[].class)
                        .setParameter(1, t)
                        .setParameter(2, MatchStage.GROUP)
                        .getResultList());
        List<MatchStage> koStages = koStagesInOrder(srcByStage);
        List<String[]> roundOneSources = koStages.isEmpty()
                ? List.of() : srcByStage.get(koStages.get(0));
        List<String[]> nextRoundSources = koStages.size() >= 2
                ? srcByStage.get(koStages.get(1)) : List.of();
        boolean hasSources = java.util.stream.Stream
                .concat(roundOneSources.stream(), nextRoundSources.stream())
                .anyMatch(s -> s[0] != null || s[1] != null);

        // Wipe any prior knockout matches and their now-empty rounds.
        matchesRepo.delete("tournament = ?1 and stage <> ?2", t, MatchStage.GROUP);
        matchesRepo.flush();
        for (Rounds r : roundsRepo.findByTournament_Id(t.getId())) {
            if (matchesRepo.count("round", r) == 0) roundsRepo.delete(r);
        }
        // A fresh draw invalidates any prior confirmation - the organizer must
        // re-confirm the new bracket before its matches can start / record.
        t.setBracketConfirmedAt(null);

        int q = qs.size();
        int n = nextPowerOfTwo(q); // bracket size

        // One Round entity carries the whole knockout - `stage` distinguishes
        // the rounds, so a Round per stage isn't needed.
        int baseNum = roundsRepo.findTopByTournamentOrderByNumberDesc(t)
                .map(Rounds::getNumber).orElse(0);
        Rounds koRound = new Rounds();
        koRound.setTournament(t);
        koRound.setNumber(baseNum + 1);
        roundsRepo.persist(koRound);

        // Build the empty match tree, round by round.
        int totalRounds = Integer.numberOfTrailingZeros(n); // log2(n)
        List<List<Matches>> byRound = new ArrayList<>();
        int inRound = n / 2;
        for (int r = 0; r < totalRounds; r++) {
            MatchStage stage = stageFor(inRound);
            List<Matches> rm = new ArrayList<>();
            for (int i = 0; i < inRound; i++) {
                Matches m = new Matches();
                m.setTournament(t);
                m.setRound(koRound);
                m.setStage(stage);
                m.setStatus(MatchStatus.SCHEDULED);
                matchesRepo.persist(m);
                rm.add(m);
            }
            byRound.add(rm);
            inRound /= 2;
        }
        // Link each match to the one its winner advances into.
        for (int r = 0; r < totalRounds - 1; r++) {
            List<Matches> cur = byRound.get(r);
            List<Matches> next = byRound.get(r + 1);
            for (int i = 0; i < cur.size(); i++) {
                cur.get(i).setNextMatch(next.get(i / 2));
                cur.get(i).setNextSlot((i % 2) + 1);
            }
        }

        // Seed round one. A persisted position pairing (the position-based
        // manual draw) WINS: build round one from the organizer's exact
        // sources, honoring their pairing/order and skipping the classic /
        // constraint algorithms entirely. Otherwise GROUPS_KNOCKOUT gets the
        // deterministic group cross-pairing and KNOCKOUT_ONLY the plain standard
        // seeding (seed s vs seed n+1-s). Seeds beyond the qualifier count are
        // byes.
        List<Teams[]> roundOnePairs;
        if (hasSources) {
            roundOnePairs = pairsFromSources(t, roundOneSources, nextRoundSources, n);
        } else if (t.getFormat() == TournamentFormat.GROUPS_KNOCKOUT) {
            roundOnePairs = groupRoundOnePairs(t, qs, byeTeamIds, n);
        } else {
            roundOnePairs = pairsFromSeedOrder(qs, n);
        }
        List<Matches> round1 = byRound.get(0);
        for (int i = 0; i < round1.size(); i++) {
            round1.get(i).setTeam1(roundOnePairs.get(i)[0]);
            round1.get(i).setTeam2(roundOnePairs.get(i)[1]);
        }

        // Third-place playoff - fed by the semi-final losers. Skipped when the
        // bracket can't produce two of them (see hasThirdPlace).
        if (hasThirdPlace(q)) {
            Matches third = new Matches();
            third.setTournament(t);
            third.setRound(koRound);
            third.setStage(MatchStage.THIRD_PLACE);
            third.setStatus(MatchStatus.SCHEDULED);
            matchesRepo.persist(third);
        }

        // Resolve byes: a round-one match with a single team auto-advances it.
        for (Matches m : round1) {
            boolean has1 = m.getTeam1() != null;
            boolean has2 = m.getTeam2() != null;
            if (has1 ^ has2) {
                Teams w = has1 ? m.getTeam1() : m.getTeam2();
                m.setWinnerTeam(w);
                m.setStatus(MatchStatus.FINISHED);
                advanceWinner(m, w);
            }
        }

        applyReservedKickoffs(t, reservedKickoffs);
        return bracket(t.getId());
    }

    /**
     * Re-apply kickoff slots that a multi-day schedule reserved on the knockout
     * placeholders. Keeps the schedule's day split after the real bracket
     * replaces the skeleton. No-op when nothing was reserved.
     *
     * <p><b>Per stage, not one flat list.</b> Each round's reserved slots go back
     * onto that same round's matches, so a round keeps exactly the times it was
     * given. That is what preserves a CUSTOM round order (an osmina the organizer
     * dragged before the šesnaestina keeps its earlier slots); pouring one
     * chronological list back in stage order would silently re-sort the rounds.
     */
    private void applyReservedKickoffs(Tournaments t,
                                       Map<MatchStage, List<java.time.OffsetDateTime>> reserved) {
        if (reserved == null || reserved.isEmpty()) return;
        List<Matches> ko = matchesRepo.list("tournament = ?1 and stage <> ?2", t, MatchStage.GROUP);
        // BYEs are never played and never appear in the schedule - handing them
        // a reserved slot would leave a real match without one (the skeleton
        // reserves exactly the number of REAL knockout matches).
        ko.removeIf(Matches::isKnockoutBye);
        Map<MatchStage, List<Matches>> byStage = new EnumMap<>(MatchStage.class);
        for (Matches m : ko) {
            byStage.computeIfAbsent(m.getStage(), k -> new ArrayList<>()).add(m);
        }
        for (Map.Entry<MatchStage, List<Matches>> e : byStage.entrySet()) {
            List<java.time.OffsetDateTime> slots = reserved.get(e.getKey());
            if (slots == null || slots.isEmpty()) continue;
            List<Matches> ms = e.getValue();
            // Stable within the round - same id order the labels/feeders use.
            ms.sort(Comparator.comparingLong(m -> m.getId() != null ? m.getId() : 0L));
            for (int i = 0; i < ms.size() && i < slots.size(); i++) {
                ms.get(i).setKickoffAt(slots.get(i));
            }
        }
    }

    /** Play-order rank for a knockout stage: earlier rounds first, third-place
     *  right before the final (mirrors SchedulingService's stage ordering). */
    private static int knockoutStageRank(MatchStage s) {
        if (s == null) return 0;
        if (s == MatchStage.THIRD_PLACE) return MatchStage.FINAL.ordinal() * 2 - 1;
        return s.ordinal() * 2;
    }

    /**
     * Wipe the knockout bracket - deletes every non-group match (all knockout
     * rounds + the third-place playoff) and removes the now-empty knockout
     * round. Group-stage matches and standings are left untouched. Backs the
     * "Resetiraj" action so the organizer can clear and redo the elimination.
     */
    @Transactional
    public void resetBracket(Tournaments t) {
        matchesRepo.delete("tournament = ?1 and stage <> ?2", t, MatchStage.GROUP);
        matchesRepo.flush();
        for (Rounds r : roundsRepo.findByTournament_Id(t.getId())) {
            if (matchesRepo.count("round", r) == 0) roundsRepo.delete(r);
        }
        // Clearing the bracket also clears its confirmation - a redrawn bracket
        // must be confirmed again.
        t.setBracketConfirmedAt(null);
    }

    /**
     * Confirm the drawn knockout bracket so its matches can be started and
     * their results recorded. Idempotent: a second call is a no-op success that
     * keeps the original confirmation time.
     *
     * <p>Rejects with 409 {@code GROUP_STAGE_NOT_COMPLETE} while the group stage
     * still has unplayed matches. When the bracket hasn't been drawn yet - only
     * the multi-day skeleton (teamless placeholders) exists, or nothing at all -
     * it is generated first via the automatic draw, so confirm always operates
     * on a materialized bracket. Returns the fresh bracket.
     */
    @Transactional
    public BracketDto confirmBracket(Tournaments t) {
        if (!isGroupStageComplete(t)) {
            throw new WebApplicationException(
                    Response.status(Response.Status.CONFLICT)
                            .entity("GROUP_STAGE_NOT_COMPLETE").build());
        }
        // Round one has no real teams yet (skeleton-only or empty) → draw now.
        // generateBracket clears bracketConfirmedAt, which we then set below.
        if (!bracketHasRealTeams(t)) {
            generateBracket(t);
        }
        if (t.getBracketConfirmedAt() == null) {
            t.setBracketConfirmedAt(java.time.OffsetDateTime.now());
        }
        return bracket(t.getId());
    }

    /** Whether any knockout match already carries a real team - i.e. the bracket
     *  has been drawn, as opposed to only the teamless multi-day skeleton (or no
     *  knockout matches at all). */
    private boolean bracketHasRealTeams(Tournaments t) {
        return matchesRepo.count(
                "tournament = ?1 and stage <> ?2 and (team1 is not null or team2 is not null)",
                t, MatchStage.GROUP) > 0;
    }

    /* ──────────────── multi-day schedule support ───────────────── */

    /** Predicted qualifier count for a GROUPS_KNOCKOUT tournament, before the
     *  bracket exists: groupCount * advancePerGroup + bestThirdCount. */
    public int predictedQualifiers(Tournaments t) {
        int adv = t.getAdvancePerGroup() == null ? 2 : t.getAdvancePerGroup();
        int bt = t.getBestThirdCount() == null ? 0 : t.getBestThirdCount();
        // Once drawn, sum each group's own advance count (per-group overrides
        // make the total uneven, e.g. 6×1 + 1×2) - lightweight, one query, no
        // standings computation. Before the draw (-1) fall back to groupCount×adv.
        long sum = groupStageService.advanceSum(t.getId(), adv);
        if (sum >= 0) return (int) sum + bt;
        int gc = t.getGroupCount() == null ? 0 : t.getGroupCount();
        return gc * adv + bt;
    }

    /** Predicted count of REAL (playable) knockout matches for the predicted
     *  qualifiers, or the actual non-bye count once a bracket/skeleton exists. */
    public int plannedKnockoutMatchCount(Tournaments t) {
        List<Matches> existing = matchesRepo.list(
                "tournament = ?1 and stage <> ?2", t, MatchStage.GROUP);
        if (!existing.isEmpty()) {
            // BYEs are never played - don't count them as schedulable matches.
            return (int) existing.stream().filter(m -> !m.isKnockoutBye()).count();
        }
        if (t.getFormat() != TournamentFormat.GROUPS_KNOCKOUT) return 0;
        int q = predictedQualifiers(t);
        if (q < 2) return 0;
        // A bracket of size n = nextPowerOfTwo(q) has (n - 1) tree matches, of
        // which (n - q) are first-round byes that are never played - leaving
        // (q - 1) real ones - plus the third-place playoff when it's playable.
        return (q - 1) + (hasThirdPlace(q) ? 1 : 0);
    }

    /** Predicted knockout stages in single-court play order (e.g. QF×4, SF×2,
     *  THIRD_PLACE, FINAL for 8 qualifiers), for the multi-day schedule preview
     *  before the bracket exists. Empty when not GROUPS_KNOCKOUT or < 2 qualify. */
    public List<MatchStage> plannedKnockoutStages(Tournaments t) {
        if (t.getFormat() != TournamentFormat.GROUPS_KNOCKOUT) return List.of();
        int q = predictedQualifiers(t);
        if (q < 2) return List.of();
        int n = nextPowerOfTwo(q);
        // (n - q) first-round pairs are BYEs (one team, auto-advance) - they
        // are never played, so don't plan a slot for them.
        int byes = n - q;
        List<MatchStage> stages = new ArrayList<>();
        int inRound = n / 2;
        boolean firstRound = true;
        while (inRound >= 1) {
            MatchStage st = stageFor(inRound);
            int cnt = firstRound ? inRound - byes : inRound;
            for (int i = 0; i < cnt; i++) stages.add(st);
            firstRound = false;
            inRound /= 2;
        }
        if (hasThirdPlace(q)) stages.add(MatchStage.THIRD_PLACE);
        stages.sort(Comparator.comparingInt(KnockoutService::knockoutStageRank));
        return stages;
    }

    /**
     * Predicted-pairing labels for the schedule SKETCH, before any knockout
     * match is persisted - the combinatorial counterpart of the persisted
     * {@link #knockoutSlotLabels}. The returned list is aligned 1:1 (same size
     * and order) with {@link #plannedKnockoutStages}, so caller {@code i} maps a
     * planned stage entry to its labels. Empty for KNOCKOUT_ONLY or when fewer
     * than two teams will qualify (mirrors {@code plannedKnockoutStages}).
     *
     * <p>Built to reproduce EXACTLY what {@link #computeSlotLabels} would emit
     * for the {@link #createSkeleton} tree, so the "no bracket yet" sketch and
     * the "skeleton exists" preview show identical labels:
     * <ul>
     *   <li><b>Round one</b> is labeled "A1" / "D2" only when the classic
     *       mirror-cross shape holds - reusing the same {@link #classicCrossLayout}
     *       the generator seeds from, indexed 0..k in creation order exactly as
     *       computeSlotLabels maps it onto the persisted round-one matches.</li>
     *   <li><b>Later rounds</b> are labeled from the reconstructed feeder graph
     *       (the same {@code i/2} linking createSkeleton uses, byes omitted from
     *       round one), e.g. "Pobj. ČF1".</li>
     *   <li><b>Third place</b> is labeled from the two semi-finals ("Por. PF1" /
     *       "Por. PF2").</li>
     * </ul>
     * A slot with no predictable feeder (e.g. the semi-final fed only by
     * first-round byes) carries a null label, just as the skeleton would.
     */
    public List<SlotLabels> plannedSlotLabels(Tournaments t) {
        List<MatchStage> stages = plannedKnockoutStages(t);
        if (stages.isEmpty()) return List.of();

        int q = predictedQualifiers(t);
        int n = nextPowerOfTwo(q);
        int byes = n - q;

        // Round-one classic-cross layout (null unless the shape qualifies) - the
        // SAME source of truth the generator seeds from and computeSlotLabels
        // reads, so a labeled round-one sketch matches the eventual bracket.
        List<GroupDto> groups = groupStageService.standings(t.getId());
        List<int[]> crossLayout = classicCrossLayout(t, groups, n, null, q);

        // Rebuild the createSkeleton match tree in memory (identical per-round
        // counts and i/2 feeder linking, byes dropped from round one) so the
        // "Pobj." feeder labels derive from the very graph the persisted
        // skeleton would carry.
        final class Node {
            MatchStage stage;
            int indexInStage; // 1-based, like computeSlotLabels
            boolean roundOne;
            Node feeder1;     // feeds slot 1 (null when none, e.g. a bye slot)
            Node feeder2;     // feeds slot 2
        }
        int totalRounds = Integer.numberOfTrailingZeros(n); // log2(n)
        List<List<Node>> byRound = new ArrayList<>();
        int inRound = n / 2;
        for (int r = 0; r < totalRounds; r++) {
            MatchStage stage = stageFor(inRound);
            int cnt = r == 0 ? inRound - byes : inRound;
            List<Node> rm = new ArrayList<>();
            for (int i = 0; i < cnt; i++) {
                Node node = new Node();
                node.stage = stage;
                node.indexInStage = i + 1;
                node.roundOne = r == 0;
                rm.add(node);
            }
            byRound.add(rm);
            inRound /= 2;
        }
        for (int r = 0; r < totalRounds - 1; r++) {
            List<Node> cur = byRound.get(r);
            List<Node> next = byRound.get(r + 1);
            for (int i = 0; i < cur.size(); i++) {
                Node nx = next.get(i / 2);
                if (i % 2 == 0) nx.feeder1 = cur.get(i);
                else nx.feeder2 = cur.get(i);
            }
        }

        List<Node> semis = List.of();
        for (List<Node> rd : byRound) {
            if (!rd.isEmpty() && rd.get(0).stage == MatchStage.SEMIFINAL) { semis = rd; break; }
        }

        // Flat list in plannedKnockoutStages insertion order (every round in
        // build order, then the third-place playoff), then the SAME stable sort
        // by stage rank - so this lines up 1:1 with plannedKnockoutStages.
        List<Node> flat = new ArrayList<>();
        for (List<Node> rd : byRound) flat.addAll(rd);
        if (hasThirdPlace(q)) {
            Node third = new Node();
            third.stage = MatchStage.THIRD_PLACE;
            flat.add(third);
        }
        flat.sort(Comparator.comparingInt((Node node) -> knockoutStageRank(node.stage)));

        // Only the classic mirror-cross is predictable for round one; mirror
        // computeSlotLabels' guard exactly (with byes = 0 the counts always
        // match, so this is defensive).
        boolean crossApplies = crossLayout != null
                && !byRound.isEmpty() && byRound.get(0).size() == crossLayout.size();

        List<SlotLabels> out = new ArrayList<>(flat.size());
        for (Node node : flat) {
            String l1 = null, l2 = null, p1 = null, p2 = null;
            if (node.stage == MatchStage.THIRD_PLACE) {
                if (semis.size() >= 1) {
                    l1 = "L " + stageAbbrev(MatchStage.SEMIFINAL) + semis.get(0).indexInStage;
                }
                if (semis.size() >= 2) {
                    l2 = "L " + stageAbbrev(MatchStage.SEMIFINAL) + semis.get(1).indexInStage;
                }
            } else if (node.roundOne) {
                if (crossApplies) {
                    int[] pair = crossLayout.get(node.indexInStage - 1);
                    GroupDto winnerGroup = groups.get(pair[0]);
                    GroupDto runnerGroup = groups.get(pair[1]);
                    l1 = groupSlotLabel(winnerGroup, 1);
                    p1 = groupPredictedName(winnerGroup, 0);
                    l2 = groupSlotLabel(runnerGroup, 2);
                    p2 = groupPredictedName(runnerGroup, 1);
                }
            } else {
                if (node.feeder1 != null) {
                    l1 = "W " + stageAbbrev(node.feeder1.stage) + node.feeder1.indexInStage;
                }
                if (node.feeder2 != null) {
                    l2 = "W " + stageAbbrev(node.feeder2.stage) + node.feeder2.indexInStage;
                }
            }
            out.add(new SlotLabels(l1, l2, p1, p2));
        }
        return out;
    }

    /**
     * Create an empty knockout bracket skeleton (rounds of matches with null
     * teams + a third-place playoff) so a multi-day schedule can reserve
     * kickoff slots for the elimination BEFORE the group stage decides who
     * plays. No-op when a bracket already exists, when not GROUPS_KNOCKOUT, or
     * when fewer than two teams will qualify. Teams are filled in later by
     * {@link #generateBracket} - which preserves these reserved kickoffs.
     *
     * <p>Only the REAL matches get a placeholder: first-round byes and an
     * unplayable third-place playoff are skipped, so the reserved slot count
     * equals the number of matches the real bracket will actually schedule.
     */
    @Transactional
    public void createSkeleton(Tournaments t) {
        if (t.getFormat() != TournamentFormat.GROUPS_KNOCKOUT) return;
        if (matchesRepo.count("tournament = ?1 and stage <> ?2", t, MatchStage.GROUP) > 0) return;
        int q = predictedQualifiers(t);
        if (q < 2) return;
        int n = nextPowerOfTwo(q);
        // Mirror plannedKnockoutStages: (n - q) first-round pairs are BYEs
        // that never play - don't create (or reserve a slot for) them. The
        // real bracket recreates the full tree; only slot COUNTS must match.
        int byes = n - q;

        int baseNum = roundsRepo.findTopByTournamentOrderByNumberDesc(t)
                .map(Rounds::getNumber).orElse(0);
        Rounds koRound = new Rounds();
        koRound.setTournament(t);
        koRound.setNumber(baseNum + 1);
        roundsRepo.persist(koRound);

        int totalRounds = Integer.numberOfTrailingZeros(n); // log2(n)
        List<List<Matches>> byRound = new ArrayList<>();
        int inRound = n / 2;
        for (int r = 0; r < totalRounds; r++) {
            MatchStage stage = stageFor(inRound);
            int cnt = r == 0 ? inRound - byes : inRound;
            List<Matches> rm = new ArrayList<>();
            for (int i = 0; i < cnt; i++) {
                Matches m = new Matches();
                m.setTournament(t);
                m.setRound(koRound);
                m.setStage(stage);
                m.setStatus(MatchStatus.SCHEDULED);
                matchesRepo.persist(m);
                rm.add(m);
            }
            byRound.add(rm);
            inRound /= 2;
        }
        for (int r = 0; r < totalRounds - 1; r++) {
            List<Matches> cur = byRound.get(r);
            List<Matches> next = byRound.get(r + 1);
            for (int i = 0; i < cur.size(); i++) {
                cur.get(i).setNextMatch(next.get(i / 2));
                cur.get(i).setNextSlot((i % 2) + 1);
            }
        }
        if (hasThirdPlace(q)) {
            Matches third = new Matches();
            third.setTournament(t);
            third.setRound(koRound);
            third.setStage(MatchStage.THIRD_PLACE);
            third.setStatus(MatchStatus.SCHEDULED);
            matchesRepo.persist(third);
        }
    }

    /**
     * Build (or rebuild) the knockout bracket from organizer-supplied
     * first-round pairings (the manual draw). Same tree construction as
     * {@link #generateBracket}, but round one is seeded exactly as given
     * instead of auto cross-seeding - no group/qualifier logic, no same-group
     * repair (the organizer drew the pairs deliberately).
     *
     * <p>Switching to an explicit team draw discards any position-pairing
     * override: the wipe below deletes every knockout match (including a
     * skeleton carrying {@code slot*Source} tokens) and the rebuilt tree starts
     * with null sources, so the round-one position sources are cleared.
     */
    @Transactional
    public BracketDto generateBracketManual(Tournaments t, ManualBracketRequest req) {
        if (req == null || req.pairs() == null || req.pairs().isEmpty()) {
            throw new BadRequestException("No pairings provided");
        }
        // A group-stage tournament can only start the knockout once every
        // group match has a recorded result.
        if (t.getFormat() == TournamentFormat.GROUPS_KNOCKOUT) {
            long groupTotal = matchesRepo.count(
                    "tournament = ?1 and stage = ?2", t, MatchStage.GROUP);
            if (groupTotal == 0) {
                throw new BadRequestException("Generiraj raspored grupne faze prvo");
            }
            long unfinished = matchesRepo.count(
                    "tournament = ?1 and stage = ?2 and status <> ?3",
                    t, MatchStage.GROUP, MatchStatus.FINISHED);
            if (unfinished > 0) {
                throw new BadRequestException(
                        "Sve utakmice grupne faze moraju imati upisan rezultat prije eliminacije");
            }
        }
        int p = req.pairs().size();
        // p = number of first-round matches; must be a power of two for a
        // balanced single-elimination tree (1, 2, 4, 8, 16).
        if (Integer.bitCount(p) != 1) {
            throw new BadRequestException(
                    "Number of first-round matches must be a power of two (1, 2, 4, 8, …)");
        }
        int n = p * 2; // bracket size

        // Resolve every supplied id to a team of THIS tournament; reject
        // unknown ids and any team that appears in more than one slot.
        Map<Long, Teams> byId = teamsRepo.list("tournament.id", t.getId())
                .stream().collect(Collectors.toMap(Teams::getId, x -> x));
        Set<Long> used = new HashSet<>();
        List<Teams[]> roundOnePairs = new ArrayList<>();
        int teamCount = 0;
        for (ManualBracketRequest.Pairing mp : req.pairs()) {
            Teams a = resolveManualTeam(mp.team1Id(), byId, used);
            Teams b = resolveManualTeam(mp.team2Id(), byId, used);
            if (a == null && b == null) {
                throw new BadRequestException("Each match must have at least one team");
            }
            if (a != null) teamCount++;
            if (b != null) teamCount++;
            roundOnePairs.add(new Teams[]{a, b});
        }
        if (teamCount < 2) {
            throw new BadRequestException("Need at least 2 teams for a knockout bracket");
        }

        // Wipe any prior knockout matches and their now-empty rounds.
        matchesRepo.delete("tournament = ?1 and stage <> ?2", t, MatchStage.GROUP);
        matchesRepo.flush();
        for (Rounds r : roundsRepo.findByTournament_Id(t.getId())) {
            if (matchesRepo.count("round", r) == 0) roundsRepo.delete(r);
        }
        // A fresh draw invalidates any prior confirmation - the organizer must
        // re-confirm the new bracket before its matches can start / record.
        t.setBracketConfirmedAt(null);

        // One Round carries the whole knockout; stage distinguishes the rounds.
        int baseNum = roundsRepo.findTopByTournamentOrderByNumberDesc(t)
                .map(Rounds::getNumber).orElse(0);
        Rounds koRound = new Rounds();
        koRound.setTournament(t);
        koRound.setNumber(baseNum + 1);
        roundsRepo.persist(koRound);

        // Empty match tree, round by round.
        int totalRounds = Integer.numberOfTrailingZeros(n);
        List<List<Matches>> byRound = new ArrayList<>();
        int inRound = n / 2;
        for (int r = 0; r < totalRounds; r++) {
            MatchStage stage = stageFor(inRound);
            List<Matches> rm = new ArrayList<>();
            for (int i = 0; i < inRound; i++) {
                Matches m = new Matches();
                m.setTournament(t);
                m.setRound(koRound);
                m.setStage(stage);
                m.setStatus(MatchStatus.SCHEDULED);
                matchesRepo.persist(m);
                rm.add(m);
            }
            byRound.add(rm);
            inRound /= 2;
        }
        for (int r = 0; r < totalRounds - 1; r++) {
            List<Matches> cur = byRound.get(r);
            List<Matches> next = byRound.get(r + 1);
            for (int i = 0; i < cur.size(); i++) {
                cur.get(i).setNextMatch(next.get(i / 2));
                cur.get(i).setNextSlot((i % 2) + 1);
            }
        }

        // Seed round one straight from the supplied pairings.
        List<Matches> round1 = byRound.get(0);
        for (int i = 0; i < round1.size(); i++) {
            round1.get(i).setTeam1(roundOnePairs.get(i)[0]);
            round1.get(i).setTeam2(roundOnePairs.get(i)[1]);
        }

        // Third-place playoff - fed by the semi-final losers. Skipped when the
        // bracket can't produce two of them (see hasThirdPlace).
        if (hasThirdPlace(teamCount)) {
            Matches third = new Matches();
            third.setTournament(t);
            third.setRound(koRound);
            third.setStage(MatchStage.THIRD_PLACE);
            third.setStatus(MatchStatus.SCHEDULED);
            matchesRepo.persist(third);
        }

        // Resolve byes: a single-team round-one match auto-advances.
        for (Matches m : round1) {
            boolean has1 = m.getTeam1() != null;
            boolean has2 = m.getTeam2() != null;
            if (has1 ^ has2) {
                Teams w = has1 ? m.getTeam1() : m.getTeam2();
                m.setWinnerTeam(w);
                m.setStatus(MatchStatus.FINISHED);
                advanceWinner(m, w);
            }
        }

        return bracket(t.getId());
    }

    private Teams resolveManualTeam(Long id, Map<Long, Teams> byId, Set<Long> used) {
        if (id == null) return null;
        Teams tm = byId.get(id);
        if (tm == null) {
            throw new BadRequestException("Unknown team id: " + id);
        }
        if (!used.add(id)) {
            throw new BadRequestException(
                    "Team appears in more than one match: " + tm.getName());
        }
        return tm;
    }

    /* ─────────────── position-based manual pairing ────────────────── */

    /**
     * Define the round-one knockout pairings BY POSITION ("A1 vs B2") for a
     * GROUPS_KNOCKOUT tournament - the position-based manual draw. Persists an
     * organizer's custom first-round template on the skeleton so it can be set
     * at ANY time after the groups are drawn, even before the group stage
     * finishes: the classic default is the mirror cross (A1-D2), but some
     * organizers pair differently (A1-B2), and this lets them say so up front.
     *
     * <p>The request carries the FULL bracket layout: n/2 pairs for a bracket of
     * size {@code n = nextPowerOfTwo(qualifierCount)}, byes ("slobodan prolaz",
     * a pair with exactly one null slot) included as their own pairs. Real pairs
     * (both slots set) are persisted onto the round-one skeleton matches (which
     * hold only the real matches - byes are dropped from the skeleton); each bye
     * survivor is persisted onto the next-round landing slot no round-one match
     * feeds (a bye's winner arrives there), so there is somewhere to keep it even
     * though no round-one match exists for the bye.
     *
     * <p>The template drives every predicted-label display (bracket, schedule,
     * sketch) via {@link #computeSlotLabels} - the position tokens win over the
     * computed classic layout on ANY round's slot, so a bye's landing slot shows
     * its position (e.g. "B2") directly on the quarter-final card - and is
     * resolved into real teams when the bracket is drawn ({@link #generateBracket}
     * via {@link #pairsFromSources}). It survives only as long as the skeleton
     * does: a reset wipes the knockout matches and the sources with them.
     *
     * <p>Rejections (409, code in the entity body): {@code GROUPS_NOT_DRAWN}
     * when no groups exist yet; {@code BRACKET_ALREADY_DRAWN} once the bracket
     * carries real teams (the organizer must reset first);
     * {@code SKELETON_SHAPE_MISMATCH} when the persisted skeleton no longer
     * matches the planned shape (real-pair or bye counts disagree with the
     * skeleton - a redraw reconciles it). Bad pairing shape / labels are 400s:
     * wrong pair count, wrong bye count, a both-null pair, an invalid or
     * duplicated position label, or labels not covering every qualifier.
     */
    @Transactional
    public BracketDto setManualPositions(Tournaments t, ManualPositionsRequest req) {
        if (t.getFormat() != TournamentFormat.GROUPS_KNOCKOUT) {
            throw new BadRequestException(
                    "Position pairing is only for group + knockout tournaments");
        }
        if (req == null || req.pairs() == null || req.pairs().isEmpty()) {
            throw new BadRequestException("No pairings provided");
        }
        // Groups must be drawn (standings exist). The group matches may still be
        // unplayed - defining the pairing early is the whole point.
        List<GroupDto> groups = groupStageService.standings(t.getId());
        if (groups.isEmpty()) {
            throw conflict("GROUPS_NOT_DRAWN");
        }
        // Can't redefine positions once the bracket has been drawn to real
        // teams - the organizer resets the bracket first.
        if (bracketHasRealTeams(t)) {
            throw conflict("BRACKET_ALREADY_DRAWN");
        }

        // Shape: the FULL bracket layout - one pair per round-one slot pair of a
        // bracket of size n = nextPowerOfTwo(qualifierCount), i.e. n/2 pairs (the
        // same n the generator derives). Byes ("slobodan prolaz", exactly one
        // null slot) are included as their own pairs and must number n - q; a
        // pair with BOTH slots null is meaningless. The non-null labels must
        // cover every qualifier position exactly once.
        int qCount = predictedQualifiers(t);
        if (qCount < 2) {
            throw new BadRequestException("Too few qualifiers for a knockout bracket");
        }
        int n = nextPowerOfTwo(qCount);
        int expectedPairs = n / 2;
        if (req.pairs().size() != expectedPairs) {
            throw new BadRequestException(
                    "Expected " + expectedPairs + " pairings, got " + req.pairs().size());
        }
        int expectedByes = n - qCount;

        // Validate every non-null label (valid grammar for THIS tournament) and
        // that no position is used twice; count labels + byes for the totals.
        Set<String> seen = new LinkedHashSet<>();
        int labelCount = 0;
        int byeCount = 0;
        for (ManualPositionsRequest.Pair p : req.pairs()) {
            boolean s1Null = p.slot1() == null;
            boolean s2Null = p.slot2() == null;
            if (s1Null && s2Null) {
                throw new BadRequestException("A pairing cannot have two empty slots");
            }
            if (s1Null || s2Null) byeCount++; // exactly one null → a bye pair
            for (String label : new String[]{p.slot1(), p.slot2()}) {
                if (label == null) continue; // bye slot
                if (parseSlotSource(t, groups, label) == null) {
                    throw new BadRequestException("Invalid position label: " + label);
                }
                if (!seen.add(label)) {
                    throw new BadRequestException("Position used more than once: " + label);
                }
                labelCount++;
            }
        }
        if (byeCount != expectedByes) {
            throw new BadRequestException(
                    "Expected " + expectedByes + " bye pairing(s), got " + byeCount);
        }
        if (labelCount != qCount) {
            throw new BadRequestException(
                    "Positions must cover every qualifier (" + qCount + "), got " + labelCount);
        }

        // Hang the template on the skeleton (create it if the multi-day schedule
        // hasn't already reserved one).
        if (matchesRepo.count("tournament = ?1 and stage <> ?2", t, MatchStage.GROUP) == 0) {
            createSkeleton(t);
            matchesRepo.flush();
        }

        // Clear stale sources on EVERY knockout match (any round) before writing
        // - a re-save must not leave an orphaned token on a slot it no longer
        // uses (bye survivors live on next-round slots, so a shrinking bye set
        // must vacate them).
        List<Matches> allKo = matchesRepo.list(
                "tournament = ?1 and stage <> ?2 order by id", t, MatchStage.GROUP);
        for (Matches m : allKo) {
            m.setSlot1Source(null);
            m.setSlot2Source(null);
        }

        // Split the submitted layout into REAL pairs (both slots set → a played
        // round-one match) and BYE survivors (the single non-null side of a bye
        // pair), each kept in layout order.
        List<ManualPositionsRequest.Pair> realPairs = new ArrayList<>();
        List<String> byeSurvivors = new ArrayList<>();
        for (ManualPositionsRequest.Pair p : req.pairs()) {
            if (p.slot1() != null && p.slot2() != null) {
                realPairs.add(p);
            } else {
                byeSurvivors.add(p.slot1() != null ? p.slot1() : p.slot2());
            }
        }

        // Real pairs → the round-one skeleton matches, id order (the skeleton
        // holds ONLY the real matches - byes were dropped from it). A count
        // disagreement means the persisted skeleton no longer matches the
        // planned shape (e.g. the qualifier count shifted): 409, redraw needed.
        List<Matches> round1 = roundOneKnockoutMatches(t);
        if (realPairs.size() != round1.size()) {
            throw conflict("SKELETON_SHAPE_MISMATCH");
        }
        for (int i = 0; i < round1.size(); i++) {
            round1.get(i).setSlot1Source(realPairs.get(i).slot1());
            round1.get(i).setSlot2Source(realPairs.get(i).slot2());
        }

        // Bye survivors → the next-round landing slots that NO round-one match
        // feeds (a bye's winner arrives on exactly such a feeder-less slot).
        // Collected in (match id, slot) order and matched to the bye survivors
        // in layout order; the inverse mapping in pairsFromSources rebuilds each
        // bye at its layout position from the slot that carries it.
        List<SlotRef> feederLess = feederlessNextRoundSlots(t, round1);
        if (feederLess.size() != byeSurvivors.size()) {
            throw conflict("SKELETON_SHAPE_MISMATCH");
        }
        for (int i = 0; i < byeSurvivors.size(); i++) {
            SlotRef ref = feederLess.get(i);
            if (ref.slot() == 1) ref.match().setSlot1Source(byeSurvivors.get(i));
            else ref.match().setSlot2Source(byeSurvivors.get(i));
        }

        // A changed template invalidates any prior confirmation - the organizer
        // re-confirms once the (re)drawn bracket materializes.
        t.setBracketConfirmedAt(null);
        return bracket(t.getId());
    }

    /** The tournament's round-one knockout matches, id-ordered. Round one is
     *  the largest knockout stage present (the entry round) - the same entry
     *  the label helper picks, so the two agree on which matches are round one. */
    private List<Matches> roundOneKnockoutMatches(Tournaments t) {
        List<Matches> ko = matchesRepo.list(
                "tournament = ?1 and stage <> ?2 order by id", t, MatchStage.GROUP);
        if (ko.isEmpty()) return List.of();
        Map<MatchStage, List<Matches>> byStage = new EnumMap<>(MatchStage.class);
        for (Matches m : ko) byStage.computeIfAbsent(m.getStage(), k -> new ArrayList<>()).add(m);
        MatchStage[] roundOrder = {
                MatchStage.ROUND_OF_32, MatchStage.ROUND_OF_16,
                MatchStage.QUARTERFINAL, MatchStage.SEMIFINAL, MatchStage.FINAL,
        };
        for (MatchStage s : roundOrder) {
            if (byStage.containsKey(s)) return byStage.get(s);
        }
        return List.of();
    }

    /** A concrete knockout match slot: the match plus which side (1 or 2). */
    private record SlotRef(Matches match, int slot) {}

    /**
     * The next-round landing slots that NO round-one match feeds, in
     * {@code (match id, slot)} order - exactly the slots on which a round-one
     * bye's winner arrives (a bye is dropped from the skeleton, so its next-round
     * slot has no feeder). Derived from the actual {@code nextMatch}/{@code
     * nextSlot} graph the skeleton was linked with, NOT arithmetic: the round-one
     * matches announce which next-round match+slot each feeds, and every other
     * slot of that same (second-largest) stage is feeder-less. Empty when there
     * is no next round (a size-2 bracket, where round one IS the final).
     */
    private List<SlotRef> feederlessNextRoundSlots(Tournaments t, List<Matches> round1) {
        Matches anyNext = null;
        for (Matches m : round1) {
            if (m.getNextMatch() != null) { anyNext = m.getNextMatch(); break; }
        }
        if (anyNext == null) return List.of(); // n == 2: no next round
        MatchStage nextStage = anyNext.getStage();
        // Every match of the next-round stage (id order), including ones fed only
        // by byes - those simply have both slots feeder-less.
        List<Matches> nextRound = matchesRepo.list(
                "tournament = ?1 and stage = ?2 order by id", t, nextStage);
        Set<String> fed = new HashSet<>();
        for (Matches m : round1) {
            if (m.getNextMatch() != null && m.getNextSlot() != null) {
                fed.add(m.getNextMatch().getId() + ":" + m.getNextSlot());
            }
        }
        List<SlotRef> out = new ArrayList<>();
        for (Matches m : nextRound) {
            for (int slot = 1; slot <= 2; slot++) {
                if (!fed.contains(m.getId() + ":" + slot)) out.add(new SlotRef(m, slot));
            }
        }
        return out;
    }

    /**
     * Bucket a {@code (stage, slot1Source, slot2Source)} scalar projection of a
     * tournament's knockout matches by stage, each bucket keeping the projection
     * order (id order) - so the entry round (largest stage) holds the round-one
     * real-pair sources and the next stage holds the bye-survivor sources on
     * their landing slots. Both are read back by {@link #pairsFromSources} when
     * the bracket is drawn.
     */
    private static Map<MatchStage, List<String[]>> sourcesByStage(List<Object[]> koStageRows) {
        Map<MatchStage, List<String[]>> byStage = new EnumMap<>(MatchStage.class);
        for (Object[] row : koStageRows) {
            MatchStage st = (MatchStage) row[0];
            byStage.computeIfAbsent(st, k -> new ArrayList<>())
                    .add(new String[]{(String) row[1], (String) row[2]});
        }
        return byStage;
    }

    /** The knockout rounds in entry-first order ({@code ROUND_OF_32 …FINAL}),
     *  filtered to those actually present in {@code byStage}. Index 0 is the
     *  round-one (entry) stage, index 1 the next round, etc. THIRD_PLACE is not
     *  a tree round and is excluded. */
    private static List<MatchStage> koStagesInOrder(Map<MatchStage, List<String[]>> byStage) {
        MatchStage[] roundOrder = {
                MatchStage.ROUND_OF_32, MatchStage.ROUND_OF_16,
                MatchStage.QUARTERFINAL, MatchStage.SEMIFINAL, MatchStage.FINAL,
        };
        List<MatchStage> present = new ArrayList<>();
        for (MatchStage s : roundOrder) if (byStage.containsKey(s)) present.add(s);
        return present;
    }

    /** A parsed slot-source token: EITHER a group placement ({@code group} +
     *  0-based {@code placeIndex}) OR a wildcard "best next-placed" rank
     *  (1-based {@code wildcardRank}, with {@code group} null). */
    private record ParsedSource(GroupDto group, int placeIndex, int wildcardRank) {
        boolean isWildcard() { return group == null; }
    }

    /**
     * Whether a label has the wildcard-token shape {@code <digits>-<digits>}
     * (e.g. "2-1", "3-1"). A group-position label ({@link #groupSlotLabel})
     * never contains a hyphen - it is a letter/short-name followed directly by
     * the place ("A1", "D2", or a numeric group name "3" → "31") - so the hyphen
     * unambiguously marks a wildcard token. Purely structural: it does NOT check
     * the place/rank against the tournament (that is {@link #parseSlotSource}),
     * so it can prettify a token for display even after the feature is toggled.
     */
    private static boolean isWildcardToken(String label) {
        if (label == null) return false;
        int dash = label.indexOf('-');
        if (dash <= 0 || dash >= label.length() - 1) return false;
        for (int i = 0; i < label.length(); i++) {
            if (i == dash) continue;
            char c = label.charAt(i);
            if (c < '0' || c > '9') return false;
        }
        return true;
    }

    /**
     * Parse a slot-source label into its meaning, or null when it is not a
     * valid position for THIS tournament. The single source of truth for the
     * position grammar - both the validator ({@link #setManualPositions}) and
     * the resolvers go through it, so an accepted label is always resolvable:
     *
     * <ul>
     *   <li><b>Group placement</b> ("A1", "D2"): reconstructed by matching the
     *       label against the very {@link #groupSlotLabel} the classic labels
     *       emit, for every place up to that group's {@code effectiveAdvance} -
     *       so a place beyond a group's advance count (e.g. "A3" when 2 advance)
     *       is rejected.</li>
     *   <li><b>Wildcard ("best next-placed") token</b> "&lt;place&gt;-&lt;rank&gt;":
     *       the canonical {@code place} is {@code advancePerGroup + 1} - the first
     *       non-advancing spot - so "2-1" when one advances (best runner-up) and
     *       "3-1" when two do (best third). Valid only while
     *       {@code bestThirdCount > 0} and {@code 1 <= rank <= bestThirdCount}.
     *       LEGACY: the old hardcoded "3-&lt;rank&gt;" token is also accepted
     *       regardless of advance (old persisted sources / old clients) -
     *       resolution is by {@code rank} against the thirdPlacedTable only, so
     *       it stays correct whatever the place digit says.</li>
     * </ul>
     */
    private ParsedSource parseSlotSource(Tournaments t, List<GroupDto> groups, String label) {
        if (label == null) return null;
        // Wildcard token "<place>-<rank>" (place = advance+1: "2-1"/"3-1").
        if (isWildcardToken(label)) {
            int bestThird = t.getBestThirdCount() == null ? 0 : t.getBestThirdCount();
            if (bestThird <= 0) return null;
            int dash = label.indexOf('-');
            int place, rank;
            try {
                place = Integer.parseInt(label.substring(0, dash));
                rank = Integer.parseInt(label.substring(dash + 1));
            } catch (NumberFormatException e) {
                return null;
            }
            int adv = t.getAdvancePerGroup() == null ? 2 : t.getAdvancePerGroup();
            // Canonical place = advance+1; also accept the legacy "3-<rank>"
            // token (old clients / persisted sources) whatever the advance is.
            if (place != adv + 1 && place != 3) return null;
            if (rank < 1 || rank > bestThird) return null;
            return new ParsedSource(null, -1, rank);
        }
        // Group placement: match against each group's canonical slot labels.
        for (GroupDto g : groups) {
            for (int place = 1; place <= g.effectiveAdvance(); place++) {
                if (groupSlotLabel(g, place).equals(label)) {
                    return new ParsedSource(g, place - 1, -1);
                }
            }
        }
        return null;
    }

    /** Display form of a persisted slot source. A wildcard token
     *  "&lt;place&gt;-&lt;rank&gt;" is prettified to "Najbolji &lt;place&gt;-&lt;rank&gt;"
     *  (e.g. "2-1" → "Najbolji 2-1"); a group placement ("A1") is shown
     *  verbatim. Only the EMITTED label changes - the persisted 16-char source
     *  column keeps the raw canonical token. */
    private static String displaySourceLabel(String source) {
        if (source == null) return null;
        return isWildcardToken(source) ? "Najbolji " + source : source;
    }

    /**
     * Predicted team name for a slot source, or null when it can't be resolved
     * yet. A group placement resolves once THAT group is finished (early, per
     * group - the same {@link #groupPredictedName} path the classic labels
     * use); a wildcard token resolves only once EVERY group is finished (the
     * cross-group best-next-placed table isn't final until then).
     */
    private String resolveSourceName(Tournaments t, List<GroupDto> groups, String label) {
        ParsedSource ps = parseSlotSource(t, groups, label);
        if (ps == null) return null;
        if (ps.isWildcard()) {
            for (GroupDto g : groups) if (!groupComplete(g)) return null;
            for (ThirdPlacedTableDto.Row row : groupStageService.thirdPlacedTable(t).rows()) {
                if (row.rank() == ps.wildcardRank()) return row.standing().teamName();
            }
            return null;
        }
        return groupPredictedName(ps.group(), ps.placeIndex());
    }

    /**
     * Resolve a slot source to a real team using the FINAL group standings /
     * best-next-placed table (called at draw time, when the group stage is
     * complete). A group placement reads that group's standings row; a wildcard
     * token reads the ranked best-next-placed table. Null when the token can't
     * be resolved.
     */
    private Teams resolveSourceTeam(
            Tournaments t, List<GroupDto> groups, ThirdPlacedTableDto thirdTable,
            Map<Long, Teams> teamById, String label) {
        ParsedSource ps = parseSlotSource(t, groups, label);
        if (ps == null) return null;
        if (ps.isWildcard()) {
            for (ThirdPlacedTableDto.Row row : thirdTable.rows()) {
                if (row.rank() == ps.wildcardRank()) return teamById.get(row.standing().teamId());
            }
            return null;
        }
        if (ps.group().standings().size() <= ps.placeIndex()) return null;
        return teamById.get(ps.group().standings().get(ps.placeIndex()).teamId());
    }

    /**
     * The FULL round-one layout ({@code n/2} pairs) rebuilt from the organizer's
     * persisted position sources - the inverse of the persistence in
     * {@link #setManualPositions}. Two source lists feed it, both in id order:
     *
     * <ul>
     *   <li>{@code roundOneSources} - the round-one (entry stage) real-pair
     *       sources, one {@code {slot1, slot2}} per real match.</li>
     *   <li>{@code nextRoundSources} - the next stage's slot sources, where a
     *       bye survivor was parked on the landing slot no round-one match feeds.
     *       Next-round match {@code j} (id order) maps to full-layout positions
     *       {@code 2j} (slot 1) and {@code 2j+1} (slot 2) - the exact inverse of
     *       the {@code nextMatch}/{@code nextSlot} linking the tree is built with
     *       ({@code round-one position p → nextMatch p/2, nextSlot p%2+1}), so a
     *       bye placed here auto-advances back onto the very slot that carried
     *       it.</li>
     * </ul>
     *
     * <p>Each bye becomes a {@code {team, null}} pair at its derived position; the
     * remaining (non-bye) positions take the round-one real pairs in order. The
     * caller's existing tree build then auto-advances every single-team pair. A
     * non-null source that can't be resolved to a team aborts the draw with 409
     * {@code POSITIONS_UNRESOLVED}.
     */
    private List<Teams[]> pairsFromSources(
            Tournaments t, List<String[]> roundOneSources,
            List<String[]> nextRoundSources, int n) {
        List<GroupDto> groups = groupStageService.standings(t.getId());
        ThirdPlacedTableDto thirdTable = groupStageService.thirdPlacedTable(t);
        Map<Long, Teams> teamById = teamsRepo.list("tournament.id", t.getId())
                .stream().collect(Collectors.toMap(Teams::getId, x -> x));

        int half = n / 2;
        Teams[][] layout = new Teams[half][];
        // Byes: each next-round slot carrying a source is the landing slot of a
        // round-one bye; place that bye back at the round-one position feeding it.
        for (int j = 0; j < nextRoundSources.size(); j++) {
            String[] slots = nextRoundSources.get(j);
            for (int k = 1; k <= 2; k++) {
                String src = slots[k - 1];
                if (src == null) continue;
                int pos = 2 * j + (k - 1);
                if (pos >= half) continue; // defensive: skeleton wider than n
                Teams tm = resolveSourceOrThrow(t, groups, thirdTable, teamById, src);
                layout[pos] = new Teams[]{tm, null};
            }
        }
        // Real pairs fill the positions the byes left open, in order.
        int ri = 0;
        for (int pos = 0; pos < half; pos++) {
            if (layout[pos] != null) continue; // a bye already sits here
            String[] src = ri < roundOneSources.size()
                    ? roundOneSources.get(ri) : new String[]{null, null};
            ri++;
            Teams a = resolveSourceOrThrow(t, groups, thirdTable, teamById, src[0]);
            Teams b = resolveSourceOrThrow(t, groups, thirdTable, teamById, src[1]);
            layout[pos] = new Teams[]{a, b};
        }

        List<Teams[]> pairs = new ArrayList<>(half);
        for (int i = 0; i < half; i++) {
            pairs.add(layout[i] != null ? layout[i] : new Teams[]{null, null});
        }
        return pairs;
    }

    /** Resolve one source to a team, or null for a bye slot; a non-null source
     *  that fails to resolve is a 409 {@code POSITIONS_UNRESOLVED}. */
    private Teams resolveSourceOrThrow(
            Tournaments t, List<GroupDto> groups, ThirdPlacedTableDto thirdTable,
            Map<Long, Teams> teamById, String label) {
        if (label == null) return null; // bye slot
        Teams tm = resolveSourceTeam(t, groups, thirdTable, teamById, label);
        if (tm == null) throw conflict("POSITIONS_UNRESOLVED");
        return tm;
    }

    /** A 409 Conflict carrying {@code code} as its plain-text body - the same
     *  shape the other knockout conflicts ({@code GROUP_STAGE_NOT_COMPLETE},
     *  {@code BRACKET_NOT_CONFIRMED}) use. */
    private static WebApplicationException conflict(String code) {
        return new WebApplicationException(
                Response.status(Response.Status.CONFLICT).entity(code).build());
    }

    /** Whether the group stage is fully played (all group matches FINISHED).
     *  Always true for KNOCKOUT_ONLY (no group stage). */
    public boolean isGroupStageComplete(Tournaments t) {
        if (t.getFormat() != TournamentFormat.GROUPS_KNOCKOUT) return true;
        long total = matchesRepo.count("tournament = ?1 and stage = ?2", t, MatchStage.GROUP);
        if (total == 0) return false; // fixtures not generated yet
        long unfinished = matchesRepo.count(
                "tournament = ?1 and stage = ?2 and status <> ?3",
                t, MatchStage.GROUP, MatchStatus.FINISHED);
        return unfinished == 0;
    }

    /**
     * Teams the organizer may place into the manual bracket: the group
     * qualifiers (ranked, top-seed first) for GROUPS_KNOCKOUT, or the full
     * registered field for KNOCKOUT_ONLY. Empty until the group stage is
     * complete so the manual draw can't offer not-yet-qualified teams.
     */
    public List<Teams> bracketCandidates(Tournaments t) {
        if (t.getFormat() != TournamentFormat.GROUPS_KNOCKOUT) {
            // KNOCKOUT_ONLY - every registered team is a candidate, returned in
            // the deterministic seed order (manual seeds first, then by id).
            List<Teams> all = teamsRepo.list(
                    "tournament.id = ?1 and pendingApproval = false", t.getId());
            all.sort(SEED_ORDER);
            return all;
        }
        if (!isGroupStageComplete(t)) return List.of();
        return qualifiers(t);
    }

    /** Ranked list of teams that enter the bracket, best seed first. */
    private List<Teams> qualifiers(Tournaments t) {
        if (t.getFormat() == TournamentFormat.KNOCKOUT_ONLY) {
            // Deterministic: manual seeds first, then registration order. The
            // standard bracket layout (seedSlots) then yields the same pairings
            // every time for the same seed order.
            List<Teams> all = teamsRepo.list(
                    "tournament.id = ?1 and pendingApproval = false", t.getId());
            all.sort(SEED_ORDER);
            return all;
        }

        int defaultAdv = t.getAdvancePerGroup() == null ? 2 : t.getAdvancePerGroup();
        List<GroupDto> groups = groupStageService.standings(t.getId());
        if (groups.isEmpty()) {
            throw new BadRequestException("Group stage has not been drawn yet");
        }
        Map<Long, Teams> teamById = teamsRepo.list("tournament.id", t.getId())
                .stream().collect(Collectors.toMap(Teams::getId, x -> x));

        // How many advance from each group - a group's own advanceCount
        // overrides the tournament default (e.g. a 4-team group advances 2
        // while 3-team groups advance 1). The first non-advancing spot per
        // group (index = that group's advance count) feeds the best-third /
        // wildcard tiers.
        java.util.function.ToIntFunction<GroupDto> advOf = GroupDto::effectiveAdvance;
        int maxAdv = groups.stream().mapToInt(advOf).max().orElse(defaultAdv);

        // Tier by tier: every group winner first (ranked among themselves),
        // then every runner-up, etc. - group winners become the top seeds. A
        // group only contributes to a tier while that placement is below its
        // own advance count.
        List<Teams> qualified = new ArrayList<>();
        for (int placement = 0; placement < maxAdv; placement++) {
            List<GroupStandingRowDto> tier = new ArrayList<>();
            for (GroupDto g : groups) {
                if (placement < advOf.applyAsInt(g) && g.standings().size() > placement) {
                    tier.add(g.standings().get(placement));
                }
            }
            tier.sort(STANDING_RANK);
            for (GroupStandingRowDto row : tier) {
                Teams tm = teamById.get(row.teamId());
                if (tm != null) qualified.add(tm);
            }
        }

        // Best "third-placed" qualifiers: the organizer picked N best teams
        // from each group's first non-advancing tier (index = that group's
        // advance count) to also enter the bracket. They are the lowest seeds
        // (appended last), ranked across groups by points → goal difference →
        // goals scored.
        int bestThird = t.getBestThirdCount() == null ? 0 : t.getBestThirdCount();
        if (bestThird > 0) {
            List<GroupStandingRowDto> tier = new ArrayList<>();
            for (GroupDto g : groups) {
                int a = advOf.applyAsInt(g);
                if (g.standings().size() > a) tier.add(g.standings().get(a));
            }
            tier.sort(STANDING_RANK);
            for (int i = 0; i < bestThird && i < tier.size(); i++) {
                Teams tm = teamById.get(tier.get(i).teamId());
                if (tm != null && !qualified.contains(tm)) qualified.add(tm);
            }
        }

        // Wildcards: add the best next-placed teams to round the qualifier
        // count up to a power of two (no byes needed).
        if (t.getBracketFill() == BracketFill.WILDCARDS) {
            int target = nextPowerOfTwo(qualified.size());
            if (qualified.size() < target) {
                List<GroupStandingRowDto> wc = new ArrayList<>();
                for (GroupDto g : groups) {
                    int a = advOf.applyAsInt(g);
                    if (g.standings().size() > a) wc.add(g.standings().get(a));
                }
                wc.sort(STANDING_RANK);
                for (int i = 0; i < wc.size() && qualified.size() < target; i++) {
                    Teams tm = teamById.get(wc.get(i).teamId());
                    // Skip teams already taken as best-third qualifiers so the
                    // two features can't double-add the same tier team.
                    if (tm != null && !qualified.contains(tm)) qualified.add(tm);
                }
            }
        }
        return qualified;
    }

    /**
     * Persist the organizer's manual seed order for a KNOCKOUT_ONLY tournament.
     * {@code orderedTeamIds} lists every team best-seed first; each team's
     * {@code manualRank} is set to its 0-based position so the auto draw becomes
     * deterministic. Unknown/duplicate ids are skipped. Only meaningful before
     * the bracket is generated.
     */
    @Transactional
    public void setSeeds(Tournaments t, List<Long> orderedTeamIds) {
        if (orderedTeamIds == null || orderedTeamIds.isEmpty()) return;
        Map<Long, Teams> byId = teamsRepo.list("tournament.id", t.getId())
                .stream().collect(Collectors.toMap(Teams::getId, x -> x));
        int rank = 0;
        Set<Long> seen = new HashSet<>();
        for (Long id : orderedTeamIds) {
            Teams tm = byId.get(id);
            if (tm == null || !seen.add(id)) continue;
            tm.setManualRank(rank++);
        }
    }

    /* ──────────────────────────── results ────────────────────────────── */

    /**
     * Record a knockout-match result and propagate it: the winner advances
     * into the next match, and a semi-final loser drops into the third-place
     * playoff. A level score requires a (differing) penalty-shootout result.
     */
    @Transactional
    public void recordResult(Long tournamentId, Long matchId, KnockoutResultRequest req) {
        Matches m = matchesRepo.findByIdOptional(matchId)
                .orElseThrow(() -> new NotFoundException("Match not found"));
        // Scope guard: the match MUST belong to the authorized tournament.
        // Without this, an owner of any throwaway tournament could record
        // results on another tournament's matches (cross-tournament IDOR).
        if (m.getTournament() == null || !m.getTournament().getId().equals(tournamentId)) {
            throw new NotFoundException("Match not found");
        }
        if (m.getStage() == MatchStage.GROUP) {
            throw new BadRequestException("Not a knockout match");
        }
        // The bracket must be confirmed before any knockout result is recorded
        // (GROUPS_KNOCKOUT only; KNOCKOUT_ONLY has no confirmation step).
        Tournaments gate = m.getTournament();
        if (gate != null && gate.getFormat() == TournamentFormat.GROUPS_KNOCKOUT
                && gate.getBracketConfirmedAt() == null) {
            throw new WebApplicationException(
                    Response.status(Response.Status.CONFLICT)
                            .entity("BRACKET_NOT_CONFIRMED").build());
        }
        if (m.getTeam1() == null || m.getTeam2() == null) {
            throw new BadRequestException("Both teams of this match are not decided yet");
        }

        int s1 = req.score1();
        int s2 = req.score2();
        Teams winner;
        if (s1 == s2) {
            Integer p1 = req.penalties1();
            Integer p2 = req.penalties2();
            if (p1 == null || p2 == null || p1.equals(p2)) {
                throw new BadRequestException(
                        "A knockout match cannot end level - enter a penalty result");
            }
            m.setPenalties1(p1);
            m.setPenalties2(p2);
            winner = p1 > p2 ? m.getTeam1() : m.getTeam2();
        } else {
            m.setPenalties1(null);
            m.setPenalties2(null);
            winner = s1 > s2 ? m.getTeam1() : m.getTeam2();
        }
        Teams loser = winner.equals(m.getTeam1()) ? m.getTeam2() : m.getTeam1();

        m.setScore1(s1);
        m.setScore2(s2);
        m.setWinnerTeam(winner);
        m.setStatus(MatchStatus.FINISHED);
        // Recording a result counts as the tournament having started.
        if (m.getTournament() != null) m.getTournament().markStartedIfDraft();

        advanceWinner(m, winner);

        // Semi-final loser → third-place playoff. The lower-id semi-final
        // feeds slot 1, the other slot 2 - deterministic even on a re-score.
        if (m.getStage() == MatchStage.SEMIFINAL) {
            Tournaments t = m.getTournament();
            Matches third = matchesRepo.find(
                    "tournament = ?1 and stage = ?2", t, MatchStage.THIRD_PLACE).firstResult();
            if (third != null) {
                List<Matches> sfs = matchesRepo.list(
                        "tournament = ?1 and stage = ?2 order by id", t, MatchStage.SEMIFINAL);
                boolean isFirst = !sfs.isEmpty() && sfs.get(0).getId().equals(m.getId());
                if (isFirst) third.setTeam1(loser);
                else third.setTeam2(loser);
            }
        }

        // Final / third-place results populate the tournament podium.
        if (m.getStage() == MatchStage.FINAL) {
            Tournaments t = m.getTournament();
            t.setWinnerName(winner.getName());
            t.setSecondPlaceName(loser.getName());
        } else if (m.getStage() == MatchStage.THIRD_PLACE) {
            m.getTournament().setThirdPlaceName(winner.getName());
        }

        // Notify the match's bell subscribers (+ tournament bell) of the result.
        Tournaments tour = m.getTournament();
        if (tour != null) {
            String t1 = m.getTeam1() != null && m.getTeam1().getName() != null ? m.getTeam1().getName() : "?";
            String t2 = m.getTeam2() != null && m.getTeam2().getName() != null ? m.getTeam2().getName() : "?";
            String body = t1 + " " + m.getScore1() + ":" + m.getScore2() + " " + t2;
            if (m.getPenalties1() != null && m.getPenalties2() != null) {
                body += " (" + m.getPenalties1() + ":" + m.getPenalties2() + " p)";
            }
            String ref = tour.getSlug() != null && !tour.getSlug().isBlank()
                    ? tour.getSlug()
                    : (tour.getUuid() != null ? tour.getUuid().toString() : null);
            // Deep-link the finish push to the match's own page (score +
            // timeline), not the bracket tab.
            String url = ref != null ? "/turniri/" + ref + "/utakmica/" + m.getId() : null;
            try {
                pushService.sendToMatchAndTournamentSubscribers(
                        m.getId(), tour.getId(),
                        "🏁 Kraj utakmice - " + tour.getName(), body, url);
            } catch (Exception ignored) {
                // best-effort - the result is already saved.
            }
        }
    }

    private void advanceWinner(Matches m, Teams winner) {
        Matches next = m.getNextMatch();
        if (next == null) return;
        if (Integer.valueOf(1).equals(m.getNextSlot())) next.setTeam1(winner);
        else next.setTeam2(winner);
    }

    /* ──────────────────────────── read ───────────────────────────────── */

    /** The full knockout bracket for the tournament. Empty rounds before generation. */
    @Transactional
    public BracketDto bracket(Long tournamentId) {
        List<Matches> ko = matchesRepo.list(
                "tournament.id = ?1 and stage <> ?2 order by id",
                tournamentId, MatchStage.GROUP);
        Tournaments t = tournamentsRepo.findById(tournamentId);

        // Predicted-pairing labels + per-group resolved names, keyed by match id.
        // Empty for KNOCKOUT_ONLY (never labeled) or a missing tournament.
        Map<Long, SlotLabels> labels = t != null ? computeSlotLabels(t, ko) : Map.of();

        Map<MatchStage, List<Matches>> byStage = new LinkedHashMap<>();
        Matches third = null;
        for (Matches m : ko) {
            if (m.getStage() == MatchStage.THIRD_PLACE) {
                third = m;
                continue;
            }
            byStage.computeIfAbsent(m.getStage(), k -> new ArrayList<>()).add(m);
        }

        MatchStage[] order = {
                MatchStage.ROUND_OF_32, MatchStage.ROUND_OF_16,
                MatchStage.QUARTERFINAL, MatchStage.SEMIFINAL, MatchStage.FINAL,
        };
        List<BracketRoundDto> rounds = new ArrayList<>();
        for (MatchStage s : order) {
            List<Matches> ms = byStage.get(s);
            if (ms == null || ms.isEmpty()) continue;
            List<BracketMatchDto> dtos = ms.stream().map(m -> toDto(m, labels)).toList();
            rounds.add(new BracketRoundDto(s.name(), stageTitle(s), dtos));
        }
        // Only GROUPS_KNOCKOUT gates its knockout behind a confirmation.
        boolean confirmationRequired =
                t != null && t.getFormat() == TournamentFormat.GROUPS_KNOCKOUT;
        java.time.OffsetDateTime confirmedAt = t != null ? t.getBracketConfirmedAt() : null;
        return new BracketDto(
                rounds,
                third == null ? null : toDto(third, labels),
                confirmedAt,
                confirmationRequired);
    }

    private BracketMatchDto toDto(Matches m, Map<Long, SlotLabels> labels) {
        SlotLabels sl = labels.get(m.getId());
        return new BracketMatchDto(
                m.getId(),
                m.getStage().name(),
                m.getTeam1() != null ? m.getTeam1().getId() : null,
                m.getTeam1() != null ? m.getTeam1().getName() : null,
                m.getTeam2() != null ? m.getTeam2().getId() : null,
                m.getTeam2() != null ? m.getTeam2().getName() : null,
                m.getScore1(), m.getScore2(),
                m.getPenalties1(), m.getPenalties2(),
                m.getWinnerTeam() != null ? m.getWinnerTeam().getId() : null,
                m.getStatus() != null ? m.getStatus().name() : null,
                m.getLiveMode() != null ? m.getLiveMode().name() : null,
                m.getLiveStartedAt(),
                m.getFirstHalfEndedAt(),
                m.getSecondHalfStartedAt(),
                m.getLivePausedAt(),
                m.getKickoffAt(),
                m.getFouls1First(),
                m.getFouls1Second(),
                m.getFouls2First(),
                m.getFouls2Second(),
                sl != null ? sl.slot1Label() : null,
                sl != null ? sl.slot2Label() : null,
                sl != null ? sl.slot1PredictedName() : null,
                sl != null ? sl.slot2PredictedName() : null);
    }

    /* ─────────────────────── predicted-pairing labels ─────────────────── */

    /**
     * Predicted-pairing labels (and, for a finished group, resolved team names)
     * for every knockout slot of the tournament, keyed by match id. Loads the
     * tournament's knockout matches itself; use the same query as
     * {@link #bracket} so the two produce identical labels. KNOCKOUT_ONLY gets
     * feeder labels only ("W O2", "L PF1" - no group positions to predict).
     */
    public Map<Long, SlotLabels> knockoutSlotLabels(Tournaments t) {
        List<Matches> ko = matchesRepo.list(
                "tournament.id = ?1 and stage <> ?2 order by id", t.getId(), MatchStage.GROUP);
        return computeSlotLabels(t, ko);
    }

    /**
     * Compute the slot labels for {@code ko} (a tournament's knockout matches,
     * ordered by id). A slot is labeled only while its real team is still null
     * and the match is not a bye:
     *
     * <p>A persisted position source ({@link #setManualPositions}) WINS on ANY
     * round's slot: its {@link #displaySourceLabel pretty} form is emitted as
     * the label - a group placement ("B2") verbatim, a wildcard token
     * ("2-1"/"3-1") as "Najbolji 2-1" - and resolved to a predicted name once
     * its group / best-next-placed table settles; the computed labels below
     * never overwrite it. Round-one real pairs carry their sources on the
     * round-one matches; a round-one bye's survivor carries its source on the
     * next-round landing slot it advances onto, so that card shows the bye's
     * position directly. Otherwise:
     *
     * <ul>
     *   <li><b>Round one</b> (the largest stage present) is labeled "A1" / "D2"
     *       style ONLY when the classic mirror-cross shape holds - the exact same
     *       {@link #classicCrossLayout} the generator seeds from, so the label
     *       order is provably identical to the generated pairing order. Its
     *       predicted name is filled once THAT group has finished all its
     *       matches (groups complete per-group, not the whole stage).</li>
     *   <li><b>Later rounds</b> are labeled from the {@code nextMatch} graph: the
     *       feeder match's stage abbreviation + its 1-based index among same-stage
     *       matches ordered by id, e.g. "Pobj. ČF1" - but only on a slot with no
     *       persisted source.</li>
     *   <li><b>Third place</b> is labeled from the two semi-final losers,
     *       "Por. PF1" / "Por. PF2" (lower-id semi-final feeds slot 1).</li>
     * </ul>
     *
     * <p>Non-classic round-one shapes are standings-dependent and therefore not
     * predictable, so a source-less slot there carries no round-one label.
     * KNOCKOUT_ONLY carries no label at all. Purely derived - nothing is
     * persisted.
     */
    private Map<Long, SlotLabels> computeSlotLabels(Tournaments t, List<Matches> ko) {
        Map<Long, SlotLabels> out = new HashMap<>();
        if (ko.isEmpty()) return out;

        // Bucket by stage (each bucket stays id-ordered, since ko is id-ordered)
        // and pick the entry round = the largest stage present.
        Map<MatchStage, List<Matches>> byStage = new EnumMap<>(MatchStage.class);
        for (Matches m : ko) byStage.computeIfAbsent(m.getStage(), k -> new ArrayList<>()).add(m);
        MatchStage[] roundOrder = {
                MatchStage.ROUND_OF_32, MatchStage.ROUND_OF_16,
                MatchStage.QUARTERFINAL, MatchStage.SEMIFINAL, MatchStage.FINAL,
        };
        MatchStage entry = null;
        for (MatchStage s : roundOrder) {
            if (byStage.containsKey(s)) { entry = s; break; }
        }

        // 1-based index of every match within its own stage (byes included, so
        // the index is a stable "ČF1/ČF2/…" ordinal regardless of who plays).
        Map<Long, Integer> indexInStage = new HashMap<>();
        for (List<Matches> bucket : byStage.values()) {
            for (int i = 0; i < bucket.size(); i++) indexInStage.put(bucket.get(i).getId(), i + 1);
        }

        // Feeder lookup: which match feeds slot 1 / slot 2 of a given next match.
        Map<Long, Matches> feederSlot1 = new HashMap<>();
        Map<Long, Matches> feederSlot2 = new HashMap<>();
        for (Matches m : ko) {
            if (m.getNextMatch() == null || m.getNextSlot() == null) continue;
            Long nid = m.getNextMatch().getId();
            if (Integer.valueOf(1).equals(m.getNextSlot())) feederSlot1.put(nid, m);
            else feederSlot2.put(nid, m);
        }

        // Round-one classic-cross layout (null unless the shape qualifies).
        // KNOCKOUT_ONLY has no groups: skip the standings fetch - round one is
        // real teams there, and every LATER round still gets its feeder labels
        // ("W O2", "L PF1") from the nextMatch graph below.
        List<GroupDto> groups = t.getFormat() == TournamentFormat.GROUPS_KNOCKOUT
                ? groupStageService.standings(t.getId())
                : List.of();
        int q = predictedQualifiers(t);
        int n = q >= 2 ? nextPowerOfTwo(q) : 0;
        List<int[]> crossLayout = (entry != null && n >= 2)
                ? classicCrossLayout(t, groups, n, null, q) : null;
        List<Matches> entryMatches = entry != null ? byStage.get(entry) : null;
        boolean crossApplies = crossLayout != null && entryMatches != null
                && entryMatches.size() == crossLayout.size();

        List<Matches> semis = byStage.getOrDefault(MatchStage.SEMIFINAL, List.of());

        for (Matches m : ko) {
            if (m.isKnockoutBye()) continue; // byes are never labeled
            boolean s1Null = m.getTeam1() == null;
            boolean s2Null = m.getTeam2() == null;
            if (!s1Null && !s2Null) continue; // both teams known → nothing to label

            // A persisted position source WINS on ANY round's slot: round-one
            // real pairs carry their sources on the round-one matches, while a
            // bye survivor carries its source on the next-round landing slot it
            // auto-advances onto - so the quarter-final (etc.) card shows the
            // bye's position ("B2") directly. It also makes a round-one slot
            // labeled even in a non-classic shape, and the computed labels below
            // (classic cross, feeder "Pobj."/"Por.") must NOT overwrite it.
            boolean s1HasSource = m.getSlot1Source() != null;
            boolean s2HasSource = m.getSlot2Source() != null;
            String l1 = null, l2 = null, p1 = null, p2 = null;
            // Emit the pretty label for the persisted source: a group placement
            // ("A1") shows verbatim, a wildcard token ("2-1"/"3-1") shows as
            // "Najbolji 2-1". The raw token stays only in the DB column.
            if (s1Null && s1HasSource) {
                l1 = displaySourceLabel(m.getSlot1Source());
                p1 = resolveSourceName(t, groups, m.getSlot1Source());
            }
            if (s2Null && s2HasSource) {
                l2 = displaySourceLabel(m.getSlot2Source());
                p2 = resolveSourceName(t, groups, m.getSlot2Source());
            }

            if (m.getStage() == entry) {
                // Classic mirror-cross fills only the slots WITHOUT a source.
                if (crossApplies && ((s1Null && !s1HasSource) || (s2Null && !s2HasSource))) {
                    int idx = indexInStage.getOrDefault(m.getId(), 0) - 1;
                    if (idx >= 0 && idx < crossLayout.size()) {
                        int[] pair = crossLayout.get(idx);
                        GroupDto winnerGroup = groups.get(pair[0]);
                        GroupDto runnerGroup = groups.get(pair[1]);
                        if (s1Null && !s1HasSource) {
                            l1 = groupSlotLabel(winnerGroup, 1);
                            p1 = groupPredictedName(winnerGroup, 0);
                        }
                        if (s2Null && !s2HasSource) {
                            l2 = groupSlotLabel(runnerGroup, 2);
                            p2 = groupPredictedName(runnerGroup, 1);
                        }
                    }
                }
            } else if (m.getStage() == MatchStage.THIRD_PLACE) {
                // Third place is fed (in recordResult) by the two semi-final
                // losers: lower-id semi-final → slot 1, the other → slot 2.
                if (s1Null && !s1HasSource && semis.size() >= 1) {
                    l1 = "L " + stageAbbrev(MatchStage.SEMIFINAL)
                            + indexInStage.get(semis.get(0).getId());
                }
                if (s2Null && !s2HasSource && semis.size() >= 2) {
                    l2 = "L " + stageAbbrev(MatchStage.SEMIFINAL)
                            + indexInStage.get(semis.get(1).getId());
                }
            } else {
                // Any later round: label each empty, source-less slot from its
                // feeder match. A slot carrying a bye source keeps that source.
                Matches f1 = feederSlot1.get(m.getId());
                Matches f2 = feederSlot2.get(m.getId());
                if (s1Null && !s1HasSource && f1 != null) {
                    l1 = "W " + stageAbbrev(f1.getStage()) + indexInStage.get(f1.getId());
                }
                if (s2Null && !s2HasSource && f2 != null) {
                    l2 = "W " + stageAbbrev(f2.getStage()) + indexInStage.get(f2.getId());
                }
            }
            if (l1 != null || l2 != null || p1 != null || p2 != null) {
                out.put(m.getId(), new SlotLabels(l1, l2, p1, p2));
            }
        }
        return out;
    }

    /** Round-one slot label for a group + placement: the group's own name when
     *  it is short (&lt;= 3 chars), else its letter by ordinal (A=0, B=1, …),
     *  suffixed with the 1-based place (winner "A1", runner-up "D2"). */
    private static String groupSlotLabel(GroupDto g, int place) {
        String base = (g.name() != null && g.name().length() <= 3)
                ? g.name()
                : String.valueOf((char) ('A' + g.ordinal()));
        return base + place;
    }

    /** Predicted team name for a group's placement (0-based standings index)
     *  once that group has finished all its matches, else null. Shared by the
     *  bracket labels ({@link #computeSlotLabels}) and the schedule sketch
     *  ({@link #plannedSlotLabels}) so both resolve round-one qualifiers the
     *  same way. */
    private static String groupPredictedName(GroupDto g, int placeIndex) {
        if (!groupComplete(g) || g.standings().size() <= placeIndex) return null;
        return g.standings().get(placeIndex).teamName();
    }

    /** Whether every one of a group's matches has finished - a group completes
     *  on its own, before the whole group stage does, so its round-one
     *  qualifiers can be resolved early. */
    private static boolean groupComplete(GroupDto g) {
        if (g.matches() == null || g.matches().isEmpty()) return false;
        for (GroupMatchDto gm : g.matches()) {
            if (!MatchStatus.FINISHED.name().equals(gm.status())) return false;
        }
        return true;
    }

    /** Short knockout-stage code, used in feeder labels ("W Š1", "W O2",
     *  "W ČF1", "L PF2"): Š = šesnaestina (R32), O = osmina (R16), ČF, PF, F. */
    private static String stageAbbrev(MatchStage s) {
        return switch (s) {
            case ROUND_OF_32 -> "Š";
            case ROUND_OF_16 -> "O";
            case QUARTERFINAL -> "ČF";
            case SEMIFINAL -> "PF";
            case FINAL -> "F";
            // GROUP / THIRD_PLACE never feed another slot.
            default -> "";
        };
    }

    /* ──────────────────────────── helpers ────────────────────────────── */

    /**
     * Whether a third-place playoff is playable for the given qualifier count.
     * It is fed by the TWO semi-final losers, so it needs two REAL semi-finals.
     * With {@code q} qualifiers in a bracket of size {@code nextPowerOfTwo(q)}
     * the byes all sit in round one, so: {@code q=2} has no semi-final at all
     * and {@code q=3} leaves one semi-final a bye (no loser - the other
     * semi-final's loser IS third). From 4 qualifiers up both semi-finals are
     * always real. Below that the match could never be played, so it must not
     * be created - it would sit in the schedule forever as an unplayable
     * "TBD" fixture.
     */
    private static boolean hasThirdPlace(int qualifiers) {
        return qualifiers >= 4;
    }

    /** Smallest power of two that is >= n (and >= 2). */
    private static int nextPowerOfTwo(int n) {
        int p = 2;
        while (p < n) p <<= 1;
        return p;
    }

    /** Knockout stage for a round that contains the given number of matches. */
    private static MatchStage stageFor(int matchesInRound) {
        return switch (matchesInRound) {
            case 16 -> MatchStage.ROUND_OF_32;
            case 8 -> MatchStage.ROUND_OF_16;
            case 4 -> MatchStage.QUARTERFINAL;
            case 2 -> MatchStage.SEMIFINAL;
            case 1 -> MatchStage.FINAL;
            // Brackets larger than 32 are out of scope for futsal tournaments;
            // fall back to the largest named round.
            default -> MatchStage.ROUND_OF_32;
        };
    }

    private static String stageTitle(MatchStage s) {
        return switch (s) {
            case ROUND_OF_32 -> "Šesnaestina finala";
            case ROUND_OF_16 -> "Osmina finala";
            case QUARTERFINAL -> "Četvrtfinale";
            case SEMIFINAL -> "Polufinale";
            case FINAL -> "Finale";
            case THIRD_PLACE -> "Za 3. mjesto";
            case GROUP -> "Grupa";
        };
    }

    /**
     * Standard seeded-bracket slot order for a bracket of size n (a power of
     * two). Each consecutive pair of returned seed numbers is one round-one
     * match - e.g. n=8 → [1,8,4,5,2,7,3,6], so matches are 1v8, 4v5, 2v7, 3v6.
     * This keeps the top seeds in opposite halves/quarters of the bracket.
     */
    private static int[] seedSlots(int n) {
        int[] order = {1};
        while (order.length < n) {
            int size = order.length * 2;
            int[] next = new int[size];
            for (int i = 0; i < order.length; i++) {
                next[2 * i] = order[i];
                next[2 * i + 1] = size + 1 - order[i];
            }
            order = next;
        }
        return order;
    }

    /** Round-one pairs straight from a seed-ordered team list, laid out on the
     *  standard bracket slots (seed s meets seed n+1-s); seeds beyond the team
     *  count are byes (null side). */
    private static List<Teams[]> pairsFromSeedOrder(List<Teams> seedOrder, int n) {
        int q = seedOrder.size();
        int[] slots = seedSlots(n);
        List<Teams[]> pairs = new ArrayList<>();
        for (int i = 0; i < n / 2; i++) {
            int seedA = slots[2 * i];
            int seedB = slots[2 * i + 1];
            pairs.add(new Teams[]{
                    seedA <= q ? seedOrder.get(seedA - 1) : null,
                    seedB <= q ? seedOrder.get(seedB - 1) : null});
        }
        return pairs;
    }

    /* ─────────────── deterministic group cross-pairing ────────────────── */

    /**
     * Round-one pairings for a GROUPS_KNOCKOUT bracket. Fully deterministic -
     * the same group standings always produce the identical bracket (no
     * shuffling of any kind). Two strategies:
     *
     * <p><b>Classic mirror cross</b> - when exactly two advance per group with
     * no extra qualifiers and no byes (group count 2, 4, 8, …): the winner of
     * group i plays the runner-up of the mirror group (last-first). Four
     * groups → QF: A1-D2, C1-B2, B1-C2, D1-A2; SF: W(A1-D2)-W(C1-B2) and
     * W(B1-C2)-W(D1-A2) - so two teams of the same group can only meet again
     * in the final.
     *
     * <p><b>Constraint seeding</b> - every other shape (best-third qualifiers,
     * byes, wildcards, advance ≠ 2, group count not a power of two). Teams
     * keep their performance-ranked seed tiers (winners are the top seeds,
     * then runners-up, then the best next-placed) but are permuted WITHIN a
     * tier so that: (1) round one never pairs two teams of the same group -
     * e.g. a best-third qualifier never meets the winner of its own group;
     * (2) group-mates land in opposite bracket halves (meet in the final at
     * the earliest) whenever mathematically possible, relaxing gradually
     * (semi-final, quarter-final, …) only when it is not. With three groups
     * of which two advance plus two best thirds, this yields: the two
     * best-ranked group winners each play a third-placed team from another
     * group, the remaining winner plays the weakest runner-up (other group),
     * and the two remaining runners-up play each other.
     */
    private List<Teams[]> groupRoundOnePairs(
            Tournaments t, List<Teams> qs, List<Long> byeTeamIds, int n) {
        List<GroupDto> groups = groupStageService.standings(t.getId());

        List<Teams[]> classic = classicCrossPairs(t, qs, byeTeamIds, groups, n);
        if (classic != null) return classic;

        // Seed tier of every team = its placement in its group (0 = winner).
        // Organizer-chosen bye teams sit in front of the list as their own
        // tier (-1) so the search can't move them off the bye seeds.
        Map<Long, Integer> tierOf = new HashMap<>();
        for (GroupDto g : groups) {
            for (int r = 0; r < g.standings().size(); r++) {
                tierOf.put(g.standings().get(r).teamId(), r);
            }
        }
        Set<Long> byeSet = byeTeamIds == null ? Set.of() : new HashSet<>(byeTeamIds);
        int[] classOf = new int[qs.size()];
        for (int i = 0; i < qs.size(); i++) {
            Long id = qs.get(i).getId();
            classOf[i] = byeSet.contains(id) ? -1
                    : tierOf.getOrDefault(id, Integer.MAX_VALUE);
        }
        return pairsFromSeedOrder(constraintSeed(qs, classOf, n), n);
    }

    /**
     * The classic mirror cross-pairing resolved to teams, or null when this
     * bracket shape doesn't qualify for it (see {@link #groupRoundOnePairs}).
     * Delegates the shape check and slot ordering to {@link #classicCrossLayout}
     * - the same layout the predicted-pairing labels read - then fills each slot
     * with the group's winner / runner-up, so the generated pairing order and
     * the "A1 / D2" label order can never diverge.
     */
    private List<Teams[]> classicCrossPairs(
            Tournaments t, List<Teams> qs, List<Long> byeTeamIds,
            List<GroupDto> groups, int n) {
        List<int[]> layout = classicCrossLayout(t, groups, n, byeTeamIds, qs.size());
        if (layout == null) return null;

        Map<Long, Teams> byId = qs.stream()
                .collect(Collectors.toMap(Teams::getId, x -> x));
        List<Teams[]> ordered = new ArrayList<>();
        for (int[] pair : layout) {
            // pair = {winnerGroupIndex, runnerUpGroupIndex}.
            Teams winner = byId.get(groups.get(pair[0]).standings().get(0).teamId());
            Teams second = byId.get(groups.get(pair[1]).standings().get(1).teamId());
            if (winner == null || second == null) return null;
            ordered.add(new Teams[]{winner, second});
        }
        return ordered;
    }

    /**
     * The classic mirror-cross layout as ordered slot pairs, or null when the
     * bracket shape doesn't qualify for it. Each entry is
     * {@code {winnerGroupIndex, runnerUpGroupIndex}} into {@code groups}: match i
     * pairs the winner of group i with the runner-up of group (G-1-i), then the
     * matches are laid out via {@link #interleaveOrder} so each pair of mirror
     * matches (which share two groups) lands in opposite bracket halves. Four
     * groups → order [0, 2, 1, 3]: [A1-D2, C1-B2 | B1-C2, D1-A2].
     *
     * <p>The single source of truth for the classic shape: the generator
     * ({@link #classicCrossPairs}) seeds teams from it AND the label helper
     * ({@link #computeSlotLabels}) reads labels from it, so pairing order and
     * label order are provably identical. Only holds when exactly two advance
     * per group, no best-thirds and no manual byes, group count a power of two,
     * and {@code qualifierCount == 2 * groupCount == n}.
     */
    private List<int[]> classicCrossLayout(
            Tournaments t, List<GroupDto> groups, int n,
            List<Long> byeTeamIds, int qualifierCount) {
        int adv = t.getAdvancePerGroup() == null ? 2 : t.getAdvancePerGroup();
        int bestThird = t.getBestThirdCount() == null ? 0 : t.getBestThirdCount();
        if (adv != 2 || bestThird != 0) return null;
        if (byeTeamIds != null && !byeTeamIds.isEmpty()) return null;
        int g = groups.size();
        // Needs exactly 2 qualifiers from each of the G groups filling the
        // whole bracket (2G a power of two → G = 2, 4, 8, …).
        if (g < 2 || qualifierCount != 2 * g || n != qualifierCount) return null;
        for (GroupDto grp : groups) {
            // Every group must advance EXACTLY two (its effective count, so a
            // per-group override that makes the field uneven - e.g. one group of
            // three - falls through to constraint seeding). Without this the
            // label helper would predict a cross that the generator never draws.
            if (grp.effectiveAdvance() != 2 || grp.standings().size() < 2) return null;
        }
        List<int[]> matches = new ArrayList<>();
        for (int i = 0; i < g; i++) {
            matches.add(new int[]{i, g - 1 - i});
        }
        List<int[]> ordered = new ArrayList<>();
        for (int idx : interleaveOrder(g)) ordered.add(matches.get(idx));
        return ordered;
    }

    /** [0..count-1] recursively interleaved: evens first, then odds -
     *  e.g. 4 → [0, 2, 1, 3]; 8 → [0, 4, 2, 6, 1, 5, 3, 7]. */
    private static List<Integer> interleaveOrder(int count) {
        List<Integer> idx = new ArrayList<>();
        for (int i = 0; i < count; i++) idx.add(i);
        return interleave(idx);
    }

    private static List<Integer> interleave(List<Integer> in) {
        if (in.size() <= 1) return in;
        List<Integer> evens = new ArrayList<>();
        List<Integer> odds = new ArrayList<>();
        for (int k = 0; k < in.size(); k++) {
            (k % 2 == 0 ? evens : odds).add(in.get(k));
        }
        List<Integer> out = new ArrayList<>(interleave(evens));
        out.addAll(interleave(odds));
        return out;
    }

    /**
     * Deterministically permute the qualifiers WITHIN their seed tiers
     * ({@code classOf} - non-decreasing over the list) so that same-group
     * teams are spread as far apart in the bracket as possible.
     *
     * <p>Per group the ideal separation is computed from its qualifier count
     * (2 mates → opposite halves, 3-4 → different quarters, …) and relaxed
     * one round at a time until an assignment exists; not pairing same-group
     * teams in round one is the last constraint to go (practically always
     * satisfiable). The first valid assignment in tier-rank order is chosen -
     * no randomness, so the result is stable across regenerations.
     */
    private List<Teams> constraintSeed(List<Teams> qs, int[] classOf, int n) {
        int q = qs.size();
        int[] slots = seedSlots(n);
        int[] posOfSeed = new int[n + 1];
        for (int i = 0; i < n; i++) posOfSeed[slots[i]] = i;
        int rounds = Integer.numberOfTrailingZeros(n); // log2(n)

        Map<Long, Integer> counts = new HashMap<>();
        for (Teams tm : qs) {
            Long g = groupIdOf(tm);
            if (g != null) counts.merge(g, 1, Integer::sum);
        }
        // minMeet: same-group teams may first meet in this round or later
        // (1 = round one allowed, rounds = final only).
        Map<Long, Integer> minMeet = new HashMap<>();
        for (Map.Entry<Long, Integer> e : counts.entrySet()) {
            int cnt = e.getValue();
            int spread = 32 - Integer.numberOfLeadingZeros(cnt - 1); // ceil(log2)
            minMeet.put(e.getKey(), Math.min(rounds, Math.max(2, rounds - spread + 1)));
        }

        while (true) {
            Teams[] out = new Teams[q];
            int[] budget = {500_000}; // search-node cap; overrun → relax
            if (placeSeed(0, qs, classOf, posOfSeed, minMeet, out, new boolean[q], budget)) {
                return new ArrayList<>(Arrays.asList(out));
            }
            boolean relaxed = false;
            for (Map.Entry<Long, Integer> e : minMeet.entrySet()) {
                if (e.getValue() > 2) { e.setValue(e.getValue() - 1); relaxed = true; }
            }
            if (!relaxed) {
                boolean lowered = false;
                for (Map.Entry<Long, Integer> e : minMeet.entrySet()) {
                    if (e.getValue() > 1) { e.setValue(1); lowered = true; }
                }
                if (!lowered) return qs; // constraint-free - keep base order
            }
        }
    }

    /** Depth-first assignment of seed index {@code i}: try the remaining teams
     *  of that seed's tier in rank order, keeping every same-group pair at or
     *  beyond its {@code minMeet} round. First full assignment wins. */
    private boolean placeSeed(
            int i, List<Teams> qs, int[] classOf, int[] posOfSeed,
            Map<Long, Integer> minMeet, Teams[] out, boolean[] used, int[] budget) {
        if (i == qs.size()) return true;
        if (--budget[0] < 0) return false;
        for (int j = 0; j < qs.size(); j++) {
            if (used[j] || classOf[j] != classOf[i]) continue;
            Teams cand = qs.get(j);
            Long g = groupIdOf(cand);
            boolean ok = true;
            if (g != null) {
                int need = minMeet.getOrDefault(g, 1);
                for (int k = 0; k < i && ok; k++) {
                    if (g.equals(groupIdOf(out[k]))
                            && meetRound(posOfSeed[i + 1], posOfSeed[k + 1]) < need) {
                        ok = false;
                    }
                }
            }
            if (!ok) continue;
            used[j] = true;
            out[i] = cand;
            if (placeSeed(i + 1, qs, classOf, posOfSeed, minMeet, out, used, budget)) {
                return true;
            }
            used[j] = false;
            out[i] = null;
        }
        return false;
    }

    /** The round (1 = round one, log2(n) = final) in which the two bracket
     *  slot positions would first meet. */
    private static int meetRound(int p1, int p2) {
        int k = 1;
        while ((p1 >> k) != (p2 >> k)) k++;
        return k;
    }

    private static Long groupIdOf(Teams t) {
        return t != null && t.getGroup() != null ? t.getGroup().getId() : null;
    }
}
