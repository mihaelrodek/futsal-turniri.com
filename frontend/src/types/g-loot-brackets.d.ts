/**
 * Re-export the bracket library's types from the path TypeScript actually
 * resolves them at.
 *
 * Why this file exists: `@g-loot/react-tournament-brackets@1.0.31-rc`
 * declares `"types": "dist/index.d.ts"` in its package.json, but the
 * shipped declarations actually live under `dist/cjs/`. TypeScript fails
 * the import with "Could not find a declaration file" before we even get
 * to use the package.
 *
 * This `declare module` block re-exports the symbols we use from the
 * correct nested path, so the import in BracketTab.tsx resolves cleanly
 * without us forking the package or pulling in a `@types/...` shim that
 * doesn't exist on npm.
 */
declare module "@g-loot/react-tournament-brackets" {
    export * from "@g-loot/react-tournament-brackets/dist/cjs/types"
    export {
        default as SingleEliminationBracket,
    } from "@g-loot/react-tournament-brackets/dist/cjs/bracket-single/single-elim-bracket"
    export {
        default as DoubleEliminationBracket,
    } from "@g-loot/react-tournament-brackets/dist/cjs/bracket-double/double-elim-bracket"
    export {
        default as Match,
    } from "@g-loot/react-tournament-brackets/dist/cjs/components/match"
    export { MATCH_STATES } from "@g-loot/react-tournament-brackets/dist/cjs/core/match-states"
    export {
        default as SVGViewer,
    } from "@g-loot/react-tournament-brackets/dist/cjs/svg-viewer"
    export { createTheme } from "@g-loot/react-tournament-brackets/dist/cjs/themes/themes"
}
