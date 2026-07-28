/**
 * seed-mock-data.mjs
 * ──────────────────────────────────────────────────────────────────────────────
 * Seeds mock data by calling the Nogometni-turniri.com REST API.
 *
 * WHAT IT CREATES
 *   1. 6 DRAFT tournaments with teams + random players (nothing played).
 *   2. 4 FULLY PLAYED, FINISHED knockout tournaments - drawn, scheduled, every
 *      match started, goals recorded with named scorers, results entered and
 *      the tournament finished with a podium and a best-scorer award.
 *
 *   The finished ones deliberately OVERLAP so the cross-tournament views have
 *   something real to aggregate:
 *     - the same TEAMS appear in several tournaments (all-time medal table),
 *     - the same PLAYER NAMES appear in several tournaments, sometimes for a
 *       different club (all-time scorer list / "vjecna lista strijelaca").
 *   Both list keys are name-based (upper+trim), so reusing a name IS reusing
 *   the person. Within ONE tournament a name may only exist on one roster -
 *   the backend rejects the same player on two teams - so shared players move
 *   as whole rosters.
 *
 *   Goals for the finished tournaments come from a FIXED SEED, so re-running
 *   produces the same leaderboard instead of a different one every time.
 *
 * HOW TO RUN
 *   node scripts/seed-mock-data.mjs
 *
 *   Only part of it:
 *     SEED_ONLY=draft    node scripts/seed-mock-data.mjs   # just the 6 drafts
 *     SEED_ONLY=finished node scripts/seed-mock-data.mjs   # just the 4 played
 *     SEED_ONLY=all      node scripts/seed-mock-data.mjs   # both (default)
 *
 * REQUIREMENTS
 *   Node 18+ (uses the global `fetch`).
 *
 * AUTHENTICATION
 *   Every mutating endpoint requires a Firebase ID token.
 *   Supply it in one of two ways:
 *
 *   1. Environment variable:
 *        SEED_TOKEN="<token>" node scripts/seed-mock-data.mjs
 *
 *   2. File (scripts/seed-token.txt - one line, the raw token):
 *        echo "ey..." > scripts/seed-token.txt
 *        node scripts/seed-mock-data.mjs
 *
 *   How to obtain the token:
 *     * Log into the app in your browser.
 *     * Open DevTools -> Network tab.
 *     * Click any request that goes to /api/ (e.g. /api/tournaments).
 *     * In the "Headers" panel look for the "Authorization" request header.
 *     * Copy the value that comes AFTER "Bearer " -- that is your token.
 *
 * API_URL OVERRIDE
 *   By default the script targets http://localhost:8087/api.
 *   Override:
 *     API_URL=https://api.example.com/api node scripts/seed-mock-data.mjs
 * ──────────────────────────────────────────────────────────────────────────────
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.API_URL ?? "http://localhost:8087/api";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function cleanToken(s) {
  // Strip whitespace, a UTF-8 BOM, wrapping quotes and a leading "Bearer ".
  let t = String(s).replace(/^\uFEFF/, "").trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    t = t.slice(1, -1).trim();
  }
  if (t.toLowerCase().startsWith("bearer ")) t = t.slice(7).trim();
  return t;
}

function loadToken() {
  // 1) command-line argument:  node scripts/seed-mock-data.mjs <token>
  if (process.argv[2]) return cleanToken(process.argv[2]);
  // 2) environment variable SEED_TOKEN
  if (process.env.SEED_TOKEN) return cleanToken(process.env.SEED_TOKEN);
  // 3) a token file next to this script (hyphen or underscore name)
  for (const name of ["seed-token.txt", "seed_token.txt"]) {
    const f = path.join(__dirname, name);
    if (fs.existsSync(f)) {
      const raw = cleanToken(fs.readFileSync(f, "utf8"));
      if (raw) return raw;
    }
  }
  return null;
}

const TOKEN = loadToken();

if (!TOKEN) {
  console.error(`
ERROR: No Firebase ID token found.

The seed script needs an authenticated Firebase ID token to create
tournaments, teams, and players (organizer-only endpoints).

Supply it in one of two ways:

  1. Environment variable:
       SEED_TOKEN="ey..." node scripts/seed-mock-data.mjs

  2. File -- create scripts/seed-token.txt containing only the token:
       echo "ey..." > scripts/seed-token.txt
       node scripts/seed-mock-data.mjs

How to get the token:
  * Log into the app in your browser.
  * Open DevTools (F12) -> Network tab.
  * Reload the page or click around so /api/ requests appear.
  * Click any request to /api/ (e.g. GET /api/tournaments).
  * In the Headers panel find the "Authorization" request header.
  * Copy the value AFTER "Bearer " -- that is your token.
  * Tokens typically expire after 1 hour; re-copy if you get 401 errors.
`);
  process.exit(1);
}

// ── HTTP helpers ───────────────────────────────────────────────────────────────

async function apiRequest(method, urlPath, body) {
  const url = `${BASE_URL}${urlPath}`;
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TOKEN}`,
    },
  };
  if (body !== undefined) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) {
    throw new ApiError(res.status, url, text);
  }
  return text ? JSON.parse(text) : null;
}

class ApiError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} -- ${url}\n  Response: ${body}`);
    this.status = status;
    this.url = url;
    this.responseBody = body;
  }
}

const api = {
  get: (urlPath) => apiRequest("GET", urlPath),
  post: (urlPath, body) => apiRequest("POST", urlPath, body),
  put: (urlPath, body) => apiRequest("PUT", urlPath, body),
};

// ── Deterministic RNG (finished tournaments only) ─────────────────────────────
// The played tournaments must produce the SAME scorer leaderboard on every run,
// otherwise "is the all-time list right?" has no fixed answer to check against.
// mulberry32 with a hardcoded seed; the DRAFT specs keep using Math.random.

function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** Integer in [min, max] inclusive. */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

