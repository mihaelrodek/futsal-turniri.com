-- ═══════════════════════════════════════════════════════════════════════════
-- Inkrementalni import: grupe A/B/C (odigrane 11.07.) za
-- "Karlovačko Kup 2026 - Žarovnica 2026"
-- Izvor: https://www.turniri.hr/raspored-i-rezultati/karlovacko-kup-2026-zarovnica-2026-63.html
--        (interni JSON /dajStatistkuUtakmicePrikaz, po utakmici)
--
-- Turnir, ekipe, igrači i SVE 32 utakmice već postoje (jučerašnji import); A/B/C
-- su tada bile SCHEDULED. Ova skripta ih ZAVRŠAVA: postavi rezultat + status,
-- i doda golove/kartone (41 događaj). Ništa se ne referencira po ID-u — sve se
-- nalazi po imenu (turnir → naziv, ekipe → naziv, utakmice → grupa + par ekipa,
-- igrači → UPPER(ime) unutar ekipe).
--
-- Napomene:
--   • minute: turniri.hr sprema minutu-unutar-poluvremena; ova app sprema
--     kontinuiranu minutu → 2. poluvrijeme = 12 + minuta (poluvrijeme = 12 min).
--   • 6 golova (ŽAROVNICA/OGREVANJE 3:0 GRADNJA) NEMA strijelca na izvoru →
--     unose se kao TIMSKI (player NULL, team_id postavljen) da rezultat ostane
--     točan. Skripta na kraju izvijesti koliko je golova ostalo bez strijelca i
--     koliko IMENOVANIH golova nije nađeno po imenu (ako se roster razlikuje).
--   • IDEMPOTENTNO: prvo briše postojeće događaje tih 9 utakmica pa unosi nanovo
--     (sigurno za ponovno pokretanje / ako je nešto već ručno uneseno).
--   • Knockout NIJE odigran na izvoru → ne dira se. Nakon uvoza po želji
--     regeneriraj ždrijeb u aplikaciji da se popune parovi četvrtfinala
--     (pobjednici grupa + najbolji drugoplasirani); rezervirane satnice ostaju.
--
-- Run:  psql "$DATABASE_URL" -f scripts/import_karlovacko_kup_2026_grupe_abc.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Turnir ──────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _t ON COMMIT DROP AS
SELECT id FROM tournaments
WHERE name = 'Karlovačko Kup 2026 - Žarovnica 2026' AND is_deleted = false;

DO $$ BEGIN
    IF (SELECT count(*) FROM _t) <> 1 THEN
        RAISE EXCEPTION 'Turnir nije jednoznačno pronađen po nazivu (našao %). Prekid.',
            (SELECT count(*) FROM _t);
    END IF;
END $$;

-- ── 9 utakmica A/B/C: (mi, grupa, ekipa1, ekipa2, rez1, rez2, pobjednik-strana) ─
-- wside: 1 = ekipa1, 2 = ekipa2, NULL = neriješeno. Nazivi i orijentacija
-- (ekipa1/ekipa2) identični su jučerašnjem unosu (turniri.hr idekipe1/idekipe2).
CREATE TEMP TABLE _m ON COMMIT DROP AS
SELECT * FROM (VALUES
    (1,'A','GEP J.D.O.O.',                              'SAFEFLOW',                                 1, 4, 2),
    (2,'A','UŠR CVETLIN JUNIORI',                       'SAFEFLOW',                                 1, 8, 2),
    (3,'A','UŠR CVETLIN JUNIORI',                       'GEP J.D.O.O.',                             1, 6, 2),
    (4,'B','NANI-PLUS & MM PROJEKT',                    'ŠRU ORKAN',                                2, 0, 1),
    (5,'B','TRANSPORTI MAČEK & ELEKTROMONT M',          'ŠRU ORKAN',                                4, 0, 1),
    (6,'B','TRANSPORTI MAČEK & ELEKTROMONT M',          'NANI-PLUS & MM PROJEKT',                   1, 1, NULL::int),
    (7,'C','DŠR ŽAROVNICA & MH SYSTEM & BUENO CAFFE',   'GRADNJA BEŠENIĆ',                          3, 0, 1),
    (8,'C','OGREVANJE ZAMUDA',                          'GRADNJA BEŠENIĆ',                          3, 0, 1),
    (9,'C','OGREVANJE ZAMUDA',                          'DŠR ŽAROVNICA & MH SYSTEM & BUENO CAFFE',  3, 0, 1)
) v(mi, grp, t1name, t2name, s1, s2, wside);

-- Poveži svaku na postojeći red u `matches` (turnir + grupa + par ekipa po imenu).
CREATE TEMP TABLE _mr ON COMMIT DROP AS
SELECT m.mi, ma.id AS match_id, ma.team1_id, ma.team2_id,
       ma.status AS old_status, ma.kickoff_at, m.s1, m.s2, m.wside
