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
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import hr.mrodek.apps.futsal_turniri.dtos.ManualBracketRequest;

/**
 * Knockout-bracket engine (Phase E3).
 *
 * <p>Generates a single-elimination bracket from the group qualifiers (or
 * all teams, for KNOCKOUT_ONLY), seeds it with standard cross-seeding,
 * links each match to the next via {@code nextMatch}/{@code nextSlot}, and
 * propagates winners (and semi-final losers into the third-place match) as
 * results are recorded. A third-place playoff is always created.
 */
@ApplicationScoped
public class KnockoutService {

    @Inject TeamsRepository teamsRepo;
    @Inject MatchesRepository matchesRepo;
    @Inject RoundsRepository roundsRepo;
    @Inject GroupStageService groupStageService;

    /** Group-standings ranking used to seed qualifiers within a placement tier. */
    private static final Comparator<GroupStandingRowDto> STANDING_RANK =
            Comparator.comparingInt(GroupStandingRowDto::points).reversed()
                    .thenComparing(Comparator.comparingInt(GroupStandingRowDto::goalDiff).reversed())
                    .thenComparing(Comparator.comparingInt(GroupStandingRowDto::goalsFor).reversed());

    /* ─────────────────────────── generation ──────────────────────────── */

    /**
     * Build (or rebuild) the knockout bracket and return it. Re-runnable —
     * any existing knockout matches are wiped first.
     */
    @Transactional
    public BracketDto generateBracket(Tournaments t) {
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

        // Wipe any prior knockout matches and their now-empty rounds.
        matchesRepo.delete("tournament = ?1 and stage <> ?2", t, MatchStage.GROUP);
        matchesRepo.flush();
        for (Rounds r : roundsRepo.findByTournament_Id(t.getId())) {
            if (matchesRepo.count("round", r) == 0) roundsRepo.delete(r);
        }

        int q = qs.size();
        int n = nextPowerOfTwo(q); // bracket size

        // One Round entity carries the whole knockout — `stage` distinguishes
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

        // Seed round one. Seed s (1-based) → the s-th-best qualifier; seeds
        // beyond the qualifier count are byes (null opponent).
        int[] slots = seedSlots(n);
        List<Matches> round1 = byRound.get(0);
        for (int i = 0; i < round1.size(); i++) {
            int seedA = slots[2 * i];
            int seedB = slots[2 * i + 1];
            round1.get(i).setTeam1(seedA <= q ? qs.get(seedA - 1) : null);
            round1.get(i).setTeam2(seedB <= q ? qs.get(seedB - 1) : null);
        }
        if (t.getFormat() == TournamentFormat.GROUPS_KNOCKOUT) {
            repairSameGroup(round1);
        }

        // Third-place playoff — fed by the semi-final losers.
        Matches third = new Matches();
        third.setTournament(t);
        third.setRound(koRound);
        third.setStage(MatchStage.THIRD_PLACE);
        third.setStatus(MatchStatus.SCHEDULED);
        matchesRepo.persist(third);

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

        return bracket(t.getId());
    }