// ── Croatian name pools ────────────────────────────────────────────────────────

const FIRST_NAMES = [
  "Luka", "Ivan", "Tomislav", "Marko", "Ante", "Josip", "Nikola", "Mateo",
  "Filip", "Damir", "Karlo", "Bruno", "Stjepan", "Dario", "Mario", "Patrik",
  "Robert", "Domagoj", "Marin", "Tin", "Petar", "Kruno", "Vedran", "Boris",
  "Leon", "Niko", "Sven", "Goran", "Alen", "Igor",
];

const LAST_NAMES = [
  "Horvat", "Kovac", "Babic", "Maric", "Tomic", "Juric", "Novak", "Petric",
  "Blazevic", "Simic", "Knezevic", "Vukovic", "Bozic", "Kralj", "Peric",
  "Filipovic", "Majic", "Matic", "Pavlovic", "Starcevic", "Galic", "Loncar",
  "Radic", "Vukic", "Djukic", "Mihalic", "Bosnjak", "Vidovic", "Soric", "Crkvenac",
];

function randomName(usedNames) {
  let name;
  let attempts = 0;
  do {
    const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
    const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
    name = `${first} ${last}`;
    attempts++;
  } while (usedNames.has(name) && attempts < 200);
  usedNames.add(name);
  return name;
}

// ── Tournament definitions ─────────────────────────────────────────────────────

const ALL_TEAM_NAMES = [
  "NK Sokol", "NK Olimpija", "FK Zelena dolina", "NK Bregana",
  "NK Stari grad", "FK Podgorje", "NK Rudar", "NK Rijeka Stars",
  "NK Jadran", "FK Klek", "NK Dinamo Zapresic", "FK Veseljak",
  "NK Borac", "NK Jarun", "FK Brodosplit", "NK Metalac",
  "NK Vinkovci 91", "FK Vukovar", "NK Moslavina", "NK Slavonac",
  "FK Posavec", "NK Sveta Nedjelja", "FK Lika", "NK Krajina",
  "NK Dugave", "FK Tresnjevka", "NK Spansko", "FK Sesvete",
  "NK Novi Zagreb", "FK Susedgrad", "NK Crnomerec", "FK Dubrava",
  "NK Maksimir", "FK Ravnice", "NK Zitnjak", "FK Precko",
  "NK Botinec", "FK Gornji grad", "NK Pleso", "FK Samobor",
  "NK Zabok", "FK Sveti Ivan Zelina", "NK Ivanic Grad", "FK Kriz",
  "NK Dugo Selo", "FK Bjelovar", "NK Koprivnica", "FK Virovitica",
  // The 6 DRAFT specs need 62 distinct names in total; without these the last
  // spec got an empty team slice and silently ended up with no teams at all.
  "NK Karlovac 1919", "FK Duga Resa", "NK Ozalj", "FK Draganic",
  "NK Ribnik", "FK Barilovic", "NK Generalski Stol", "FK Krnjak",
  "NK Vojnic", "FK Cetingrad", "NK Slunj", "FK Rakovica",
  "NK Plaski", "FK Josipdol", "NK Tounj", "FK Bosiljevo",
];

