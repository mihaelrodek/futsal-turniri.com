-- ============================================================================
-- demo-tournament.sql - "Pokazni turnir" (ogledni/showcase turnir)
-- ============================================================================
-- Ubacuje POTPUNO ODIGRAN demo turnir:
--   * 16 ekipa u 4 skupine (A-D) po 4 ekipe
--   * 6 igraca po ekipi (96 igraca, svi oznaceni is_demo = true)
--   * kompletan raspored: 24 utakmice skupina (3 kola) + cetvrtfinale,
--     polufinale, utakmica za 3. mjesto i finale - SVE odigrano s rezultatima
--   * golovi (strijelci + poneka asistencija), zuti i crveni kartoni,
--     jedanaesterac, penali u QF3 - vidljivo na timelineu svake utakmice
--   * poredak (pobjednik/2./3. mjesto) i najbolji strijelac upisani
--
-- PREDUVJET: backend s migracijom "player_is_demo" mora biti deployan PRIJE
-- pokretanja (dodaje kolonu players.is_demo). Inace: ERROR column does not exist.
--
-- POKRETANJE (na serveru, iz root direktorija repo-a):
--   docker exec -i futsal-postgres psql -U <POSTGRES_USER> -d <POSTGRES_DB> \
--       < scripts/demo-tournament.sql
--
-- BRISANJE KASNIJE (match_events referenciraju ekipe/igrace bez kaskade,
-- pa se dogadaji brisu PRVI; ostalo ide kaskadno preko turnira):
--   DELETE FROM match_events e USING matches m
--       WHERE e.match_id = m.id
--         AND m.tournament_id = (SELECT id FROM tournaments
--                                WHERE slug = 'pokazni-turnir-20-06-2026');
--   DELETE FROM tournaments WHERE slug = 'pokazni-turnir-20-06-2026';
--   DELETE FROM players WHERE is_demo;   -- za svaki slucaj / ostali demo igraci
--
-- Vlasnik turnira: preuzima se created_by_uid najstarijeg postojeceg turnira
-- (na produkciji je to tvoj racun), pa turnir mozes normalno uredivati.
-- ============================================================================

-- Pomocna (privremena, auto-drop na kraju sesije): generira golove utakmice
-- zavrsnice tocno prema rezultatu + poneki zuti karton. Kapetan (indeks 5,
-- broj 10) zabija neparne golove pa se prirodno profilira najbolji strijelac.
CREATE OR REPLACE FUNCTION pg_temp.demo_ko_events(
    p_mid bigint, p_seed int,
    p_players bigint[], p_teams bigint[],
    p_t1_idx int, p_t2_idx int, p_s1 int, p_s2 int
) RETURNS void AS $fn$
DECLARE
    side int; gl int; v_idx int; v_as int;
    v_abs int; v_minute int; v_scorer bigint; v_assist bigint;
BEGIN
    FOR side IN 1..2 LOOP
        v_abs := CASE side WHEN 1 THEN p_t1_idx ELSE p_t2_idx END;
        FOR gl IN 1..(CASE side WHEN 1 THEN p_s1 ELSE p_s2 END) LOOP
            v_minute := 1 + ((p_seed * 7 + gl * 5 + side * 3) % 20);
            v_idx := CASE WHEN gl % 2 = 1 THEN 5 ELSE 1 + ((p_seed + gl) % 6) END;
            v_scorer := p_players[(v_abs - 1) * 6 + v_idx];
            v_assist := NULL;
            IF (p_seed + gl) % 2 = 0 THEN
                v_as := 1 + ((v_idx + gl) % 6);
                IF v_as = v_idx THEN v_as := 1 + (v_as % 6); END IF;
                v_assist := p_players[(v_abs - 1) * 6 + v_as];
            END IF;
            INSERT INTO match_events (id, match_id, type, player_id, team_id, minute, assist_player_id, created_at)
            VALUES (nextval('seq_match_events_id'), p_mid, 'GOAL', v_scorer,
                    p_teams[v_abs], v_minute, v_assist, now());
        END LOOP;
    END LOOP;
    IF p_seed % 2 = 0 THEN
        INSERT INTO match_events (id, match_id, type, player_id, team_id, minute, created_at)
        VALUES (nextval('seq_match_events_id'), p_mid, 'YELLOW_CARD',
                p_players[(p_t2_idx - 1) * 6 + 1 + (p_seed % 6)], p_teams[p_t2_idx],
                6 + (p_seed % 14), now());
    END IF;
