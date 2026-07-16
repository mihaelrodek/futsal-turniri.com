# App Overview — futsal-turniri.com

> Handoff document for design work. Everything the app does, who uses it, and how the current UI is built.
> Last updated: 2026-07-16. UI language is **Croatian** (glossary at the bottom).

## What it is

A full platform for **amateur / county-level football (futsal & small-sided) tournaments and leagues** in Croatia, currently being repositioned as a general grassroots-football platform (rebrand in progress — working candidates: Golveo, Skudeo, Kickoffcam; current brand "Futsal Turniri"). It covers the whole lifecycle:

**organize a tournament → register teams → draw groups/bracket → schedule matches → run matches live (referee console) → live standings & stats → live video stream with overlays → share/watch everything publicly.**

Think **Sofascore + Veo for grassroots football**: one person with a phone can run a whole tournament, and spectators get a professional-feeling live experience (stream, live tables, timelines, stats).

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + TypeScript + Vite, Chakra UI **v3** (`createSystem`), react-router v7, TanStack Query (with localStorage persistence), react-icons (Feather `Fi*`) |
| Backend | Quarkus 3.15 / Java 21, JAX-RS REST, Hibernate ORM + Panache, PostgreSQL, Liquibase migrations |
| Storage | MinIO (private bucket) — all images/videos proxied via `/api/resources/{id}/image` (HTTP Range / 206 supported for video) |
| Auth | Firebase OIDC (Google + email/password), role `admin` for platform admin |
| Realtime | WebSocket for live match/standings updates + visibility-aware polling fallback (`usePolling`) |
| Infra | Docker Compose, Caddy reverse proxy (also does crawler UA-rewrites for SSR previews), PWA service worker |
| Fonts | **Bricolage Grotesque** (headings), Inter-style body, **JetBrains Mono** (labels/numbers) |

Frontend verification: `cd frontend && npx tsc -b --noEmit`.

---

## Design system ("Pitch" theme)

Defined in `frontend/src/system.ts` (Chakra v3 tokens) + shared primitives in `frontend/src/ui/pitch.tsx`.

