-- ═══════════════════════════════════════════════════════════════════════════
-- Import: 4. MNT ŠKARIĆEVO — knockout bracket, teams, goals, penalty shootouts
-- Source:      https://www.turniri.hr/raspored-i-rezultati/4-mnt-skaricevo-65.html
-- Scraped at:  2026-07-29, via the page's own internal JSON endpoints
--              (/dajSatnicu, /dajStatistkuUtakmicePrikaz, /dajListuStrijelaca)
--              because the static HTML has no kickoff times or per-goal detail.
--
-- Tournament:  id = 1 (already exists). Teams 1-15 already exist for it (given).
--
-- Shape of the bracket (pure KNOCKOUT_ONLY, no group stage on the source page):
--   19 teams total → a preliminary round ('1/16 finala' on the site, mapped to
--   our ROUND_OF_32 - it's the stage immediately before Round of 16, just not a
--   full 32-slot round) reduces 6 of them to 3 winners; the other 13 teams had a
--   bye straight into Round of 16 (16 slots total). Byes are NOT inserted as rows
--   here - they were never real matches, just bracket placeholders on the source.
--   ROUND_OF_32 (3) → ROUND_OF_16 (8) → QUARTERFINAL (4) → SEMIFINAL (2) →
--   THIRD_PLACE (1) + FINAL (1) = 19 real matches.
--
-- Score model (see enums/MatchEventType.java + TournamentController.
-- recomputeScoreFromGoals): matches.score1/score2 = REGULATION goals only
-- (GOAL/OWN_GOAL). matches.penalties1/penalties2 = shootout make-count, from
-- PENALTY_GOAL/PENALTY_MISSED match_events, which never affect score1/score2 or
-- the scorer leaderboard. The source page's bracket score for a PEN match is the
-- SUM of the two (e.g. final 'Juraj Centar 7 - Nixogradnja 6 (PEN)' = regulation
-- 2-2 + shootout 5-4) - verified against the per-kick JSON for every PEN match
-- below before splitting it back into score/penalties.
--
-- Goal scorers: almost none are named on the source page. Per the task, unnamed
-- goals get match_events.player_id = NULL with team_id set explicitly instead
-- (match_event_team.xml + TournamentController.java confirm the app itself
-- supports/records goals this way — 'gol bez igrača' — for ANY event type, not
-- just penalties, despite that changelog comment predating the generalisation).
-- This avoids inventing a placeholder 'Nepoznat igrač' player per team, which
-- would be unnecessary since NULL+team_id is a real, already-supported shape.
-- The only match with named individual scorers is the FINAL (44068 on the
-- source), matching /dajListuStrijelaca's site-wide top-scorer list exactly.
--
-- Minute convention assumption (schema requires match_events.minute NOT NULL,
-- but the source's 'minuta' field is elapsed time WITHIN a half/shootout, not a
-- cumulative match minute): halves ran ~10-11 real minutes each on every match
-- timestamp we sampled (1pol_start/1pol_stop), so 2nd-half minute = 10 + source
-- minute, shootout kicks = 30 + source minute. This is a light, evidence-based
-- assumption (not fabricated data) documented here for the user to correct if
-- the tournament's actual half length was different.
--
-- Fuzzy team-name matches to the existing 1-15 roster (case/diacritic-insensitive):
--   'Dimnjacarstvo Leuštek'      → 1  Dimnjačarstvo Leuštek   (missing č)
--   'tihi i prijatelji'          → 15 Tihi i prijatelji        (lowercase)
--   'src sveti juraj'            → 12 ŠRC Sveti Juraj          (Š→s, case)
-- 'ŠUJ' looks similar to 'ŠRC Sveti Juraj' but is NOT the same team - it plays
-- in a DIFFERENT bracket slot in the SAME round as 'src sveti juraj', so both
-- must be real, distinct entrants. 'ŠUJ' is therefore inserted as a new team.
-- Existing teams 8 (SD Gregurovec 2) and 13 (Bistro Point Pregrada) do not
-- appear anywhere on this tournament's page - left untouched, no matches for them.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Safety: abort instead of clobbering if any target id already exists locally.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM teams WHERE id BETWEEN 16 AND 21)
        OR EXISTS (SELECT 1 FROM matches WHERE id BETWEEN 90001 AND 90019)
        OR EXISTS (SELECT 1 FROM players WHERE id BETWEEN 90101 AND 90109)
        OR EXISTS (SELECT 1 FROM match_events WHERE id BETWEEN 900001 AND 900105)
        OR EXISTS (SELECT 1 FROM rounds WHERE id = 9001) THEN
        RAISE EXCEPTION 'Import id range already occupied - aborting (already imported, or ids collide with other local data).';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM tournaments WHERE id = 1) THEN
        RAISE EXCEPTION 'Tournament id=1 not found - this script assumes it already exists.';
    END IF;
