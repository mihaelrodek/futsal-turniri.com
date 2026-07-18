package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.dtos.BracketDto;
import hr.mrodek.apps.futsal_turniri.dtos.BracketMatchDto;
import hr.mrodek.apps.futsal_turniri.dtos.BracketRoundDto;
import hr.mrodek.apps.futsal_turniri.dtos.GroupDto;
import hr.mrodek.apps.futsal_turniri.dtos.GroupMatchDto;
import hr.mrodek.apps.futsal_turniri.dtos.GroupStandingRowDto;
import hr.mrodek.apps.futsal_turniri.dtos.KnockoutResultRequest;
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
        List<java.time.OffsetDateTime> reservedKickoffs = matchesRepo.getEntityManager()
                .createQuery(
                        "select m.kickoffAt from Matches m "
                                + "where m.tournament = ?1 and m.stage <> ?2 "
                                + "and m.kickoffAt is not null "
                                + "and not (m.status = ?3 and (m.team1 is null or m.team2 is null)) "
                                + "order by m.kickoffAt",
                        java.time.OffsetDateTime.class)
                .setParameter(1, t)
                .setParameter(2, MatchStage.GROUP)
                .setParameter(3, MatchStatus.FINISHED)
                .getResultList();

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

        // Seed round one. GROUPS_KNOCKOUT gets the deterministic group
        // cross-pairing; KNOCKOUT_ONLY the plain standard seeding (seed s vs
        // seed n+1-s). Seeds beyond the qualifier count are byes.
        List<Teams[]> roundOnePairs = t.getFormat() == TournamentFormat.GROUPS_KNOCKOUT
                ? groupRoundOnePairs(t, qs, byeTeamIds, n)
                : pairsFromSeedOrder(qs, n);
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
     * placeholders, in bracket play order (earlier rounds first; third place
     * before the final). Keeps the schedule's day split after the real bracket
     * replaces the skeleton. No-op when nothing was reserved.
     */
    private void applyReservedKickoffs(Tournaments t, List<java.time.OffsetDateTime> reserved) {
        if (reserved == null || reserved.isEmpty()) return;
        List<Matches> ko = matchesRepo.list("tournament = ?1 and stage <> ?2", t, MatchStage.GROUP);
        // BYEs are never played and never appear in the schedule - handing them
        // a reserved slot would leave a real match without one (the skeleton
        // reserves exactly the number of REAL knockout matches).
        ko.removeIf(Matches::isKnockoutBye);
        ko.sort(Comparator
                .comparingInt((Matches m) -> knockoutStageRank(m.getStage()))
                .thenComparingLong(m -> m.getId() != null ? m.getId() : 0L));
        for (int i = 0; i < ko.size() && i < reserved.size(); i++) {
            ko.get(i).setKickoffAt(reserved.get(i));
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
                    l1 = "Por. " + stageAbbrev(MatchStage.SEMIFINAL) + semis.get(0).indexInStage;
                }
                if (semis.size() >= 2) {
                    l2 = "Por. " + stageAbbrev(MatchStage.SEMIFINAL) + semis.get(1).indexInStage;
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
                    l1 = "Pobj. " + stageAbbrev(node.feeder1.stage) + node.feeder1.indexInStage;
                }
                if (node.feeder2 != null) {
                    l2 = "Pobj. " + stageAbbrev(node.feeder2.stage) + node.feeder2.indexInStage;
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
     * {@link #bracket} so the two produce identical labels. Empty map for
     * KNOCKOUT_ONLY - that format is never labeled.
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
     * <ul>
     *   <li><b>Round one</b> (the largest stage present) is labeled "A1" / "D2"
     *       style ONLY when the classic mirror-cross shape holds - the exact same
     *       {@link #classicCrossLayout} the generator seeds from, so the label
     *       order is provably identical to the generated pairing order. Its
     *       predicted name is filled once THAT group has finished all its
     *       matches (groups complete per-group, not the whole stage).</li>
     *   <li><b>Later rounds</b> are always labeled from the {@code nextMatch}
     *       graph: the feeder match's stage abbreviation + its 1-based index
     *       among same-stage matches ordered by id, e.g. "Pobj. ČF1".</li>
     *   <li><b>Third place</b> is labeled from the two semi-final losers,
     *       "Por. PF1" / "Por. PF2" (lower-id semi-final feeds slot 1).</li>
     * </ul>
     *
     * <p>Non-classic round-one shapes are standings-dependent and therefore not
     * predictable, so they carry no round-one label. KNOCKOUT_ONLY carries no
     * label at all. Purely derived - nothing is persisted.
     */
    private Map<Long, SlotLabels> computeSlotLabels(Tournaments t, List<Matches> ko) {
        Map<Long, SlotLabels> out = new HashMap<>();
        if (ko.isEmpty() || t.getFormat() != TournamentFormat.GROUPS_KNOCKOUT) return out;

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
        List<GroupDto> groups = groupStageService.standings(t.getId());
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

            String l1 = null, l2 = null, p1 = null, p2 = null;
            if (m.getStage() == entry) {
                // Round one: only the classic mirror-cross is predictable.
                if (crossApplies) {
                    int idx = indexInStage.getOrDefault(m.getId(), 0) - 1;
                    if (idx >= 0 && idx < crossLayout.size()) {
                        int[] pair = crossLayout.get(idx);
                        GroupDto winnerGroup = groups.get(pair[0]);
                        GroupDto runnerGroup = groups.get(pair[1]);
                        if (s1Null) {
                            l1 = groupSlotLabel(winnerGroup, 1);
                            p1 = groupPredictedName(winnerGroup, 0);
                        }
                        if (s2Null) {
                            l2 = groupSlotLabel(runnerGroup, 2);
                            p2 = groupPredictedName(runnerGroup, 1);
                        }
                    }
                }
            } else if (m.getStage() == MatchStage.THIRD_PLACE) {
                // Third place is fed (in recordResult) by the two semi-final
                // losers: lower-id semi-final → slot 1, the other → slot 2.
                if (s1Null && semis.size() >= 1) {
                    l1 = "Por. " + stageAbbrev(MatchStage.SEMIFINAL)
                            + indexInStage.get(semis.get(0).getId());
                }
                if (s2Null && semis.size() >= 2) {
                    l2 = "Por. " + stageAbbrev(MatchStage.SEMIFINAL)
                            + indexInStage.get(semis.get(1).getId());
                }
            } else {
                // Any later round: label each empty slot from its feeder match.
                Matches f1 = feederSlot1.get(m.getId());
                Matches f2 = feederSlot2.get(m.getId());
                if (s1Null && f1 != null) {
                    l1 = "Pobj. " + stageAbbrev(f1.getStage()) + indexInStage.get(f1.getId());
                }
                if (s2Null && f2 != null) {
                    l2 = "Pobj. " + stageAbbrev(f2.getStage()) + indexInStage.get(f2.getId());
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

    /** Short Croatian abbreviation for a knockout stage, used in feeder labels
     *  ("Pobj. ČF1", "Por. PF2"). */
    private static String stageAbbrev(MatchStage s) {
        return switch (s) {
            case ROUND_OF_32 -> "1/16";
            case ROUND_OF_16 -> "OF";
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
