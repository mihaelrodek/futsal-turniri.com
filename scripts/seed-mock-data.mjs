/**
 * seed-mock-data.mjs
 * ──────────────────────────────────────────────────────────────────────────────
 * Seeds 6 varied mock tournaments (with teams and players) by calling the
 * Nogometni-turniri.com REST API.
 *
 * HOW TO RUN
 *   node scripts/seed-mock-data.mjs
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
  post: (urlPath, body) => apiRequest("POST", urlPath, body),
  put: (urlPath, body) => apiRequest("PUT", urlPath, body),
};

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

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  Futsal-turniri.com -- Mock Data Seed");
  console.log("=".repeat(60));
  console.log(`  API: ${BASE_URL}`);
  console.log(`  Tournaments to create: ${TOURNAMENT_SPECS.length}`);
  console.log("=".repeat(60) + "\n");

  let teamNameOffset = 0;
  const stats = { tournaments: 0, teams: 0, players: 0, errors: [] };

  for (let ti = 0; ti < TOURNAMENT_SPECS.length; ti++) {
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

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log("=".repeat(60));
  console.log("  SEED COMPLETE -- Summary");
  console.log("=".repeat(60));
  console.log(`  Tournaments created : ${stats.tournaments} / ${TOURNAMENT_SPECS.length}`);
  console.log(`  Teams added         : ${stats.teams}`);
  console.log(`  Players added       : ${stats.players}`);
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
