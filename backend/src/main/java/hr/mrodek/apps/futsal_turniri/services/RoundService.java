// src/main/java/hr/mrodek/apps/futsal_turniri/service/RoundService.java
package hr.mrodek.apps.futsal_turniri.services;

import hr.mrodek.apps.futsal_turniri.dtos.ManualRoundRequest;
import hr.mrodek.apps.futsal_turniri.dtos.MatchDto;
import hr.mrodek.apps.futsal_turniri.dtos.RoundDto;
import hr.mrodek.apps.futsal_turniri.dtos.UpdateMatchRequest;
import hr.mrodek.apps.futsal_turniri.enums.MatchStatus;
import hr.mrodek.apps.futsal_turniri.enums.RoundStatus;
import hr.mrodek.apps.futsal_turniri.enums.TournamentStatus;
import hr.mrodek.apps.futsal_turniri.mappers.RoundMatchMapper;
import hr.mrodek.apps.futsal_turniri.model.Matches;
import hr.mrodek.apps.futsal_turniri.model.Teams;
import hr.mrodek.apps.futsal_turniri.model.Rounds;
import hr.mrodek.apps.futsal_turniri.model.Tournaments;
import hr.mrodek.apps.futsal_turniri.repository.MatchesRepository;
import hr.mrodek.apps.futsal_turniri.repository.TeamsRepository;
import hr.mrodek.apps.futsal_turniri.repository.RoundsRepository;
import hr.mrodek.apps.futsal_turniri.repository.TournamentsRepository;
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;
import jakarta.transaction.Transactional;

import java.time.OffsetDateTime;
import java.util.*;
import java.util.stream.Collectors;

@ApplicationScoped
public class RoundService {

    @Inject
    TournamentsRepository tournamentsRepo;
    @Inject
    RoundsRepository roundsRepo;
    @Inject
    MatchesRepository matchesRepo;
    @Inject
    TeamsRepository teamsRepo;
    @Inject
    RoundMatchMapper mapper;
    @Inject
    PushService pushService;

