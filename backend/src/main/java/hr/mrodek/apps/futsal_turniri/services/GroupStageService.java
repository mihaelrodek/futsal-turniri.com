package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.dtos.DrawRequest;
import hr.mrodek.apps.futsal_turniri.dtos.GroupDto;
import hr.mrodek.apps.futsal_turniri.dtos.GroupMatchDto;
import hr.mrodek.apps.futsal_turniri.dtos.GroupStandingRowDto;
import hr.mrodek.apps.futsal_turniri.dtos.ThirdPlacedTableDto;
import hr.mrodek.apps.futsal_turniri.enums.MatchStage;
import hr.mrodek.apps.futsal_turniri.enums.MatchStatus;
import hr.mrodek.apps.futsal_turniri.enums.TournamentFormat;
import hr.mrodek.apps.futsal_turniri.model.Groups;
import hr.mrodek.apps.futsal_turniri.model.Matches;
import hr.mrodek.apps.futsal_turniri.model.Rounds;
import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.repository.GroupsRepository;
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
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Group-stage engine for GROUPS_KNOCKOUT tournaments (Phase E2).
 *
 * <p>Responsibilities:
 * <ul>
 *   <li>draw registered teams into groups - random ({@code AUTO}) or from an
 *       organizer-supplied placement ({@code MANUAL});</li>
 *   <li>generate single round-robin fixtures within each group via the
 *       circle method, laid out into shared matchdays;</li>
 *   <li>compute live group standings with UEFA-style head-to-head
 *       tiebreakers.</li>
 * </ul>
 */
@ApplicationScoped
public class GroupStageService {

    @Inject TeamsRepository teamsRepo;
    @Inject GroupsRepository groupsRepo;
    @Inject RoundsRepository roundsRepo;
    @Inject MatchesRepository matchesRepo;

    /* ───────────────────────── draw + fixtures ───────────────────────── */

    /**
     * Draw the registered teams into groups - groups + team placement ONLY,
     * no fixtures. The group matches are created later, when the organizer
     * generates the schedule on the Raspored tab ({@link #generateFixtures}).
     * Re-runnable: wipes any existing groups, group-stage matches and matchday
     * rounds first, so the organizer can redo the draw.
     */
    @Transactional
    public void draw(Tournaments t, DrawRequest req) {
        if (t.getFormat() != TournamentFormat.GROUPS_KNOCKOUT) {
            throw new BadRequestException("Tournament format is not GROUPS_KNOCKOUT");
        }
        // Group count + advance-per-group are chosen at draw time. Persist them
        // on the tournament so the bracket / standings know how many advance.
        Integer reqGroupCount = req != null ? req.groupCount() : null;
        int groupCount = reqGroupCount != null ? reqGroupCount
                : (t.getGroupCount() != null ? t.getGroupCount() : 0);
        if (groupCount < 2) {
            throw new BadRequestException("Need at least 2 groups");
        }
        t.setGroupCount(groupCount);
        if (req != null && req.advancePerGroup() != null) {
            if (req.advancePerGroup() < 1) {
                throw new BadRequestException("At least 1 team must advance per group");
            }
            t.setAdvancePerGroup(req.advancePerGroup());
        }
        // How many best next-placed ("third") teams also advance. Clamp to
        // [0, groupCount] - at most one such team can come from each group.
        if (req != null && req.bestThirdCount() != null) {
            t.setBestThirdCount(Math.max(0, Math.min(req.bestThirdCount(), groupCount)));
        } else {
            t.setBestThirdCount(0);
        }

        // Registered teams = everything except still-pending self-registrations.
        List<Teams> teams = teamsRepo.list(
                "tournament.id = ?1 and pendingApproval = false", t.getId());
        if (teams.size() < groupCount) {
            throw new BadRequestException(
                    "Need at least " + groupCount + " teams for " + groupCount + " groups");
        }

        // Wipe any previous group stage. NOTE (Phase E2): a tournament at this
        // point only has GROUP matches and matchday rounds, so clearing all
        // rounds is safe. Revisit when E3 adds knockout rounds.
        matchesRepo.delete("tournament = ?1 and stage = ?2", t, MatchStage.GROUP);
        roundsRepo.deleteByTournament(t);
        for (Teams tm : teams) tm.setGroup(null);
        groupsRepo.deleteByTournamentId(t.getId());
        groupsRepo.flush();

        // Create the groups: A, B, C, …
        List<Groups> groups = new ArrayList<>();
        for (int i = 0; i < groupCount; i++) {
            Groups g = new Groups(t, groupLabel(i), i);
            groupsRepo.persist(g);
            groups.add(g);
        }

        assignTeams(teams, groups, req);
        // Fixtures are intentionally NOT generated here - see generateFixtures.
    }

