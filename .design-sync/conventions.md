# Building with the "Pitch" design system

Football/futsal tournament UI: pitch-green primary, scoreboard mono numerics,
off-white canvas. Built on Chakra UI v3. Copy is **Croatian**.

## 1. Wrap the app in `PitchProvider` — once, at the root

Chakra v3 is CSS-in-JS: **every token in this system is injected at runtime by
the provider.** Without it, no component is styled — no pitch green, no
Bricolage/Inter/JetBrains fonts, no surfaces. It is not optional.

```jsx
import { PitchProvider, SectionCard, PrimaryButton } from '<ds>'

export default function App() {
  return (
    <PitchProvider>
      {/* every Pitch component must be inside this */}
    </PitchProvider>
  )
}
```

`PitchProvider` also supplies a react-router `MemoryRouter` **only when there
isn't already a router above it** — `Logo`, `Footer`, `NotFoundView` and
`HelpFab` render `<Link>`s and throw without one. Wrapping a real app that owns
a `BrowserRouter` stays a no-op.

Dark mode: the `_dark` token twins activate when an ancestor carries the `dark`
class. `PitchProvider` does not set it — add `class="dark"` on `<html>` yourself.

## 2. There are no CSS classes — style via Chakra style props

Most components spread extra props onto their Chakra root, so you style them
with **token strings**, never class names and never raw hex:

```jsx
<SectionCard title="Ekipe" bg="bg.panel" borderColor="border" rounded="xl" />
```

`Box` / `Flex` / `Stack` are **not exported**. For your own layout glue use
`Panel` or `SectionCard` as the surface, and plain `<div>`s for structure. Inside
a plain `<div>`, reach the tokens as CSS variables — Chakra emits them at
runtime, e.g. `var(--chakra-colors-pitch-500)`, `var(--chakra-fonts-mono)`.

### The token vocabulary (all verified against the built bundle)

| Family | Real names |
|---|---|
| Brand ramp | `pitch.50 … pitch.950` (`pitch.500` = `#0b6b3a` primary) |
| Brand palette | `colorPalette="pitch"` (alias `"brand"`) → `pitch.solid` `.contrast` `.fg` `.muted` `.subtle` `.emphasized` `.focusRing` |
| Status accents | `accent.red` (LIVE/destructive), `accent.amber` (warnings), `accent.goal` (goals/trophies) |
| Surfaces | `bg.canvas` (page), `bg.panel` (cards), `bg.surfaceTint`, `bg.surfaceTint2` |
| Text | `fg.ink` (primary), `fg.soft` (secondary) |
| Teams | `team.blue`, `team.purple` |
| Radii | `sm` 8 · `md` 10 · `lg` 12 · `xl` 16 · `2xl` 20 · `full` |
| Shadows | `xs` `sm` `md` `lg` `xl` `sticky` |
| Fonts | `heading` Bricolage Grotesque · `body` Inter · `mono` JetBrains Mono |
| Type scale | `textStyle="display.xl\|lg\|md"`, `"heading.lg\|md"`, `"mono.label\|score\|time"` |

Use `mono.score` for scoreboards, `mono.label` for the all-caps kickers
("DATUM", "ORGANIZATOR"). A global `pitchPulse` keyframe drives every live dot.

> **Known theme quirk.** `fg.muted`, `fg.subtle`, `border`, `border.emphasized`,
> `border.subtle`, `bg.subtle` and `bg.muted` are overridden in `system.ts` but
> Chakra's own defaults win, so they render as **neutral zinc grays**, not the
> intended green-tinted values. They are still the correct tokens to use — just
> don't expect a green tint from them. Prefer `fg.ink` / `fg.soft` for text you
> want on-brand.

## 3. Where the truth lives

- `_ds/<folder>/styles.css` and its `@import` closure — fonts + global keyframes.
- `components/<Group>/<Name>/<Name>.prompt.md` — per-component usage.
- `components/<Group>/<Name>/<Name>.d.ts` — the exact props. Read it before
  guessing.

### Icons

The bundle ships exactly one icon: **`BallIcon`** (`size`, `color`,
`strokeWidth`). No icon set is exported — bring your own (the app uses
`react-icons` Feather, `Fi*`). The `icon` prop shape differs per component:

- **ElementType reference** — `IconChip`, `SectionHeader`, `EmptyState`, `Meta`:
  `icon={BallIcon}`
- **Rendered node** — `FormSectionCard`, `PrimaryButton`, `GhostButton`,
  `TintButton`: `icon={<BallIcon size={16} />}`
- `SectionCard` accepts **either**.

Passing the wrong shape renders nothing.

## 4. An idiomatic screen

```jsx
<PitchProvider>
  <div style={{ minHeight: '100vh', background: 'var(--chakra-colors-bg-canvas)', padding: 24 }}>
    <PageTitle
      kicker="TURNIR"
      title="Kup Grada Zagreba"
      subtitle="Sortirano po datumu početka"
      status="live"
      statusLabel="UŽIVO"
      action={<PrimaryButton icon={<BallIcon size={15} />}>Prijavi ekipu</PrimaryButton>}
    />

    <PillTabBar tabs={['Detalji', 'Ekipe', 'Ždrijeb', 'Raspored']} active={tab} onChange={setTab} />

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
      <AccentStat label="DATUM" value="22. svibnja" hint="subota" accent="pitch.500" />
      <AccentStat label="EKIPE" value="12 / 16" accent="accent.amber" />
    </div>

    <SectionCard
      title="Detalji turnira"
      subtitle="Osnovne informacije"
      icon={BallIcon}
      action={<GhostButton>Uredi</GhostButton>}
      mt="6"
    >
      <Meta icon={BallIcon}>Sportska dvorana, Zagreb</Meta>
      <StatusChip status="upcoming" label="Nadolazeći" />
    </SectionCard>
  </div>
</PitchProvider>
```
