import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react"

/**
 * ─── "Pitch" design system - Nogometni-turniri.com ─────────────────────────
 *
 * The SPECTO brand: deep navy (#0B1522) paired with bright cyan (#2AD4C8),
 * with lime (#C9F24B) reserved as a data/highlight accent. The `pitch` ramp
 * NAME is kept for call-site compatibility but now carries the cyan family,
 * not the old football greens. A small accent stack (amber / red / lime goal)
 * drives status and live signals; LIVE stays RED.
 *
 * Cyan is a LIGHT hue, so white-on-cyan fails contrast: CTAs use NAVY text on
 * cyan (`pitch.contrast` = #0B1522), matching the spec's "Watch live" button.
 *
 * Tokens map 1:1 to the design handoff doc:
 *   pitch.400          primary brand cyan    - buttons, links, accents
 *   pitch.600 / fg     readable teal on white (text/icons)
 *   accent.amber       "Za 6 dana", warnings
 *   accent.red         LIVE / destructive    - UNCHANGED (stays red)
 *   accent.goal        goals, trophies       - lime highlight
 *   bg.canvas          page background (white light / navy dark)
 *   bg.surfaceTint     active pill / hover / soft fills
 *   bg.surfaceTint2    subtle inner panels
 *   fg.ink / inkSoft / inkMute   text ladder
 *   border.default / strong      divider ladder
 *
 * `colorPalette="pitch"` resolves through the standard solid/contrast/fg/
 * muted/subtle/focusRing semantic tokens so existing Chakra primitives just
 * work. `brand` is kept as an alias for the same ramp so any straggling
 * `colorPalette="brand"` reference keeps rendering in the new cyan instead
 * of falling back to gray.
 */