    /**
     * Undo the group draw - deletes every group-stage match, removes the
     * now-empty matchday rounds, clears each team's group assignment and
     * deletes the groups. The knockout bracket (if already generated) is left
     * untouched. Backs the "Resetiraj" action on the Grupe tab.
     */
    @Transactional
    public void resetGroups(Tournaments t) {
        matchesRepo.delete("tournament = ?1 and stage = ?2", t, MatchStage.GROUP);
        matchesRepo.flush();
        for (Rounds r : roundsRepo.findByTournament_Id(t.getId())) {
            if (matchesRepo.count("round", r) == 0) roundsRepo.delete(r);
        }
        for (Teams tm : teamsRepo.list("tournament.id = ?1", t.getId())) {
            tm.setGroup(null);
        }
        groupsRepo.deleteByTournamentId(t.getId());
        groupsRepo.flush();
    }

    /**
     * Delete the generated group-stage fixtures (and their now-empty matchday
     * rounds) but KEEP the groups / draw - so "Očisti raspored" returns to the
     * groups-drawn state and the schedule can be regenerated. Only not-yet-
     * played matches are removed.
     */
    @Transactional
    public void clearFixtures(Tournaments t) {
        matchesRepo.delete(
                "tournament = ?1 and stage = ?2 and status = ?3",
                t, MatchStage.GROUP, MatchStatus.SCHEDULED);
        matchesRepo.flush();
        for (Rounds r : roundsRepo.findByTournament_Id(t.getId())) {
            if (matchesRepo.count("round", r) == 0) roundsRepo.delete(r);
        }
    }

    /**
     * Generate the round-robin group fixtures for an already-drawn group
     * stage. Called when the organizer generates the schedule. Idempotent and
     * non-destructive: if group matches already exist it does nothing (so a
     * re-generated schedule never wipes played results), and if no groups have
     * been drawn it is a no-op.
     */
    @Transactional
    public void generateFixtures(Tournaments t) {
        long existing = matchesRepo.count(
                "tournament = ?1 and stage = ?2", t, MatchStage.GROUP);
        if (existing > 0) return; // already generated - keep results intact
        List<Groups> groups = groupsRepo.findByTournamentIdOrderByOrdinal(t.getId());
        if (groups.isEmpty()) return; // not drawn yet (or KNOCKOUT_ONLY)
        buildGroupFixtures(t, groups);
    }

