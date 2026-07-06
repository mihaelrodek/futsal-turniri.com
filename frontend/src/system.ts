import { createSystem, defaultConfig, defineConfig } from "@chakra-ui/react"

/**
 * ─── "Pitch" design system — Nogometni-turniri.com ─────────────────────────
 *
 * The visual language leans into football vocabulary: pitch green primary,
 * scoreboard mono numerics, jersey-number type, off-white canvas. Replaces
 * the previous emerald `brand` palette with a confident "pitch" green plus a
 * small accent stack (amber / red / goal yellow) for status and live signals.
 *
 * Tokens map 1:1 to the design handoff doc:
 *   pitch.500          primary brand green   — buttons, links, headings
 *   pitch.400 / .700   gradient ramp
 *   accent.amber       "Za 6 dana", warnings
 *   accent.red         LIVE / destructive
 *   accent.goal        goals, trophies
 *   bg.canvas          page background (pale green-tinted off-white)
 *   bg.surfaceTint     active pill / hover / soft fills
 *   bg.surfaceTint2    subtle inner panels
 *   fg.ink / inkSoft / inkMute   text ladder
 *   border.default / strong      divider ladder
 *
 * `colorPalette="pitch"` resolves through the standard solid/contrast/fg/
 * muted/subtle/focusRing semantic tokens so existing Chakra primitives just
 * work. `brand` is kept as an alias for the same ramp so any straggling
 * `colorPalette="brand"` reference keeps rendering in the new green instead
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
        // own stacking context (isolation: isolate + z-index: 0) — that
        // way leaflet's internal panes (tile 200 / overlay 400 /
        // shadow 500 / marker 600 / tooltip 650 / popup 700) layer
        // normally inside the container without bleeding above the nav.
        //
        // IMPORTANT: do NOT clamp .leaflet-pane to auto — that collapses
        // the per-pane z-index so markers render under tiles and popups
        // never appear above the map.
        ".leaflet-container": {
            isolation: "isolate",
            zIndex: "0",
        },
        // NB: the `pitchPulse` keyframes used by PulseDot / StatusChip /
        // FilterChip / LiveNavItem live in index.html. Chakra v3's
        // `globalCss` type rejects raw @keyframes blocks, so they're
        // injected via a plain <style> tag instead — same effect, types
        // stay happy.
    },
    theme: {
        tokens: {
            fonts: {
                heading: {
                    value: "'Bricolage Grotesque', 'Inter', system-ui, -apple-system, sans-serif",
                },
                body: {
                    value: "'Inter', system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
                },
                mono: {
                    value: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
                },
            },
            colors: {
                // Pitch green — primary brand ramp tuned to #0b6b3a.
                pitch: {
                    50: { value: "#eaf1e7" },
                    100: { value: "#cde0c4" },
                    200: { value: "#a4cf94" },
                    300: { value: "#6bbd84" },
                    400: { value: "#3aa56b" },
                    500: { value: "#0b6b3a" },
                    600: { value: "#0a5e34" },
                    700: { value: "#084a28" },
                    800: { value: "#053a1f" },
                    900: { value: "#032513" },
                    950: { value: "#021609" },
                },
                // Alias kept so legacy `colorPalette="brand"` keeps rendering green.
                brand: {
                    50: { value: "#eaf1e7" },
                    100: { value: "#cde0c4" },
                    200: { value: "#a4cf94" },
                    300: { value: "#6bbd84" },
                    400: { value: "#3aa56b" },
                    500: { value: "#0b6b3a" },
                    600: { value: "#0a5e34" },
                    700: { value: "#084a28" },
                    800: { value: "#053a1f" },
                    900: { value: "#032513" },
                    950: { value: "#021609" },
                },
                // NB: `accent` lives in semanticTokens (light + dark pair)
                // rather than here — a plain token and a semantic token can't
                // share the same path.
                team: {
                    blue: { value: "#2563eb" },
                    purple: { value: "#7c3aed" },
                },
                ink: {
                    DEFAULT: { value: "#0e1f15" },
                    soft: { value: "#3d4a42" },
                    mute: { value: "#728176" },
                },
                surface: {
                    canvas: { value: "#f3f6f1" },
                    base: { value: "#ffffff" },
                    tint: { value: "#eaf1e7" },
                    tint2: { value: "#f7faf5" },
                },
                line: {
                    DEFAULT: { value: "#dde5d8" },
                    strong: { value: "#c9d4c2" },
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
                xs: { value: "0 1px 2px rgba(14,31,21,0.04)" },
                sm: { value: "0 1px 2px rgba(14,31,21,0.04), 0 1px 3px rgba(14,31,21,0.06)" },
                md: { value: "0 4px 12px rgba(14,31,21,0.06)" },
                lg: { value: "0 10px 28px rgba(14,31,21,0.12)" },
                xl: { value: "0 8px 24px rgba(14,31,21,0.16)" },
                sticky: { value: "0 -4px 20px rgba(14,31,21,0.04)" },
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
                // Canvas/surfaces — let `bg="bg.canvas"` / `bg="bg.panel"` keep
                // working on existing components without touching call sites.
                // Every token carries a `_dark` twin: a deep green-tinted dark
                // ("night pitch") rather than neutral gray, so the brand hue
                // survives the flip. Toggle lives in the navbar; next-themes
                // sets the `dark` class that Chakra's `_dark` condition reads.
                bg: {
                    DEFAULT: { value: { base: "{colors.surface.base}", _dark: "#131c16" } },
                    canvas: { value: { base: "{colors.surface.canvas}", _dark: "#0c1310" } },
                    panel: { value: { base: "{colors.surface.base}", _dark: "#131c16" } },
                    subtle: { value: { base: "{colors.surface.tint2}", _dark: "#17221b" } },
                    muted: { value: { base: "{colors.surface.tint}", _dark: "#1c2a21" } },
                    surfaceTint: { value: { base: "{colors.surface.tint}", _dark: "#1c2a21" } },
                    surfaceTint2: { value: { base: "{colors.surface.tint2}", _dark: "#17221b" } },
                },
                fg: {
                    DEFAULT: { value: { base: "{colors.ink}", _dark: "#e6ede7" } },
                    ink: { value: { base: "{colors.ink}", _dark: "#e6ede7" } },
                    soft: { value: { base: "{colors.ink.soft}", _dark: "#b3c0b6" } },
                    muted: { value: { base: "{colors.ink.mute}", _dark: "#8a988e" } },
                    subtle: { value: { base: "{colors.ink.mute}", _dark: "#77857b" } },
                },
                border: {
                    DEFAULT: { value: { base: "{colors.line}", _dark: "#263427" } },
                    emphasized: { value: { base: "{colors.line.strong}", _dark: "#35473a" } },
                    subtle: { value: { base: "{colors.line}", _dark: "#202c23" } },
                    strong: { value: { base: "{colors.line.strong}", _dark: "#35473a" } },
                },
                // Make `colorPalette="pitch"` fully wired. Dark: solid pops a
                // step brighter, fg goes light-green for text/links, subtle/
                // muted become deep green fills instead of near-white ones.
                pitch: {
                    solid: { value: { base: "{colors.pitch.500}", _dark: "#148f4e" } },
                    contrast: { value: "#ffffff" },
                    fg: { value: { base: "{colors.pitch.500}", _dark: "#4cc088" } },
                    muted: { value: { base: "{colors.pitch.200}", _dark: "#1b4028" } },
                    subtle: { value: { base: "{colors.pitch.50}", _dark: "#12281c" } },
                    emphasized: { value: { base: "{colors.pitch.400}", _dark: "#2c6644" } },
                    focusRing: { value: { base: "{colors.pitch.500}", _dark: "#3aa56b" } },
                },
                // Alias.
                brand: {
                    solid: { value: { base: "{colors.pitch.500}", _dark: "#148f4e" } },
                    contrast: { value: "#ffffff" },
                    fg: { value: { base: "{colors.pitch.500}", _dark: "#4cc088" } },
                    muted: { value: { base: "{colors.pitch.200}", _dark: "#1b4028" } },
                    subtle: { value: { base: "{colors.pitch.50}", _dark: "#12281c" } },
                    emphasized: { value: { base: "{colors.pitch.400}", _dark: "#2c6644" } },
                    focusRing: { value: { base: "{colors.pitch.500}", _dark: "#3aa56b" } },
                },
                // Status accents — slightly brighter in dark so they keep
                // their pop on the deep-green surfaces. Referenced directly
                // as `accent.*` across the app.
                // NB: raw values (not {colors.accent.*} references) — a semantic
                // token that references a plain token at the SAME path would
                // resolve to itself and cycle.
                accent: {
                    amber: { value: { base: "#d97706", _dark: "#f59e0b" } },
                    red: { value: { base: "#dc2626", _dark: "#f05252" } },
                    goal: { value: { base: "#f5b921", _dark: "#fbc934" } },
                },
            },
        },
    },
})

export const system = createSystem(defaultConfig, config)