const config = defineConfig({
    globalCss: {
        "html, body": {
            bg: "bg.canvas",
            color: "fg.ink",
        },
        "::selection": {
            bg: "pitch.solid",
            color: "pitch.contrast",
        },
        // Keep Leaflet's stacking context below the mobile bottom nav
        // (z-index 1100). We do this by giving the OUTER container its
        // own stacking context (isolation: isolate + z-index: 0) - that
        // way leaflet's internal panes (tile 200 / overlay 400 /
        // shadow 500 / marker 600 / tooltip 650 / popup 700) layer
        // normally inside the container without bleeding above the nav.
        //
        // IMPORTANT: do NOT clamp .leaflet-pane to auto - that collapses
        // the per-pane z-index so markers render under tiles and popups
        // never appear above the map.
        ".leaflet-container": {
            isolation: "isolate",
            zIndex: "0",
        },
        // NB: the `pitchPulse` keyframes used by PulseDot / StatusChip /
        // FilterChip / LiveNavItem live in index.html. Chakra v3's
        // `globalCss` type rejects raw @keyframes blocks, so they're
        // injected via a plain <style> tag instead - same effect, types
        // stay happy.
    },
    theme: {
        tokens: {
            fonts: {
                heading: {
                    value: "'Outfit', 'Inter', system-ui, -apple-system, sans-serif",
                },
                body: {
                    value: "'Outfit', 'Inter', system-ui, -apple-system, sans-serif",
                },
                mono: {
                    value: "'Geist Mono', 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace",
                },
            },
            colors: {
                // SPECTO cyan - primary brand ramp centred on #2AD4C8 (pitch.400).
                pitch: {
                    50: { value: "#E6FAF8" },
                    100: { value: "#C3F2EE" },
                    200: { value: "#8FE6DF" },
                    300: { value: "#5CDAD1" },
                    400: { value: "#2AD4C8" },
                    500: { value: "#17A79D" },
                    600: { value: "#0E8A81" },
                    700: { value: "#0B6D66" },
                    800: { value: "#08514C" },
                    900: { value: "#053633" },
                    950: { value: "#032220" },
                },
                // Alias kept so legacy `colorPalette="brand"` keeps rendering cyan.
                brand: {
                    50: { value: "#E6FAF8" },
                    100: { value: "#C3F2EE" },
                    200: { value: "#8FE6DF" },
                    300: { value: "#5CDAD1" },
                    400: { value: "#2AD4C8" },
                    500: { value: "#17A79D" },
                    600: { value: "#0E8A81" },
                    700: { value: "#0B6D66" },
                    800: { value: "#08514C" },
                    900: { value: "#053633" },
                    950: { value: "#032220" },
                },
                // NB: `accent` lives in semanticTokens (light + dark pair)
                // rather than here - a plain token and a semantic token can't
                // share the same path.
                team: {
                    blue: { value: "#2563eb" },
                    purple: { value: "#7c3aed" },
                },
                ink: {
                    DEFAULT: { value: "#1B2836" },
                    soft: { value: "#3A4B5E" },
                    mute: { value: "#5F7080" },
                },
                surface: {
                    canvas: { value: "#FFFFFF" },
                    base: { value: "#FFFFFF" },
                    tint: { value: "#EDF1F5" },
                    tint2: { value: "#F4F7FA" },
                },
                line: {
                    DEFAULT: { value: "#DCE3EA" },
                    strong: { value: "#C4D0DC" },
                },
            },
            radii: {
                sm: { value: "8px" },
                md: { value: "10px" },
                lg: { value: "12px" },
                xl: { value: "16px" },
                "2xl": { value: "20px" },
            },
            shadows: {
                xs: { value: "0 1px 2px rgba(11,21,34,0.04)" },
                sm: { value: "0 1px 2px rgba(11,21,34,0.04), 0 1px 3px rgba(11,21,34,0.06)" },
                md: { value: "0 4px 12px rgba(11,21,34,0.06)" },
                lg: { value: "0 10px 28px rgba(11,21,34,0.12)" },
                xl: { value: "0 8px 24px rgba(11,21,34,0.16)" },
                sticky: { value: "0 -4px 20px rgba(11,21,34,0.04)" },
            },
        },
        textStyles: {
            "display.xl": {
                value: {
                    fontFamily: "heading",
                    fontSize: "38px",
                    fontWeight: 800,
                    letterSpacing: "-0.03em",
                    lineHeight: 1.05,
                },
            },
            "display.lg": {
                value: {
                    fontFamily: "heading",
                    fontSize: "32px",
                    fontWeight: 800,
                    letterSpacing: "-0.025em",
                    lineHeight: 1.1,
                },
            },
            "display.md": {
                value: {
                    fontFamily: "heading",
                    fontSize: "28px",
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                    lineHeight: 1.15,
                },
            },
            "heading.lg": {
                value: {
                    fontFamily: "body",
                    fontSize: "22px",
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                },
            },
            "heading.md": {
                value: {
                    fontFamily: "body",
                    fontSize: "17px",
                    fontWeight: 700,
                    letterSpacing: "-0.01em",
                },
            },
            "mono.label": {
                value: {
                    fontFamily: "mono",
                    fontSize: "10px",
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                },
            },
            "mono.score": {
                value: {
                    fontFamily: "mono",
                    fontSize: "42px",
                    fontWeight: 800,
                    letterSpacing: "-0.04em",
                    lineHeight: 1,
                },
            },
            "mono.time": {
                value: {
                    fontFamily: "mono",
                    fontSize: "18px",
                    fontWeight: 700,
                    letterSpacing: "-0.02em",
                },
            },
        },
        semanticTokens: {
            colors: {
                // Canvas/surfaces - let `bg="bg.canvas"` / `bg="bg.panel"` keep
                // working on existing components without touching call sites.
                // Every token carries a `_dark` twin: SPECTO navy surfaces
                // (#0B1522 canvas / #111F31 panels) rather than neutral gray,
                // so the brand identity survives the flip. Toggle lives in the
                // navbar; next-themes sets the `dark` class that Chakra's
                // `_dark` condition reads. The brand cyan stays reserved for
                // accents/CTAs so it pops against the navy.
                //
                // ── Why `_light` is spelled out next to `base` ────────────────
                // Chakra's own defaults key their light value under `_light`,
                // not `base`. `createSystem(defaultConfig, config)` DEEP-MERGES
                // the two `value` objects, so overriding a token Chakra already
                // defines (bg.panel, fg.muted, border.*, …) leaves Chakra's
                // `_light` in place alongside our `base`. The emitted CSS puts
                // them on different selectors:
                //
                //   base    -> &:where(html, .chakra-theme)
                //   _light  -> :root &, .light &            ← higher specificity
                //
                // …so a `base`-only override silently loses in light mode and
                // the token renders Chakra's neutral zinc. Setting BOTH makes
                // ours win on either selector. Tokens Chakra doesn't define
                // (bg.canvas, fg.ink, accent.*, pitch.*) have no `_light`
                // sibling and work with `base` alone - they're left as-is.
                bg: {
                    DEFAULT: { value: { base: "{colors.surface.base}", _light: "{colors.surface.base}", _dark: "#111F31" } },
                    canvas: { value: { base: "{colors.surface.canvas}", _dark: "#0B1522" } },
                    panel: { value: { base: "{colors.surface.base}", _light: "{colors.surface.base}", _dark: "#111F31" } },
                    subtle: { value: { base: "{colors.surface.tint2}", _light: "{colors.surface.tint2}", _dark: "#152539" } },
                    muted: { value: { base: "{colors.surface.tint}", _light: "{colors.surface.tint}", _dark: "#1B2C42" } },
                    surfaceTint: { value: { base: "{colors.surface.tint}", _dark: "#1B2C42" } },
                    surfaceTint2: { value: { base: "{colors.surface.tint2}", _dark: "#152539" } },
                },
                fg: {
                    DEFAULT: { value: { base: "{colors.ink}", _light: "{colors.ink}", _dark: "#F5F7FA" } },
                    ink: { value: { base: "{colors.ink}", _dark: "#F5F7FA" } },
                    soft: { value: { base: "{colors.ink.soft}", _dark: "#C7D0DA" } },
                    muted: { value: { base: "{colors.ink.mute}", _light: "{colors.ink.mute}", _dark: "#8B97A5" } },
                    subtle: { value: { base: "{colors.ink.mute}", _light: "{colors.ink.mute}", _dark: "#7A8794" } },
                },
                border: {
                    DEFAULT: { value: { base: "{colors.line}", _light: "{colors.line}", _dark: "#243650" } },
                    emphasized: { value: { base: "{colors.line.strong}", _light: "{colors.line.strong}", _dark: "#314766" } },
                    subtle: { value: { base: "{colors.line}", _light: "{colors.line}", _dark: "#1E2F47" } },
                    strong: { value: { base: "{colors.line.strong}", _dark: "#314766" } },
                },
                // Make `colorPalette="pitch"` fully wired. Cyan is a LIGHT hue,
                // so `contrast` is NAVY (#0B1522) - navy text on cyan CTAs, per
                // the spec's "Watch live" button. `fg` uses the darker pitch.600
                // teal so brand-coloured text/links stay readable on white; in
                // dark mode fg/emphasized brighten to cyan-leaning tints.
                pitch: {
                    solid: { value: { base: "#2AD4C8", _dark: "#2AD4C8" } },
                    contrast: { value: "#0B1522" },
                    fg: { value: { base: "{colors.pitch.600}", _dark: "#5CDAD1" } },
                    muted: { value: { base: "{colors.pitch.200}", _dark: "#123A42" } },
                    subtle: { value: { base: "#E3F7F5", _dark: "#0F2E35" } },
                    emphasized: { value: { base: "{colors.pitch.300}", _dark: "#1C5F62" } },
                    focusRing: { value: { base: "{colors.pitch.500}", _dark: "#2AD4C8" } },
                },
                // Alias.
                brand: {
                    solid: { value: { base: "#2AD4C8", _dark: "#2AD4C8" } },
                    contrast: { value: "#0B1522" },
                    fg: { value: { base: "{colors.pitch.600}", _dark: "#5CDAD1" } },
                    muted: { value: { base: "{colors.pitch.200}", _dark: "#123A42" } },
                    subtle: { value: { base: "#E3F7F5", _dark: "#0F2E35" } },
                    emphasized: { value: { base: "{colors.pitch.300}", _dark: "#1C5F62" } },
                    focusRing: { value: { base: "{colors.pitch.500}", _dark: "#2AD4C8" } },
                },
                // Status accents - slightly brighter in dark so they keep
                // their pop on the deep navy surfaces. Referenced directly
                // as `accent.*` across the app.
                // NB: raw values (not {colors.accent.*} references) - a semantic
                // token that references a plain token at the SAME path would
                // resolve to itself and cycle.
                accent: {
                    // Light amber darkened #d97706 → #b45309: the old value was
                    // ~3.4:1 against white (WCAG fail for the 14-16px prize/date
                    // texts, flagged by PSI); #b45309 clears 4.5:1 and still
                    // reads amber. Dark-mode value unchanged.
                    amber: { value: { base: "#b45309", _dark: "#f59e0b" } },
                    red: { value: { base: "#dc2626", _dark: "#f05252" } },
                    // SPECTO lime highlight. Base darkened to #93B512 so it
                    // clears 4.5:1 on white for text/icons; dark mode uses the
                    // full spec lime #C9F24B.
                    goal: { value: { base: "#93B512", _dark: "#C9F24B" } },
                },
            },
        },
    },
})

export const system = createSystem(defaultConfig, config)