    /** Places teams into groups - manual placement or a random auto draw.
     *  Each team's {@code drawPosition} is set to its 0-based order within the
     *  group so the round-robin fixtures follow the organizer's arrangement. */
    private void assignTeams(List<Teams> teams, List<Groups> groups, DrawRequest req) {
        boolean manual = req != null
                && req.mode() == DrawRequest.Mode.MANUAL
                && req.assignments() != null;

        if (manual) {
            Map<Long, Teams> byId = teams.stream()
                    .collect(Collectors.toMap(Teams::getId, x -> x));
            // Per-group running counter: teams keep the order they appear in the
            // assignments list (which the board sends in drag/display order).
            int[] posInGroup = new int[groups.size()];
            for (DrawRequest.Assignment a : req.assignments()) {
                Teams tm = byId.get(a.teamId());
                if (tm == null) continue;
                int ord = a.groupOrdinal();
                if (ord < 0 || ord >= groups.size()) {
                    throw new BadRequestException("Invalid group ordinal: " + ord);
                }
                tm.setGroup(groups.get(ord));
                tm.setDrawPosition(posInGroup[ord]++);
            }
            for (Teams tm : teams) {
                if (tm.getGroup() == null) {
                    throw new BadRequestException(
                            "Team not assigned to a group: " + tm.getName());
                }
            }
        } else {
            // AUTO - shuffle, then spread round-robin so group sizes differ
            // by at most one (13 teams, 4 groups → 4+3+3+3). Position within a
            // group = the cycle index (i / groupCount).
            List<Teams> shuffled = new ArrayList<>(teams);
            Collections.shuffle(shuffled);
            for (int i = 0; i < shuffled.size(); i++) {
                shuffled.get(i).setGroup(groups.get(i % groups.size()));
                shuffled.get(i).setDrawPosition(i / groups.size());
            }
        }
    }

    /** A group's teams in draw-board order (the arrangement the organizer made),
     *  falling back to id for any legacy team without a draw position. */
    private List<Teams> groupTeamsInDrawOrder(Long groupId) {
        return teamsRepo.list(
                "group.id = ?1 order by drawPosition nulls last, id", groupId);
    }

    /** Builds the single round-robin fixtures for every group. */
    private void buildGroupFixtures(Tournaments t, List<Groups> groups) {
        // Round-robin schedule per group; track the longest so we know how
        // many shared matchday rounds to create.
        Map<Long, List<List<Teams[]>>> schedules = new HashMap<>();
        int maxMatchdays = 0;
        for (Groups g : groups) {
            List<Teams> gt = groupTeamsInDrawOrder(g.getId());
            List<List<Teams[]>> sched = roundRobin(gt);
            schedules.put(g.getId(), sched);
            maxMatchdays = Math.max(maxMatchdays, sched.size());
        }

        // One Round per matchday, shared across groups (matchday 1 = round 1).
        List<Rounds> rounds = new ArrayList<>();
        for (int md = 0; md < maxMatchdays; md++) {
            Rounds r = new Rounds();
            r.setTournament(t);
            r.setNumber(md + 1);
            roundsRepo.persist(r);
            rounds.add(r);
        }

        for (Groups g : groups) {
            List<List<Teams[]>> sched = schedules.get(g.getId());
            for (int md = 0; md < sched.size(); md++) {
                Rounds round = rounds.get(md);
                for (Teams[] pair : sched.get(md)) {
                    Matches m = new Matches();
                    m.setTournament(t);
                    m.setRound(round);
                    m.setStage(MatchStage.GROUP);
                    m.setGroup(g);
                    m.setTeam1(pair[0]);
                    m.setTeam2(pair[1]);
                    m.setStatus(MatchStatus.SCHEDULED);
                    matchesRepo.persist(m);
                }
            }
        }
    }

    /**
     * Single round-robin pairings via the circle method. Returns a list of
     * matchdays; each matchday is a list of {@code [home, away]} pairs.
     * A group with an odd team count gets a rotating bye (no match emitted).
     */
    private List<List<Teams[]>> roundRobin(List<Teams> teams) {
        List<Teams> arr = new ArrayList<>(teams);
        if (arr.size() % 2 != 0) arr.add(null); // bye placeholder
        int n = arr.size();
        List<List<Teams[]>> result = new ArrayList<>();
        if (n < 2) return result;

        List<Teams> rot = new ArrayList<>(arr);
        for (int md = 0; md < n - 1; md++) {
            List<Teams[]> day = new ArrayList<>();
            for (int i = 0; i < n / 2; i++) {
                Teams a = rot.get(i);
                Teams b = rot.get(n - 1 - i);
                if (a != null && b != null) day.add(new Teams[]{a, b});
            }
            result.add(day);
            // Rotate: first element fixed, everything else rotates one step.
            List<Teams> next = new ArrayList<>();
            next.add(rot.get(0));
            next.add(rot.get(n - 1));
            for (int i = 1; i < n - 1; i++) next.add(rot.get(i));
            rot = next;
        }
        return result;
    }

