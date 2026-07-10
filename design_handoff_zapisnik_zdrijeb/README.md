# Handoff: Zapisnik uživo & Ždrijeb grupa

## Overview
Two turnir (tournament) admin screens for **Nogometni-turniri.com**:

1. **Zapisnik** — the live match-recording screen. Lets an operator run a match: choose how to record it (live with timer / live without timer / result-only), then log goals, own-goals and cards per player, track fouls per team, and see a running match timeline.
2. **Ždrijeb grupa** — the group-draw screen. Drag teams ("kuglice") from a pool into groups, with per-group team counts and auto-distribution tools.

Language of all UI copy is **Croatian** — keep the exact strings from this doc.

## About the Design Files
The files in `prototypes/` are **design references authored in HTML** (they use a small in-house template runtime — the `.dc.html` format — with a `<script>` logic class and `{{ }}` template holes). They are **prototypes showing intended look and behavior, not production code to copy verbatim.**

Your task: **recreate these designs in the target codebase's existing environment** (React, Vue, Svelte, etc.) using its established components, styling approach, and state patterns. If no frontend environment exists yet, pick the most appropriate framework for the project and implement there. Treat the `.dc.html` logic classes as a **behavioral spec** — the state shape and handlers translate almost 1:1 to a React component with `useState`.

The `.dc.html` files open in a browser via the runtime, but you do not need to run them — read them as reference. Everything needed to rebuild is in this README.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, and interactions are all specified. Recreate the UI faithfully (pixel-level spacing values are given below), adapting only to your codebase's component library where it makes sense.

---

## Design Tokens

### Colors
| Token | Hex | Use |
|---|---|---|
| Page background | `#eef1e9` | app canvas behind cards |
| Card surface | `#ffffff` | main content cards |
| Ink / primary text | `#1c2b22` | body text |
| Muted text | `#6b7568` | secondary labels |
| Faint label | `#9aa393` | section eyebrows / hints |
| Border | `#e2e6dc` | default 1.5px borders |
| Faint divider | `#eef1ea` / `#ecefe6` | hairlines, event rows |
| Home team maroon | `#7a1d2b` | Roma color, timer, scores, "NA REDU" |
| Away team green | `#14512f` | Đurđ color |
| Goal green | `#1a6a43` | goal accent, selected player |
| Selected chip bg | `#e6f2ea` | selected player / goal button |
| Live/red | `#c0392b` | LIVE badge, red card, destructive |
| Red-ball gradient | `radial-gradient(circle at 35% 30%, #e8635a, #b7301f)` | own-goal (auto-gol) marker |
| Yellow card | `#e8a01f` | yellow card + "Završi poluvrijeme" btn |
| Fouls amber bg | `#faf6f0` | fouls block bg |
| Fouls amber text | `#8a6a3a` | fouls labels/steppers |
| Score pill bg | `#e8ebfb` | timeline running-score pill |
| Score pill text | `#33407a` | timeline running-score pill text |
| Draw green (primary) | `#2f6b3f` | ždrijeb active tab, primary tools |
| Draw green (dark) | `#254e2f` | "Potvrdi ždrijeb" |
| Group card bg | `#f3f7f0` | ždrijeb group cards |
| Group card border | `#dce7d4` | ždrijeb group cards |
| Team pill border (grouped) | `#cfe0c6` | ždrijeb team pill in a group |
| Team pill border (pool) | `#d3ddca` | ždrijeb team pill in pool |
| Pool dashed border | `#cdd5c4` | ždrijeb pool drop zone |
| Save-result green | `#3f6b47` | "Spremi rezultat" button |

### Typography
- **Font family:** `Nunito` (Google Fonts, weights 400/600/700/800), fallback `system-ui, sans-serif`.
- Timer digits: 52px / 800. Pre-match scoreboard team names: 30px / 800. Section eyebrows: 12px / 800, letter-spacing .08–.09em, uppercase, color `#9aa393`. Team names in roster: 20px / 800. Body/labels: 13–16px / 700. Timeline player: 15px / 700 italic.
- Numeric displays (scores, timer, counts, fouls) use `font-variant-numeric: tabular-nums`.

### Spacing / Radius
- Card padding: 24–26px. Card radius: 22–24px. Inner blocks radius: 11–18px. Pills/badges radius: 999px.
- Standard border: `1.5px solid`. Selected emphasis: `2px solid #1a6a43`.
- Grid gaps: 8px (tight lists), 12–14px (columns), 20px (board).

### Shadows
- Cards: `0 1px 3px rgba(20,40,25,.06)`.
- Timeline dot ring: `box-shadow: 0 0 0 5px #fff` (breaks the dashed centre line).

---

