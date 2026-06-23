package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.dtos.DrawRequest;
import hr.mrodek.apps.futsal_turniri.dtos.GroupDto;
import hr.mrodek.apps.futsal_turniri.dtos.GroupMatchDto;
import hr.mrodek.apps.futsal_turniri.dtos.GroupStandingRowDto;
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
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * Group-stage engine for GROUPS_KNOCKOUT tournaments (Phase E2).
 *
 * <p>Responsibilities:
 * <ul>
 *   <li>draw registered teams into groups — random ({@code AUTO}) or from an
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
     * Draw the registered teams into groups and generate the round-robin
     * fixtures. Re-runnable: it first wipes any existing groups, group-stage
     * matches and matchday rounds, so the organizer can redo the draw.
     */
    @Transactional
    public void drawAndGenerate(Tournaments t, DrawRequest req) {
        if (t.getFormat() != TournamentFormat.GROUPS_KNOCKOUT) {
            throw new BadRequestException("Tournament format is not GROUPS_KNOCKOUT");
        }
        Integer groupCount = t.getGroupCount();
        if (groupCount == null || groupCount < 2) {
            throw new BadRequestException("Group count is not configured for this tournament");
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
        generateFixtures(t, groups);
    }

    /** Places teams into groups — manual placement or a random auto draw. */
    private void assignTeams(List<Teams> teams, List<Groups> groups, DrawRequest req) {
        boolean manual = req != null
                && req.mode() == DrawRequest.Mode.MANUAL
                && req.assignments() != null;

        if (manual) {
            Map<Long, Teams> byId = teams.stream()
                    .collect(Collectors.toMap(Teams::getId, x -> x));
            for (DrawRequest.Assignment a : req.assignments()) {
                Teams tm = byId.get(a.teamId());
                if (tm == null) continue;
                int ord = a.groupOrdinal();
                if (ord < 0 || ord >= groups.size()) {
                    throw new BadRequestException("Invalid group ordinal: " + ord);
                }
                tm.setGroup(groups.get(ord));
            }
            for (Teams tm : teams) {
                if (tm.getGroup() == null) {
                    throw new BadRequestException(
                            "Team not assigned to a group: " + tm.getName());
                }
            }
        } else {
            // AUTO — shuffle, then spread round-robin so group sizes differ
            // by at most one (13 teams, 4 groups → 4+3+3+3).
            List<Teams> shuffled = new ArrayList<>(teams);
            Collections.shuffle(shuffled);
            for (int i = 0; i < shuffled.size(); i++) {
                shuffled.get(i).setGroup(groups.get(i % groups.size()));
            }
        }
    }

    /** Builds the single round-robin fixtures for every group. */
    private void generateFixtures(Tournaments t, List<Groups> groups) {
        // Round-robin schedule per group; track the longest so we know how
        // many shared matchday rounds to create.
        Map<Long, List<List<Teams[]>>> schedules = new HashMap<>();
        int maxMatchdays = 0;
        for (Groups g : groups) {
            List<Teams> gt = teamsRepo.list("group.id", g.getId());
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
            List<Teams> teams = teamsRepo.list("group.id", g.getId());
            List<Matches> finished = matchesRepo.list(
                    "group.id = ?1 and status = ?2", g.getId(), MatchStatus.FINISHED);

            List<Row> rows = new ArrayList<>();
            for (Teams tm : teams) rows.add(buildRow(tm, finished));
            rankRows(rows, finished);

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
                        m.getSecondHalfStartedAt()));
            }
            out.add(new GroupDto(g.getId(), g.getName(), g.getOrdinal(), dto, matchDtos));
        }
        return out;
    }

    /**
     * Record a group-match result. Group matches may end level; the winner
     * (or null for a draw) is set and the standings recompute live.
     */
    @Transactional
    public void recordGroupResult(Long matchId, int score1, int score2) {
        Matches m = matchesRepo.findByIdOptional(matchId)
                .orElseThrow(() -> new NotFoundException("Match not found"));
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
    }

    /** Accumulate a team's played/W-D-L/goals from the finished group matches. */
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
            if (gf > ga) r.won++;
            else if (gf < ga) r.lost++;
            else r.drawn++;
        }
        return r;
    }

    /**
     * Rank the rows in place. Primary key is points; teams level on points
     * are ordered by the UEFA head-to-head rule — a mini-table built from
     * only the matches among the tied teams (H2H points, then H2H goal
     * difference, then H2H goals scored) — falling back to overall goal
     * difference and goals scored.
     */
    private void rankRows(List<Row> rows, List<Matches> finished) {
        rows.sort(Comparator.comparingInt(Row::points).reversed());

        int i = 0;
        while (i < rows.size()) {
            int j = i + 1;
            while (j < rows.size() && rows.get(j).points() == rows.get(i).points()) j++;
            if (j - i > 1) {
                List<Row> run = rows.subList(i, j);
                Set<Long> ids = run.stream().map(r -> r.teamId).collect(Collectors.toSet());
                Map<Long, int[]> h2h = headToHead(ids, finished); // id -> [pts, gd, gf]
                run.sort((a, b) -> {
                    int[] ha = h2h.get(a.teamId), hb = h2h.get(b.teamId);
                    int c = Integer.compare(hb[0], ha[0]);          // H2H points
                    if (c != 0) return c;
                    c = Integer.compare(hb[1], ha[1]);              // H2H goal diff
                    if (c != 0) return c;
                    c = Integer.compare(hb[2], ha[2]);              // H2H goals for
                    if (c != 0) return c;
                    c = Integer.compare(b.goalDiff(), a.goalDiff()); // overall goal diff
                    if (c != 0) return c;
                    return Integer.compare(b.goalsFor, a.goalsFor);  // overall goals for
                });
            }
            i = j;
        }
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

        Row(Long teamId, String teamName) {
            this.teamId = teamId;
            this.teamName = teamName;
        }

        int points() { return won * 3 + drawn; }
        int goalDiff() { return goalsFor - goalsAgainst; }

        GroupStandingRowDto toDto() {
            return new GroupStandingRowDto(
                    teamId, teamName, played, won, drawn, lost,
                    goalsFor, goalsAgainst, goalDiff(), points());
        }
    }
}