END $$;

-- ── New teams (not part of the pre-existing 1-15 roster) ─────────────────
INSERT INTO teams (id, tournament_id, name) VALUES
    (16, 1, 'Kr adapting'),
    (17, 1, 'Šljosari'),
    (18, 1, 'Nixogradnja'),
    (19, 1, 'MBM Keramika'),
    (20, 1, 'niko i prijatelji'),
    (21, 1, 'ŠUJ');

-- ── One round row carries the whole knockout bracket (matches KnockoutService:
--    a single Round per tournament for all knockout stages; 'stage' distinguishes
--    them, not rounds.number). Number continues after any existing rounds.
INSERT INTO rounds (id, tournament_id, number, status, created_at)
SELECT 9001, 1, COALESCE((SELECT MAX(number) FROM rounds WHERE tournament_id = 1), 0) + 1,
       'IN_PROGRESS', now();

-- ── Matches (19 played; stage codes per matches_knockout_code.xml backfill rule) ──
INSERT INTO matches (id, tournament_id, round_id, team1_id, team2_id, score1, score2,
                     winner_team_id, status, stage, knockout_code, penalties1, penalties2, kickoff_at)
VALUES
    -- 1/16 finala (ROUND_OF_32)
    (90001, 1, 9001, 10, 9, 4, 3, 10, 'FINISHED', 'ROUND_OF_32', 'Š1', NULL, NULL, timestamptz '2026-07-04 20:00:00+02'), -- R cars vs Leško transporti
    (90002, 1, 9001, 18, 1, 2, 0, 18, 'FINISHED', 'ROUND_OF_32', 'Š2', NULL, NULL, timestamptz '2026-07-04 20:30:00+02'), -- Nixogradnja vs Dimnjačarstvo Leuštek
    (90003, 1, 9001, 11, 6, 1, 3, 6, 'FINISHED', 'ROUND_OF_32', 'Š3', NULL, NULL, timestamptz '2026-07-04 21:00:00+02'), -- Preseka zapad vs Caffe bar Down Town & Vinarija Petrač
    -- Osmina finala (ROUND_OF_16)
    (90004, 1, 9001, 15, 10, 0, 0, 15, 'FINISHED', 'ROUND_OF_16', 'O1', 3, 2, timestamptz '2026-07-04 22:00:00+02'), -- Tihi i prijatelji vs R cars (PEN)
    (90005, 1, 9001, 2, 12, 2, 0, 2, 'FINISHED', 'ROUND_OF_16', 'O2', NULL, NULL, timestamptz '2026-07-04 19:30:00+02'), -- Juraj Centar vs ŠRC Sveti Juraj
    (90006, 1, 9001, 16, 7, 3, 2, 16, 'FINISHED', 'ROUND_OF_16', 'O3', NULL, NULL, timestamptz '2026-07-04 18:30:00+02'), -- Kr adapting vs SD Gregurovec
    (90007, 1, 9001, 3, 17, 3, 0, 3, 'FINISHED', 'ROUND_OF_16', 'O4', NULL, NULL, timestamptz '2026-07-04 19:00:00+02'), -- SD SVEDRUŽA vs Šljosari
    (90008, 1, 9001, 5, 18, 0, 3, 18, 'FINISHED', 'ROUND_OF_16', 'O5', NULL, NULL, timestamptz '2026-07-04 22:30:00+02'), -- Autoservis Vinski vs Nixogradnja
    (90009, 1, 9001, 19, 14, 1, 4, 14, 'FINISHED', 'ROUND_OF_16', 'O6', NULL, NULL, timestamptz '2026-07-04 21:30:00+02'), -- MBM Keramika vs Janžek gradnja
    (90010, 1, 9001, 20, 6, 1, 3, 6, 'FINISHED', 'ROUND_OF_16', 'O7', NULL, NULL, timestamptz '2026-07-04 23:00:00+02'), -- niko i prijatelji vs Caffe bar Down Town & Vinarija Petrač
    (90011, 1, 9001, 4, 21, 4, 3, 4, 'FINISHED', 'ROUND_OF_16', 'O8', NULL, NULL, timestamptz '2026-07-04 18:00:00+02'), -- Stara Ves vs ŠUJ
    -- Čevrtfinale (QUARTERFINAL)
    (90012, 1, 9001, 15, 2, 0, 7, 2, 'FINISHED', 'QUARTERFINAL', 'ČF1', NULL, NULL, timestamptz '2026-07-04 23:50:00+02'), -- Tihi i prijatelji vs Juraj Centar
    (90013, 1, 9001, 16, 3, 4, 1, 16, 'FINISHED', 'QUARTERFINAL', 'ČF2', NULL, NULL, timestamptz '2026-07-05 00:20:00+02'), -- Kr adapting vs SD SVEDRUŽA
    (90014, 1, 9001, 18, 14, 1, 1, 18, 'FINISHED', 'QUARTERFINAL', 'ČF3', 3, 1, timestamptz '2026-07-05 01:00:00+02'), -- Nixogradnja vs Janžek gradnja (PEN)
    (90015, 1, 9001, 6, 4, 7, 0, 6, 'FINISHED', 'QUARTERFINAL', 'ČF4', NULL, NULL, timestamptz '2026-07-05 00:50:00+02'), -- Caffe bar Down Town & Vinarija Petrač vs Stara Ves
    -- Polufinale (SEMIFINAL)
    (90016, 1, 9001, 2, 16, 2, 1, 2, 'FINISHED', 'SEMIFINAL', 'PF1', NULL, NULL, timestamptz '2026-07-05 01:30:00+02'), -- Juraj Centar vs Kr adapting
    (90017, 1, 9001, 18, 6, 2, 2, 18, 'FINISHED', 'SEMIFINAL', 'PF2', 3, 1, timestamptz '2026-07-05 02:00:00+02'), -- Nixogradnja vs Caffe bar Down Town & Vinarija Petrač (PEN)
    -- Za 3. mjesto (THIRD_PLACE)
    (90018, 1, 9001, 16, 6, 0, 0, 16, 'FINISHED', 'THIRD_PLACE', NULL, 3, 1, timestamptz '2026-07-05 02:30:00+02'), -- Kr adapting vs Caffe bar Down Town & Vinarija Petrač (PEN)
    -- Finale (FINAL)
    (90019, 1, 9001, 2, 18, 2, 2, 2, 'FINISHED', 'FINAL', NULL, 5, 4, timestamptz '2026-07-05 03:00:00+02'); -- Juraj Centar vs Nixogradnja (PEN)