## Screen 1 — Zapisnik (match recording)

A single screen with **two phases** driven by one state machine. File: `prototypes/Zapisnik.dc.html`.

### Phase A — Pre-match (`phase = 'pre'`)
Purpose: operator picks how to record the match.

Layout, top→bottom, inside the white card:
1. **Eyebrow** "UTAKMICA ZA VOĐENJE" (centered, faint).
2. **Match selector** — full-width outlined button (radius 14, border `#e2e6dc`), left text `▶ NA REDU · Roma – Đurđ · Grupa · 10. 07. 20:00`, right chevron `▾` (`#9aa393`). (Prototype is display-only; wire to real match picker.)
3. **Scoreboard** — centered row: `Roma` (30/800) · score badge · `:` (`#c9ccc3`) · score badge · `Đurđ`. Score badges: bg `#f6eef0`, text `#7a1d2b`, radius 10, padding 4×10, min-width 42, tabular-nums.
4. **Sub-line** "Utakmica još nije pokrenuta." (centered, `#9aa393`).
5. **Mode buttons** (hidden when result-only form is open):
   - `Uživo – s mjeračem vremena` — filled `#7a1d2b`, white text, radius 13, padding 15×24.
   - `Uživo – bez mjerača (vlastiti sat)` — white, border `#e2e6dc`, ink text.
6. **Result-only toggle** — text button with pencil `✎`, label toggles `Unesi samo rezultat` ⇄ `Odustani od unosa rezultata`.
7. **Result-only panel** (only when toggled): bg `#f4f6f0`, border `#e4e9dd`, radius 16. Eyebrow "UNESI REZULTAT (BEZ STRIJELACA)". A 3-column grid `1fr auto 1fr`: left `ROMA` stepper `− N +`, centre `:`, right `ĐURĐ` stepper. Stepper buttons 34×34, border `#d9e0d3`, `#3f6b47` glyphs; number 26/800. Below, centered `✎ Spremi rezultat` (filled `#3f6b47`). On save, show confirmation line "Rezultat spremljen: X : Y" in `#3f6b47`.
8. Shared **timeline** section (empty here → "Još nema zabilježenih događaja.").

**Key behavior:** opening the result-only form **hides the two mode buttons** (mirrors how choosing a live mode swaps the whole screen into recording). The toggle remains as the way back.

### Phase B — Live recording (`phase = 'live'`)
Entered by clicking a mode button. `timed` flag = with/without clock.

1. **Sticky top bar** (only in live): white, radius 20, sticky at top:10. Left: red **UŽIVO** pill with pulsing dot (`@keyframes` opacity 1→.35). Centre: `Roma – Đurđ` (22/800, the `–` is `#c9ccc3`). Right: `{half short} · {timer}` (maroon timer).
2. **Match selector** (same as pre-match; prefix becomes `● UŽIVO`).
3. **Timer block**: if `timed`, 52px maroon `M:SS` + round play/pause toggle (`❚❚`/`►`, 48px). If not `timed`, text "Bez mjerača — minuta se upisuje ručno". Below: half label eyebrow ("1. POLUVRIJEME" / "2. POLUVRIJEME").
4. **Entry card** (border `#e2e6dc`, radius 18):
   - Eyebrow **"1 · ODABERI IGRAČA"**. Two columns (Roma / Đurđ). Each column: team name (20/800 with color square 15×15 — maroon home, green away), then a **fouls block** (amber bg `#faf6f0`, label "PREKRŠAJI", stepper `− N +` in `#8a6a3a`), then the **player list**.
   - **Player list**: one button per player. Left: number badge (24×24, radius 7 — home bg `#f4ece2`/text `#7a1d2b`, away bg `#e4efe6`/text `#14512f`), then name (14/700). First entry is always **"Nepoznati igrač"** with a `?` badge. Selected state: border `2px #1a6a43`, bg `#e6f2ea`, trailing `✓` (`#1a6a43`).
   - Eyebrow **"2 · ODABERI RADNJU"**. 4-column grid of action buttons, each a stacked icon+label:
     - `⚽ Gol` (bg `#e6f2ea`, text `#14512f`)
     - `Auto-gol` — icon is a **red ball** (17–20px circle, radial-gradient `#e8635a→#b7301f`, inset dark ring), text `#7a1d2b`
     - `Žuti` — 15×19 rounded rect `#e8a01f`
     - `Crveni` — 15×19 rounded rect `#c0392b`
   - **Footer row**: left = live `hint` text (see State); right = `Min.` number input (56px) + `Sada` button (resets to current minute) + `Odustani` (clears pending selection).
