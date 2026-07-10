package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.dtos.BracketDto;
import hr.mrodek.apps.futsal_turniri.dtos.BracketMatchDto;
import hr.mrodek.apps.futsal_turniri.dtos.BracketRoundDto;
import hr.mrodek.apps.futsal_turniri.dtos.GroupDto;
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
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;
import jakarta.ws.rs.BadRequestException;
import jakarta.ws.rs.NotFoundException;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
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
    @Inject GroupStageService groupStageService;
    @Inject PushService pushService;

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
            List<BracketMatchDto> dtos = ms.stream().map(this::toDto).toList();
            rounds.add(new BracketRoundDto(s.name(), stageTitle(s), dtos));
        }
        return new BracketDto(rounds, third == null ? null : toDto(third));
    }

    private BracketMatchDto toDto(Matches m) {
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
                m.getFouls2Second());
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
     * The classic mirror cross-pairing, or null when this bracket shape
     * doesn't qualify for it (see {@link #groupRoundOnePairs}). Match i pairs
     * the winner of group i with the runner-up of group (G-1-i); matches are
     * laid out so that each pair of mirror matches (which share two groups)
     * ends up in opposite bracket halves.
     */
    private List<Teams[]> classicCrossPairs(
            Tournaments t, List<Teams> qs, List<Long> byeTeamIds,
            List<GroupDto> groups, int n) {
        int adv = t.getAdvancePerGroup() == null ? 2 : t.getAdvancePerGroup();
        int bestThird = t.getBestThirdCount() == null ? 0 : t.getBestThirdCount();
        if (adv != 2 || bestThird != 0) return null;
        if (byeTeamIds != null && !byeTeamIds.isEmpty()) return null;
        int g = groups.size();
        // Needs exactly 2 qualifiers from each of the G groups filling the
        // whole bracket (2G a power of two → G = 2, 4, 8, …).
        if (g < 2 || qs.size() != 2 * g || n != qs.size()) return null;
        for (GroupDto grp : groups) {
            if (grp.standings().size() < 2) return null;
        }

        Map<Long, Teams> byId = qs.stream()
                .collect(Collectors.toMap(Teams::getId, x -> x));
        Teams[] winner = new Teams[g];
        Teams[] second = new Teams[g];
        for (int i = 0; i < g; i++) {
            winner[i] = byId.get(groups.get(i).standings().get(0).teamId());
            second[i] = byId.get(groups.get(i).standings().get(1).teamId());
            if (winner[i] == null || second[i] == null) return null;
        }
        List<Teams[]> matches = new ArrayList<>();
        for (int i = 0; i < g; i++) {
            matches.add(new Teams[]{winner[i], second[g - 1 - i]});
        }
        // Interleaved order: even-indexed matches fill the first half of the
        // bracket, odd the second (recursively), so match i and its mirror
        // match G-1-i - the only two carrying the same groups - are always in
        // opposite halves. Four groups → order [0, 2, 1, 3]:
        // [A1-D2, C1-B2 | B1-C2, D1-A2].
        List<Teams[]> ordered = new ArrayList<>();
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