    /**
     * Build (or rebuild) the knockout bracket from organizer-supplied
     * first-round pairings (the manual draw). Same tree construction as
     * {@link #generateBracket}, but round one is seeded exactly as given
     * instead of auto cross-seeding — no group/qualifier logic, no same-group
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

        // Third-place playoff — fed by the semi-final losers.
        Matches third = new Matches();
        third.setTournament(t);
        third.setRound(koRound);
        third.setStage(MatchStage.THIRD_PLACE);
        third.setStatus(MatchStatus.SCHEDULED);
        matchesRepo.persist(third);

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
            // KNOCKOUT_ONLY — every registered team is a candidate (no random
            // shuffle here; this is a picker, not the auto draw).
            return teamsRepo.list(
                    "tournament.id = ?1 and pendingApproval = false", t.getId());
        }
        if (!isGroupStageComplete(t)) return List.of();
        return qualifiers(t);
    }

    /** Ranked list of teams that enter the bracket, best seed first. */
    private List<Teams> qualifiers(Tournaments t) {
        if (t.getFormat() == TournamentFormat.KNOCKOUT_ONLY) {
            List<Teams> all = teamsRepo.list(
                    "tournament.id = ?1 and pendingApproval = false", t.getId());
            Collections.shuffle(all); // no groups → random seeding for the auto draw
            return all;
        }

        int adv = t.getAdvancePerGroup() == null ? 2 : t.getAdvancePerGroup();
        List<GroupDto> groups = groupStageService.standings(t.getId());
        if (groups.isEmpty()) {
            throw new BadRequestException("Group stage has not been drawn yet");
        }
        Map<Long, Teams> teamById = teamsRepo.list("tournament.id", t.getId())
                .stream().collect(Collectors.toMap(Teams::getId, x -> x));

        // Tier by tier: every group winner first (ranked among themselves),
        // then every runner-up, etc. — group winners become the top seeds.
        List<Teams> qualified = new ArrayList<>();
        for (int placement = 0; placement < adv; placement++) {
            List<GroupStandingRowDto> tier = new ArrayList<>();
            for (GroupDto g : groups) {
                if (g.standings().size() > placement) {
                    tier.add(g.standings().get(placement));
                }
            }
            tier.sort(STANDING_RANK);
            for (GroupStandingRowDto row : tier) {
                Teams tm = teamById.get(row.teamId());
                if (tm != null) qualified.add(tm);
            }
        }

        // Wildcards: add the best next-placed teams to round the qualifier
        // count up to a power of two (no byes needed).
        if (t.getBracketFill() == BracketFill.WILDCARDS) {
            int target = nextPowerOfTwo(qualified.size());
            if (qualified.size() < target) {
                List<GroupStandingRowDto> wc = new ArrayList<>();
                for (GroupDto g : groups) {
                    if (g.standings().size() > adv) wc.add(g.standings().get(adv));
                }
                wc.sort(STANDING_RANK);
                int need = target - qualified.size();
                for (int i = 0; i < need && i < wc.size(); i++) {
                    Teams tm = teamById.get(wc.get(i).teamId());
                    if (tm != null) qualified.add(tm);
                }
            }
        }
        return qualified;
    }

    /* ──────────────────────────── results ────────────────────────────── */

    /**
     * Record a knockout-match result and propagate it: the winner advances
     * into the next match, and a semi-final loser drops into the third-place
     * playoff. A level score requires a (differing) penalty-shootout result.
     */
    @Transactional
    public void recordResult(Long matchId, KnockoutResultRequest req) {
        Matches m = matchesRepo.findByIdOptional(matchId)
                .orElseThrow(() -> new NotFoundException("Match not found"));
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
                        "A knockout match cannot end level — enter a penalty result");
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

        advanceWinner(m, winner);

        // Semi-final loser → third-place playoff. The lower-id semi-final
        // feeds slot 1, the other slot 2 — deterministic even on a re-score.
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
                m.getSecondHalfStartedAt(),
                m.getKickoffAt(),
                m.getFouls1First(),
                m.getFouls1Second(),
                m.getFouls2First(),
                m.getFouls2Second());
    }

    /* ──────────────────────────── helpers ────────────────────────────── */

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
     * match — e.g. n=8 → [1,8,4,5,2,7,3,6], so matches are 1v8, 4v5, 2v7, 3v6.
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

    /**
     * Best-effort fix so two teams from the same group don't meet again in
     * round one: when a match pairs same-group teams, swap one side with
     * another match's same-side team if that resolves the clash.
     */
    private void repairSameGroup(List<Matches> round1) {
        for (int i = 0; i < round1.size(); i++) {
            Matches m = round1.get(i);
            if (m.getTeam1() == null || m.getTeam2() == null) continue;
            if (!sameGroup(m.getTeam1(), m.getTeam2())) continue;
            for (int j = 0; j < round1.size(); j++) {
                if (j == i) continue;
                Matches o = round1.get(j);
                if (o.getTeam2() == null) continue;
                Teams a = m.getTeam2();
                Teams b = o.getTeam2();
                if (!sameGroup(m.getTeam1(), b)
                        && (o.getTeam1() == null || !sameGroup(o.getTeam1(), a))) {
                    m.setTeam2(b);
                    o.setTeam2(a);
                    break;
                }
            }
        }
    }

    private boolean sameGroup(Teams a, Teams b) {
        return a != null && b != null
                && a.getGroup() != null && b.getGroup() != null
                && a.getGroup().getId().equals(b.getGroup().getId());
    }
}
