/**
 * Design-system entry point for claude.ai/design (see /design-sync).
 *
 * The app has no library build — this module is the single entry the
 * converter bundles into `_ds_bundle.js`. It re-exports the "Pitch" design
 * system surface plus `PitchProvider`, the wrapper every component needs in
 * order to be styled.
 *
 * Nothing in the app imports this file; it exists purely as the DS entry.
 */
import type { ReactNode } from "react"
import { ChakraProvider } from "@chakra-ui/react"
import { MemoryRouter, useInRouterContext } from "react-router-dom"
import { system } from "./system"

/* ── The design system proper: src/ui, themed by system.ts ──────────────── */
export * from "./ui/pitch"
export * from "./ui/primitives"

/* ── Presentational app components that carry no data coupling ──────────────
   Firebase-, API-, Leaflet- and react-query-bound components are deliberately
   NOT re-exported: they would drag those packages into `_ds_bundle.js`, which
   every design built with this system has to load. `TeamRow` is a dead file
   and `LiveNavItem` polls the live-match API, so both are excluded too.
   `DateTimeField` is excluded too: react-datepicker@7 resolves its default
   export to a CJS object inside the IIFE bundle, so the component throws
   "Element type is invalid … got: object" wherever it renders. It was also the
   single biggest bundle contributor (react-datepicker + date-fns/locale).
   These use `export default`, so each is given an explicit name here. */
export { Logo } from "./components/Logo"
export { default as Footer } from "./components/Footer"
export { default as NotFoundView } from "./components/NotFoundView"
export { default as HelpFab } from "./components/HelpFab"
export { default as AvatarPreview } from "./components/AvatarPreview"
export { default as IosInstallSteps } from "./components/IosInstallSteps"
export { BulkImportDialog } from "./components/BulkImportDialog"
export { FormatSketch } from "./components/FormatSketch"
export { LiveSyncIndicator } from "./components/LiveSyncIndicator"
export { LocationAutocomplete } from "./components/LocationAutocomplete"

/** The Chakra system carrying the Pitch tokens (pitch green ramp, accent
 *  stack, surface/ink/line ladders, textStyles, light+dark semantic pairs). */
export { system }

/**
 * Root wrapper for the Pitch design system.
 *
 * Chakra v3 is CSS-in-JS: the tokens in `system.ts` are injected at runtime by
 * this provider. Without it, every component renders with browser-default
 * styling — no pitch green, no fonts, no surfaces. Wrap the whole app (or the
 * whole design) in it exactly once, at the root.
 *
 * A few components (`Logo`, `Footer`, `NotFoundView`, `HelpFab`) render
 * react-router `<Link>`s and throw outside a router. This supplies a
 * `MemoryRouter` only when there isn't already one above it, so wrapping a real
 * app that owns a `BrowserRouter` stays a no-op.
 */
export function PitchProvider({ children }: { children: ReactNode }) {
    return (
        <ChakraProvider value={system}>
            <RouterBoundary>{children}</RouterBoundary>
        </ChakraProvider>
    )
}

function RouterBoundary({ children }: { children: ReactNode }) {
    return useInRouterContext() ? <>{children}</> : <MemoryRouter>{children}</MemoryRouter>
}
