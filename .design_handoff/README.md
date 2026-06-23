# Handoff: Futsal Turniri — Pitch Theme Redesign

## Overview

A full visual redesign of the **Futsal Turniri** web application — a public platform where anyone can host a futsal (5-a-side / małonogometni) tournament in Croatia. Users can create tournaments, prijaviti ekipe (register teams), manage the draw and schedule, and follow matches live.

The new theme — internally called **"Pitch"** — leans into football vocabulary (pitch green, scoreboard typography, jersey-number type, pitch-line motifs) while staying clean, modern and product-grade. It replaces the previous generic blue/red palette with a single confident green primary and a soft off-white surface, plus a small accent stack (amber / red / goal yellow) for status and live signals.

## About the Design Files

The files in `design-reference/` are **HTML/React design prototypes** built to communicate visual intent and layout — they are **not production code to copy line-for-line**. They use inline styles, vanilla JS-style helpers and a stand-in design canvas wrapper purely to render multiple screens side-by-side in one preview.

**Your job is to recreate these screens in the target codebase using Chakra UI v3** (the user has chosen this as the component library for the new frontend). Use Chakra's component primitives, theme tokens and patterns — do not port the inline styles directly. Reach for Chakra's `Box / Flex / Grid / Stack` for layout, `Card`, `Button`, `Badge`, `Input`, `Tabs` etc. for components, and configure design tokens via Chakra's `createSystem` / `defineConfig`.

## Fidelity

**High-fidelity.** Colors, spacing, typography and component states are intentional. Match them closely. Where the prototype hand-rolled something Chakra has a primitive for (badges, tabs, progress bars, inputs), prefer the Chakra primitive over a pixel re-implementation — but theme it to match the look.

## Tech Stack Expectations

- **React 18+** (Next.js or Vite app router both fine)
- **Chakra UI v3** (`@chakra-ui/react` v3.x)
- **Fonts via `next/font` or `@fontsource/*`** — see token list below
- **Icons**: use `react-icons` (Lucide / Feather set) — the prototype's hand-drawn SVG icons map 1:1 to common Feather icons (see "Icon mapping" below)
- **State**: trivial local state for tabs/filters; data fetching layer is out of scope here
- **i18n**: copy is in **Croatian**. Preserve all strings exactly as in the prototypes
- **Routing**: each "page" file in the prototype maps to one route

---

## Design Tokens

Define these as Chakra v3 tokens in your theme. Example structure:

```ts
import { createSystem, defaultConfig, defineConfig } from '@chakra-ui/react';

const config = defineConfig({
  theme: {
    tokens: {
      colors: {
        // ...
      },
      fonts: {
        // ...
      },
      // ...
    },
    semanticTokens: { /* ... */ },
  },
});

export const system = createSystem(defaultConfig, config);
```

### Colors

| Token name        | Hex       | Use                                              |
| ----------------- | --------- | ------------------------------------------------ |
| `bg.canvas`       | `#f3f6f1` | Page background (very pale green-tinted off-white) |
| `bg.surface`      | `#ffffff` | Cards, inputs                                    |
| `bg.surfaceTint`  | `#eaf1e7` | Active pill background, hover, soft fills       |
| `bg.surfaceTint2` | `#f7faf5` | Subtle inner panels                             |
| `fg.ink`          | `#0e1f15` | Primary text                                     |
| `fg.inkSoft`      | `#3d4a42` | Secondary text                                   |
| `fg.inkMute`      | `#728176` | Muted / placeholder                              |
| `border.default`  | `#dde5d8` | Default border                                   |
| `border.strong`   | `#c9d4c2` | Stronger divider                                 |
| `pitch.500`       | `#0b6b3a` | **Primary brand green** — buttons, links, headings accent |
| `pitch.400`       | `#3aa56b` | Lighter pitch — gradients, success dots          |
| `pitch.700`       | `#084a28` | Deepest pitch — gradient ends                    |
| `accent.amber`    | `#d97706` | "Za 6 dana" status, secondary alerts             |
| `accent.red`      | `#dc2626` | LIVE, danger, destructive                        |
| `accent.goal`     | `#f5b921` | Goals, trophy, in-progress accents              |
| `team.blue`       | `#2563eb` | Sample team color                                |
| `team.purple`     | `#7c3aed` | Sample team color                                |