- **Brand green**: `pitch.500` = `#0b6b3a` (ramp `pitch.50–900`, alias `brand`). Dark-mode brand is a lighter green (`#17a05a` / `#58cb93`).
- **Surfaces**: `bg.canvas` (page, `#f3f6f1`), `bg.panel` (cards, white), `bg.surfaceTint` / `bg.surfaceTint2` (subtle green-tinted fills).
- **Text**: `fg.ink` (near-black green `#0e1f15`), `fg.soft`, `fg.muted`.
- **Borders**: `border`, `border.subtle`, `border.emphasized`, `border.strong` (greenish greys).
- **Accents**: `accent.amber` (warnings/2nd place), `accent.red` (live/cards), `accent.goal`, `green.subtle` (winner/advance highlight).
- **Dark mode**: full support, toggle in navbar (`ColorModeToggle`, `ThemeSync` syncs `<meta theme-color>`).
- **Shared UI primitives** (`ui/pitch.tsx`): `PageTitle` (title + status chip + actions row), `StatusChip` (e.g. pulsing red "UŽIVO" badge), `MonoLabel` (small mono uppercase labels), section cards.
- **Keyframes** live in `index.html` (Chakra v3 can't take raw `@keyframes`): `pitchPulse`, `mapLivePing` (map live dot), `livePillPulse` (pulsing UŽIVO chip).
- **Navbar** (`NavBar.tsx`): sticky, desktop = 3-column grid (logo | centred pill-capsule nav | color-mode + install + user pill). Mobile = logo + install + avatar; navigation moves to a fixed `MobileBottomNav` at the bottom.
- **Logo** (`Logo.tsx`): SVG mark (net + green ball) + live-text wordmark "Futsal **Turniri**" + mono domain line. Light/dark variants.
- General look: rounded-full pills, soft shadows, green-tinted neutrals, compact 16px section gaps, mono labels for data, sporty but clean.

---

## Roles

1. **Visitor (anonymous)** — can watch everything: tournaments, live matches, stream, stats, map. No account needed to spectate.
2. **Registered user** — creates tournaments, claims a player name / team, saves team presets, gets push notifications, public profile page.
3. **Organizer (owner / co-owner)** — full tournament management incl. the live referee console ("Zapisnik"). Tournaments support **multiple co-owners**.
4. **Platform admin** — global dashboard, players list moderation, **Live stream** control (global stream banner, ads, overlays).

---

## Route map

| Route | Page | What it shows |
|---|---|---|
| `/turniri` | **Home** (`TournamentsPage`) | Hero (promo carousel, or live-stream hero when streaming), filter toolbar, sections: "Nadolazeći turniri" (upcoming), in-progress, finished (greyed-out cards). Live tournaments get a pulsing "UŽIVO" chip |
| `/turniri/novi` | Create tournament (auth) | Creation wizard: name, date(s), location (autocomplete + map picker), format, team count, poster upload |
| `/turniri/:uuid` | **Tournament details** | Tab sections: **Detalji** (overview, poster, location map, podium/results when finished), **Zapisnik** (live console, organizers only), **Ekipe** (teams & players, kit-color picker, bulk import), **Ždrijeb** (draw: Grupe / Eliminacija), **Raspored** (schedule), **Statistika** (scorers, cards, awards) |
| `/turniri/:uuid/uzivo` | **Turnir mode** (`TournamentLivePage`) | Shareable fullscreen live view: stream player + tabbed side panel (Utakmica / Tablica), Podijeli (share) + Izađi buttons. SSR preview for social crawlers ("Uživo prijenos … putem kamere") |
| `/turniri/:uuid/fullscreen` | Projector view | Fullscreen rotating tournament display (venue TV/projector) |
| `/turniri/:uuid/utakmica/:matchId` | **Match page** (`MatchLivePage`) | Public per-match view: score, Sofascore-style event timeline, lineups/scorers |
| `/uzivo` | Live hub (`LivePage`) | Compact cards of today's / live tournaments (replaces calendar; `/kalendar` redirects here) |
| `/karta` | Map (`MapPage`) | Leaflet map of all tournaments, live ones ping (`mapLivePing`) |
| `/statistika` | Global stats (`StatsPage`) | **Vječna lista strijelaca** (all-time scorer list across all tournaments), filters. Penalty-shootout goals excluded |
| `/pronadi-ekipu` | Find a team (`FindTeamPage`) | Players looking for a team / team requests board |
| `/profil` | Own profile (auth) | Profile editing, avatar, team presets, claims; **admin users** get extra tabs: Dashboard, Players list, **Live stream** |
| `/profil/:slug` | Public profile | Player's public page: career stats, tournaments, avatar (SSR OG preview) |
| `/preuzmi-ekipu/:token`, `/preuzmi-ime/:token` | Claim flows | Token links that let a real person claim a team / a player name entered by an organizer |
| `/vodic` | Guide | How-to guide; plus an interactive Joyride tour (HelpFab) that highlights nav items |
| `/embed/turnir/:uuid` | Embed | Iframe-embeddable tournament widget for external sites |
| `/prijava`, `/registracija`, `/privatnost` | Auth & legal | Login, register, privacy |

All legacy English routes (`/tournaments`, `/map`, …) 301-redirect to Croatian ones.

---

## Feature detail

### 1. Tournament creation & formats
- Wizard at `/turniri/novi`: name, venue (LocationAutocomplete + LocationMapPicker), single or **multi-day**, poster image (MinIO), format sketch preview (`FormatSketch`).
- Formats: **groups + knockout**, groups-only, knockout-only. Per-group **advance count** (how many go through per group, incl. best-third table with predicted qualifiers).
- Co-owners: owner can grant management rights to other users.

### 2. Teams & players
- Team registration with players; **bulk import** dialog (paste a roster).
- Per-team **kit color** (jersey picker, rendered as shirt icons across the UI — `jersey.tsx`).
- Player name autocomplete against the global player registry.
- **Claim system**: organizer types names → later the real person claims their team (`/preuzmi-ekipu/:token`) or their player identity (`/preuzmi-ime/:token`) and it links to their account/profile. Users keep reusable **team presets**.

### 3. Draw ("Ždrijeb")
- **Grupe**: drag/reorder teams into groups, group reorder, collapse, auto-scroll, draft persists locally before publishing.
- **Eliminacija**: knockout bracket generation and manual editing; bracket view (`BracketTab`).

### 4. Schedule ("Raspored")
- Round generation (`RoundController`), manual rounds dialog, **multi-day schedule planner** with per-day time slots (`MultiDaySchedulePlanner`), pitch/time assignment.

### 5. Live match console ("Zapisnik") — the referee/organizer tool
- Start/pause/resume match timer (pause-aware clock, `livePausedAt`).
- Events: goals (with scorer), **own goals**, assists, yellow/red cards (incl. anonymous card when player unknown), fouls per half (`FoulControls`), penalties, **penalty shootout** (shootout goals are excluded from scorer stats).
- **Offline-first**: every event goes through an offline queue with idempotency keys; works with no signal at a sports hall, syncs later (`LiveSyncIndicator` shows queue state). Optimistic UI add/delete.
- Auto-transitions tournament status to "U TIJEKU" (started) on first match activity.

### 6. Live spectator experience
- **Live standings**: group tables recompute live from in-progress scores (tie-break rules ported to frontend `liveStandings.ts`), changed cells flash red, live form badges, WebSocket + polling refresh.
- **Match page** with Sofascore-style vertical event timeline.
- **Live scorebug** overlay (`LiveScoreBug`) — broadcast-style score strip over the stream and in fullscreen views.
- Push notifications (web push): per-match and per-tournament bells (`MatchNotificationBell`, `TournamentNotificationBell`).

### 7. Video streaming (global, admin-controlled)
- One global **stream banner** set by the platform admin (Profile → Live stream tab): stream URL (HLS), optional tournament link.
- **4 states**: `STREAMING` (StreamHero on home + Turnir mode available), `PAUSED` ("stream je trenutno pauziran" banner), `ADS` (ad media plays — image or looped video from the **ad library**), `OFF` (default promo hero).
- **Ad library & overlay library**: admin uploads images/videos (≤50 MB, mp4/webm sniffed server-side) to MinIO; **overlays** can be toggled live over the stream (centered, ~72% size, e.g. half-time sponsor loop) — propagate to viewers in ~7 s (fast polling while streaming).
- **StreamHero** (home, when streaming): big player (2.2fr) + tabbed side panel (0.95fr) — tabs **Utakmica** (live event ticker + next match) / **Tablica** (live group table or bracket), tournament name on top, footer with centered "Turnir mode" button and "Turnir →" link.
- **Turnir mode** (`/turniri/:slug/uzivo`): shareable fullscreen stream + same side panel, Podijeli (Web Share API + clipboard fallback), viewer presence counter (`StreamPresenceController`).
- Custom `StreamPlayer` (HLS) with fullscreen incl. overlay layers.

### 8. Stats & awards
- Per-tournament: top scorers (configurable scope — groups only / knockout / from round X), cards, results.
- **Global eternal scorer list** (`/statistika`) across all tournaments.
- Tournament finish flow: "Završi turnir" → **podium editor** (1st/2nd/3rd), **award suggestions** auto-computed (best GK, best player heuristics), golden "Rezultati turnira" section on the details page.

### 9. PWA & mobile
- Installable PWA (install button in navbar, first-run prompt, iOS-specific install steps).
- Service worker: network-first cache for API reads → tournament pages work offline (read-only) + full offline live console (write queue).
- Mobile: bottom tab navigation (`MobileBottomNav`), everything responsive; the live console is designed phone-first (used pitchside).

### 10. SEO & sharing
- Croatian slugs, `SitemapController` (sitemap.xml), per-page `useDocumentHead`.
- **SSR previews for social crawlers** via Caddy UA-rewrite → backend renders OG HTML: tournament pages, live page ("Uživo prijenos turnira … putem kamere"), home, public profiles, brand OG images (`BrandOgController`).
- Embeddable tournament widget (`/embed/turnir/:uuid`).

---

## Croatian UI glossary

| Croatian (UI) | English |
|---|---|
| Turnir(i) | Tournament(s) |
| Nadolazeći / U tijeku / Završeni | Upcoming / In progress / Finished |
| UŽIVO | LIVE |
| Utakmica | Match |
| Tablica | Standings/table |
| Skupina / Grupe | Group(s) |
| Ždrijeb | Draw |
| Eliminacija / Završnica | Knockout / Finals |
| Raspored / Kolo | Schedule / Round |
| Zapisnik | Match report / live console |
| Ekipa / Igrač | Team / Player |
| Strijelci / Vječna lista strijelaca | Scorers / all-time scorer list |
| Poredak | Ranking |
| Kreiraj turnir | Create tournament |
| Prijava / Registracija | Login / Register |
| Podijeli / Izađi / Otvori | Share / Exit / Open |
| Pronađi ekipu | Find a team |
| Karta / Statistika / Vodič | Map / Stats / Guide |
| Reklame / Baza reklama / Baza overlaya | Ads / ad library / overlay library |

---

## Design constraints & conventions (for any redesign)

1. **Croatian-only UI** — all labels/copy in Croatian; typographic quotes must be curly `„…"` (a straight `"` inside JSX strings has broken builds before).
2. **Green is the brand** (`#0b6b3a` / `pitch.*`) — the identity equity to keep; a blue theme was tried and explicitly reverted.
3. Both **light and dark mode** must be designed; tokens are semantic (never hard-code colors except the avatar gradient).
4. **Mobile-first for the console**, desktop-first for stream viewing; bottom nav on mobile, pill navbar on desktop.
5. Compact density is preferred — the user has repeatedly asked for tighter paddings/gaps (16px section rhythm on home).
6. Live elements pulse (chip/badge level, **not** whole cards — explicit user preference).
7. Finished tournaments are visually muted (grayscale 0.6 + opacity 0.82 on cards).
8. Fonts: Bricolage Grotesque (display), JetBrains Mono for small data labels — this pairing is part of the look.
9. Chakra UI v3 API (`colorPalette`, semantic tokens, no styled-components); global keyframes go in `index.html`.
10. Everything user-facing is reachable without login — spectator experience must never sit behind auth.