-- ── Named players (only the FINAL had any named scorers/shooters on the source) ──
INSERT INTO players (id, team_id, name, is_demo) VALUES
    (90101, 18, 'Nikola Mutak', false),
    (90102, 18, 'Marko Strabic', false),
    (90103, 18, 'Leon Jedvaj', false),
    (90104, 18, 'Radovan Sostaric', false),
    (90105, 18, 'Lovro Tepus', false),
    (90106, 2, 'Borna Vidiček', false),
    (90107, 2, 'Luka Topke Topolovec', false),
    (90108, 2, 'Drazen Ilic', false),
    (90109, 2, 'Nikola Gudasic', false);

-- ── Goal events + penalty-shootout kicks ─────────────────────────────────
-- Unnamed goals: player_id NULL, team_id set explicitly (supported natively -
-- see TournamentController's event-create path). Named ones (final only):
-- player_id set, team_id left NULL (derived from the player's team on read).
INSERT INTO match_events (id, match_id, type, player_id, team_id, minute) VALUES
    -- match 90001: R cars vs Leško transporti
    (900001, 90001, 'GOAL', NULL, 10, 5),
    (900002, 90001, 'GOAL', NULL, 9, 8),
    (900003, 90001, 'GOAL', NULL, 9, 9),
    (900004, 90001, 'GOAL', NULL, 10, 11),
    (900005, 90001, 'GOAL', NULL, 10, 11),
    (900006, 90001, 'GOAL', NULL, 10, 13),
    (900007, 90001, 'GOAL', NULL, 9, 18),
    -- match 90002: Nixogradnja vs Dimnjačarstvo Leuštek
    (900008, 90002, 'GOAL', NULL, 18, 12),
    (900009, 90002, 'GOAL', NULL, 18, 21),
    -- match 90003: Preseka zapad vs Caffe bar Down Town & Vinarija Petrač
    (900010, 90003, 'GOAL', NULL, 11, 5),
    (900011, 90003, 'GOAL', NULL, 6, 11),
    (900012, 90003, 'GOAL', NULL, 6, 14),
    (900013, 90003, 'GOAL', NULL, 6, 20),
    -- match 90004: Tihi i prijatelji vs R cars
    (900014, 90004, 'PENALTY_GOAL', NULL, 10, 32),
    (900015, 90004, 'PENALTY_GOAL', NULL, 15, 32),
    (900016, 90004, 'PENALTY_MISSED', NULL, 10, 32),
    (900017, 90004, 'PENALTY_GOAL', NULL, 15, 33),
    (900018, 90004, 'PENALTY_GOAL', NULL, 10, 33),
    (900019, 90004, 'PENALTY_GOAL', NULL, 15, 34),
    -- match 90005: Juraj Centar vs ŠRC Sveti Juraj
    (900020, 90005, 'GOAL', NULL, 2, 4),
    (900021, 90005, 'GOAL', NULL, 2, 12),
    -- match 90006: Kr adapting vs SD Gregurovec
    (900022, 90006, 'GOAL', NULL, 7, 1),
    (900023, 90006, 'GOAL', NULL, 7, 4),
    (900024, 90006, 'GOAL', NULL, 16, 4),
    (900025, 90006, 'GOAL', NULL, 16, 17),
    (900026, 90006, 'GOAL', NULL, 16, 18),
    -- match 90007: SD SVEDRUŽA vs Šljosari
    (900027, 90007, 'GOAL', NULL, 3, 0),
    (900028, 90007, 'GOAL', NULL, 3, 0),
    (900029, 90007, 'GOAL', NULL, 3, 0),
    -- match 90008: Autoservis Vinski vs Nixogradnja
    (900030, 90008, 'GOAL', NULL, 18, 7),
    (900031, 90008, 'GOAL', NULL, 18, 13),
    (900032, 90008, 'GOAL', NULL, 18, 21),
    -- match 90009: MBM Keramika vs Janžek gradnja
    (900033, 90009, 'GOAL', NULL, 14, 7),
    (900034, 90009, 'GOAL', NULL, 14, 9),
    (900035, 90009, 'GOAL', NULL, 14, 13),
    (900036, 90009, 'GOAL', NULL, 19, 14),
    (900037, 90009, 'GOAL', NULL, 14, 17),
    -- match 90010: niko i prijatelji vs Caffe bar Down Town & Vinarija Petrač
    (900038, 90010, 'GOAL', NULL, 6, 4),
    (900039, 90010, 'GOAL', NULL, 20, 6),
    (900040, 90010, 'GOAL', NULL, 6, 9),
    (900041, 90010, 'GOAL', NULL, 6, 16),
    -- match 90011: Stara Ves vs ŠUJ
    (900042, 90011, 'GOAL', NULL, 21, 1),
    (900043, 90011, 'GOAL', NULL, 4, 1),
    (900044, 90011, 'GOAL', NULL, 21, 5),
    (900045, 90011, 'GOAL', NULL, 21, 16),
    (900046, 90011, 'GOAL', NULL, 4, 16),
    (900047, 90011, 'GOAL', NULL, 4, 19),
    (900048, 90011, 'GOAL', NULL, 4, 20),
    -- match 90012: Tihi i prijatelji vs Juraj Centar
    (900049, 90012, 'GOAL', NULL, 2, 3),
    (900050, 90012, 'GOAL', NULL, 2, 6),
    (900051, 90012, 'GOAL', NULL, 2, 7),
    (900052, 90012, 'GOAL', NULL, 2, 8),
    (900053, 90012, 'GOAL', NULL, 2, 9),
    (900054, 90012, 'GOAL', NULL, 2, 13),
    (900055, 90012, 'GOAL', NULL, 2, 16),
    -- match 90013: Kr adapting vs SD SVEDRUŽA
    (900056, 90013, 'GOAL', NULL, 16, 12),
    (900057, 90013, 'GOAL', NULL, 16, 16),
    (900058, 90013, 'GOAL', NULL, 3, 16),
    (900059, 90013, 'GOAL', NULL, 16, 20),
    (900060, 90013, 'GOAL', NULL, 16, 20),
    -- match 90014: Nixogradnja vs Janžek gradnja
    (900061, 90014, 'GOAL', NULL, 14, 5),
    (900062, 90014, 'GOAL', NULL, 18, 11),
    (900063, 90014, 'PENALTY_GOAL', NULL, 18, 32),
    (900064, 90014, 'PENALTY_GOAL', NULL, 14, 33),
    (900065, 90014, 'PENALTY_GOAL', NULL, 18, 33),
    (900066, 90014, 'PENALTY_MISSED', NULL, 14, 34),
    (900067, 90014, 'PENALTY_GOAL', NULL, 18, 34),
    -- match 90015: Caffe bar Down Town & Vinarija Petrač vs Stara Ves
    (900068, 90015, 'GOAL', NULL, 6, 2),
    (900069, 90015, 'GOAL', NULL, 6, 5),
    (900070, 90015, 'GOAL', NULL, 6, 6),
    (900071, 90015, 'GOAL', NULL, 6, 8),
    (900072, 90015, 'GOAL', NULL, 6, 11),
    (900073, 90015, 'GOAL', NULL, 6, 12),
    (900074, 90015, 'GOAL', NULL, 6, 14),
    -- match 90016: Juraj Centar vs Kr adapting
    (900075, 90016, 'GOAL', NULL, 16, 3),
    (900076, 90016, 'GOAL', NULL, 2, 4),
    (900077, 90016, 'GOAL', NULL, 2, 15),
    -- match 90017: Nixogradnja vs Caffe bar Down Town & Vinarija Petrač
    (900078, 90017, 'GOAL', NULL, 6, 1),
    (900079, 90017, 'GOAL', NULL, 18, 13),
    (900080, 90017, 'GOAL', NULL, 18, 15),
    (900081, 90017, 'GOAL', NULL, 6, 16),
    (900082, 90017, 'PENALTY_GOAL', NULL, 18, 32),
    (900083, 90017, 'PENALTY_GOAL', NULL, 6, 32),
    (900084, 90017, 'PENALTY_GOAL', NULL, 18, 33),
    (900085, 90017, 'PENALTY_MISSED', NULL, 6, 33),
    (900086, 90017, 'PENALTY_GOAL', NULL, 18, 34),
    -- match 90018: Kr adapting vs Caffe bar Down Town & Vinarija Petrač
    (900087, 90018, 'PENALTY_GOAL', NULL, 16, 31),
    (900088, 90018, 'PENALTY_GOAL', NULL, 6, 31),
    (900089, 90018, 'PENALTY_GOAL', NULL, 16, 32),
    (900090, 90018, 'PENALTY_MISSED', NULL, 6, 32),
    (900091, 90018, 'PENALTY_GOAL', NULL, 16, 33),
    -- match 90019: Juraj Centar vs Nixogradnja
    (900092, 90019, 'GOAL', 90101, NULL, 4),
    (900093, 90019, 'GOAL', 90106, NULL, 10),
    (900094, 90019, 'GOAL', 90107, NULL, 12),
    (900095, 90019, 'GOAL', 90102, NULL, 12),
    (900096, 90019, 'PENALTY_GOAL', 90103, NULL, 32),
    (900097, 90019, 'PENALTY_GOAL', 90108, NULL, 33),
    (900098, 90019, 'PENALTY_GOAL', 90104, NULL, 33),
    (900099, 90019, 'PENALTY_GOAL', 90109, NULL, 33),
    (900100, 90019, 'PENALTY_GOAL', 90105, NULL, 34),
    (900101, 90019, 'PENALTY_GOAL', 90106, NULL, 34),
    (900102, 90019, 'PENALTY_GOAL', 90104, NULL, 35),
    (900103, 90019, 'PENALTY_GOAL', 90109, NULL, 36),
    (900104, 90019, 'PENALTY_MISSED', 90104, NULL, 37),
    (900105, 90019, 'PENALTY_GOAL', 90109, NULL, 38);

-- ── Podium (KnockoutService.recordResult / TournamentController.setPodium fields) ──
UPDATE tournaments
SET winner_name = 'Juraj Centar',
    second_place_name = 'Nixogradnja',
    third_place_name = 'Kr adapting'
WHERE id = 1;

-- ── Standings: NOT inserted. The `standings` table is dead - nothing reads it.
-- Group standings are computed live from FINISHED matches (GroupStageService);
-- knockout placement is read from tournaments.winner_name/second_place_name/
-- third_place_name (set above), not from any persisted ranking table.

-- ── Bump sequences past every id used above ───────────────────────────────
SELECT setval('seq_teams_id', GREATEST((SELECT MAX(id) FROM teams), 21), true);
SELECT setval('seq_rounds_id', GREATEST((SELECT MAX(id) FROM rounds), 9001), true);
SELECT setval('seq_matches_id', GREATEST((SELECT MAX(id) FROM matches), 90019), true);
SELECT setval('seq_players_id', GREATEST((SELECT MAX(id) FROM players), 90109), true);
SELECT setval('seq_match_events_id', GREATEST((SELECT MAX(id) FROM match_events), 900105), true);

COMMIT;