FROM _m m
JOIN _t  t   ON true
JOIN tournament_groups g ON g.tournament_id = t.id AND g.name = m.grp
JOIN teams tm1 ON tm1.tournament_id = t.id AND tm1.name = m.t1name
JOIN teams tm2 ON tm2.tournament_id = t.id AND tm2.name = m.t2name
JOIN matches ma ON ma.tournament_id = t.id AND ma.group_id = g.id
                AND ma.team1_id = tm1.id AND ma.team2_id = tm2.id;

DO $$
DECLARE v_found int; v_already int;
BEGIN
    SELECT count(*) INTO v_found FROM _mr;
    IF v_found <> 9 THEN
        RAISE EXCEPTION 'Očekivano 9 utakmica A/B/C, pronađeno % (provjeri nazive ekipa / orijentaciju). Prekid.', v_found;
    END IF;
    SELECT count(*) INTO v_already FROM _mr WHERE old_status = 'FINISHED';
    IF v_already > 0 THEN
        RAISE NOTICE 'Napomena: % od 9 utakmica je već bilo FINISHED - prepisujem ih s izvora.', v_already;
    END IF;
END $$;

-- ── Događaji: (mi, ord, strana, IGRAČ(UPPER; ''=anon), tip, kontinuirana minuta) ─
CREATE TEMP TABLE _e ON COMMIT DROP AS
SELECT * FROM (VALUES
    -- 1) GEP 1:4 SAFEFLOW
    (1,0,1,'LUKA GOLUB',        'GOAL',         3),
    (1,1,2,'PETAR BANEKOVIĆ',   'GOAL',        14),
    (1,2,2,'MARKO BRIŠKI',      'GOAL',        15),
    (1,3,2,'ALEN BUNIĆ',        'GOAL',        21),
    (1,4,2,'FILIP HAJDUK',      'GOAL',        23),
    -- 2) UŠR CVETLIN JUNIORI 1:8 SAFEFLOW
    (2,0,2,'ALEN BUNIĆ',        'GOAL',         3),
    (2,1,2,'DRAŽEN PETROVIĆ',   'GOAL',         6),
    (2,2,2,'DRAŽEN PETROVIĆ',   'GOAL',         7),
    (2,3,2,'ALEN BUNIĆ',        'GOAL',        13),
    (2,4,2,'ZVONIMIR KOPRIVNJAK','GOAL',       14),
    (2,5,2,'JAN FUSIĆ',         'GOAL',        17),
    (2,6,1,'PATRIK KOVAČ',      'GOAL',        19),
    (2,7,2,'TIN FRUK',          'GOAL',        22),
    (2,8,2,'JAN FUSIĆ',         'GOAL',        23),
    -- 3) UŠR CVETLIN JUNIORI 1:6 GEP
    (3,0,2,'LUKA GOLUB',        'GOAL',         1),
    (3,1,2,'ALEN KUNALIĆ',      'GOAL',         3),
    (3,2,1,'SILVIO BEDNJIČKI',  'GOAL',         3),
    (3,3,2,'LUKA GOLUB',        'GOAL',         4),
    (3,4,2,'DINO KUNALIĆ',      'GOAL',        17),
    (3,5,2,'DINO KUNALIĆ',      'GOAL',        18),
    (3,6,2,'LUKA GOLUB',        'GOAL',        24),
    -- 4) NANI-PLUS 2:0 ŠRU ORKAN
    (4,0,1,'DAVID ŠTEFANEK',    'YELLOW_CARD', 19),
    (4,1,1,'ROKO LONČAR',       'GOAL',        21),
    (4,2,1,'MIHAEL ŠTEFANEK',   'GOAL',        24),
    -- 5) TRANSPORTI 4:0 ŠRU ORKAN
    (5,0,1,'SVEN HRGAR',        'GOAL',         8),
    (5,1,1,'SVEN HRGAR',        'GOAL',        10),
    (5,2,1,'EMIL MARTINČEVIĆ',  'GOAL',        11),
    (5,3,1,'DAVID ČRETNI',      'GOAL',        22),
    -- 6) TRANSPORTI 1:1 NANI-PLUS
    (6,0,2,'DAVID ŠTEFANEK',    'YELLOW_CARD',  4),
    (6,1,1,'EMIL MARTINČEVIĆ',  'GOAL',         5),
    (6,2,2,'JAN HUDOLETNJAK',   'GOAL',         5),
    (6,3,2,'RENATO RIBIĆ',      'YELLOW_CARD', 22),
    -- 7) DŠR ŽAROVNICA 3:0 GRADNJA BEŠENIĆ (bez strijelca na izvoru → timski)
    (7,0,1,'',                  'GOAL',         1),
    (7,1,1,'',                  'GOAL',         1),
    (7,2,1,'',                  'GOAL',         1),
    -- 8) OGREVANJE ZAMUDA 3:0 GRADNJA BEŠENIĆ (bez strijelca na izvoru → timski)
    (8,0,1,'',                  'GOAL',         1),
    (8,1,1,'',                  'GOAL',         1),
    (8,2,1,'',                  'GOAL',         1),
    -- 9) OGREVANJE ZAMUDA 3:0 DŠR ŽAROVNICA
    (9,0,1,'MARKO SENEKOVIĆ',   'GOAL',         4),
    (9,1,1,'ADRIJAN TRSTENJAK', 'GOAL',         8),
    (9,2,1,'ADRIJAN TRSTENJAK', 'GOAL',        18)
) v(mi, ord, side, player, type, minute);