END $fn$ LANGUAGE plpgsql;

DO $$
DECLARE
    v_owner_uid   text;
    v_owner_name  text;
    v_tid         bigint;
    v_gid         bigint[] := '{}';       -- group ids (A,B,C,D)
    v_round       bigint[] := '{}';       -- round ids (1-3 grupe, 4 QF, 5 SF, 6 F+3.)
    v_team        bigint[] := '{}';       -- 16 team ids, redom A1..A4,B1..B4,C1..C4,D1..D4
    v_players     bigint[] := '{}';       -- 96 player ids, (team-1)*6 + p
    v_base        timestamptz := '2026-06-20 09:00:00+02';

    -- imena ekipa (indeksi 1-16)
    v_team_names  text[] := ARRAY[
        'MNK Zelina',     'NK Sava Zagreb',   'MNK Kutina',        'NK Podravec',
        'MNK Osijek 031', 'NK Turopolje',     'MNK Đakovo',        'NK Bregana',
        'MNK Split 2010', 'NK Kvarner Rijeka','MNK Zadar Delfin',  'NK Neretva',
        'MNK Varteks',    'NK Međimurec',     'MNK Karlovac Stars','NK Posavina'];

    -- bazeni imena za 96 razlicitih igraca (kombinacije su jedinstvene)
    v_fn text[] := ARRAY['LUKA','IVAN','MARKO','ANTE','JOSIP','PETAR','MATEO','FILIP',
                         'DAVID','KARLO','NIKOLA','TOMISLAV','ANDRIJA','ŠIMUN','BORNA','JAKOV',
                         'LOVRO','FRAN','DINO','TIN','VITO','NOA','MAKS','LEON'];
    v_ln text[] := ARRAY['HORVAT','KOVAČEVIĆ','BABIĆ','MARIĆ','JURIĆ','NOVAK','KOVAČIĆ','VUKOVIĆ',
                         'KNEŽEVIĆ','MARKOVIĆ','PETROVIĆ','MATIĆ','TOMIĆ','PAVLOVIĆ','BOŽIĆ','BLAŽEVIĆ',
                         'GRGIĆ','PERIĆ','RADIĆ','ŠARIĆ','LOVRIĆ','VIDOVIĆ','PERKOVIĆ','ĆOSIĆ'];
    v_nums int[] := ARRAY[1, 4, 7, 9, 10, 11];   -- brojevi dresova po ekipi

    -- raspored parova unutar skupine (indeks ekipe unutar skupine) po kolima
    v_pairs int[][] := ARRAY[[1,2],[3,4],[1,3],[2,4],[1,4],[2,3]];
    v_mrnd  int[]   := ARRAY[1,1,2,2,3,3];        -- kolo svake od 6 utakmica

    -- rezultati po skupinama (6 utakmica x [golovi_t1, golovi_t2]); obrazac
    -- ishoda je isti (prvi nositelj 9 bodova, treci 6), brojke variraju
    v_scores_a int[][] := ARRAY[[2,1],[1,0],[3,1],[2,2],[4,0],[1,2]];
    v_scores_b int[][] := ARRAY[[1,0],[2,1],[2,0],[1,1],[3,1],[0,1]];
    v_scores_c int[][] := ARRAY[[3,2],[2,1],[1,0],[0,0],[2,1],[1,3]];
    v_scores_d int[][] := ARRAY[[3,1],[2,1],[2,0],[1,1],[1,0],[0,2]];
    v_gs int[][];

    -- pomocne
    g int; m int; p int; k int; r int; side int; gl int;
    t1 int; t2 int; s1 int; s2 int;
    v_names text[];
    v_mid bigint; v_gidx bigint; v_kick timestamptz; v_cnt int := 0;
    v_scorer bigint; v_assist bigint; v_sc_idx int; v_as_idx int;
    v_team_abs int; v_minute int; v_ev_type text;
    v_fid bigint; v_sf1 bigint; v_sf2 bigint;   -- finale / polufinala (bracket veze)
    v_top_name text;