    /**
     * In-memory group fixtures in single-court play order (round-robin per
     * group, interleaved across groups A, B, C…), WITHOUT persisting anything.
     * Used by the multi-day schedule preview so it can show/count group matches
     * before they're generated. Deterministic and identical to the order
     * {@code generateFixtures} + {@code orderForSingleCourt} produce, so the
     * preview lines up with the eventual generated schedule. Each element is a
     * {@code Teams[]{team1, team2}} pair (both carry their group).
     */
    public List<Teams[]> plannedGroupFixtures(Tournaments t) {
        List<Groups> groups = groupsRepo.findByTournamentIdOrderByOrdinal(t.getId());
        List<List<Teams[]>> perGroup = new ArrayList<>();
        for (Groups g : groups) {
            List<Teams> gt = groupTeamsInDrawOrder(g.getId());
            List<Teams[]> flat = new ArrayList<>();
            for (List<Teams[]> round : roundRobin(gt)) flat.addAll(round);
            perGroup.add(flat);
        }
        // Interleave: one match from each group per cycle (A1, B1, C1, A2, …).
        List<Teams[]> result = new ArrayList<>();
        boolean any = true;
        for (int idx = 0; any; idx++) {
            any = false;
            for (List<Teams[]> gp : perGroup) {
                if (idx < gp.size()) { result.add(gp.get(idx)); any = true; }
            }
        }
        return result;
    }

    private static String groupLabel(int ordinal) {
        // A..Z, then AA, AB, … for the (very unlikely) >26 groups case.
        StringBuilder sb = new StringBuilder();
        int n = ordinal;
        do {
            sb.insert(0, (char) ('A' + (n % 26)));
            n = n / 26 - 1;
        } while (n >= 0);
        return sb.toString();
    }

    /* ───────────────────────────── standings ─────────────────────────── */

    /** Computed standings for every group of the tournament, best team first. */
    @Transactional
    public List<GroupDto> standings(Long tournamentId) {
        List<Groups> groups = groupsRepo.findByTournamentIdOrderByOrdinal(tournamentId);
        List<GroupDto> out = new ArrayList<>();
        for (Groups g : groups) {
            // Draw-board order: before any match is played the table shows the
            // teams in the order the organizer arranged them.
            List<Teams> teams = groupTeamsInDrawOrder(g.getId());
            // Ordered by id ≈ matchday/play order so the per-team "Last 5"
            // form ends up chronological.
            List<Matches> finished = matchesRepo.list(
                    "group.id = ?1 and status = ?2 order by id", g.getId(), MatchStatus.FINISHED);

            List<Row> rows = new ArrayList<>();
            for (Teams tm : teams) rows.add(buildRow(tm, finished));
            rankRows(rows, finished);

            // Manual override: once the organizer has reordered the group by hand
            // (all teams carry a manual_rank), respect that order instead of the
            // computed points/H2H ranking - used to settle tiebreakers.
            boolean allManual = !teams.isEmpty()
                    && teams.stream().allMatch(t -> t.getManualRank() != null);
            if (allManual) {
                Map<Long, Integer> manual = teams.stream()
                        .collect(Collectors.toMap(Teams::getId, Teams::getManualRank));
                rows.sort(Comparator.comparingInt(r -> manual.getOrDefault(r.teamId, 0)));
            }

            List<GroupStandingRowDto> dto = new ArrayList<>();
            for (Row r : rows) dto.add(r.toDto());

            List<GroupMatchDto> matchDtos = new ArrayList<>();
            for (Matches m : matchesRepo.list("group.id = ?1 order by id", g.getId())) {
                matchDtos.add(new GroupMatchDto(
                        m.getId(),
                        m.getTeam1() != null ? m.getTeam1().getId() : null,
                        m.getTeam1() != null ? m.getTeam1().getName() : null,
                        m.getTeam2() != null ? m.getTeam2().getId() : null,
                        m.getTeam2() != null ? m.getTeam2().getName() : null,
                        m.getScore1(), m.getScore2(),
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
                        m.getFouls2Second()));
            }
            out.add(new GroupDto(g.getId(), g.getName(), g.getOrdinal(), dto, matchDtos));
        }
        return out;
    }