    public List<RoundDto> listByTournamentUuid(String uuid) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid).orElse(null);
        if (t == null) return List.of();
        var rounds = roundsRepo.findByTournamentOrderByNumberAsc(t);
        List<RoundDto> out = new ArrayList<>();
        for (var r : rounds) {
            var dto = mapper.toRoundDto(r);
            var matches = matchesRepo.findByRound(r);
            out.add(new RoundDto(dto.id(), dto.number(), dto.status(), mapper.toMatchDtoList(matches)));
        }
        return out;
    }

    @Transactional
    public RoundDto drawNextRound(String uuid) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid)
                .orElseThrow(() -> new NoSuchElementException("Tournament not found"));

        int nextNumber = roundsRepo.findTopByTournamentOrderByNumberDesc(t)
                .map(Rounds::getNumber).map(n -> n + 1).orElse(1);

        // Active teams (not eliminated)
        List<Teams> active = teamsRepo.findByTournament_Id(t.getId())
                .stream().filter(p -> !p.isEliminated()).toList();

        if (active.size() < 2) throw new IllegalStateException("Not enough teams to draw");

        // History for prior BYEs
        List<Matches> history = matchesRepo.findByTournament_Id(t.getId());

        // Collect who already received a BYE (either side, defensive)
        Set<Long> byeRecipients = new HashSet<>();
        for (Matches m : history) {
            if (m.getTeam1() != null && m.getTeam2() == null) byeRecipients.add(m.getTeam1().getId());
            if (m.getTeam2() != null && m.getTeam1() == null) byeRecipients.add(m.getTeam2().getId());
        }

        Random rnd = new Random();

        // Work on a shuffled copy for randomness
        List<Teams> pool = new ArrayList<>(active);
        Collections.shuffle(pool, rnd);

        // ===== BYE FIRST (if odd count) =====
        Teams bye = null;
        if (pool.size() % 2 == 1) {
            // Prefer players who have NOT had a BYE yet
            List<Teams> eligible = pool.stream()
                    .filter(p -> !byeRecipients.contains(p.getId()))
                    .collect(java.util.stream.Collectors.toList());

            List<Teams> candidates = eligible.isEmpty() ? pool : eligible; // if everyone had a BYE, pick truly random
            Collections.shuffle(candidates, rnd);
            bye = candidates.get(0);

            final Long byeId = (bye != null) ? bye.getId() : null;

            if (byeId != null) {
                pool.removeIf(p -> Objects.equals(p.getId(), byeId));
            }
        }

        // ===== TEAMING =====
        // Simple random adjacent pairing over the shuffled pool.
        List<long[]> chosenTeams = new ArrayList<>();
        for (int i = 0; i < pool.size(); i += 2) {
            chosenTeams.add(new long[]{pool.get(i).getId(), pool.get(i + 1).getId()});
        }

        // ===== Persist round + matches =====
        Rounds round = new Rounds();
        round.setTournament(t);
        round.setNumber(nextNumber);
        round.setStatus(RoundStatus.IN_PROGRESS);
        roundsRepo.save(round);

        Map<Long, Teams> byId = new HashMap<>();
        for (Teams p : active) byId.put(p.getId(), p); // includes the BYE pick too

        int tableNo = 1;
        List<Matches> toSave = new ArrayList<>();

        for (long[] ab : chosenTeams) {
            Teams p1 = byId.get(ab[0]);
            Teams p2 = byId.get(ab[1]);

            Matches m = new Matches();
            m.setTournament(t);
            m.setRound(round);
            m.setTableNo(tableNo++);
            m.setTeam1(p1);
            m.setTeam2(p2);
            m.setStatus(MatchStatus.SCHEDULED);
            toSave.add(m);
        }

        if (bye != null) {
            Matches m = new Matches();
            m.setTournament(t);
            m.setRound(round);
            m.setTableNo(tableNo++);
            m.setTeam1(bye);
            m.setTeam2(null); // BYE
            m.setStatus(MatchStatus.SCHEDULED);
            toSave.add(m);
        }

        var saved = matchesRepo.saveAll(toSave);

        // Notify every player whose team has a known user UID — one push per
        // device telling them which round / table / opponent to head to.
        // Skip BYE matches (team2 == null): there's no real game to attend.
        // Errors inside sendToUser are swallowed by PushService, so a flaky
        // push provider can never roll back the round.
        String tournamentRef = (t.getSlug() != null && !t.getSlug().isBlank())
                ? t.getSlug()
                : (t.getUuid() != null ? t.getUuid().toString() : "");
        for (Matches m : saved) {
            if (m.getTeam2() == null) continue; // BYE — no opponent
            Teams p1 = m.getTeam1();
            Teams p2 = m.getTeam2();
            if (p1 == null) continue;
            Integer tbl = m.getTableNo();
            String title = "Runda " + round.getNumber();
            String body = p1.getName() + " vs " + p2.getName()
                    + (tbl != null ? " na stolu " + tbl : "");
            // Deep-link to the specific match: TournamentDetailsPage reads
            // ?match={id} on mount, switches to the Ždrijeb tab, expands
            // the round, and scrolls the row into view (no modal opened
            // — there's no bill yet at this point in the tournament).
            // SPA route is /turniri/{slug} since the Croatian-routes refactor.
            // /tournaments/... still works as a 301 alias, but emitting the
            // canonical URL means the SW notification-click handler navigates
            // without a redirect hop.
            String matchUrl = "/turniri/" + tournamentRef + "?match=" + m.getId();
            // Tag groups notifications per round so a re-draw or a follow-up
            // notification for the same player+round replaces the previous
            // instead of stacking on the lock screen.
            String tag = "round-" + round.getId() + "-team-";
            // Notify every UID linked to either team (primary submitter
            // and co-owner from the share-link claim). Same payload for
            // both — they both need to know which table to head to.
            for (String uid : teamUids(p1)) {
                pushService.sendToUser(
                        uid,
                        new PushService.PushPayload(
                                title, body, matchUrl,
                                "/futsal-turniri-symbol.png",
                                tag + p1.getId() + "-" + uid
                        )
                );
            }
            for (String uid : teamUids(p2)) {
                pushService.sendToUser(
                        uid,
                        new PushService.PushPayload(
                                title, body, matchUrl,
                                "/futsal-turniri-symbol.png",
                                tag + p2.getId() + "-" + uid
                        )
                );
            }
        }

        var dto = mapper.toRoundDto(round);
        return new RoundDto(dto.id(), dto.number(), dto.status(), mapper.toMatchDtoList(saved));
    }

    /**
     * Manually generate a round from organiser-supplied pairings.
     *
     * <p>Typical use-case: late in a small bracket (≤ 4 active teams)
     * where the automatic draw's random pairing isn't what the organiser
     * wants. The caller provides the exact list of (team1, team2, tableNo)
     * tuples — we validate and persist them as a new round.
     *
     * <p>Mirrors {@link #drawNextRound(String)}'s persistence path so the
     * resulting round/matches look identical to an auto-drawn one
     * downstream (push notifications, score updates, finish-round flow).
     *
     * <p>Validation (each failure throws {@link IllegalStateException},
     * mapped to HTTP 400 by the global exception mapper):
     *   - tournament must be STARTED (not FINISHED — a finished tournament
     *     is read-only)
     *   - {@code matches} non-empty
     *   - every {@code team1Id} must reference a team in this tournament
     *     that is not eliminated; {@code team2Id} (when non-null) the same
     *   - no team may appear in more than one match
     *   - {@code team1Id != team2Id} (a team can't play itself)
     */
    @Transactional
    public RoundDto drawManualRound(String uuid, ManualRoundRequest req) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid)
                .orElseThrow(() -> new NoSuchElementException("Tournament not found"));

        if (t.getStatus() == TournamentStatus.FINISHED) {
            throw new IllegalStateException("Tournament is already finished");
        }

        if (req == null || req.matches() == null || req.matches().isEmpty()) {
            throw new IllegalStateException("At least one match is required");
        }

        // Load every team in the tournament once so we can validate the
        // request payload against actual DB rows in O(1) lookups.
        Map<Long, Teams> teamsById = new HashMap<>();
        for (Teams p : teamsRepo.findByTournament_Id(t.getId())) {
            teamsById.put(p.getId(), p);
        }

        // Track which team IDs the request already uses — catches both
        // duplicate-in-same-match and reused-across-matches in one pass.
        Set<Long> usedIds = new HashSet<>();
        for (ManualRoundRequest.Match m : req.matches()) {
            if (m == null || m.team1Id() == null || m.tableNo() == null) {
                throw new IllegalStateException("Each match needs team1Id and tableNo");
            }
            Teams p1 = teamsById.get(m.team1Id());
            if (p1 == null) {
                throw new IllegalStateException("team1Id " + m.team1Id() + " is not in this tournament");
            }
            if (p1.isEliminated()) {
                throw new IllegalStateException("Team " + p1.getName() + " is already eliminated");
            }
            if (!usedIds.add(m.team1Id())) {
                throw new IllegalStateException("Team " + p1.getName() + " appears in more than one match");
            }
            if (m.team2Id() != null) {
                if (m.team2Id().equals(m.team1Id())) {
                    throw new IllegalStateException("A team cannot play itself");
                }
                Teams p2 = teamsById.get(m.team2Id());
                if (p2 == null) {
                    throw new IllegalStateException("team2Id " + m.team2Id() + " is not in this tournament");
                }
                if (p2.isEliminated()) {
                    throw new IllegalStateException("Team " + p2.getName() + " is already eliminated");
                }
                if (!usedIds.add(m.team2Id())) {
                    throw new IllegalStateException("Team " + p2.getName() + " appears in more than one match");
                }
            }
        }

        int nextNumber = roundsRepo.findTopByTournamentOrderByNumberDesc(t)
                .map(Rounds::getNumber).map(n -> n + 1).orElse(1);

        Rounds round = new Rounds();
        round.setTournament(t);
        round.setNumber(nextNumber);
        round.setStatus(RoundStatus.IN_PROGRESS);
        roundsRepo.save(round);

        List<Matches> toSave = new ArrayList<>();
        for (ManualRoundRequest.Match m : req.matches()) {
            Matches row = new Matches();
            row.setTournament(t);
            row.setRound(round);
            row.setTableNo(m.tableNo());
            row.setTeam1(teamsById.get(m.team1Id()));
            row.setTeam2(m.team2Id() == null ? null : teamsById.get(m.team2Id()));
            row.setStatus(MatchStatus.SCHEDULED);
            toSave.add(row);
        }

        var saved = matchesRepo.saveAll(toSave);

        // Same push-notification logic as the automatic draw — players
        // get a deep link into their match. Lifted out into a helper so
        // both code paths agree on the payload shape; if you tweak one,
        // tweak the other.
        notifyMatches(t, round, saved);

        var dto = mapper.toRoundDto(round);
        return new RoundDto(dto.id(), dto.number(), dto.status(), mapper.toMatchDtoList(saved));
    }

    /**
     * Send a "Runda X" push notification to every UID linked to each
     * team playing in the round. Extracted from {@link #drawNextRound}
     * so {@link #drawManualRound} can reuse the same payload shape.
     * BYE rows (team2 == null) are skipped — there's no opponent to
     * announce.
     */
    private void notifyMatches(Tournaments t, Rounds round, List<Matches> matches) {
        String tournamentRef = (t.getSlug() != null && !t.getSlug().isBlank())
                ? t.getSlug()
                : (t.getUuid() != null ? t.getUuid().toString() : "");
        for (Matches m : matches) {
            if (m.getTeam2() == null) continue;
            Teams p1 = m.getTeam1();
            Teams p2 = m.getTeam2();
            if (p1 == null) continue;
            Integer tbl = m.getTableNo();
            String title = "Runda " + round.getNumber();
            String body = p1.getName() + " vs " + p2.getName()
                    + (tbl != null ? " na stolu " + tbl : "");
            String matchUrl = "/turniri/" + tournamentRef + "?match=" + m.getId();
            String tag = "round-" + round.getId() + "-team-";
            for (String uid : teamUids(p1)) {
                pushService.sendToUser(uid, new PushService.PushPayload(
                        title, body, matchUrl, "/futsal-turniri-symbol.png",
                        tag + p1.getId() + "-" + uid));
            }
            for (String uid : teamUids(p2)) {
                pushService.sendToUser(uid, new PushService.PushPayload(
                        title, body, matchUrl, "/futsal-turniri-symbol.png",
                        tag + p2.getId() + "-" + uid));
            }
        }
    }

    /* ===================== helpers ===================== */

    /**
     * All UIDs linked to a team — the primary submitter and (if claimed)
     * the share-link co-owner. Order is primary first then co-owner.
     */
    private static java.util.List<String> teamUids(Teams p) {
        if (p == null) return java.util.List.of();
        java.util.List<String> out = new java.util.ArrayList<>(2);
        if (p.getSubmittedByUid() != null && !p.getSubmittedByUid().isBlank()) {
            out.add(p.getSubmittedByUid());
        }
        if (p.getCoSubmittedByUid() != null && !p.getCoSubmittedByUid().isBlank()) {
            out.add(p.getCoSubmittedByUid());
        }
        return out;
    }

    /**
     * Push the loser of a freshly-finished match a notification that the
     * match was scored. Both the primary submitter AND the share-link
     * co-owner get the notification (each on their own devices).
     *
     * Silent no-op when:
     *   - BYE match (no opponent, nothing to settle)
     *   - neither side of the losing team has a known user UID
     *
     * Push failures are swallowed by PushService so a flaky provider
     * can't roll back the score update.
     */
    private void notifyLoser(Tournaments t, Matches m) {
        if (m.getTeam2() == null) return; // BYE
        if (m.getWinnerTeam() == null) return;
        if (m.getTeam1() == null) return;

        Teams loser = Objects.equals(m.getWinnerTeam().getId(), m.getTeam1().getId())
                ? m.getTeam2() : m.getTeam1();
        if (loser == null) return;
        var uids = teamUids(loser);
        if (uids.isEmpty()) return;

        String tournamentRef = (t.getSlug() != null && !t.getSlug().isBlank())
                ? t.getSlug()
                : (t.getUuid() != null ? t.getUuid().toString() : "");
        // Tag scopes the notification to this match so a re-score doesn't
        // stack multiple notifications on the lock screen.
        String tag = "loss-match-" + m.getId();

        for (String uid : uids) {
            pushService.sendToUser(
                    uid,
                    new PushService.PushPayload(
                            "Izgubili ste meč",
                            "Vaš meč je odigran.",
                            "/turniri/" + tournamentRef,
                            "/futsal-turniri-symbol.png",
                            tag + "-" + uid
                    )
            );
        }
    }

    @Transactional
    public MatchDto updateMatchScore(String uuid, Long roundId, Long matchId, UpdateMatchRequest req) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid)
                .orElseThrow(() -> new NoSuchElementException("Tournament not found"));

        Rounds r = roundsRepo.findByIdOptional(roundId)
                .filter(x -> Objects.equals(x.getTournament().getId(), t.getId()))
                .orElseThrow(() -> new NoSuchElementException("Round not found"));

        Matches m = matchesRepo.findByIdOptional(matchId)
                .filter(x -> Objects.equals(x.getRound().getId(), r.getId()))
                .orElseThrow(() -> new NoSuchElementException("Match not found"));

        Integer s1 = req.score1();
        Integer s2 = req.score2();

        // Remember the old finished/winner state so we can push the loser
        // exactly when this call introduces a NEW loss (fresh finish or
        // a re-score that flipped the winner).
        boolean wasFinished = m.getStatus() == MatchStatus.FINISHED;
        Long prevWinnerId = (m.getWinnerTeam() != null) ? m.getWinnerTeam().getId() : null;

        m.setScore1(s1);
        m.setScore2(s2);

        // if both scores present & not equal -> finish and update stats
        if (s1 != null && s2 != null && !Objects.equals(s1, s2) && m.getTeam1() != null && m.getTeam2() != null) {
            Teams winner = (s1 > s2) ? m.getTeam1() : m.getTeam2();
            Teams loser = (s1 > s2) ? m.getTeam2() : m.getTeam1();

            // If previously finished with different winner, revert old stats first
            if (m.getStatus() == MatchStatus.FINISHED && m.getWinnerTeam() != null) {
                Teams prevWinner = m.getWinnerTeam();
                Teams prevLoser = (Objects.equals(prevWinner.getId(), m.getTeam1().getId())) ? m.getTeam2() : m.getTeam1();
                // revert
                if (prevWinner.getWins() > 0) prevWinner.setWins(prevWinner.getWins() - 1);
                if (prevLoser.getLosses() > 0) prevLoser.setLosses(prevLoser.getLosses() - 1);
                // elimination may flip back if losses now 0
                if (prevLoser.getLosses() == 0) prevLoser.setEliminated(false);
                teamsRepo.save(prevWinner);
                teamsRepo.save(prevLoser);
            }

            // apply new
            m.setWinnerTeam(winner);
            m.setStatus(MatchStatus.FINISHED);

            winner.setWins(winner.getWins() + 1);
            loser.setLosses(loser.getLosses() + 1);
            loser.setEliminated(true); // eliminated immediately after 1st loss

            teamsRepo.save(winner);
            teamsRepo.save(loser);
        } else {
            // no decisive result -> mark scheduled & clear winner
            m.setWinnerTeam(null);
            m.setStatus(MatchStatus.SCHEDULED);
        }

        matchesRepo.save(m);

        // Loss push: only if the match is now FINISHED AND either
        //   (a) it wasn't finished before (fresh decision), or
        //   (b) the winner flipped (re-score by the organizer).
        // In case (b) the previous loser was just reinstated as winner;
        // the *new* loser gets the push instead.
        if (m.getStatus() == MatchStatus.FINISHED) {
            Long newWinnerId = (m.getWinnerTeam() != null) ? m.getWinnerTeam().getId() : null;
            boolean newFinish = !wasFinished;
            boolean flipped = wasFinished && !Objects.equals(prevWinnerId, newWinnerId);
            if (newFinish || flipped) {
                notifyLoser(t, m);
            }
        }

        // If every match finished -> mark round completed
        boolean allFinished = matchesRepo.findByRound(r).stream()
                .allMatch(x -> x.getStatus() == MatchStatus.FINISHED);
        if (allFinished) {
            r.setStatus(RoundStatus.COMPLETED);
            r.setCompletedAt(OffsetDateTime.now());
            roundsRepo.save(r);
        } else if (r.getStatus() == RoundStatus.COMPLETED) {
            // someone changed score back -> reopen round
            r.setStatus(RoundStatus.IN_PROGRESS);
            r.setCompletedAt(null);
            roundsRepo.save(r);
        }

        return mapper.toMatchDto(m);
    }

    @Transactional
    public void hardResetRound(String uuid, Long roundId) {
        // 0) Load + verify
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid)
                .orElseThrow(() -> new NoSuchElementException("Tournament not found"));

        Rounds r = roundsRepo.findByIdOptional(roundId)
                .filter(x -> Objects.equals(x.getTournament().getId(), t.getId()))
                .orElseThrow(() -> new NoSuchElementException("Round not found"));

        if (r.getStatus() == RoundStatus.COMPLETED) {
            throw new IllegalStateException("Cannot hard-reset a completed round.");
        }

        // 1) Delete this round's matches, then the round itself
        matchesRepo.deleteByRound(r);
        roundsRepo.delete(r);

        // 2) Recompute ALL teams' wins/losses/elimination from remaining FINISHED matches
        var teams = teamsRepo.findByTournament_Id(t.getId());
        Map<Long, Teams> byId = teams.stream().collect(Collectors.toMap(Teams::getId, p -> p));

        // reset
        for (var p : teams) {
            p.setWins(0);
            p.setLosses(0);
            p.setEliminated(false);
        }

        // count from remaining finished matches only
        var finished = matchesRepo.findByTournament_IdAndStatus(t.getId(), MatchStatus.FINISHED);
        for (var m : finished) {
            // ignore BYE for stats (team2 == null)
            if (m.getTeam2() == null) continue;
            if (m.getWinnerTeam() == null) continue;

            Teams winner = byId.get(m.getWinnerTeam().getId());
            Teams loser;
            if (m.getTeam1() != null && Objects.equals(m.getWinnerTeam().getId(), m.getTeam1().getId())) {
                loser = (m.getTeam2() != null) ? byId.get(m.getTeam2().getId()) : null;
            } else {
                loser = (m.getTeam1() != null) ? byId.get(m.getTeam1().getId()) : null;
            }

            if (winner != null) winner.setWins(winner.getWins() + 1);
            if (loser  != null) loser.setLosses(loser.getLosses() + 1);
        }

        // elimination rule: a team is out after its first loss
        for (var p : teams) {
            p.setEliminated(p.getLosses() >= 1);
        }
        teamsRepo.saveAll(teams);

        // 3) Touch tournament
        t.setUpdatedAt(OffsetDateTime.now());
        tournamentsRepo.save(t);
    }

    @Transactional
    public RoundDto finishRound(String uuid, Long roundId) {
        Tournaments t = tournamentsRepo.findByUuidOrSlug(uuid)
                .orElseThrow(() -> new NoSuchElementException("Tournament not found"));

        Rounds r = roundsRepo.findByIdOptional(roundId)
                .filter(x -> Objects.equals(x.getTournament().getId(), t.getId()))
                .orElseThrow(() -> new NoSuchElementException("Round not found"));

        var matches = matchesRepo.findByRound(r);

        // Validate & apply missing finals
        for (var m : matches) {
            // BYE
            if (m.getTeam2() == null) {
                // Just mark finished; do NOT change wins/losses for BYE
                m.setStatus(hr.mrodek.apps.futsal_turniri.enums.MatchStatus.FINISHED);
                m.setWinnerTeam(m.getTeam1());
                matchesRepo.save(m);
                continue;
            }

            Integer s1 = m.getScore1();
            Integer s2 = m.getScore2();

            if (s1 == null || s2 == null || Objects.equals(s1, s2)) {
                throw new IllegalStateException("All matches must have decisive scores (no ties, no blanks).");
            }

            // If already finished, assume stats are already accounted for (updateMatchScore handled reversals)
            if (m.getStatus() == hr.mrodek.apps.futsal_turniri.enums.MatchStatus.FINISHED) {
                continue;
            }

            // Finish & apply stats once
            var winner = (s1 > s2) ? m.getTeam1() : m.getTeam2();
            var loser = (s1 > s2) ? m.getTeam2() : m.getTeam1();

            m.setWinnerTeam(winner);
            m.setStatus(hr.mrodek.apps.futsal_turniri.enums.MatchStatus.FINISHED);
            matchesRepo.save(m);

            // Update stats
            winner.setWins(winner.getWins() + 1);
            loser.setLosses(loser.getLosses() + 1);
            loser.setEliminated(true); // eliminated immediately after 1st loss
            teamsRepo.save(winner);
            teamsRepo.save(loser);

            // Fresh finish via "Završi rundu" — notify the new loser with
            // the table's bill total.
            notifyLoser(t, m);
        }

        // Mark round completed
        r.setStatus(hr.mrodek.apps.futsal_turniri.enums.RoundStatus.COMPLETED);
        r.setCompletedAt(OffsetDateTime.now());
        roundsRepo.save(r);

        // Return fresh DTO with current matches
        var savedMatches = matchesRepo.findByRound(r);
        var dto = mapper.toRoundDto(r);
        return new RoundDto(dto.id(), dto.number(), dto.status(), mapper.toMatchDtoList(savedMatches));
    }

    @Transactional
    public RoundDto overrideMatchScore(String uuid, Long roundId, Long matchId, UpdateMatchRequest req) {
        var tournament = tournamentsRepo.findByUuidOrSlug(uuid)
                .orElseThrow(() -> new NoSuchElementException("Tournament not found"));

        var round = roundsRepo.findByIdOptional(roundId)
                .orElseThrow(() -> new NoSuchElementException("Round not found"));
        if (!round.getTournament().getId().equals(tournament.getId())) {
            throw new IllegalArgumentException("Round does not belong to tournament");
        }

        var match = matchesRepo.findByIdOptional(matchId)
                .orElseThrow(() -> new NoSuchElementException("Match not found"));
        if (!match.getRound().getId().equals(round.getId())) {
            throw new IllegalArgumentException("Match does not belong to round");
        }

        Integer s1 = req.score1();
        Integer s2 = req.score2();

        // Capture old state so we know whether this override actually
        // introduces a new loss for someone (vs. a no-op or unscore).
        boolean wasFinished = match.getStatus() == MatchStatus.FINISHED;
        Long prevWinnerId = (match.getWinnerTeam() != null) ? match.getWinnerTeam().getId() : null;

        match.setScore1(s1);
        match.setScore2(s2);

        // Decide status/winner (BYE counts as decided for team1)
        if (match.getTeam2() == null) {
            match.setStatus(MatchStatus.FINISHED);
            match.setWinnerTeam(match.getTeam1());
        } else if (s1 != null && s2 != null && !s1.equals(s2)) {
            match.setStatus(MatchStatus.FINISHED);
            match.setWinnerTeam(s1 > s2 ? match.getTeam1() : match.getTeam2());
        } else {
            match.setStatus(MatchStatus.SCHEDULED);
            match.setWinnerTeam(null);
        }
        matchesRepo.save(match);

        // Loss push — same gating as updateMatchScore (fresh finish or
        // winner flip). Skip for BYE (handled by notifyLoser).
        if (match.getStatus() == MatchStatus.FINISHED) {
            Long newWinnerId = (match.getWinnerTeam() != null) ? match.getWinnerTeam().getId() : null;
            boolean newFinish = !wasFinished;
            boolean flipped = wasFinished && !Objects.equals(prevWinnerId, newWinnerId);
            if (newFinish || flipped) {
                notifyLoser(tournament, match);
            }
        }

        // 2) Recompute ALL teams' wins/losses for this tournament from FINISHED matches
        var teams = teamsRepo.findByTournament_Id(tournament.getId());
        Map<Long, Teams> byId = teams.stream().collect(Collectors.toMap(Teams::getId, p -> p));
        teams.forEach(p -> {
            p.setWins(0);
            p.setLosses(0);
            p.setEliminated(false);
        });

        var finished = matchesRepo.findByTournament_IdAndStatus(tournament.getId(), MatchStatus.FINISHED);
        for (var m : finished) {
            // winner already set above / assumed for existing finished matches
            if (m.getWinnerTeam() != null) {
                var winner = byId.get(m.getWinnerTeam().getId());
                var loser = (m.getTeam1() != null && m.getWinnerTeam().getId().equals(m.getTeam1().getId()))
                        ? (m.getTeam2() != null ? byId.get(m.getTeam2().getId()) : null)
                        : (m.getTeam1() != null ? byId.get(m.getTeam1().getId()) : null);

                if (winner != null) winner.setWins(winner.getWins() + 1);
                if (loser != null) loser.setLosses(loser.getLosses() + 1);
            } else if (m.getTeam2() == null && m.getTeam1() != null) {
                // safety for BYE: treat as finished for team1
                var p1 = byId.get(m.getTeam1().getId());
                if (p1 != null) p1.setWins(p1.getWins() + 1);
            }
        }

        // Elimination rule: a team is out after its first loss
        for (var p : teams) {
            p.setEliminated(p.getLosses() >= 1);
        }
        teamsRepo.saveAll(teams);

        // 3) Update round status after the override
        var matchesInRound = matchesRepo.findByRound_IdOrderByTableNoAsc(round.getId());
        boolean allDecided = matchesInRound.stream().allMatch(mx -> {
            if (mx.getTeam2() == null) return true; // BYE
            return mx.getStatus() == MatchStatus.FINISHED && mx.getWinnerTeam() != null;
        });
        round.setStatus(allDecided ? RoundStatus.COMPLETED : RoundStatus.IN_PROGRESS);
        roundsRepo.save(round);

        // 4) Return updated RoundDto (with ordered matches)
        var base = mapper.toRoundDto(round);
        var matchDtos = mapper.toMatchDtoList(matchesInRound);
        return new RoundDto(base.id(), base.number(), base.status(), matchDtos);
    }
}