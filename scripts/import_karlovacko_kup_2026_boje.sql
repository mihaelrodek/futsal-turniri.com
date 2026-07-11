-- ═══════════════════════════════════════════════════════════════════════════
-- Boje dresova za "Karlovačko Kup 2026 - Žarovnica 2026"
-- Izvor: turnir-backup-972026.json (master lista `teams[]` iz stare aplikacije)
--
-- Pokreni NAKON:
--   1. glavnog importa (scripts/import_karlovacko_kup_2026.sql) i
--   2. restarta backenda (migracija teams_jersey_color mora biti primijenjena).
--
-- Napomena: u JSON-u 4 ekipe imaju DRUGU boju u kopiji unutar `groups[]`
-- nego u master listi (uzeta je master boja):
--   • JB WOHNBAU          master #858585  (grupa F kopija: #229954)
--   • DUKE INTERNATIONAL  master #e22400  (grupa F kopija: #e67e22)
--   • ELEKTRO KRUNO       master #000000  (grupa G kopija: #c0a000)
--   • DRUGOVI             master #f5ec00  (grupa G kopija: #6c3483)
-- Ako je točnija verzija iz grupa, samo promijeni hex u VALUES listi.
--
-- Run:  psql "$DATABASE_URL" -f scripts/import_karlovacko_kup_2026_boje.sql
-- Sigurno: jedna transakcija; prekida se ako ne pogodi točno 22 ekipe.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE teams t
SET jersey_color = v.color
FROM (VALUES
    ('GEP J.D.O.O.',                               '#c0392b'),
    ('UŠR CVETLIN JUNIORI',                        '#2f74c0'),
    ('SAFEFLOW',                                   '#27ae60'),
    ('NANI-PLUS & MM PROJEKT',                     '#f39c12'),
    ('ŠRU ORKAN',                                  '#8e44ad'),
    ('TRANSPORTI MAČEK & ELEKTROMONT M',           '#16a085'),
    ('DŠR ŽAROVNICA & MH SYSTEM & BUENO CAFFE',    '#2c3e50'),
    ('GRADNJA BEŠENIĆ',                            '#e74c3c'),
    ('OGREVANJE ZAMUDA',                           '#f1c40f'),
    ('UŠR CVETLIN',                                '#34495e'),
    ('MARATON USLUGE',                             '#7f8c8d'),
    ('NK TRAKOŠČAN',                               '#d35400'),
    ('UŠR VIŠNJICA',                               '#1abc9c'),
    ('AUTO MAČEK',                                 '#9b59b6'),
    ('DŠR ŽAROVNICA & MH SYSTEM & BUENO CAFFE II', '#3498db'),
    ('JB WOHNBAU',                                 '#858585'),
    ('DUKE INTERNATIONAL',                         '#e22400'),
    ('SLAVEK I PRIJATELJI',                        '#2980b9'),
    ('ELEKTRO KRUNO',                              '#000000'),
    ('DRUGOVI',                                    '#f5ec00'),
    ('CAFFE BAR DUX',                              '#0e6655'),
    ('UKS BEDENEC',                                '#a93226')
) AS v(name, color)
JOIN tournaments tr
  ON tr.name = 'Karlovačko Kup 2026 - Žarovnica 2026'
 AND tr.is_deleted = false
WHERE t.tournament_id = tr.id
  AND t.name = v.name;

-- Sanity: svih 22 ekipa turnira mora sada imati boju, inače rollback.
DO $$
DECLARE
    v_colored int;
BEGIN
    SELECT count(*) INTO v_colored
    FROM teams t
    JOIN tournaments tr ON tr.id = t.tournament_id
    WHERE tr.name = 'Karlovačko Kup 2026 - Žarovnica 2026'
      AND tr.is_deleted = false
      AND t.jersey_color IS NOT NULL;
    IF v_colored <> 22 THEN
        RAISE EXCEPTION 'Očekivano 22 obojane ekipe, obojano % - provjeri imena/redoslijed skripti.', v_colored;
    END IF;
    RAISE NOTICE 'Boje dresova postavljene za svih 22 ekipa.';
END $$;

COMMIT;