const DATES = [
  "2026-06-14T09:00:00+02:00",
  "2026-06-21T10:00:00+02:00",
  "2026-07-05T09:00:00+02:00",
  "2026-07-12T10:00:00+02:00",
  "2026-07-19T09:00:00+02:00",
  "2026-08-02T10:00:00+02:00",
];

const TOURNAMENT_SPECS = [
  {
    name: "Futsal Kup Zagreb 2026",
    location: "Dvorana Tresnjevka, Zagreb",
    maxTeams: 8,
    format: "KNOCKOUT_ONLY",
    groupCount: null,
    advancePerGroup: null,
    bracketFill: "BYES",
    entryPrice: 200,
    rewardType: "FIXED",
    rewardFirst: 1000,
    rewardSecond: 500,
    rewardThird: 250,
    details: "Gradski knockout turnir. Osam ekipa, direktna eliminacija od prve utakmice.",
    startDate: DATES[0],
    teamCount: 8,
  },
  {
    name: "Malonogometni Open Varazdin",
    location: "Sportska dvorana Varazdin",
    maxTeams: 4,
    format: "KNOCKOUT_ONLY",
    groupCount: null,
    advancePerGroup: null,
    bracketFill: null,
    entryPrice: 100,
    rewardType: "FIXED",
    rewardFirst: 600,
    rewardSecond: 300,
    rewardThird: null,
    details: "Mali brzi turnir, savrsen za prijatelje i rekreativce. Cetiri ekipe, dva polufinala i finale.",
    startDate: DATES[1],
    teamCount: 4,
  },
  {
    name: "Zagorski Futsal Grand Prix",
    location: "Sportski centar Krapina",
    maxTeams: 16,
    format: "KNOCKOUT_ONLY",
    groupCount: null,
    advancePerGroup: null,
    bracketFill: "WILDCARDS",
    entryPrice: 300,
    rewardType: "FIXED",
    rewardFirst: 2000,
    rewardSecond: 1000,
    rewardThird: 500,
    details: "Najveci knockout turnir u Zagorju. Sesnaest ekipa, brutalna eliminacija.",
    startDate: DATES[2],
    teamCount: 16,
  },
  {
    name: "Ljetni Turnir Rijeka 2026",
    location: "Dvorana Zamet, Rijeka",
    maxTeams: 6,
    format: "GROUPS_KNOCKOUT",
    groupCount: 2,
    advancePerGroup: 2,
    bracketFill: "BYES",
    entryPrice: 150,
    rewardType: "FIXED",
    rewardFirst: 800,
    rewardSecond: 400,
    rewardThird: 200,
    details: "Dvije grupe po tri ekipe. Prve dvije iz svake grupe nastavljaju u knockout fazu.",
    startDate: DATES[3],
    teamCount: 6,
  },
  {
    name: "Futsal Liga Slavonije",
    location: "Dvorana Grabik, Koprivnica",
    maxTeams: 12,
    format: "GROUPS_KNOCKOUT",
    groupCount: 4,
    advancePerGroup: 2,
    bracketFill: "BYES",
    entryPrice: 250,
    rewardType: "PERCENTAGE",
    rewardFirst: 50,
    rewardSecond: 30,
    rewardThird: 20,
    details: "Cetiri grupe po tri ekipe. Nagrade su postotak od ukupnog prihoda od kotizacija.",
    startDate: DATES[4],
    teamCount: 12,
  },
  {
    name: "Futsal Spektakl Split 2026",
    location: "Gripe sportska dvorana, Split",
    maxTeams: 16,
    format: "GROUPS_KNOCKOUT",
    groupCount: 4,
    advancePerGroup: 2,
    bracketFill: "WILDCARDS",
    entryPrice: 350,
    rewardType: "FIXED",
    rewardFirst: 3000,
    rewardSecond: 1500,
    rewardThird: 750,
    details: "Prestizni dalmatinski turnir. Cetiri grupe, knockout od cetvrtfinala.",
    startDate: DATES[5],
    teamCount: 16,
  },
];