    /**
     * Cross-group ranking of the best next-placed ("third-placed") teams for
     * the {@code bestThirdCount} feature. Takes the team at index
     * {@code advancePerGroup} from every group (the first non-qualifying spot),
     * ranks them by points → goal difference → goals scored, and flags the top
     * {@code bestThirdCount} as qualifying. Rows are empty when the feature is
     * off or no group has a team in that tier yet.
     */
    @Transactional
    public ThirdPlacedTableDto thirdPlacedTable(Tournaments t) {
        int adv = t.getAdvancePerGroup() == null ? 2 : t.getAdvancePerGroup();
        int bestThird = t.getBestThirdCount() == null ? 0 : t.getBestThirdCount();

        List<GroupDto> groups = standings(t.getId());
        // Pair each tier team with its group label, then rank across groups.
        record Tier(GroupStandingRowDto row, String group) {}
        List<Tier> tier = new ArrayList<>();
        for (GroupDto g : groups) {
            if (g.standings().size() > adv) {
                tier.add(new Tier(g.standings().get(adv), g.name()));
            }
        }
        tier.sort(Comparator
                .comparingInt((Tier x) -> x.row().points()).reversed()
                .thenComparing(Comparator.comparingInt((Tier x) -> x.row().goalDiff()).reversed())
                .thenComparing(Comparator.comparingInt((Tier x) -> x.row().goalsFor()).reversed()));

        List<ThirdPlacedTableDto.Row> rows = new ArrayList<>();
        for (int i = 0; i < tier.size(); i++) {
            rows.add(new ThirdPlacedTableDto.Row(
                    i + 1, i < bestThird, tier.get(i).group(), tier.get(i).row()));
        }
        return new ThirdPlacedTableDto(adv, bestThird, rows);
    }

    /**
     * Record a group-match result. Group matches may end level; the winner
     * (or null for a draw) is set and the standings recompute live.
     */
    @Transactional
    public void recordGroupResult(Long tournamentId, Long matchId, int score1, int score2) {
        Matches m = matchesRepo.findByIdOptional(matchId)
                .orElseThrow(() -> new NotFoundException("Match not found"));
        // Scope guard: the match MUST belong to the authorized tournament
        // (prevents cross-tournament IDOR on group results).
        if (m.getTournament() == null || !m.getTournament().getId().equals(tournamentId)) {
            throw new NotFoundException("Match not found");
        }
        if (m.getStage() != MatchStage.GROUP) {
            throw new BadRequestException("Not a group match");
        }
        if (m.getTeam1() == null || m.getTeam2() == null) {
            throw new BadRequestException("Both teams of this match are not set");
        }
        m.setScore1(score1);
        m.setScore2(score2);
        if (score1 > score2) m.setWinnerTeam(m.getTeam1());
        else if (score2 > score1) m.setWinnerTeam(m.getTeam2());
        else m.setWinnerTeam(null); // draw
        m.setStatus(MatchStatus.FINISHED);
        // Recording a result counts as the tournament having started.
        if (m.getTournament() != null) m.getTournament().markStartedIfDraft();
    }

