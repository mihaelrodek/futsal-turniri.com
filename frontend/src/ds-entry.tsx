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
import { system } from "./system"

export * from "./ui/pitch"
export * from "./ui/primitives"

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
 */
export function PitchProvider({ children }: { children: ReactNode }) {
    return <ChakraProvider value={system}>{children}</ChakraProvider>
}