// ── Finished (fully played) tournaments ────────────────────────────────────────
/*
 * These exist to give the CROSS-TOURNAMENT views real data:
 *   - vjecna lista strijelaca  (goals grouped by upper(trim(player name)))
 *   - all-time team medal table (winner/2nd/3rd names of FINISHED tournaments)
 *   - a player's public profile / match history
 *
 * Overlap is the whole point, so it's laid out explicitly:
 *   ROSTERS is a pool of named squads; a tournament's team picks one. Reusing a
 *   roster under a DIFFERENT team name models the squad changing clubs (same
 *   players, new badge); reusing the same team name across tournaments feeds the
 *   medal table. Within one tournament every name is unique - the backend
 *   refuses the same player on two rosters.
 *
 * Every finished tournament is KNOCKOUT_ONLY with a power-of-two team count, so
 * the bracket needs no byes and each match is decided in regulation.
 */

const ROSTERS = {
  sokolovi: [
    "Ivan Radic", "Marko Babic", "Luka Horvat", "Tomislav Juric",
    "Ante Novak", "Josip Kovac", "Filip Maric", "Damir Tomic",
  ],
  zmajevi: [
    "Nikola Petric", "Mateo Blazevic", "Karlo Simic", "Bruno Knezevic",
    "Stjepan Vukovic", "Dario Bozic", "Mario Kralj", "Patrik Peric",
  ],
  vukovi: [
    "Robert Filipovic", "Domagoj Majic", "Marin Matic", "Tin Pavlovic",
    "Petar Starcevic", "Kruno Galic", "Vedran Loncar", "Boris Radic",
  ],
  medvjedi: [
    "Leon Vukic", "Niko Djukic", "Sven Mihalic", "Goran Bosnjak",
    "Alen Vidovic", "Igor Soric", "Zlatko Crkvenac", "Marin Skoric",
  ],
  orlovi: [
    "Jakov Pintar", "Emanuel Gasparic", "Roko Vujic", "Toni Modric",
    "Hrvoje Sabljak", "Zvonimir Klaric", "Matej Buric", "Lovro Pusic",
  ],
  risevi: [
    "Silvio Rukavina", "Denis Turkalj", "Nenad Grgic", "Vlado Cindric",
    "Ozren Malec", "Mislav Bencic", "Kristijan Zoric", "Fran Sertic",
  ],
};

/**
 * A squad's first two names are its "stars" - weighted 3x when picking a scorer,
 * so the all-time list gets a clear, checkable top instead of 40 players tied on
 * two goals each.
 */
const STAR_WEIGHT = 3;

const FINISHED_SPECS = [
  {
    name: "Zimski Futsal Kup Karlovac 2025",
    location: "Dvorana Mladost, Karlovac",
    startDate: "2025-12-13T10:00:00+01:00",
    entryPrice: 150,
    details:
      "Odigrani zimski knockout turnir. Cetiri ekipe, polufinala, borba za trece mjesto i finale.",
    // Baseline: four clubs with their own squads.
    teams: [
      { name: "NK Sokol Karlovac", roster: "sokolovi" },
      { name: "NK Zmaj Duga Resa", roster: "zmajevi" },
      { name: "NK Vuk Ozalj", roster: "vukovi" },
      { name: "NK Medvjed Ribnik", roster: "medvjedi" },
    ],
  },
  {
    name: "Karlovacki Zimski Kup 2026",
    location: "Dvorana Mladost, Karlovac",
    startDate: "2026-01-17T10:00:00+01:00",
    entryPrice: 150,
    details:
      "Isti sastav ekipa kao prosle godine - drugi turnir, iste ekipe i isti igraci.",
    // IDENTICAL teams AND rosters as the 2025 edition: the medal table and the
    // all-time scorer list must both accumulate across the two.
    teams: [
      { name: "NK Sokol Karlovac", roster: "sokolovi" },
      { name: "NK Zmaj Duga Resa", roster: "zmajevi" },
      { name: "NK Vuk Ozalj", roster: "vukovi" },
      { name: "NK Medvjed Ribnik", roster: "medvjedi" },
    ],
  },
  {
    name: "Memorijal Ivana Horvata 2026",
    location: "Sportska dvorana Slunj",
    startDate: "2026-03-07T10:00:00+01:00",
    entryPrice: 120,
    details:
      "Memorijalni turnir. Dio igraca nastupa za nove klubove u odnosu na zimske kupove.",
    teams: [
      // Same players as NK Vuk Ozalj, new badge - a squad that changed clubs.
      { name: "FK Kupa Ozalj", roster: "vukovi" },
      // Same team AND squad as both zimski kupovi.
      { name: "NK Medvjed Ribnik", roster: "medvjedi" },
      { name: "NK Orao Slunj", roster: "orlovi" },
      { name: "NK Ris Vojnic", roster: "risevi" },
    ],
  },
  {
    name: "Turnir Grada Ozalja 2026",
    location: "Gradska dvorana Ozalj",
    startDate: "2026-04-11T09:00:00+02:00",
    entryPrice: 200,
    details:
      "Najveci odigrani turnir u nizu - osam ekipa, cetvrtfinala, polufinala i finale.",
    teams: [
      { name: "NK Sokol Karlovac", roster: "sokolovi" },
      { name: "NK Zmaj Duga Resa", roster: "zmajevi" },
      { name: "NK Orao Slunj", roster: "orlovi" },
      { name: "NK Ris Vojnic", roster: "risevi" },
      // Four one-off clubs with generated squads - noise around the recurring
      // names, so the all-time list isn't made only of repeat players.
      { name: "NK Mreznica", generate: 7 },
      { name: "FK Korana", generate: 7 },
      { name: "NK Dobra", generate: 7 },
      { name: "FK Slunjcica", generate: 7 },
    ],
  },
];