5. **Flow controls**: `Završi 1. poluvrijeme` / `Završi utakmicu` (amber `#e8a01f`, dark text) + `⋯` overflow button. Overflow reveals `Vrati na pripremu / poništi` (destructive outline `#c0392b`).
6. Shared **timeline** (below).

### Shared — Timeline ("TIJEK UTAKMICE")
A vertical center-line timeline (matches the operator's mental model).
- Container `position:relative`; an absolutely-positioned **dashed vertical line** at `left:50%`, `border-left:2px dashed #d5d9cf`, spanning top:8 → bottom:8.
- Rows are a `1fr 96px 1fr` grid. **Home** events fill the **left** cell (content right-aligned, reading `player · min' · icon`); **away** events fill the **right** cell (left-aligned, `icon · min' · player`). Centre cell holds either:
  - a **score pill** (for goals & own-goals) — the running score `H - A`, bg `#e8ebfb`, text `#33407a`, radius 999; or
  - a **dot** — 12px `#1c2b22` circle with `0 0 0 5px #fff` ring (for cards).
- **Half separators** ("1. poluvrijeme" / "2. poluvrijeme") are centered pills with white bg sitting over the line. "1. poluvrijeme" always shows first; "2. poluvrijeme" is inserted before the first 2nd-half event.
- Each row has a subtle **undo** `✕` (24px round, `#b0b7a8`) pushed to the outer edge (`margin-right/left:auto`).
- Player label italic `#3b453a`; if no real player was chosen it reads "Nepoznati igrač".
- Icons: goal `⚽`; own-goal red ball; yellow/red card = colored rounded rect (14×17).

### Interactions & Behavior (Zapisnik)
- **Pairing entry model:** to log an event the operator selects a **player** and an **action**, in either order; when both are set the event commits immediately and the selection clears. `hint` reflects the pending state:
  - none → "Odaberi igrača, zatim radnju (ili obrnuto)."
  - player picked → "Odabran: {player} — odaberi radnju."
  - action picked → "Radnja: {label} — odaberi igrača."
- **Score** is derived from events (never entered directly in live): `gol` for a team +1 that team; `ag` (own-goal) +1 the *opponent*.
- **Minute:** auto = floor(seconds/60) (+45 in 2nd half), min 1; operator may override via the `Min.` input; `Sada` clears the override.
- **Timer:** 1s interval, only ticks when `phase==='live' && timed && running`. Play/pause toggles `running`.
- **Završi poluvrijeme:** 1st half → set half=2, reset seconds. 2nd half → stop clock.
- **Undo:** removes that event; score/timeline recompute.
- **Fouls:** independent per-team counters, clamped ≥ 0. Not part of the timeline.
- **Reset / Vrati na pripremu:** returns to `phase='pre'` and clears events, fouls, timer, selection.

### State Management (Zapisnik)
```
phase: 'pre' | 'live'
timed: boolean            // live with clock vs manual minute
running: boolean          // clock ticking
seconds: number           // elapsed in current half
half: 1 | 2
minEdit: number | null    // manual minute override
events: [{ id, team:'home'|'away', type:'gol'|'ag'|'yellow'|'red', playerId, min, half }]
seq: number               // id generator
fouls: { home:number, away:number }
pendingTeam / pendingPlayer / pendingAction   // in-flight selection
resultMode: boolean       // result-only form open
manual: { home:number, away:number }          // result-only score
savedText: string | null  // result-only confirmation
```
Rosters: 10 real players per team **plus** a leading `{ num:'?', name:'Nepoznati igrač' }`. `playerName()` returns just "Nepoznati igrač" for the `?` entry, else `"{num} · {name}"`.

---

## Screen 2 — Ždrijeb grupa (group draw)

File: `prototypes/Zdrijeb.dc.html`. Purpose: distribute teams into groups via drag & drop.

### Layout
1. **Tabs** — 2-col segmented control in a white pill: `Grupe` (active, filled `#2f6b3f` white) / `Eliminacija` (inactive `#6b7568`).
2. **Card** with title "Ždrijeb grupa" (22/800) + subtitle "Skica se sprema automatski — primjenjuje se tek klikom na „Potvrdi ždrijeb”." (`#8a927f`).
3. **Config steppers** row (3 steppers, each label + `− N +` box, border `#e2e6dc` radius 12, buttons 38×44 bg `#f6f8f3` green glyphs):
   - `BROJ GRUPA` (1–8), `PROLAZI PO GRUPI` (0–8), `NAJBOLJE 2. PLASIRANE` (0–8).
4. **Toolbar** (bordered top+bottom hairlines): left status text; right buttons:
   - `⤨ Nasumično rasporedi` — filled `#2f6b3f`.
   - `↩ Isprazni` — white, border `#cfe0c6`, text `#2f6b3f`.
   - `🗑 Odbaci skicu` — white, border `#edd6cf`, text `#a24b3c`.
   - `Potvrdi ždrijeb` — filled `#254e2f`.
5. **Board** — grid `320px 1fr`:
   - **Left pool** "Kuglice / ekipe" — dashed drop zone (border `#cdd5c4`, bg `#fbfcfa`, radius 16, min-height 280). Header has a green count badge. Empty state: "Sve raspoređeno — povuci ekipu ovamo da je vratiš."
   - **Right groups** — responsive grid `repeat(auto-fill, minmax(240px,1fr))`, gap 14. Each group card: bg `#f3f7f0`, border `#dce7d4`, radius 16, min-height 200. Header: `SKUPINA {A..}` + count badge (white, border `#cfe0c6`, text `#2f6b3f`) reading "N ekipa/ekipe". Empty state: dashed "Povuci ekipu ovamo".
6. **Team pill** (both pool & groups): white, radius 11, padding 12×14, drag handle `⠿` (`#b6c1a9`) + name (15/700), `cursor:grab`, `draggable`. Pool pills border `#d3ddca`; grouped pills border `#cfe0c6`.

### Interactions & Behavior (Ždrijeb)
- **Drag & drop (HTML5 DnD):** each pill sets `dataTransfer` text = team id on `dragstart` (also stashed on an instance ref as fallback). Every zone (pool + each group) handles `dragover` (`preventDefault`, dropEffect `move`), `dragenter` (set active highlight), and `drop` (move team into that zone, appended to end → preserves drop order).
- **Active drop zone highlight:** while dragging over a zone, overlay a 2px `#2f6b3f` border + `rgba(47,107,63,.06)` fill (absolute, pointer-events none). Cleared on drop / dragend.
- **Nasumično rasporedi:** Fisher–Yates shuffle all teams, then round-robin into the current groups (pool emptied).
- **Isprazni / Odbaci skicu:** move all teams back to pool, groups emptied.
- **BROJ GRUPA change:** adding a group appends an empty one; removing groups sends orphaned teams back to the pool (`normalizedZones`).
- **Potvrdi ždrijeb:** shows confirmation banner "Ždrijeb potvrđen — {N} grupe, {passes} prolaz(a) po grupi." (wire to real save).
- **Status text:** "…Sve ekipe su raspoređene." when pool empty, else "…Raspoređeno {assigned}/{total}."
- **Counts per group** are the core feature — always visible in each group header, plus pool remaining.

### State Management (Ždrijeb)
```
numGroups: number (1–8)
passes: number
best: number
zones: { pool:[ids], A:[ids], B:[ids], ... }   // one array per zone, order = display order
dragZone: 'pool' | 'A' | ... | null            // active highlight
confirmed: boolean
```
Teams: 12 demo teams `Ekipa 1…12` (replace with real team list). `letters(n)` → `['A','B',…]`. `normalizedZones()` reconciles zones with the current group count. `move(id, zone)` removes id from every zone then appends to target.

---

## Interactions common to both
- All entrance animations are short (`.16s`/`.18s ease-out`, fade + small translateY). Keep them subtle; none loop.
- No external assets — icons are Unicode glyphs (`⚽ ✓ ✕ ⠿ ⤨ ↩ 🗑 ✎ ▶ ▾ ❚❚ ►`) and CSS-drawn shapes (card rects, red ball gradient). You may swap these for your icon set; the red-ball own-goal marker and colored card rects should stay visually distinct.

## Screenshots (`screenshots/`)
- `zapisnik-01-priprema.png` — pre-match, mode buttons visible.
- `zapisnik-02-samo-rezultat.png` — result-only form open (mode buttons hidden).
- `zapisnik-03-uzivo.png` / `zapisnik-04-uzivo-timeline.png` — live recording (timer, player+action entry, fouls). Scroll down in the prototype for the full center-line timeline described above.
- `zdrijeb-01-pocetak.png` — group draw, all teams in the pool.
- `zdrijeb-02-rasporedeno.png` — after "Nasumično rasporedi" (teams distributed, per-group counts).

## Assets
None. Only the Nunito web font (Google Fonts). If your app already has a brand font/system, prefer it and map sizes/weights accordingly.

## Files
- `prototypes/Zapisnik.dc.html` — live match-recording screen (pre-match + live + timeline).
- `prototypes/Zdrijeb.dc.html` — group-draw drag-and-drop screen.

Both are `.dc.html`: markup between `<x-dc>…</x-dc>`, a `class Component` logic block in the trailing `<script>`. Read `renderVals()` for the full list of derived values and handlers — it is the authoritative behavioral spec.
