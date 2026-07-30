import { useSyncExternalStore } from "react"
import { hr, type Dictionary } from "./hr"
import { en } from "./en"
import { sl } from "./sl"

/* ──────────────────────────────────────────────────────────────────────────
   Lightweight, hand-rolled i18n - no react-i18next / react-intl, matching
   the project's existing "one small centrally-registered module" pattern
   (compare `qk` in queryClient.ts, or `showSuccess`/`showError` in
   toaster.ts).

   Real language switcher: `currentLocale` is a plain module-level variable
   (not React state) so it can be read/set from anywhere, including
   `api/http.ts`'s axios interceptor which isn't a component. Components
   subscribe to changes via `useTranslation()` (a `useSyncExternalStore`
   hook), so switching the language re-renders every component that calls
   it - no page reload needed. `LanguagePicker` (components/LanguagePicker.tsx)
   is the UI for it, in the navbar.

   Precedence for the INITIAL locale (mirrors ThemeSync's colorMode logic):
     1. Server-side profile preference, once signed in (LocaleSync.tsx, on login)
     2. This device's localStorage choice (an explicit prior pick, this file)
     3. The browser's own language (navigator.languages, this file)
     4. "hr" (final fallback)
   Any explicit pick via `LanguagePicker` persists to localStorage immediately,
   and to the server profile too when signed in (see LanguagePicker.tsx).
   ────────────────────────────────────────────────────────────────────── */

const dictionaries = { hr, en, sl } as const
export type Locale = keyof typeof dictionaries
export type { Dictionary }

export const LOCALE_LABELS: Record<Locale, { name: string; flag: string }> = {
    hr: { name: "Hrvatski", flag: "🇭🇷" },
    en: { name: "English", flag: "🇬🇧" },
    sl: { name: "Slovenščina", flag: "🇸🇮" },
}

const STORAGE_KEY = "futsal:locale:v1"

function isLocale(v: string | null): v is Locale {
    return v === "hr" || v === "en" || v === "sl"
}

/** First matching supported locale among the browser's preferred languages
 *  (`navigator.languages`, most-preferred first; falls back to the single
 *  `navigator.language`), matched by base subtag ("en-US" → "en"). "hr" if
 *  none of the browser's languages are supported. */
function detectBrowserLocale(): Locale {
    try {
        const candidates = (navigator.languages && navigator.languages.length > 0)
            ? navigator.languages
            : [navigator.language]
        for (const lang of candidates) {
            if (!lang) continue
            const base = lang.split("-")[0]?.toLowerCase() ?? ""
            if (isLocale(base)) return base
        }
    } catch {
        /* navigator unavailable (SSR/very old browser) - fall through */
    }
    return "hr"
}

function loadInitial(): Locale {
    try {
        const stored = localStorage.getItem(STORAGE_KEY)
        if (isLocale(stored)) return stored
    } catch {
        /* private mode - fall through to browser detection */
    }
    return detectBrowserLocale()
}

let currentLocale: Locale = loadInitial()
const listeners = new Set<() => void>()

/** Current language, readable from non-component code (e.g. the axios
 *  request interceptor in `api/http.ts`, which sends it as `X-Locale`). */
export function getLocale(): Locale {
    return currentLocale
}

/** Switches the app's language everywhere `useTranslation()` is used, and
 *  persists the choice. Used by `LanguagePicker`. */
export function setLocale(next: Locale): void {
    if (next === currentLocale) return
    currentLocale = next
    try {
        localStorage.setItem(STORAGE_KEY, next)
    } catch {
        /* private mode - choice just won't survive a reload */
    }
    listeners.forEach((fn) => fn())
}

function subscribe(onStoreChange: () => void): () => void {
    listeners.add(onStoreChange)
    return () => listeners.delete(onStoreChange)
}

/**
 * Static snapshot of the dictionary taken at module-load time. Import this
 * directly in non-component code where hooks can't be called (e.g. a plain
 * helper function outside a component's render). NOT reactive to a language
 * switch made after that code first ran - use `useTranslation()` inside
 * components/render for text that must update live.
 */
export const t: Dictionary = dictionaries[currentLocale]

/** Hook form for components - re-renders on every `setLocale()` call. */
export function useTranslation(): Dictionary {
    const locale = useLocale()
    return dictionaries[locale]
}

/** The active locale itself (not the dictionary) - for `LanguagePicker` to
 *  know which option is currently selected. Re-renders on `setLocale()`. */
export function useLocale(): Locale {
    return useSyncExternalStore(subscribe, getLocale, getLocale)
}