/** Play order - THIRD_PLACE before FINAL so the bronze is recorded first. */
const STAGE_ORDER = [
  "GROUP",
  "ROUND_OF_32",
  "ROUND_OF_16",
  "QUARTER_FINAL",
  "SEMI_FINAL",
  "THIRD_PLACE",
  "FINAL",
];

// ── Seeding logic ──────────────────────────────────────────────────────────────

async function createTournament(spec) {
  const payload = {
    name: spec.name,
    location: spec.location,
    details: spec.details,
    startAt: spec.startDate,
    status: "DRAFT",
    maxTeams: spec.maxTeams,
    format: spec.format,
    groupCount: spec.groupCount ?? null,
    advancePerGroup: spec.advancePerGroup ?? null,
    bracketFill: spec.bracketFill ?? null,
    entryPrice: spec.entryPrice,
    contactName: null,
    contactPhone: null,
    rewardType: spec.rewardType ?? null,
    rewardFirst: spec.rewardFirst ?? null,
    rewardSecond: spec.rewardSecond ?? null,
    rewardThird: spec.rewardThird ?? null,
    resourceId: null,
  };
  return api.post("/tournaments", payload);
}

async function addTeams(tournamentUuid, teamNames) {
  const payload = teamNames.map((name) => ({
    id: null,
    name,
    isEliminated: false,
    paid: false,
  }));
  return api.put(`/tournaments/${tournamentUuid}/teams`, payload);
}

async function addPlayersToTeam(tournamentUuid, teamId, playerCount) {
  const usedNames = new Set();
  const usedNumbers = new Set();
  const players = [];

  for (let i = 0; i < playerCount; i++) {
    const name = randomName(usedNames);
    let number;
    do {
      number = Math.floor(Math.random() * 99) + 1;
    } while (usedNumbers.has(number));
    usedNumbers.add(number);
    players.push({ name, number });
  }

  const createdPlayers = [];
  for (const p of players) {
    const created = await api.post(
      `/tournaments/${tournamentUuid}/teams/${teamId}/players`,
      { name: p.name, number: p.number },
    );
    createdPlayers.push(created);
  }

  // Mark first player as captain via PUT update
  if (createdPlayers.length > 0) {
    const captain = createdPlayers[0];
    await api.put(
      `/tournaments/${tournamentUuid}/teams/${teamId}/players/${captain.id}`,
      { name: captain.name, number: captain.number, captain: true },
    );
  }

  return createdPlayers.length;
}

// ── Playing a finished tournament ───────────────────────────────────────────────

/** Create a tournament's players from an explicit name list. Returns
 *  [{ id, name }] so the goal generator can pick scorers without a re-fetch. */
async function addNamedPlayers(tournamentUuid, teamId, names) {
  const created = [];
  const usedNumbers = new Set();
  let nextNumber = 1;
  for (const name of names) {
    while (usedNumbers.has(nextNumber)) nextNumber++;
    usedNumbers.add(nextNumber);
    const p = await api.post(
      `/tournaments/${tournamentUuid}/teams/${teamId}/players`,
      { name, number: nextNumber },
    );
    // The backend normalises the name (upper + trim) - keep ITS version, that's
    // the string the all-time scorer list groups on.
    created.push({ id: p.id, name: p.name ?? name });
    nextNumber++;
  }
  if (created.length > 0) {
    const c = created[0];
    await api.put(
      `/tournaments/${tournamentUuid}/teams/${teamId}/players/${c.id}`,
      { name: c.name, number: 1, captain: true },
    );
  }
  return created;
}