    /**
     * Manually reorder a group's standings. {@code orderedTeamIds} must list
     * every team of the group exactly once, best team first; each team's
     * {@code manualRank} is set to its 0-based position. Only allowed once all
     * of the group's matches are finished (the override exists to settle a
     * tiebreaker, which only makes sense on a complete group).
     */
    @Transactional
    public void reorderGroup(Long tournamentId, Long groupId, List<Long> orderedTeamIds) {
        Groups g = groupsRepo.findByIdOptional(groupId)
                .orElseThrow(() -> new NotFoundException("Group not found"));
        // Scope guard: the group MUST belong to the authorized tournament
        // (prevents cross-tournament IDOR that could re-seed another
        // tournament's qualifiers).
        if (g.getTournament() == null || !g.getTournament().getId().equals(tournamentId)) {
            throw new NotFoundException("Group not found");
        }
        List<Teams> teams = teamsRepo.list("group.id", g.getId());

        long unfinished = matchesRepo.count(
                "group.id = ?1 and status != ?2", g.getId(), MatchStatus.FINISHED);
        if (unfinished > 0) {
            throw new BadRequestException(
                    "Sve utakmice u skupini moraju biti odigrane prije ručne izmjene poretka");
        }

        Map<Long, Teams> byId = teams.stream()
                .collect(Collectors.toMap(Teams::getId, x -> x));
        if (orderedTeamIds == null || orderedTeamIds.size() != teams.size()) {
            throw new BadRequestException("Poredak mora sadržavati sve ekipe skupine");
        }
        Set<Long> seen = new HashSet<>();
        int rank = 0;
        for (Long id : orderedTeamIds) {
            Teams tm = byId.get(id);
            if (tm == null || !seen.add(id)) {
                throw new BadRequestException("Nevažeća ekipa u poretku skupine");
            }
            tm.setManualRank(rank++);
        }
    }

    /** Accumulate a team's played/W-D-L/goals from the finished group matches.
     *  `finished` is in chronological (id) order, so the collected results
     *  give the team's form oldest-first; the last 5 become the "Last 5". */
    private Row buildRow(Teams tm, List<Matches> finished) {
        Row r = new Row(tm.getId(), tm.getName());
        for (Matches m : finished) {
            Integer s1 = m.getScore1(), s2 = m.getScore2();
            if (s1 == null || s2 == null) continue;
            boolean isT1 = m.getTeam1() != null && m.getTeam1().getId().equals(tm.getId());
            boolean isT2 = m.getTeam2() != null && m.getTeam2().getId().equals(tm.getId());
            if (!isT1 && !isT2) continue;
            int gf = isT1 ? s1 : s2;
            int ga = isT1 ? s2 : s1;
            r.played++;
            r.goalsFor += gf;
            r.goalsAgainst += ga;
            if (gf > ga) { r.won++; r.results.add("W"); }
            else if (gf < ga) { r.lost++; r.results.add("L"); }
            else { r.drawn++; r.results.add("D"); }
        }
        return r;
    }

    /**
     * Rank the rows in place. Primary key is points; teams level on points are
     * ordered by the "closed circle" rule the product owner specified:
     *   1. head-to-head POINTS among the tied teams (who beat whom), and
     *      crucially the circle is RE-COMPUTED for each shrunken sub-group -
     *      once a team separates out on H2H points, the remaining still-tied
     *      teams are re-ranked by the head-to-head among ONLY themselves;
     *   2. then OVERALL goal difference;
     *   3. then OVERALL goals scored.
     * Note: only head-to-head POINTS are used inside the circle - NOT H2H goal
     * difference or H2H goals - so once the mutual matches are all level on
     * points, the overall goal difference decides (e.g. three teams that drew
     * each other are ordered by their overall GD, then overall goals).
     */
    private void rankRows(List<Row> rows, List<Matches> finished) {
        rows.sort(Comparator.comparingInt(Row::points).reversed());

        int i = 0;
        while (i < rows.size()) {
            int j = i + 1;
            while (j < rows.size() && rows.get(j).points() == rows.get(i).points()) j++;
            if (j - i > 1) {
                List<Row> ordered = breakTie(new ArrayList<>(rows.subList(i, j)), finished);
                for (int k = 0; k < ordered.size(); k++) rows.set(i + k, ordered.get(k));
            }
            i = j;
        }
    }

