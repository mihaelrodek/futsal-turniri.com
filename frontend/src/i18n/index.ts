import { hr, type Dictionary } from "./hr"
import { en } from "./en"

/* ──────────────────────────────────────────────────────────────────────────
   Lightweight, hand-rolled i18n - no react-i18next / react-intl, matching
   the project's existing "one small centrally-registered module" pattern
   (compare `qk` in queryClient.ts, or `showSuccess`/`showError` in
   toaster.ts).

   There is no language switcher yet: `locale` below is the ONE line that
   decides the active language for the whole app. Flipping it to "en" (or
   later wiring a real switcher that reads/writes this from state/localStorage)
   does not require touching any call site - every component already reads
   through `useTranslation()` / `t`.
   ────────────────────────────────────────────────────────────────────── */

const dictionaries = { hr, en } as const
export type Locale = keyof typeof dictionaries
export type { Dictionary }

const locale: Locale = "hr"

/** The active dictionary. Import this directly in non-component code (e.g.
 *  toaster.ts) where hooks can't be called. */
export const t: Dictionary = dictionaries[locale]

/**
 * Hook form for components - same object as `t`, just called the way every
 * other hook in this codebase is called. Exists mainly so a future locale
 * switcher can swap this for a real per-render value (e.g. from context or
 * localStorage) without changing a single call site.
 */
export function useTranslation(): Dictionary {
    return t
}