/** Deterministic filler names for the one-off clubs. */
function generatedRoster(rng, count, usedNames) {
  const out = [];
  while (out.length < count) {
    const name = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    if (usedNames.has(name)) continue;
    usedNames.add(name);
    out.push(name);
  }
  return out;
}

/** A knockout match must have a winner, so the two scores are never equal. */
function pickScores(rng) {
  const a = rng.int(0, 4);
  let b = rng.int(0, 4);
  if (a === b) b = Math.min(a + 1, 5);
  // Coin-flip which side got the bigger number, so team1 isn't always favoured.
  return rng.chance(0.5) ? [a, b] : [b, a];
}

/** Weighted scorer pick - the squad's two stars are 3x as likely. */
function pickScorer(rng, roster) {
  const pool = [];
  roster.forEach((p, i) => {
    const weight = i < 2 ? STAR_WEIGHT : 1;
    for (let w = 0; w < weight; w++) pool.push(p);
  });
  return rng.pick(pool);
}

/**
 * Record `count` goals for one side. Every goal names a scorer (an anonymous
 * goal would never show up on the all-time list) and sometimes an assist from
 * the same squad. Minutes are ascending within the side, 1..20 (2 x 10 min).
 */
async function addGoals(tournamentUuid, matchId, roster, count, rng, tallies) {
  if (!roster || roster.length === 0) {
    throw new Error(`No roster known for a side of match ${matchId} - cannot record goals`);
  }
  const minutes = [];
  for (let i = 0; i < count; i++) minutes.push(rng.int(1, 20));
  minutes.sort((a, b) => a - b);

  for (const minute of minutes) {
    const scorer = pickScorer(rng, roster);
    let assist = null;
    if (roster.length > 1 && rng.chance(0.35)) {
      const candidates = roster.filter((p) => p.id !== scorer.id);
      assist = rng.pick(candidates);
    }
    await api.post(`/tournaments/${tournamentUuid}/matches/${matchId}/events`, {
      type: "GOAL",
      playerId: scorer.id,
      teamId: null,
      minute,
      assistPlayerId: assist ? assist.id : null,
      clientEventId: null,
    });
    for (const t of tallies) t.set(scorer.name, (t.get(scorer.name) ?? 0) + 1);
  }
}

/**
 * Create, draw, schedule and PLAY one tournament end to end, leaving it
 * FINISHED with a podium and a best-scorer award.
 *
 * Sequence matters: the bracket has to exist before the schedule can lay out
 * kickoff times (for KNOCKOUT_ONLY nothing else creates the matches), and each
 * later round's teams only resolve once the previous round's results are in -
 * hence the re-fetch of the schedule per round.
 */