### Typography

Three font families:

| Token              | Family                   | Use                                       | Load                              |
| ------------------ | ------------------------ | ----------------------------------------- | --------------------------------- |
| `fonts.body`       | `Inter`                  | All body text, default                    | Google Fonts, weights 400–800     |
| `fonts.heading`    | `Bricolage Grotesque`    | Large headings, team names, big numerics  | Google Fonts, weights 400–800     |
| `fonts.mono`       | `JetBrains Mono`         | Stats, time, all-caps labels, scoreboards | Google Fonts, weights 400, 700, 800 |

**Type scale** (use Chakra's `textStyles` for these):

| Style key            | Family    | Size | Weight | Letter-spacing | Use                       |
| -------------------- | --------- | ---- | ------ | -------------- | ------------------------- |
| `display.xl`         | Bricolage | 38px | 800    | -0.03em        | Page hero titles          |
| `display.lg`         | Bricolage | 32px | 800    | -0.025em       | Page titles               |
| `display.md`         | Bricolage | 28px | 700    | -0.02em        | Section titles            |
| `heading.lg`         | Inter     | 22px | 700    | -0.02em        | Card title                |
| `heading.md`         | Inter     | 17px | 700    | -0.01em        | Sub-card title            |
| `body.md`            | Inter     | 14px | 400    | normal         | Default                   |
| `body.sm`            | Inter     | 13px | 500    | normal         | Secondary                 |
| `body.xs`            | Inter     | 12px | 500    | normal         | Tertiary                  |
| `mono.label`         | JetBrains | 10px | 700    | 0.1em          | All-caps labels, "DATUM"  |
| `mono.score`         | JetBrains | 42–110px | 800 | -0.04em       | Scoreboard numbers        |
| `mono.time`          | JetBrains | 18–24px | 700  | -0.02em       | Match clock               |

### Spacing

Chakra default scale (4px base) works. Hot-spots used heavily:
- `2`, `3`, `4` (8–16px) for in-card spacing
- `5`, `6` (20–24px) for card padding
- `8`, `10` (32–40px) for section margin

### Radii

| Token        | Value   | Use                       |
| ------------ | ------- | ------------------------- |
| `radii.sm`   | `8px`   | Inputs, small buttons     |
| `radii.md`   | `10px`  | Date stamps, list items   |
| `radii.lg`   | `12px`  | Cards, badges (large)     |
| `radii.xl`   | `16px`  | Page-level cards          |
| `radii.2xl`  | `20px`  | Hero blocks               |
| `radii.full` | `9999px`| Pills, avatars, chips     |

### Shadows

Minimal. Cards rely on borders, not shadows. Use shadows only on:
- Focused tournament card overlay on the map: `0 10px 28px rgba(14,31,21,0.12)`
- Big team badges (live page): `0 8px 24px rgba(team-color, 0.5)`
- Sticky action bar (Create tournament): `0 -4px 20px rgba(14,31,21,0.04)`

---

## Chakra v3 Component Mapping

Use these Chakra primitives. The prototype hand-rolls many of these — replace them with the Chakra version.

| Prototype concept             | Chakra v3 primitive                       |
| ----------------------------- | ----------------------------------------- |
| `<PageShell>`                 | `<Box minH="100vh" bg="bg.canvas">` + your own `<TopNav>` |
| `<PitchNav>`                  | `<HStack>` + `<Tabs.Root>` for nav, `<Avatar>` for user |
| `<SectionCard>`               | `<Card.Root>` + `<Card.Header>` + `<Card.Body>` + `<Card.Footer>` |
| `<TabBar>`                    | `<Tabs.Root>` with `variant="enclosed"` or custom pill variant |
| `<PrimaryButton>` / `<GhostButton>` | `<Button variant="solid" colorPalette="pitch">` / `<Button variant="outline">` |
| `<StatusChip>`                | `<Badge variant="subtle">` with status dot              |
| `<Input>` (custom)            | `<Input>` + `<InputGroup>` w/ `<InputElement>` for icons |
| `<Radio>` (custom card)       | `<RadioGroup.Root>` + `<RadioGroup.Item>` styled as cards |
| `<Textarea>`                  | `<Textarea>`                              |
| `<FormField>`                 | `<Field.Root>` + `<Field.Label>` + `<Field.HelperText>` |
| Progress bar in cards         | `<Progress.Root>` + `<Progress.Track>` + `<Progress.Range>` |
| Number stat with accent stripe | `<Card.Root>` with `borderLeftWidth="3px" borderLeftColor="..."` |
| Tournament card               | `<Card.Root>` + `<AspectRatio>` for poster + custom inner layout |
| Map sidebar list              | `<Stack>` of clickable `<Card.Root>` items |
| Filter chips                  | `<Button size="sm" borderRadius="full">`  |
| Bracket cells                 | `<Card.Root>` with `<Stack divider>` for home/away rows |
| Live scoreboard               | Custom layout (`<Grid>`/`<HStack>`) — see "Live page" section |

### Icon mapping

The prototype uses inline SVGs. Replace with `react-icons` (lucide pack `lu*` or feather `fi*`):

| Prototype icon  | react-icons replacement     |
| --------------- | --------------------------- |
| `IconClock`     | `LuClock` / `FiClock`       |
| `IconUsers`     | `LuUsers` / `FiUsers`       |
| `IconEuro`      | `LuEuro` / `FiDollarSign` (use € manually) |
| `IconPin`       | `LuMapPin` / `FiMapPin`     |
| `IconSearch`    | `LuSearch` / `FiSearch`     |
| `IconFilter`    | `LuFilter` / `FiFilter`     |
| `IconPlus`      | `LuPlus` / `FiPlus`         |
| `IconChev`      | `LuChevronRight` / `FiChevronRight` |
| `IconCalendar`  | `LuCalendar` / `FiCalendar` |
| `IconTrophy`    | `LuTrophy`                  |
| `IconShare`     | `LuShare2`                  |
| `IconEdit`      | `LuPencil` / `FiEdit2`      |
| `IconTrash`     | `LuTrash2`                  |
| `IconInfo`      | `LuInfo`                    |
| `IconTarget`    | `LuTarget`                  |
| `IconUser`      | `LuUser`                    |
| `IconSettings`  | `LuSettings` / `LuSlidersHorizontal` |
| `IconExternal`  | `LuExternalLink`            |
| `IconPlay`      | `LuPlay`                    |
| `IconLocate`    | `LuLocate`                  |
| `IconGift`      | `LuGift`                    |
| `BallIcon`      | `LuVolleyball` or `GiSoccerBall` from `react-icons/gi` — preferred: keep as custom SVG, it's a small distinctive mark |

---

## Screens

### Shared shell

Every page shares the same top navigation (`PitchNav` in the prototype).

- **Left**: brand mark (a green pill with a ball glyph) + "Futsal Turniri" wordmark + small mono caption "HRVATSKA · SEZONA 2026"
- **Center**: nav as a pill group inside a soft-green capsule. Items: `Turniri`, `Uživo`, `Kreiraj turnir`, `Karta`. Active = filled green pill, white text. "Uživo" carries a red pulsing dot when not active.
- **Right**: a 38px round ghost icon button (chat/notifications stand-in) + a user pill with avatar (gradient circle initials) and full name.

Implement once and render at the top of every page.

---

### 1. Turniri (listing) — `page-list.jsx`

**Route**: `/` or `/turniri`

**Purpose**: Public listing of all tournaments. Search, filter by status, view as grid/list/map. Anyone can browse; signed-in users see "Kreiraj turnir" button.

**Layout (top → bottom)**:

1. **Live scoreboard hero** (full width inside a rounded `2xl` container, dark gradient background `linear-gradient(135deg, #0b6b3a, #084a28)`):
   - Top sub-bar with red-tinted background (`rgba(220,38,38,0.18)`): `● UŽIVO · MATCHDAY` label on left, tournament name + round on right
   - Center scoreboard:
     - Home (right-aligned): "DOMAĆIN" mono caption, team name in 28px Bricolage 700, small stat line, 64×64 team badge with gradient + shadow
     - Score: amber pill with clock+time on top, then `2 : 2` in **78px JetBrains Mono 800** with the colon at 35% white opacity, then mono caption with referee + venue
     - Away: mirror of home
   - Bottom 3-col footer: home scorer ticker (left, ball icon + mono minute + name), away ticker (right), and a **goal-yellow "Prati uživo" CTA** on the far right

2. **Toolbar**:
   - Full-width search input (left, with `⌘ K` chip on right)
   - "Filteri" button with badge count
   - View switcher: pill group `Mreža / Lista / Karta`
   - Status filter chips row beneath: `Svi turniri · Uživo · Nadolazeći · Za 6 dana · Mjesta puna` (each with a colored dot + count, dark active pill)

3. **Section header**: "Predstojeći turniri" + small "Sortirano po datumu početka · X rezultata" subtext, and a mono caption on the right "SVI · KOL 2026"

4. **3-column grid of tournament cards** (`<Grid templateColumns="repeat(3, 1fr)" gap={5}>`):
   - Each card is a `<Card.Root>` with rounded `xl` corners
   - **Top half (180px)**: poster area
     - If `tournament.poster` exists: render the image (`<Image objectFit="cover">`)
     - Otherwise: render the empty-state placeholder — a `pitch.500 → pitch.700` gradient, pitch-line motif overlay at 16% opacity, big team-initials in 52px Bricolage 800 centered, plus mono caption "⊕ NEMA PLAKATA"
     - Overlays on top:
       - Top-left: white **date stamp** (day of week tiny, day of month 20px 800, month tiny mono)
       - Top-right: status `<Badge>` (UŽIVO red+pulse, Nadolazeći green dot, Za 6 dana amber dot, Mjesta puna gray dot)
       - Bottom-right: dark glass time chip with clock icon
   - **Body**: name (17px 700), location (`MapPin` + city, 13px muted), progress bar for capacity (label "Popunjenost" / mono "X / Y"), bottom row with fee on left (16px 700 pitch green) and pitch-tinted pill "Detalji →" button

5. **Completed section** (always present, with empty state):
   - `<Card.Root>` with `1px dashed` border, faint pitch backdrop
   - Calendar icon in a green-tint circle, "Još nema završenih turnira" headline + paragraph

**Removed (per latest direction)**: do NOT add a "SEZONA 2026 · 8 TURNIRA" / "Sve hrvatske ture na jednom mjestu." headline block between the hero and toolbar. The hero is the top of the page.

**Tournament data model** (see `shared.jsx`):
```ts
type Tournament = {
  id: string;
  name: string;
  status: 'live' | 'upcoming' | 'soon' | 'full';
  statusLabel: string;       // Croatian display label
  date: string;              // "pet, 22. svi"
  dateShort: string;         // "22 SVI"
  day: string;               // "PET"
  time: string;              // "19:15"
  fee: number;               // €
  teams: number;
  max: number;
  location: string;
  poster?: string;           // URL when uploaded
};
```

---

### 2. Uživo — `page-live.jsx`

**Route**: `/uzivo`

**Purpose**: Watch multiple live matches at the same time. Multiple matches can be playing concurrently across different tournaments, so the page is built as a **grid of medium-sized live scoreboard cards** — not one big featured match.

**Layout**:

1. **Header**:
   - Mono caption: `● UŽIVO SADA` (red pulsing dot)
   - 32px Bricolage title: "`{count} utakmice u tijeku`" — value is dynamic
   - Sub-text: "Prati sve utakmice paralelno · X nadolaze danas"
   - Right: `Podijeli` and `Cijeli raspored` ghost buttons

2. **Filter chips row + sort**:
   - Chips: `Sve / Uživo / Nadolaze danas / Završene danas` (active = dark pill)
   - Sort dropdown on the right ("Najnoviji događaj")

3. **2-column grid of live match cards** (`<Grid templateColumns="repeat(2, 1fr)" gap={4}>`):
   - Each card is the **`LiveMatchCard`** component (see prototype). Structure:
     - **Header strip** (soft green tint background, bordered bottom): red `UŽIVO` badge + tournament name + round, plus right-side watching count + venue
     - **Scoreboard row** (3-col grid: home / score / away):
       - Team name right-aligned, then 44px team badge with brand gradient
       - Score: amber pill with clock+time+half, then `{home} : {away}` in 42px JetBrains Mono 800
       - Mirror for away
     - **Event ticker** (soft tint background, bordered): last 5 events as pill chips. Each chip = mono minute + ball icon (goal) or yellow card rectangle + player name. If >5 events, `+N` more
     - **Footer**: goal count + card count stats on left (mono), "▶ Prati uživo" green button on right

4. **Two-column section below**:
   - **Left (1.6fr)**: `<SectionCard>` "Nadolazeće utakmice danas" — list of 3 items, each with big mono time, teams (home vs away), tournament+round subtext, "Podsjeti me" button + chevron
   - **Right (1fr)**: `<SectionCard>` "Strijelci dana" — top 4 scorers across all live matches today (jersey number tile + name + team color dot + goal count)

**Live match data model**:
```ts
type LiveMatch = {
  tournament: string;
  round: string;             // "Četvrtfinale · 3/8"
  home: { name: string; short: string; color: string; score: number };
  away: { name: string; short: string; color: string; score: number };
  clock: string;             // "12:34"
  half: '1. POL.' | '2. POL.';
  watching: number;          // viewers
  venue: string;
  events: Array<{
    side: 'h' | 'a';
    min: string;             // "12'"
    name: string;            // "K. Tomic"
    kind: 'goal' | 'yellow' | 'red' | 'sub';
  }>;
};
```

The grid auto-fits up to ~10 simultaneous matches comfortably (2 per row, scrolling). Empty state when zero live: show a `<SectionCard>` "Trenutno nema utakmica uživo" with the calendar icon and a CTA to view the schedule.

---

### 3. Karta — `page-map.jsx`

**Route**: `/karta`

**Purpose**: Geographic browse — see all upcoming tournaments on a map of Croatia.

**Layout**:
1. **Header**: mono caption "KARTA · X LOKACIJA U HRVATSKOJ" + title "Sve ture na karti" + subtitle, with `Moja lokacija` and `Filteri` buttons on right
2. **Filter bar card**: range slider "U KRUGU OD" with kilometer value, and three legend toggles (Danas green / Tjedan amber / Kasnije red) on the right
3. **Two-column main split**:
   - **Sidebar (340px)**: header "VIDLJIVE TURE (N)" + sort link, then list of clickable list items (colored pin icon + tournament name + status badge + city/date/teams + chevron). Active item = green-tinted background
   - **Map area**: large rounded card with Leaflet/Mapbox/MapLibre map inside. Zoom controls top-left. Pins colored by status (red live with `!` badge, green upcoming, amber soon, gray full). Top-right of the map: an absolutely-positioned "focused tournament" card showing the selected pin's tournament with `Prati →` and `Ruta` buttons

**Implementation note**: The prototype draws a stylized SVG map. In production, use a real map library (Leaflet + react-leaflet, or Mapbox GL JS). Style pins to match: rounded pin shape, brand colors per status, white border, pulsing animation for live.

---

### 4. Kreiraj turnir — `page-create.jsx`

**Route**: `/kreiraj`

**Purpose**: Multi-section form to create a new tournament.

**Layout**:
1. **Back link** + **header row**: mono kicker "NOVI TURNIR · 3 KORAKA", title "Kreiraj turnir", subtitle. Right: **step indicator** — 3 pills (`Osnovno · Format · Pregled`) with arrows between; active = filled green
2. **Stack of `<FormSection>` cards** (each: icon + title + subtitle header, then form body):
   - **Osnovne informacije**: 2-col grid — Ime turnira (required), Datum i vrijeme, Maks. ekipa, Kotizacija. Then below, 2-col with Lokacija field + Detalji textarea on left, **map picker preview** on right
   - **Plakat turnira**: 2-col with dashed-border upload zone on left (icon + "Povuci sliku ovdje / ili klikni za odabir"), and a panel of format/size hints on the right
   - **Format natjecanja**: two radio cards (`Grupe + eliminacija` / `Samo eliminacija`) in a 2-col grid, then "Broj grupa" + "Ekipa prolazi iz grupe" inputs, then "Popunjavanje eliminacijske ljestvice" radio stack
   - **Nagradni fond**: 3-col grid of inputs for 1./2./3. mjesto, each with trophy icon prefix
3. **Sticky action bar at bottom** (positioned `sticky bottom-0`):
   - Left: green dot + "Sve obavezno popunjeno · spremno za kreiranje" status
   - Right: `Odustani` / `Spremi kao nacrt` ghost + `Kreiraj turnir` solid primary

**Form spec**: Required fields marked with red asterisk. Validation should run on blur and submit. Map picker uses the same map library as the Karta page.

---

### 5. Tournament detail — 5 tabs (`page-detail.jsx`, `page-teams.jsx`, etc.)

**Route**: `/turnir/:id` with hash/path-based tabs `#detalji | #ekipe | #zdrijeb | #raspored | #statistika`

**Shared header on all tabs**:
- Back link "← Natrag na popis"
- Title row: tournament name (34px 800) + status badge ("U tijeku" green dot, "Nacrt" dark, etc.)
- **`<TabBar>`**: white-bg pill container with 5 equal-flex tab buttons. Active = filled green pill, white text. Use Chakra `<Tabs.Root variant="plain">` with a custom trigger style.

#### Tab: Detalji

2-column layout (380px poster column / fluid info column).

- **Poster column**: large poster card (or empty-state placeholder, same component as the listing card poster but `height={500}` and `big={true}` for larger text), then "Podijeli" + "Uredi" buttons in a row
- **Info column** (vertical stack of cards):
  - 4 quick-stat tiles (Datum / Vrijeme / Ekipe / Kotizacija) — each with mono caption, value in 22px 700, left 3px accent stripe
  - Organizer pill bar (avatar + "ORGANIZATOR" + name + "Pošalji poruku →" link)
  - **`<SectionCard>` Lokacija**: MapPin icon, address, "Otvori u kartama" button. Body: 200px map preview
  - **`<SectionCard>` Detalji turnira**: descriptive paragraph + 3-col mini-grid of format facts (Format / Poluvremena / Pravila)
  - **`<SectionCard>` Nagradni fond**: 3-col row of medal pill cards (gold/silver/bronze gradient with trophy + place + amount). Total badge in the card header
  - **`<SectionCard>` Kontakt**: name + phone + email, with "Prijavi ekipu" primary button on the right

#### Tab: Ekipe

- Top **`<SectionCard>`** "Ekipe" header with subtitle and two buttons in the header (`Prijavi ekipu za turnir` ghost + `Dodaj ekipu` solid primary). Body: 4-tile stat strip (Prijavljene / Popunjeno / Igrača ukupno / Prosjek po ekipi)
- Below: **2-column split**:
  - **Left (1fr)**: section header "AKTIVNE EKIPE (N)" + search input. Then a stack of **team list items** (40×40 colored team badge + name + player count + chevron, with red trash button when active/selected). Selected item = green-tinted background, green border
  - **Right (1.2fr)**: selected team header card (44×44 badge + team name + "Sastav igrača · N igrača" + "Dodaj igrača" button). Then a stack of **player rows**: 44×44 jersey number tile (dark with white text; **active captain row = filled green tile**), name + tiny role + goals stat, with `K · KAPETAN` badge for the captain, and edit/trash icon buttons on the right. End with "Spremi promjene" primary button in a footer row

#### Tab: Ždrijeb (Bracket)

- **Toolbar card**: icon + "Eliminacija" + "16 ekipa · 4 kola · 15 utakmica" subtitle. Right: `Podijeli ždrijeb` ghost + `Ponovno generiraj` ghost (danger variant)
- **Bracket card** (white, padding 24/28, horizontal scroll allowed):
  - 4 column **round headers**: pill-style labels "Osmina finala / Četvrtfinale / Polufinale / Finale" — Final pill uses gold/amber instead of green
  - Grid of `BracketCell`s in 4 columns with SVG connectors between columns. Each cell = `<Card.Root>` with two team rows separated by a divider; the **winning team row** gets a green-tinted background and a left 6px green bar (loser gets a gray bar). Score on the right in 18px JetBrains Mono 800. Live cells get a red border + glow ring + floating "● UŽIVO" badge above the card. Empty cells get a footer row with two link-style buttons: "Unesi rezultat" (green) and "▶ Pokreni" (red)
  - **Final cell** is special: gold-tinted gradient background with trophy + "FINALE" label and "NAGRADA 1. MJESTO · 5.000€" caption beneath

#### Tab: Raspored

- **`<SectionCard>` Format utakmice** (icon: settings/sliders): 5-col grid of mini stat inputs (Poluvremena / Min/Polu. / Pauza polu. / Pauza između / Buffer). Body footer: green-tint info bar showing computed match duration (`Trajanje termina: 35 min`) and overall start/end estimate. Right: `Generiraj raspored` primary button (in card header)
- **`<SectionCard>` Raspored utakmica**: round-header chip ("OSMINA FINALA · 8 UTAKMICA") with day on right. Stack of **`MatchRow`** items:
  - 6-col grid: match # tile (green-tint), time block (18px mono + day mono small), home (name + 32px team badge, right-aligned), score column (`– vs –` muted; for live: `0 : 0` + red live clock), away (32px badge + name), action button (Prati for live, Detalji for others). Live row gets red border + soft red ring

#### Tab: Statistika (populated)

- **4-tile stat strip**: Utakmica / Golova / Najviše u utakmici / Najbrži gol, each with icon, mono label, big value, sub-line
- **2-column split**:
  - **Left (1.1fr) `<SectionCard>` Najbolji strijelci**: stack of `ScorerRow` (rank circle — gold/silver/bronze gradient for top 3, gray for rest; jersey-number dark tile; name + team color dot + team name; mono stat group "X UTAK · X ASIST"; goals total with ball icon + 22px number)
  - **Right (1fr) `<SectionCard>` Tablica grupa**: dense table — # / EKIPA / UT / P / N / I / GOL / PTS. First row green-tinted (leader). Left side bar color codes prolaze/doigravanje. Legend in footer

#### Tab: Statistika (empty)

Same `<SectionCard>` header. Body: centered empty state — 56px circle with ball icon in a green tint, "Još nema golova" headline, "Statistika strijelaca prikazat će se čim padne prvi gol na turniru." paragraph.

---

## Interactions & Behavior

- **Live pulse**: any element with a red dot or "UŽIVO" label uses CSS animation `pulse 1.6s infinite` (50% opacity at midpoint)
- **Tab switching**: instant content swap, no transition
- **Buttons**:
  - Primary (solid green): hover darken ~8%, active darken ~14%
  - Ghost (outline + white): hover bg `bg.surfaceTint`, active darker tint
  - Danger ghost: red text with red-tint border
  - Pill chip filter: inactive = white bg + border; active = `fg.ink` solid dark; transition 150ms
- **Cards**: no hover lift; the card itself is the click target where applicable. Cursor `pointer` on clickable cards.
- **Inputs**: focus ring uses Chakra default `pitch.500` ring at 30% opacity, no shadow.
- **Tournament card click**: navigates to `/turnir/{id}` (Detalji tab)
- **Bracket "Unesi rezultat"**: opens a modal/drawer with score input + scorer list
- **Bracket "Pokreni"**: starts live match clock and moves match into live state (becomes a red live cell)

## State Management

Per page, local React state is sufficient for:
- Active tab
- Selected team in Ekipe (controlled by URL param `?team=NK_Borac` or local state)
- Filter selection on listing
- View mode (Mreža / Lista / Karta) on listing
- Map zoom & focused pin on Karta page

Data fetching is **out of scope** for this design package — the engineer will wire to whatever API exists.

## Responsive Behavior

Designs are sized for desktop **1280–1440px** wide content. For tablet/mobile:
- Convert 3-col grids → 2-col then 1-col
- Make `<TabBar>` horizontally scrollable
- Live page: 1 column on mobile, stacked
- Detail page: poster column moves on top of info column
- Create form: 2-col grids collapse to 1-col
- Karta sidebar becomes a bottom sheet on mobile

Use Chakra's responsive value syntax `{ base: 1, md: 2, lg: 3 }`.

## Assets

- **Fonts**: Inter, Bricolage Grotesque, JetBrains Mono — all Google Fonts, free
- **Icons**: react-icons (Lucide pack preferred — `lu*`)
- **Images**: tournament poster placeholders should be real uploaded user images via signed URLs. The empty-state visual (gradient + initials + "Nema plakata") is generated client-side, not an asset
- **Map**: Use Leaflet + OpenStreetMap tiles or Mapbox. Pin SVG is custom — port the prototype's pin path

## Files in this bundle

`design-reference/` contains the source prototypes. Each file is a single React component file (no JSX import statements — they rely on a Babel-in-browser setup just for the preview, so don't try to run them directly).

| File                  | Renders                                            |
| --------------------- | -------------------------------------------------- |
| `index.html`          | Loader for the design canvas                       |
| `main.jsx`            | The design canvas wrapping all artboards           |
| `theme.jsx`           | Shared tokens (`T`), nav (`PitchNav`), shell, primitives (`SectionCard`, `TabBar`, `PrimaryButton`, etc.) and many icons |
| `shared.jsx`          | Mock tournament data + base icons                  |
| `design-canvas.jsx`   | The canvas wrapper component (presentation only — ignore for porting) |
| `page-list.jsx`       | **Turniri** listing                                |
| `page-live.jsx`       | **Uživo** grid of live matches                     |
| `page-map.jsx`        | **Karta**                                          |
| `page-create.jsx`     | **Kreiraj turnir** form                            |
| `page-detail.jsx`     | Tournament **Detalji** tab                         |
| `page-teams.jsx`      | **Ekipe** tab                                      |
| `page-bracket.jsx`    | **Ždrijeb** tab                                    |
| `page-schedule.jsx`   | **Raspored** tab                                   |
| `page-stats.jsx`      | **Statistika** tab (with empty state variant)      |

To view the design locally, open `index.html` in a browser (it loads React + Babel via CDN). The Croatian copy in each file is the **canonical source for all UI strings** — preserve verbatim.

## Suggested implementation order

1. Set up Chakra v3 theme with the tokens above
2. Build the top nav + page shell — share across all routes
3. Build the listing page (turniri) — exercises most primitives (cards, badges, search, filters, posters)
4. Build the detail page tab shell + Detalji tab
5. Add the remaining detail tabs one at a time
6. Build the live page (grid of `LiveMatchCard` instances)
7. Build the create form
8. Wire up the map page (needs a map lib; can start with placeholder)
9. Wire data fetching to your API/backend

## Questions for the team

Things the design intentionally left open and the dev should confirm:

- **Auth/profile screens**: not in this bundle. The header user-pill assumes signed-in state. The listing & live pages should also work logged-out (hide Create CTA, show Sign in instead)
- **Mobile-first**: prototypes are desktop. If the primary target is mobile, the layouts need adaptation per "Responsive Behavior"
- **Image uploads**: poster upload UX is sketched but assumes a backend that stores and serves the image. Pick a storage layer (Cloudinary / Supabase Storage / S3) early
- **Live updates**: the live page assumes server-sent events or websockets for clock/score updates. Confirm transport before building