    /**
     * Order teams level on points using the closed-circle head-to-head POINTS
     * rule, recomputing the mini-table for each shrunken circle. Teams that
     * stay level on head-to-head points fall back to OVERALL goal difference,
     * then OVERALL goals scored.
     */
    private List<Row> breakTie(List<Row> tied, List<Matches> finished) {
        if (tied.size() <= 1) return tied;

        Set<Long> ids = tied.stream().map(r -> r.teamId).collect(Collectors.toSet());
        // [pts, gd, gf] - only the head-to-head POINTS (index 0) are used here.
        Map<Long, int[]> h2h = headToHead(ids, finished); // recomputed for THIS circle only

        // Order by head-to-head points within this (possibly shrunken) circle.
        tied.sort((a, b) -> Integer.compare(h2h.get(b.teamId)[0], h2h.get(a.teamId)[0]));

        // Maximal blocks equal on H2H points; recurse on a proper sub-circle,
        // otherwise fall back to overall goal difference then overall goals.
        List<Row> result = new ArrayList<>();
        int k = 0;
        while (k < tied.size()) {
            int l = k + 1;
            int pk = h2h.get(tied.get(k).teamId)[0];
            while (l < tied.size() && h2h.get(tied.get(l).teamId)[0] == pk) l++;
            List<Row> block = new ArrayList<>(tied.subList(k, l));
            if (block.size() == 1) {
                result.add(block.get(0));
            } else if (block.size() == tied.size()) {
                // H2H points couldn't split this circle → overall GD then GF.
                block.sort(Comparator
                        .comparingInt(Row::goalDiff).reversed()
                        .thenComparing(Comparator.comparingInt((Row r) -> r.goalsFor).reversed()));
                result.addAll(block);
            } else {
                // A proper sub-circle → recompute head-to-head points among just these.
                result.addAll(breakTie(block, finished));
            }
            k = l;
        }
        return result;
    }

    /** Head-to-head mini-table among the given team ids: id → [points, gd, gf]. */
    private Map<Long, int[]> headToHead(Set<Long> ids, List<Matches> finished) {
        Map<Long, int[]> map = new HashMap<>();
        for (Long id : ids) map.put(id, new int[]{0, 0, 0});
        for (Matches m : finished) {
            if (m.getTeam1() == null || m.getTeam2() == null) continue;
            Long a = m.getTeam1().getId(), b = m.getTeam2().getId();
            if (!ids.contains(a) || !ids.contains(b)) continue;
            Integer s1 = m.getScore1(), s2 = m.getScore2();
            if (s1 == null || s2 == null) continue;
            int[] ra = map.get(a), rb = map.get(b);
            ra[2] += s1; rb[2] += s2;             // goals for
            ra[1] += (s1 - s2); rb[1] += (s2 - s1); // goal diff
            if (s1 > s2) ra[0] += 3;
            else if (s1 < s2) rb[0] += 3;
            else { ra[0] += 1; rb[0] += 1; }
        }
        return map;
    }

    /** Mutable accumulator for one team while standings are being computed. */
    private static final class Row {
        final Long teamId;
        final String teamName;
        int played, won, drawn, lost, goalsFor, goalsAgainst;
        /** Chronological per-match results ("W"/"D"/"L"); last 5 → the form. */
        final List<String> results = new ArrayList<>();

        Row(Long teamId, String teamName) {
            this.teamId = teamId;
            this.teamName = teamName;
        }

        int points() { return won * 3 + drawn; }
        int goalDiff() { return goalsFor - goalsAgainst; }

        GroupStandingRowDto toDto() {
            List<String> form = results.subList(Math.max(0, results.size() - 5), results.size());
            return new GroupStandingRowDto(
                    teamId, teamName, played, won, drawn, lost,
                    goalsFor, goalsAgainst, goalDiff(), points(),
                    List.copyOf(form));
        }
    }
}
