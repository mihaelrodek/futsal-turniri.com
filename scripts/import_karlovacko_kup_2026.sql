-- ═══════════════════════════════════════════════════════════════════════════
-- Import: "Karlovačko Kup 2026 - Žarovnica 2026"
-- Scraped from: https://www.turniri.hr/raspored-i-rezultati/karlovacko-kup-2026-zarovnica-2026-63.html
-- Scraped at:   2026-07-11 (turniri.hr internal JSON endpoint /dajStatistkuUtakmicePrikaz)
--
-- State at scrape time:
--   • groups D/E/F/G fully played on 10.07. - 15 matches with goals & cards
--     per minute (68 timeline events, scores cross-checked against goal events)
--   • groups A/B/C scheduled for 11.07. 15:00-19:00 (imported as SCHEDULED)
--   • knockout (4×QF, 2×SF, 3rd place, final) scheduled 11.07. 19:30-23:05 -
--     imported as the reserved-kickoff skeleton; QF pairs already known from
--     the page are pre-filled (QF3, QF4 + DRUGOVI in QF1), the rest stay TBD.
--     Regenerating the bracket in-app keeps these kickoffs (applyReservedKickoffs).
--
-- Mapping notes:
--   • minutes: turniri.hr stores minute-within-half; this app stores the
--     continuous match minute → 2nd-half events are imported as 12 + minute
--     (halves are 12 min; half_length_min=12 splits the timeline at 12').
--     One event (S. Golub, goal 12' 1st half) sits exactly on the boundary
--     and will render under "2. poluvrijeme" - same as a goal recorded in
--     the app at 11:59 of the 1st half.
--   • player names uppercased (app convention, aggregates the all-time list)
--   • one anonymous yellow card (ELEKTRO KRUNO) → player NULL + team set
--   • created_by_uid is left NULL → only admins can manage the tournament;
--     optionally set your Firebase UID below (search for CREATED_BY_UID).
--
-- Run:  psql "$DATABASE_URL" -f scripts/import_karlovacko_kup_2026.sql
-- Safe: single transaction; aborts if the tournament was already imported.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Guard against double import.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM tournaments
               WHERE name = 'Karlovačko Kup 2026 - Žarovnica 2026'
                 AND is_deleted = false) THEN
        RAISE EXCEPTION 'Turnir "Karlovačko Kup 2026 - Žarovnica 2026" već postoji - import preskočen.';
    END IF;
END $$;

-- ── Tournament ──────────────────────────────────────────────────────────────
CREATE TEMP TABLE _imp_t ON COMMIT DROP AS
SELECT nextval('seq_tournaments_id')::bigint AS id;

INSERT INTO tournaments (id, name, location, start_at, status, max_teams, entry_price,
                         format, group_count, advance_per_group, best_third_count, bracket_fill,
                         half_count, half_length_min, halftime_break_min, break_between_matches_min,
                         created_by_uid, created_by_name)
SELECT id,
       'Karlovačko Kup 2026 - Žarovnica 2026',
       'Žarovnica',
       timestamptz '2026-07-10 17:00:00+02',
       'STARTED',
       22,
       0,
       'GROUPS_KNOCKOUT',
       7,   -- groups A..G
       1,   -- winner of each group advances
       1,   -- + the best runner-up (8th QF slot - DRUGOVI on the source page)
       'BYES',
       2, 12, 1, 5,
       NULL,                -- CREATED_BY_UID: stavi svoj Firebase UID ako želiš uređivati kao vlasnik
       'Import (turniri.hr)'
FROM _imp_t;

-- ── Groups A..G ─────────────────────────────────────────────────────────────
CREATE TEMP TABLE _imp_g ON COMMIT DROP AS
SELECT v.letter, v.ord, nextval('seq_groups_id')::bigint AS id
FROM (VALUES ('A',0),('B',1),('C',2),('D',3),('E',4),('F',5),('G',6)) v(letter, ord);

INSERT INTO tournament_groups (id, tournament_id, name, ordinal)
SELECT g.id, t.id, g.letter, g.ord FROM _imp_g g CROSS JOIN _imp_t t;

-- ── Teams (ext = turniri.hr team id; pos = listing order within the group) ──
CREATE TEMP TABLE _imp_tm ON COMMIT DROP AS
SELECT v.ext, v.letter, v.name, v.pos, nextval('seq_teams_id')::bigint AS id
FROM (VALUES
    (892,'A','GEP J.D.O.O.',0),
    (828,'A','SAFEFLOW',1),
    (889,'A','UŠR CVETLIN JUNIORI',2),
    (865,'B','NANI-PLUS & MM PROJEKT',0),
    (829,'B','ŠRU ORKAN',1),
    (827,'B','TRANSPORTI MAČEK & ELEKTROMONT M',2),
    (824,'C','DŠR ŽAROVNICA & MH SYSTEM & BUENO CAFFE',0),
    (882,'C','GRADNJA BEŠENIĆ',1),
    (881,'C','OGREVANJE ZAMUDA',2),
    (888,'D','MARATON USLUGE',0),
    (832,'D','UŠR CVETLIN',1),
    (825,'D','NK TRAKOŠČAN',2),
    (890,'E','DŠR ŽAROVNICA & MH SYSTEM & BUENO CAFFE II',0),
    (880,'E','AUTO MAČEK',1),
    (830,'E','UŠR VIŠNJICA',2),
    (834,'F','SLAVEK I PRIJATELJI',0),
    (887,'F','DUKE INTERNATIONAL',1),
    (837,'F','JB WOHNBAU',2),
    (833,'G','UKS BEDENEC',0),
    (891,'G','DRUGOVI',1),
    (883,'G','ELEKTRO KRUNO',2),
    (826,'G','CAFFE BAR DUX',3)
) v(ext, letter, name, pos);

INSERT INTO teams (id, tournament_id, name, group_id, draw_position)
SELECT tm.id, t.id, tm.name, g.id, tm.pos
FROM _imp_tm tm
JOIN _imp_g g ON g.letter = tm.letter
CROSS JOIN _imp_t t;

-- ── Rounds: 1..3 = group matchdays ("kolo"), 4 = the whole knockout ─────────
CREATE TEMP TABLE _imp_r ON COMMIT DROP AS
SELECT v.num, nextval('seq_rounds_id')::bigint AS id
FROM (VALUES (1),(2),(3),(4)) v(num);

INSERT INTO rounds (id, tournament_id, number, created_at)
SELECT r.id, t.id, r.num, now() FROM _imp_r r CROSS JOIN _imp_t t;

-- ── Matches ─────────────────────────────────────────────────────────────────
-- ext = turniri.hr match id (9001..9008 are synthetic ids for the knockout).
-- kolo: group matchday 1..3 (knockout rows use 4). w = winning team ext (draw → NULL).
CREATE TEMP TABLE _imp_m ON COMMIT DROP AS
SELECT v.ext, v.letter, v.kolo, v.t1, v.t2, v.s1, v.s2, v.w, v.status, v.kick::timestamptz AS kick,
       v.stage, v.ko_ord, nextval('seq_matches_id')::bigint AS id
FROM (VALUES
    -- ── group A (scheduled 11.07.) ──
    (55603,'A',1,  892,  828, NULL::int, NULL::int, NULL::int, 'SCHEDULED', '2026-07-11 16:00:00+02', 'GROUP', NULL::int),
    (55604,'A',2,  889,  828, NULL, NULL, NULL, 'SCHEDULED', '2026-07-11 17:30:00+02', 'GROUP', NULL),
    (55605,'A',3,  889,  892, NULL, NULL, NULL, 'SCHEDULED', '2026-07-11 15:00:00+02', 'GROUP', NULL),
    -- ── group B (scheduled 11.07.) ──
    (55606,'B',1,  865,  829, NULL, NULL, NULL, 'SCHEDULED', '2026-07-11 15:30:00+02', 'GROUP', NULL),
    (55607,'B',2,  827,  829, NULL, NULL, NULL, 'SCHEDULED', '2026-07-11 18:30:00+02', 'GROUP', NULL),
    (55608,'B',3,  827,  865, NULL, NULL, NULL, 'SCHEDULED', '2026-07-11 16:30:00+02', 'GROUP', NULL),
    -- ── group C (scheduled 11.07.) ──
    (55609,'C',1,  824,  882, NULL, NULL, NULL, 'SCHEDULED', '2026-07-11 17:00:00+02', 'GROUP', NULL),
    (55610,'C',2,  881,  882, NULL, NULL, NULL, 'SCHEDULED', '2026-07-11 19:00:00+02', 'GROUP', NULL),
    (55611,'C',3,  881,  824, NULL, NULL, NULL, 'SCHEDULED', '2026-07-11 18:00:00+02', 'GROUP', NULL),
    -- ── group D (played 10.07.) ──
    (55612,'D',1,  832,  888, 0, 2,  888, 'FINISHED', '2026-07-10 20:00:00+02', 'GROUP', NULL),
    (55613,'D',2,  825,  888, 2, 2, NULL, 'FINISHED', '2026-07-10 23:00:00+02', 'GROUP', NULL),
    (55614,'D',3,  825,  832, 2, 3,  832, 'FINISHED', '2026-07-10 22:00:00+02', 'GROUP', NULL),
    -- ── group E (played 10.07.) ──
    (55615,'E',1,  830,  880, 1, 2,  880, 'FINISHED', '2026-07-10 19:00:00+02', 'GROUP', NULL),
    (55616,'E',2,  890,  880, 1, 0,  890, 'FINISHED', '2026-07-10 23:59:00+02', 'GROUP', NULL),
    (55617,'E',3,  890,  830, 3, 1,  890, 'FINISHED', '2026-07-10 22:30:00+02', 'GROUP', NULL),
    -- ── group F (played 10.07.) ──
    (55618,'F',1,  837,  834, 1, 5,  834, 'FINISHED', '2026-07-10 21:00:00+02', 'GROUP', NULL),
    (55619,'F',2,  887,  834, 0, 2,  834, 'FINISHED', '2026-07-10 23:30:00+02', 'GROUP', NULL),
    (55620,'F',3,  887,  837, 3, 0,  887, 'FINISHED', '2026-07-10 17:30:00+02', 'GROUP', NULL),
    -- ── group G (played 10.07., 4 teams → 2 matches per matchday) ──
    (55621,'G',1,  883,  891, 0, 4,  891, 'FINISHED', '2026-07-10 17:00:00+02', 'GROUP', NULL),
    (55622,'G',1,  833,  826, 6, 3,  833, 'FINISHED', '2026-07-10 21:30:00+02', 'GROUP', NULL),
    (55623,'G',2,  883,  826, 3, 1,  883, 'FINISHED', '2026-07-10 19:30:00+02', 'GROUP', NULL),
    (55624,'G',2,  891,  833, 0, 2,  833, 'FINISHED', '2026-07-10 20:30:00+02', 'GROUP', NULL),
    (55625,'G',3,  883,  833, 1, 2,  833, 'FINISHED', '2026-07-10 18:30:00+02', 'GROUP', NULL),
    (55626,'G',3,  826,  891, 0, 8,  891, 'FINISHED', '2026-07-10 18:00:00+02', 'GROUP', NULL),
    -- ── knockout skeleton (scheduled 11.07. evening; known pairs pre-filled) ──
    ( 9001,NULL,4, NULL,  891, NULL, NULL, NULL, 'SCHEDULED', '2026-07-11 19:30:00+02', 'QUARTERFINAL', 1),
    ( 9002,NULL,4, NULL, NULL, NULL, NULL, NULL, 'SCHEDULED', '2026-07-11 20:00:00+02', 'QUARTERFINAL', 2),
    ( 9003,NULL,4,  888,  890, NULL, NULL, NULL, 'SCHEDULED', '2026-07-11 20:30:00+02', 'QUARTERFINAL', 3),
    ( 9004,NULL,4,  834,  833, NULL, NULL, NULL, 'SCHEDULED', '2026-07-11 21:00:00+02', 'QUARTERFINAL', 4),
    ( 9005,NULL,4, NULL, NULL, NULL, NULL, NULL, 'SCHEDULED', '2026-07-11 21:30:00+02', 'SEMIFINAL',    5),
    ( 9006,NULL,4, NULL, NULL, NULL, NULL, NULL, 'SCHEDULED', '2026-07-11 22:00:00+02', 'SEMIFINAL',    6),
    ( 9007,NULL,4, NULL, NULL, NULL, NULL, NULL, 'SCHEDULED', '2026-07-11 22:35:00+02', 'THIRD_PLACE',  7),
    ( 9008,NULL,4, NULL, NULL, NULL, NULL, NULL, 'SCHEDULED', '2026-07-11 23:05:00+02', 'FINAL',        8)
) v(ext, letter, kolo, t1, t2, s1, s2, w, status, kick, stage, ko_ord);

INSERT INTO matches (id, tournament_id, round_id, stage, group_id,
                     team1_id, team2_id, score1, score2, winner_team_id,
                     status, kickoff_at)
SELECT m.id, t.id, r.id, m.stage, g.id,
       tm1.id, tm2.id, m.s1, m.s2, tmw.id,
       m.status, m.kick
FROM _imp_m m
JOIN _imp_r r   ON r.num = m.kolo
LEFT JOIN _imp_g  g   ON g.letter = m.letter
LEFT JOIN _imp_tm tm1 ON tm1.ext = m.t1
LEFT JOIN _imp_tm tm2 ON tm2.ext = m.t2
LEFT JOIN _imp_tm tmw ON tmw.ext = m.w
CROSS JOIN _imp_t t;

-- Knockout advancement links (winner of QFn → SF slot, SF → final).
-- Third place is fed by the semifinal losers in the service layer - no link.
UPDATE matches SET next_match_id = nm.id, next_slot = v.slot
FROM (VALUES (9001, 9005, 1), (9002, 9005, 2),
             (9003, 9006, 1), (9004, 9006, 2),
             (9005, 9008, 1), (9006, 9008, 2)) v(cur, nxt, slot)
JOIN _imp_m cm ON cm.ext = v.cur
JOIN _imp_m nm ON nm.ext = v.nxt
WHERE matches.id = cm.id;

-- ── Players (everyone who appears in the event feed; names uppercased) ──────
CREATE TEMP TABLE _imp_p ON COMMIT DROP AS
SELECT v.ext, v.team_ext, v.name, nextval('seq_players_id')::bigint AS id
FROM (VALUES
    (18098, 888, 'MARGET PISKAČ'),
    (18104, 888, 'JURICA PRAŠNJAK'),
    (18096, 888, 'BOJAN HERCEG'),
    (18141, 825, 'JASMIN HRŽIN'),
    (18136, 825, 'DARIAN ČRETNI'),
    (18137, 825, 'DAVID VORIH'),
    (18140, 825, 'ŽAN KOGOJ'),
    (18107, 832, 'PATRIK KRAMAR'),
    (18106, 832, 'RENATO VRBANIĆ'),
    (18112, 832, 'DENIS NAHBERGER'),
    (18091, 880, 'DARIO GALINEC'),
    (18089, 880, 'ADARIAN STANČIĆ'),
    (18090, 880, 'ANDRIJA GREGUREC'),
    (18077, 830, 'TONI ZAGORŠČAK'),
    (18078, 830, 'IVAN ZVER'),
    (18172, 890, 'VLADO MARTIĆ'),
    (18170, 890, 'DARIO ŠINCEK'),
    (18183, 890, 'DARIO BUBEK'),
    (18169, 890, 'DRAGO OŠTARIJAŠ'),
    (18125, 834, 'DARKO JAGIĆ'),
    (18122, 834, 'DARIO BOBEK'),
    (18120, 834, 'MATIJA BOBEK'),
    (18013, 837, 'DARIO BELAČ'),
    (17990, 887, 'MARIO GALINEC'),
    (18000, 887, 'NIKOLA GLAVICA'),
    (17999, 887, 'LEON BRLEČIĆ'),
    (17936, 891, 'PETAR KOVAČIĆ'),
    (17937, 891, 'DAVID KOVAČIĆ'),
    (17934, 891, 'MARIN NOVOSELEV'),
    (17938, 891, 'IVAN TOMIŠA'),
    (17935, 891, 'DARIO PRESEČKI'),
    (17942, 891, 'LUKA SERINI'),
    (17939, 891, 'HRVOJE KOVAČIĆ'),
    (18051, 833, 'MARIN BELCAR'),
    (18052, 833, 'MARIO NOVAK'),
    (18062, 833, 'TOMO ŽELJEŽIĆ'),
    (18047, 833, 'IVICA HUNJET'),
    (18032, 826, 'VALENTINO DELIMAR'),
    (18030, 826, 'LUKA BANIČEK'),
    (18034, 826, 'LUKA JEREŠIĆ'),
    (18033, 826, 'NIKOLA VRHOVSKI'),
    (18026, 826, 'ANTONIO ŠPREM'),
    (17944, 883, 'STIVEN GOLUB')
) v(ext, team_ext, name);

INSERT INTO players (id, team_id, name, sort_order)
SELECT p.id, tm.id, p.name,
       row_number() OVER (PARTITION BY p.team_ext ORDER BY p.ext) - 1
FROM _imp_p p
JOIN _imp_tm tm ON tm.ext = p.team_ext;

-- ── Match events (goals + cards) ─────────────────────────────────────────────
-- minute is the CONTINUOUS match minute (2nd half = 12 + minute-in-half).
-- ord preserves the source insertion order; created_at = kickoff + minute
-- + ord seconds gives the timeline a stable same-minute tiebreak.
-- player_ext NULL = anonymous event → team_id carries the side.
CREATE TEMP TABLE _imp_e ON COMMIT DROP AS
SELECT * FROM (VALUES
    -- UŠR CVETLIN 0:2 MARATON USLUGE
    (55612, 0, 888, 18098, 'GOAL',         6),
    (55612, 1, 888, 18104, 'GOAL',        21),
    -- NK TRAKOŠČAN 2:2 MARATON USLUGE
    (55613, 0, 888, 18096, 'GOAL',         7),
    (55613, 1, 825, 18141, 'GOAL',         4),
    (55613, 2, 825, 18141, 'GOAL',         2),
    (55613, 3, 888, 18096, 'GOAL',        23),
    (55613, 4, 825, 18136, 'RED_CARD',    17),
    (55613, 5, 825, 18137, 'YELLOW_CARD', 22),
    -- NK TRAKOŠČAN 2:3 UŠR CVETLIN
    (55614, 0, 832, 18107, 'GOAL',         3),
    (55614, 1, 825, 18140, 'GOAL',         5),
    (55614, 2, 832, 18106, 'YELLOW_CARD', 17),
    (55614, 3, 832, 18112, 'GOAL',        18),
    (55614, 4, 832, 18107, 'YELLOW_CARD', 19),
    (55614, 5, 825, 18140, 'GOAL',        20),
    (55614, 6, 832, 18112, 'GOAL',        24),
    -- UŠR VIŠNJICA 1:2 AUTO MAČEK
    (55615, 0, 880, 18091, 'GOAL',        11),
    (55615, 1, 830, 18077, 'GOAL',        16),
    (55615, 2, 880, 18089, 'GOAL',        19),
    (55615, 3, 880, 18090, 'YELLOW_CARD', 20),
    (55615, 4, 880, 18091, 'YELLOW_CARD', 22),
    -- ŽAROVNICA II 1:0 AUTO MAČEK
    (55616, 0, 890, 18172, 'GOAL',        20),
    -- ŽAROVNICA II 3:1 UŠR VIŠNJICA
    (55617, 0, 890, 18170, 'GOAL',         5),
    (55617, 1, 890, 18183, 'GOAL',        16),
    (55617, 2, 830, 18078, 'GOAL',        18),
    (55617, 3, 890, 18169, 'GOAL',        23),
    -- JB WOHNBAU 1:5 SLAVEK I PRIJATELJI
    (55618, 0, 834, 18125, 'GOAL',         5),
    (55618, 1, 837, 18013, 'GOAL',         7),
    (55618, 2, 834, 18122, 'GOAL',        11),
    (55618, 3, 834, 18120, 'GOAL',        17),
    (55618, 4, 834, 18122, 'GOAL',        24),
    (55618, 5, 834, 18122, 'GOAL',        14),
    -- DUKE INTERNATIONAL 0:2 SLAVEK I PRIJATELJI
    (55619, 0, 834, 18125, 'GOAL',        22),
    (55619, 1, 834, 18120, 'GOAL',        24),
    -- DUKE INTERNATIONAL 3:0 JB WOHNBAU
    (55620, 0, 887, 17990, 'GOAL',        14),
    (55620, 1, 887, 18000, 'GOAL',        19),
    (55620, 2, 887, 17999, 'GOAL',        22),
    -- ELEKTRO KRUNO 0:4 DRUGOVI
    (55621, 0, 891, 17936, 'GOAL',         5),
    (55621, 1, 891, 17937, 'GOAL',        15),
    (55621, 2, 891, 17934, 'GOAL',        19),
    (55621, 3, 891, 17938, 'GOAL',        22),
    -- UKS BEDENEC 6:3 CAFFE BAR DUX
    (55622, 0, 833, 18051, 'GOAL',         2),
    (55622, 1, 826, 18032, 'GOAL',         8),
    (55622, 2, 833, 18052, 'GOAL',        10),
    (55622, 3, 833, 18052, 'GOAL',         5),
    (55622, 4, 826, 18030, 'GOAL',        19),
    (55622, 5, 833, 18062, 'GOAL',        20),
    (55622, 6, 826, 18034, 'GOAL',        21),
    (55622, 7, 833, 18051, 'GOAL',        23),
    (55622, 8, 833, 18051, 'GOAL',        24),
    -- ELEKTRO KRUNO 3:1 CAFFE BAR DUX  (žuti bez imena → anon)
    (55623, 0, 883, 17944, 'GOAL',        12),
    (55623, 1, 883, 17944, 'GOAL',        14),
    (55623, 2, 826, 18033, 'GOAL',        16),
    (55623, 3, 883, 17944, 'GOAL',        19),
    (55623, 4, 883, NULL::int, 'YELLOW_CARD', 22),
    -- DRUGOVI 0:2 UKS BEDENEC
    (55624, 0, 833, 18051, 'GOAL',        16),
    (55624, 1, 833, 18047, 'GOAL',        21),
    -- ELEKTRO KRUNO 1:2 UKS BEDENEC
    (55625, 0, 833, 18051, 'GOAL',         2),
    (55625, 1, 883, 17944, 'GOAL',         9),
    (55625, 2, 833, 18051, 'GOAL',        23),
    -- CAFFE BAR DUX 0:8 DRUGOVI
    (55626, 0, 891, 17936, 'GOAL',         2),
    (55626, 1, 891, 17935, 'GOAL',         5),
    (55626, 2, 891, 17936, 'GOAL',         9),
    (55626, 3, 826, 18026, 'YELLOW_CARD', 10),
    (55626, 4, 891, 17937, 'GOAL',        13),
    (55626, 5, 891, 17942, 'GOAL',        17),
    (55626, 6, 891, 17939, 'GOAL',        19),
    (55626, 7, 891, 17936, 'GOAL',        21),
    (55626, 8, 891, 17936, 'GOAL',        23)
) v(match_ext, ord, team_ext, player_ext, type, minute);

INSERT INTO match_events (id, match_id, type, player_id, team_id, minute, created_at)
SELECT nextval('seq_match_events_id'),
       m.id,
       e.type,
       p.id,
       CASE WHEN e.player_ext IS NULL THEN tm.id END,  -- team only for anon events
       e.minute,
       m.kick + (e.minute * interval '1 minute') + (e.ord * interval '1 second')
FROM _imp_e e
JOIN _imp_m  m  ON m.ext  = e.match_ext
LEFT JOIN _imp_p  p  ON p.ext  = e.player_ext
LEFT JOIN _imp_tm tm ON tm.ext = e.team_ext;

-- ── Sanity checks (abort the whole transaction on mismatch) ─────────────────
DO $$
DECLARE
    v_teams   int; v_matches int; v_events  int; v_goal_mismatch int;
BEGIN
    SELECT count(*) INTO v_teams   FROM teams   WHERE tournament_id = (SELECT id FROM _imp_t);
    SELECT count(*) INTO v_matches FROM matches WHERE tournament_id = (SELECT id FROM _imp_t);
    SELECT count(*) INTO v_events  FROM match_events me
        JOIN matches ma ON ma.id = me.match_id
        WHERE ma.tournament_id = (SELECT id FROM _imp_t);
    IF v_teams <> 22   THEN RAISE EXCEPTION 'Očekivano 22 ekipe, uneseno %', v_teams; END IF;
    IF v_matches <> 32 THEN RAISE EXCEPTION 'Očekivano 32 utakmice (24 grupa + 8 KO), uneseno %', v_matches; END IF;
    IF v_events <> 68  THEN RAISE EXCEPTION 'Očekivano 68 događaja, uneseno %', v_events; END IF;

    -- Stored score must equal the number of imported GOAL events per side.
    SELECT count(*) INTO v_goal_mismatch FROM (
        SELECT ma.id
        FROM matches ma
        WHERE ma.tournament_id = (SELECT id FROM _imp_t)
          AND ma.status = 'FINISHED'
          AND (ma.score1 <> (SELECT count(*) FROM match_events me
                             LEFT JOIN players p ON p.id = me.player_id
                             WHERE me.match_id = ma.id AND me.type = 'GOAL'
                               AND coalesce(me.team_id, p.team_id) = ma.team1_id)
            OR ma.score2 <> (SELECT count(*) FROM match_events me
                             LEFT JOIN players p ON p.id = me.player_id
                             WHERE me.match_id = ma.id AND me.type = 'GOAL'
                               AND coalesce(me.team_id, p.team_id) = ma.team2_id))
    ) x;
    IF v_goal_mismatch <> 0 THEN
        RAISE EXCEPTION 'Rezultat i golovi se ne poklapaju u % utakmica', v_goal_mismatch;
    END IF;

    RAISE NOTICE 'Import OK: 22 ekipe, 32 utakmice (15 odigranih), 68 događaja.';
END $$;

COMMIT;