async function playFinishedTournament(spec, rng, globalTally) {
  const tournament = await createTournament({
    name: spec.name,
    location: spec.location,
    details: spec.details,
    startDate: spec.startDate,
    maxTeams: spec.teams.length,
    format: "KNOCKOUT_ONLY",
    groupCount: null,
    advancePerGroup: null,
    bracketFill: null,
    entryPrice: spec.entryPrice,
    rewardType: "FIXED",
    rewardFirst: spec.entryPrice * 4,
    rewardSecond: spec.entryPrice * 2,
    rewardThird: spec.entryPrice,
  });
  const uuid = tournament.uuid;
  console.log(`  OK Tournament created -- UUID: ${uuid}`);

  const savedTeams = await addTeams(uuid, spec.teams.map((t) => t.name));
  console.log(`  OK ${savedTeams.length} teams added`);

  // teamId -> roster ([{id, name}]), used by the goal generator.
  const rosterByTeamId = new Map();
  // Names already spoken for in THIS tournament. Pre-seeded with every fixed
  // roster name (not just the ones used here) because the generator draws from
  // the same first/last-name pools and the backend rejects the same player name
  // appearing on two rosters of one tournament.
  const usedGenerated = new Set(Object.values(ROSTERS).flat());
  let playerCount = 0;
  for (const teamSpec of spec.teams) {
    const team = savedTeams.find((t) => t.name === teamSpec.name);
    if (!team) throw new Error(`Team "${teamSpec.name}" missing from the save response`);
    const names = teamSpec.roster
      ? ROSTERS[teamSpec.roster]
      : generatedRoster(rng, teamSpec.generate ?? 7, usedGenerated);
    const players = await addNamedPlayers(uuid, team.id, names);
    rosterByTeamId.set(team.id, players);
    playerCount += players.length;
    process.stdout.write(".");
  }
  console.log(`\n  OK ${playerCount} players added across ${savedTeams.length} teams`);

  await api.put(`/tournaments/${uuid}/start`);
  await api.post(`/tournaments/${uuid}/bracket/generate`, { byeTeamIds: null, shuffleRest: false });
  await api.post(`/tournaments/${uuid}/schedule/generate`, {
    halfCount: 2,
    halfLengthMin: 10,
    halftimeBreakMin: 3,
    breakBetweenMatchesMin: 5,
    bufferMin: 0,
    koHalfLengthMin: null,
    koHalftimeBreakMin: null,
    koBreakBetweenMatchesMin: null,
  });
  console.log("  OK bracket drawn + schedule generated");

  const tournamentTally = new Map();
  let played = 0;

  // Round by round: play everything currently playable, then re-read the
  // schedule to pick up the teams the results just resolved.
  for (let guard = 0; guard < 12; guard++) {
    const schedule = await api.get(`/tournaments/${uuid}/schedule`);
    const playable = (schedule.matches ?? [])
      .filter((m) => m.status !== "FINISHED" && m.team1Id != null && m.team2Id != null)
      .sort((a, b) => {
        const sa = STAGE_ORDER.indexOf(a.stage);
        const sb = STAGE_ORDER.indexOf(b.stage);
        return sa !== sb ? sa - sb : a.matchId - b.matchId;
      });
    if (playable.length === 0) break;

    for (const m of playable) {
      const [score1, score2] = pickScores(rng);
      await api.post(`/tournaments/${uuid}/matches/${m.matchId}/start`, { mode: "SIMPLE" });
      await addGoals(uuid, m.matchId, rosterByTeamId.get(m.team1Id), score1, rng, [
        tournamentTally,
        globalTally,
      ]);
      await addGoals(uuid, m.matchId, rosterByTeamId.get(m.team2Id), score2, rng, [
        tournamentTally,
        globalTally,
      ]);
      // Knockout matches must be finalised through the bracket endpoint - it is
      // what advances the winner, feeds the third-place playoff and writes the
      // podium. The generic /finish rejects them with 409.
      await api.post(`/tournaments/${uuid}/bracket/matches/${m.matchId}/result`, {
        score1,
        score2,
        penalties1: null,
        penalties2: null,
      });
      played++;
      process.stdout.write(".");
    }
  }
  console.log(`\n  OK ${played} matches played`);

  const finished = await api.post(`/tournaments/${uuid}/finish`);
  const winnerName = finished?.winnerName ?? "?";

  // Best-scorer award, so the all-time list's "nagrada" column has values.
  const topScorer = [...tournamentTally.entries()].sort(
    (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])),
  )[0];
  if (topScorer) {
    await api.post(`/tournaments/${uuid}/awards`, {
      bestScorerName: topScorer[0],
      bestPlayerName: topScorer[0],
      bestGoalkeeperName: null,
    });
  }
  console.log(
    `  OK finished -- winner: ${winnerName}` +
      (topScorer ? `, best scorer: ${topScorer[0]} (${topScorer[1]})` : ""),
  );

  return {
    uuid,
    winnerName,
    matches: played,
    players: playerCount,
    goals: [...tournamentTally.values()].reduce((a, b) => a + b, 0),
  };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const only = (process.env.SEED_ONLY ?? "all").trim().toLowerCase();
  const doDrafts = only === "all" || only === "draft" || only === "drafts";
  const doFinished = only === "all" || only === "finished" || only === "played";
  if (!doDrafts && !doFinished) {
    console.error(`ERROR: unknown SEED_ONLY="${only}". Use draft | finished | all.`);
    process.exit(1);
  }

  console.log("\n" + "=".repeat(60));
  console.log("  Futsal-turniri.com -- Mock Data Seed");
  console.log("=".repeat(60));
  console.log(`  API: ${BASE_URL}`);
  console.log(`  Draft tournaments   : ${doDrafts ? TOURNAMENT_SPECS.length : 0}`);
  console.log(`  Played to the finish: ${doFinished ? FINISHED_SPECS.length : 0}`);
  console.log("=".repeat(60) + "\n");

  let teamNameOffset = 0;
  const stats = { tournaments: 0, teams: 0, players: 0, errors: [] };

  for (let ti = 0; doDrafts && ti < TOURNAMENT_SPECS.length; ti++) {
    const spec = TOURNAMENT_SPECS[ti];
    console.log(`[${ti + 1}/${TOURNAMENT_SPECS.length}] Creating tournament: "${spec.name}"`);

    let tournament;
    try {
      tournament = await createTournament(spec);
      console.log(`  OK Tournament created -- UUID: ${tournament.uuid}`);
      stats.tournaments++;
    } catch (err) {
      console.error(`  FAIL Failed to create tournament: ${err.message}`);
      stats.errors.push(`Tournament "${spec.name}": ${err.message}`);
      teamNameOffset += spec.teamCount;
      console.log();
      continue;
    }

    // Slice team names for this tournament
    const teamNames = ALL_TEAM_NAMES.slice(teamNameOffset, teamNameOffset + spec.teamCount);
    teamNameOffset += spec.teamCount;

    let savedTeams;
    try {
      savedTeams = await addTeams(tournament.uuid, teamNames);
      console.log(`  OK ${savedTeams.length} teams added`);
      stats.teams += savedTeams.length;
    } catch (err) {
      console.error(`  FAIL Failed to add teams: ${err.message}`);
      stats.errors.push(`Teams for "${spec.name}": ${err.message}`);
      console.log();
      continue;
    }

    // Add players to each team
    let tournamentPlayerCount = 0;
    for (const team of savedTeams) {
      const playerCount = 6 + Math.floor(Math.random() * 3); // 6, 7, or 8
      try {
        const added = await addPlayersToTeam(tournament.uuid, team.id, playerCount);
        tournamentPlayerCount += added;
        stats.players += added;
        process.stdout.write(".");
      } catch (err) {
        console.error(`\n  FAIL Failed to add players to team "${team.name}": ${err.message}`);
        stats.errors.push(`Players for team "${team.name}" in "${spec.name}": ${err.message}`);
      }
    }
    console.log(
      `\n  OK ${tournamentPlayerCount} players added across ${savedTeams.length} teams`,
    );
    console.log();
  }

  // ── Fully played tournaments ───────────────────────────────────────────────
  // Fixed seed: same leaderboard on every run, so the all-time list has a known
  // expected answer (printed at the end) to check the UI against.
  const rng = makeRng(20260728);
  const globalTally = new Map();
  const finishedResults = [];

  for (let fi = 0; doFinished && fi < FINISHED_SPECS.length; fi++) {
    const spec = FINISHED_SPECS[fi];
    console.log(`[${fi + 1}/${FINISHED_SPECS.length}] Playing tournament: "${spec.name}"`);
    try {
      const res = await playFinishedTournament(spec, rng, globalTally);
      finishedResults.push({ name: spec.name, ...res });
      stats.tournaments++;
      stats.teams += spec.teams.length;
      stats.players += res.players;
    } catch (err) {
      console.error(`  FAIL ${err.message}`);
      stats.errors.push(`Played tournament "${spec.name}": ${err.message}`);
    }
    console.log();
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const plannedTournaments =
    (doDrafts ? TOURNAMENT_SPECS.length : 0) + (doFinished ? FINISHED_SPECS.length : 0);

  console.log("=".repeat(60));
  console.log("  SEED COMPLETE -- Summary");
  console.log("=".repeat(60));
  console.log(`  Tournaments created : ${stats.tournaments} / ${plannedTournaments}`);
  console.log(`  Teams added         : ${stats.teams}`);
  console.log(`  Players added       : ${stats.players}`);

  if (finishedResults.length > 0) {
    console.log("\n  Played tournaments:");
    for (const r of finishedResults) {
      console.log(`    - ${r.name}: ${r.matches} matches, ${r.goals} goals, winner ${r.winnerName}`);
      console.log(`      /turniri/${r.uuid}`);
    }

    const top = [...globalTally.entries()]
      .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
      .slice(0, 12);
    console.log("\n  Expected all-time scorer list (vjecna lista), top 12:");
    top.forEach(([name, goals], i) => {
      console.log(`    ${String(i + 1).padStart(2)}. ${name} -- ${goals}`);
    });
    console.log("\n  Compare against /statistika (goals aggregate by player NAME,");
    console.log("  so the same name in several tournaments is the same person).");
  }
  if (stats.errors.length > 0) {
    console.log(`\n  Errors (${stats.errors.length}):`);
    for (const e of stats.errors) {
      console.log(`    - ${e}`);
    }
  } else {
    console.log("\n  No errors.");
  }
  console.log("=".repeat(60) + "\n");
}

main().catch((err) => {
  console.error("Unexpected fatal error:", err);
  process.exit(1);
});