-- ── Idempotentno: obriši postojeće događaje tih 9 utakmica ──────────────────
DELETE FROM match_events WHERE match_id IN (SELECT match_id FROM _mr);

-- ── Završi utakmice (rezultat + pobjednik + status) ─────────────────────────
UPDATE matches ma
SET score1 = r.s1,
    score2 = r.s2,
    status = 'FINISHED',
    winner_team_id = CASE r.wside WHEN 1 THEN r.team1_id WHEN 2 THEN r.team2_id END
FROM _mr r
WHERE ma.id = r.match_id;

-- ── Unos događaja ───────────────────────────────────────────────────────────
-- player_id = igrač nađen po (ekipa, UPPER(ime)); ako nije nađen (ili je anon),
-- player_id ostaje NULL a team_id nosi stranu → gol i dalje broji točno.
INSERT INTO match_events (id, match_id, type, player_id, team_id, minute, created_at)
SELECT nextval('seq_match_events_id'),
       r.match_id,
       e.type,
       pl.id,
       CASE WHEN pl.id IS NULL
            THEN CASE e.side WHEN 1 THEN r.team1_id ELSE r.team2_id END
       END,
       e.minute,
       r.kickoff_at + (e.minute * interval '1 minute') + (e.ord * interval '1 second')
FROM _e e
JOIN _mr r ON r.mi = e.mi
LEFT JOIN players pl
       ON pl.team_id = (CASE e.side WHEN 1 THEN r.team1_id ELSE r.team2_id END)
      AND e.player <> ''
      AND UPPER(TRIM(pl.name)) = e.player;

-- ── Provjere + izvještaj (rollback na neslaganje rezultat↔golovi) ────────────
DO $$
DECLARE
    v_events int; v_mismatch int; v_anon int; v_unmatched int;
BEGIN
    SELECT count(*) INTO v_events
        FROM match_events me WHERE me.match_id IN (SELECT match_id FROM _mr);
    IF v_events <> 41 THEN
        RAISE EXCEPTION 'Očekivan 41 događaj, uneseno %.', v_events;
    END IF;

    -- Rezultat mora biti jednak broju GOAL događaja po strani.
    SELECT count(*) INTO v_mismatch
    FROM _mr r JOIN matches ma ON ma.id = r.match_id
    WHERE ma.score1 <> (SELECT count(*) FROM match_events me LEFT JOIN players p ON p.id = me.player_id
                        WHERE me.match_id = ma.id AND me.type = 'GOAL'
                          AND coalesce(me.team_id, p.team_id) = ma.team1_id)
       OR ma.score2 <> (SELECT count(*) FROM match_events me LEFT JOIN players p ON p.id = me.player_id
                        WHERE me.match_id = ma.id AND me.type = 'GOAL'
                          AND coalesce(me.team_id, p.team_id) = ma.team2_id);
    IF v_mismatch <> 0 THEN
        RAISE EXCEPTION 'Rezultat i golovi se ne poklapaju u % utakmica. Prekid.', v_mismatch;
    END IF;

    SELECT count(*) INTO v_anon FROM _e WHERE type = 'GOAL' AND player = '';
    SELECT count(*) INTO v_unmatched
    FROM _e e JOIN _mr r ON r.mi = e.mi
    WHERE e.type = 'GOAL' AND e.player <> ''
      AND NOT EXISTS (
          SELECT 1 FROM players pl
          WHERE pl.team_id = (CASE e.side WHEN 1 THEN r.team1_id ELSE r.team2_id END)
            AND UPPER(TRIM(pl.name)) = e.player);

    RAISE NOTICE 'Import A/B/C OK: 9 utakmica završeno, 41 događaj.';
    RAISE NOTICE '  • golova bez strijelca na izvoru (timski): %', v_anon;
    RAISE NOTICE '  • IMENOVANIH golova NIJE nađeno po imenu u rosteru (uneseni kao timski): %', v_unmatched;
    IF v_unmatched > 0 THEN
        RAISE NOTICE '    → ako je ovaj broj velik, imena igrača u bazi se razlikuju od turniri.hr; javi pa riješimo.';
    END IF;
END $$;

COMMIT;