BEGIN
    -- ─── 0. Zastita od duplog pokretanja + vlasnik ──────────────────────
    IF EXISTS (SELECT 1 FROM tournaments WHERE slug = 'pokazni-turnir-20-06-2026') THEN
        RAISE EXCEPTION 'Pokazni turnir vec postoji (slug pokazni-turnir-20-06-2026) - prvo ga obrisi.';
    END IF;

    SELECT created_by_uid, created_by_name INTO v_owner_uid, v_owner_name
    FROM tournaments WHERE created_by_uid IS NOT NULL ORDER BY id LIMIT 1;
    IF v_owner_uid IS NULL THEN
        RAISE EXCEPTION 'Nema postojeceg turnira iz kojeg bih preuzeo vlasnika (created_by_uid).';
    END IF;

    -- ─── 1. Turnir ──────────────────────────────────────────────────────
    INSERT INTO tournaments (
        id, slug, name, location, latitude, longitude, geocoded_at, details,
        start_at, status, format, group_count, advance_per_group,
        half_count, half_length_min, entry_price, max_teams, game_system,
        created_by_uid, created_by_name,
        winner_name, second_place_name, third_place_name,
        created_at, updated_at
    ) VALUES (
        nextval('seq_tournaments_id'), 'pokazni-turnir-20-06-2026', 'Pokazni turnir',
        'Zagreb, Hrvatska', 45.8150, 15.9819, now(),
        'Ogledni (demo) turnir - primjer potpuno odigranog turnira na futsal-turniri.com: skupine, raspored, rezultati, tablice, zavrsnica i statistika.',
        v_base, 'FINISHED', 'GROUPS_KNOCKOUT', 4, 2,
        2, 10, 0, 16, '4+1',
        v_owner_uid, v_owner_name,
        'MNK Zelina', 'MNK Varteks', 'MNK Osijek 031',
        now(), now()
    ) RETURNING id INTO v_tid;

    -- ─── 2. Skupine A-D ─────────────────────────────────────────────────
    FOR g IN 1..4 LOOP
        INSERT INTO tournament_groups (id, tournament_id, name, ordinal)
        VALUES (nextval('seq_groups_id'), v_tid, chr(64 + g), g)
        RETURNING id INTO v_gidx;
        v_gid := array_append(v_gid, v_gidx);
    END LOOP;

    -- ─── 3. Kola (1-3 skupine, 4 QF, 5 SF, 6 finale + 3. mjesto) ───────
    FOR r IN 1..6 LOOP
        INSERT INTO rounds (id, tournament_id, number, status, created_at, completed_at)
        VALUES (nextval('seq_rounds_id'), v_tid, r, 'COMPLETED', now(), now())
        RETURNING id INTO v_gidx;
        v_round := array_append(v_round, v_gidx);
    END LOOP;

    -- ─── 4. Ekipe + igraci ──────────────────────────────────────────────
    -- 96 jedinstvenih imena: sve kombinacije ime x prezime (576) posortirane
    -- deterministicki pseudo-slucajno (md5), uzima se prvih 96 - nema
    -- vidljivog uzorka ni duplikata.
    SELECT array_agg(nm ORDER BY rn) INTO v_names FROM (
        SELECT f || ' ' || l AS nm,
               row_number() OVER (ORDER BY md5(f || l)) AS rn
        FROM unnest(v_fn) f CROSS JOIN unnest(v_ln) l
    ) s WHERE rn <= 96;

    FOR k IN 1..16 LOOP
        INSERT INTO teams (id, tournament_id, group_id, name, created_at, updated_at)
        VALUES (nextval('seq_teams_id'), v_tid, v_gid[((k - 1) / 4) + 1],
                v_team_names[k], now(), now())
        RETURNING id INTO v_gidx;
        v_team := array_append(v_team, v_gidx);

        FOR p IN 1..6 LOOP
            m := (k - 1) * 6 + p;                                   -- globalni indeks igraca
            INSERT INTO players (id, team_id, name, number, captain, sort_order, is_demo, created_at, updated_at)
            VALUES (nextval('seq_players_id'), v_gidx,
                    v_names[m],
                    v_nums[p], (p = 5), p, true, now(), now())      -- kapetan nosi broj 10
            RETURNING id INTO v_scorer;
            v_players := array_append(v_players, v_scorer);
        END LOOP;
    END LOOP;

    -- ─── 5. Utakmice skupina (24) + dogadaji ───────────────────────────
    FOR g IN 1..4 LOOP
        v_gs := CASE g WHEN 1 THEN v_scores_a WHEN 2 THEN v_scores_b WHEN 3 THEN v_scores_c ELSE v_scores_d END;
        FOR m IN 1..6 LOOP
            v_cnt := v_cnt + 1;
            t1 := (g - 1) * 4 + v_pairs[m][1];                       -- apsolutni indeks ekipe
            t2 := (g - 1) * 4 + v_pairs[m][2];
            s1 := v_gs[m][1]; s2 := v_gs[m][2];
            -- termini: 3 kola x 8 utakmica, slot 20 min unutar kola
            v_kick := v_base + ((v_mrnd[m] - 1) * 8 + (g - 1) * 2
                      + ((m - 1) % 2)) * interval '20 minutes';

            INSERT INTO matches (id, tournament_id, round_id, stage, group_id,
                                 kickoff_at, team1_id, team2_id, score1, score2,
                                 winner_team_id, status,
                                 fouls1_first, fouls1_second, fouls2_first, fouls2_second)
            VALUES (nextval('seq_matches_id'), v_tid, v_round[v_mrnd[m]], 'GROUP', v_gid[g],
                    v_kick, v_team[t1], v_team[t2], s1, s2,
                    CASE WHEN s1 > s2 THEN v_team[t1] WHEN s2 > s1 THEN v_team[t2] END,
                    'FINISHED',
                    v_cnt % 4, (v_cnt + 1) % 3, (v_cnt + 2) % 4, v_cnt % 3)
            RETURNING id INTO v_mid;

            -- golovi (strijelac + povremena asistencija), tocno prema rezultatu
            FOR side IN 1..2 LOOP
                v_team_abs := CASE side WHEN 1 THEN t1 ELSE t2 END;
                FOR gl IN 1..(CASE side WHEN 1 THEN s1 ELSE s2 END) LOOP
                    v_minute := 1 + ((v_cnt * 7 + gl * 5 + side * 3) % 20);
                    v_sc_idx := CASE WHEN gl % 2 = 1 THEN 5                       -- "desetka" ekipe
                                     ELSE 1 + ((v_cnt + gl) % 6) END;
                    v_scorer := v_players[(v_team_abs - 1) * 6 + v_sc_idx];
                    v_assist := NULL;
                    IF (v_cnt + gl) % 2 = 0 THEN
                        v_as_idx := 1 + ((v_sc_idx + gl) % 6);
                        IF v_as_idx = v_sc_idx THEN v_as_idx := 1 + (v_as_idx % 6); END IF;
                        v_assist := v_players[(v_team_abs - 1) * 6 + v_as_idx];
                    END IF;
                    v_ev_type := CASE WHEN (v_cnt * 3 + gl) % 11 = 0 THEN 'PENALTY_GOAL' ELSE 'GOAL' END;
                    INSERT INTO match_events (id, match_id, type, player_id, team_id, minute, assist_player_id, created_at)
                    VALUES (nextval('seq_match_events_id'), v_mid, v_ev_type, v_scorer,
                            v_team[v_team_abs], v_minute, v_assist, now());
                END LOOP;
            END LOOP;

            -- poneki zuti karton, dva crvena kroz turnir
            IF v_cnt % 3 = 0 THEN
                INSERT INTO match_events (id, match_id, type, player_id, team_id, minute, created_at)
                VALUES (nextval('seq_match_events_id'), v_mid, 'YELLOW_CARD',
                        v_players[(t2 - 1) * 6 + 1 + (v_cnt % 6)], v_team[t2],
                        8 + (v_cnt % 12), now());
            END IF;
            IF v_cnt IN (7, 17) THEN
                INSERT INTO match_events (id, match_id, type, player_id, team_id, minute, created_at)
                VALUES (nextval('seq_match_events_id'), v_mid, 'RED_CARD',
                        v_players[(t1 - 1) * 6 + 2], v_team[t1], 17 + (v_cnt % 3), now());
            END IF;
        END LOOP;
    END LOOP;

    -- ─── 6. Zavrsnica (unatrag: finale → polufinala → QF, zbog veza) ───
    -- Finale: MNK Zelina (1) 3:2 MNK Varteks (13)
    INSERT INTO matches (id, tournament_id, round_id, stage, kickoff_at,
                         team1_id, team2_id, score1, score2, winner_team_id, status,
                         fouls1_first, fouls1_second, fouls2_first, fouls2_second)
    VALUES (nextval('seq_matches_id'), v_tid, v_round[6], 'FINAL',
            v_base + interval '12 hours',
            v_team[1], v_team[13], 3, 2, v_team[1], 'FINISHED', 2, 3, 3, 2)
    RETURNING id INTO v_fid;

    -- Za 3. mjesto: MNK Osijek 031 (5) 4:3 MNK Split 2010 (9)
    INSERT INTO matches (id, tournament_id, round_id, stage, kickoff_at,
                         team1_id, team2_id, score1, score2, winner_team_id, status)
    VALUES (nextval('seq_matches_id'), v_tid, v_round[6], 'THIRD_PLACE',
            v_base + interval '11 hours 15 minutes',
            v_team[5], v_team[9], 4, 3, v_team[5], 'FINISHED')
    RETURNING id INTO v_mid;
    PERFORM pg_temp.demo_ko_events(v_mid, 41, v_players, v_team, 5, 9, 4, 3);

    -- Polufinala
    INSERT INTO matches (id, tournament_id, round_id, stage, kickoff_at, team1_id, team2_id,
                         score1, score2, winner_team_id, status, next_match_id, next_slot)
    VALUES (nextval('seq_matches_id'), v_tid, v_round[5], 'SEMIFINAL',
            v_base + interval '10 hours', v_team[1], v_team[5],
            2, 1, v_team[1], 'FINISHED', v_fid, 1)
    RETURNING id INTO v_sf1;
    PERFORM pg_temp.demo_ko_events(v_sf1, 42, v_players, v_team, 1, 5, 2, 1);

    INSERT INTO matches (id, tournament_id, round_id, stage, kickoff_at, team1_id, team2_id,
                         score1, score2, winner_team_id, status, next_match_id, next_slot)
    VALUES (nextval('seq_matches_id'), v_tid, v_round[5], 'SEMIFINAL',
            v_base + interval '10 hours 30 minutes', v_team[9], v_team[13],
            0, 2, v_team[13], 'FINISHED', v_fid, 2)
    RETURNING id INTO v_sf2;
    PERFORM pg_temp.demo_ko_events(v_sf2, 43, v_players, v_team, 9, 13, 0, 2);

    -- Cetvrtfinala (pobjednik skupine protiv drugoplasiranog druge skupine)
    -- QF1: A1 MNK Zelina 3:1 B2 MNK Đakovo
    INSERT INTO matches (id, tournament_id, round_id, stage, kickoff_at, team1_id, team2_id,
                         score1, score2, winner_team_id, status, next_match_id, next_slot)
    VALUES (nextval('seq_matches_id'), v_tid, v_round[4], 'QUARTERFINAL',
            v_base + interval '8 hours', v_team[1], v_team[7],
            3, 1, v_team[1], 'FINISHED', v_sf1, 1)
    RETURNING id INTO v_mid;
    PERFORM pg_temp.demo_ko_events(v_mid, 44, v_players, v_team, 1, 7, 3, 1);

    -- QF2: B1 MNK Osijek 031 2:0 A2 MNK Kutina
    INSERT INTO matches (id, tournament_id, round_id, stage, kickoff_at, team1_id, team2_id,
                         score1, score2, winner_team_id, status, next_match_id, next_slot)
    VALUES (nextval('seq_matches_id'), v_tid, v_round[4], 'QUARTERFINAL',
            v_base + interval '8 hours 25 minutes', v_team[5], v_team[3],
            2, 0, v_team[5], 'FINISHED', v_sf1, 2)
    RETURNING id INTO v_mid;
    PERFORM pg_temp.demo_ko_events(v_mid, 45, v_players, v_team, 5, 3, 2, 0);

    -- QF3: C1 MNK Split 2010 1:1 (4:2 pen) D2 MNK Karlovac Stars
    INSERT INTO matches (id, tournament_id, round_id, stage, kickoff_at, team1_id, team2_id,
                         score1, score2, penalties1, penalties2, winner_team_id, status,
                         next_match_id, next_slot)
    VALUES (nextval('seq_matches_id'), v_tid, v_round[4], 'QUARTERFINAL',
            v_base + interval '8 hours 50 minutes', v_team[9], v_team[15],
            1, 1, 4, 2, v_team[9], 'FINISHED', v_sf2, 1)
    RETURNING id INTO v_mid;
    PERFORM pg_temp.demo_ko_events(v_mid, 46, v_players, v_team, 9, 15, 1, 1);

    -- QF4: D1 MNK Varteks 2:1 C2 MNK Zadar Delfin
    INSERT INTO matches (id, tournament_id, round_id, stage, kickoff_at, team1_id, team2_id,
                         score1, score2, winner_team_id, status, next_match_id, next_slot)
    VALUES (nextval('seq_matches_id'), v_tid, v_round[4], 'QUARTERFINAL',
            v_base + interval '9 hours 15 minutes', v_team[13], v_team[11],
            2, 1, v_team[13], 'FINISHED', v_sf2, 2)
    RETURNING id INTO v_mid;
    PERFORM pg_temp.demo_ko_events(v_mid, 47, v_players, v_team, 13, 11, 2, 1);

    -- golovi finala (rucno - kapetan Zeline zabija dva, jedan iz penala)
    INSERT INTO match_events (id, match_id, type, player_id, team_id, minute, assist_player_id, created_at) VALUES
        (nextval('seq_match_events_id'), v_fid, 'GOAL',         v_players[5],              v_team[1],  3,  v_players[2], now()),
        (nextval('seq_match_events_id'), v_fid, 'GOAL',         v_players[(13-1)*6 + 5],   v_team[13], 7,  NULL,         now()),
        (nextval('seq_match_events_id'), v_fid, 'PENALTY_GOAL', v_players[5],              v_team[1],  11, NULL,         now()),
        (nextval('seq_match_events_id'), v_fid, 'GOAL',         v_players[(13-1)*6 + 3],   v_team[13], 15, NULL,         now()),
        (nextval('seq_match_events_id'), v_fid, 'YELLOW_CARD',  v_players[(13-1)*6 + 2],   v_team[13], 17, NULL,         now()),
        (nextval('seq_match_events_id'), v_fid, 'GOAL',         v_players[1],              v_team[1],  19, v_players[5], now());

    -- ─── 7. Najbolji strijelac iz stvarno upisanih golova ───────────────
    SELECT p2.name INTO v_top_name
    FROM match_events e
    JOIN players p2 ON p2.id = e.player_id
    JOIN matches ma ON ma.id = e.match_id
    WHERE ma.tournament_id = v_tid AND e.type IN ('GOAL', 'PENALTY_GOAL')
    GROUP BY p2.name ORDER BY count(*) DESC, p2.name LIMIT 1;

    UPDATE tournaments SET
        best_scorer_name     = v_top_name,
        best_player_name     = (SELECT name FROM players WHERE id = v_players[(13-1)*6 + 5]),
        best_goalkeeper_name = (SELECT name FROM players WHERE id = v_players[1])
    WHERE id = v_tid;

    RAISE NOTICE 'Pokazni turnir ubacen: id=%, 16 ekipa, 96 igraca (is_demo), 32 utakmice, najbolji strijelac: %', v_tid, v_top_name;
END $$;
