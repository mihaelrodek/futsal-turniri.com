import { useEffect, useRef } from "react"
import { useAuth } from "../auth/AuthContext"
import { getProfile } from "../api/userMe"
import { getLocale, setLocale, type Locale } from "../i18n"

function isLocale(v: unknown): v is Locale {
    return v === "hr" || v === "en" || v === "sl"
}

/**
 * Mounted once at the app root, alongside `ThemeSync` (same pattern). Pulls
 * the user's saved `language` from /user/me/profile after login and applies
 * it - so an explicit pick follows the user across devices, not just
 * localStorage on one machine.
 *
 * Order of precedence (see the header comment in `i18n/index.ts`):
 *   1. Server-side preference (this component, on every login)
 *   2. Local choice for this device (localStorage, from a prior pick)
 *   3. The browser's own language
 *   4. "hr"
 *
 * Writes (when the user picks a language in the navbar) go the other
 * direction - see `updateLanguage` in `api/userMe.ts`, called from
 * `LanguagePicker`. LocaleSync itself is read-only.
 */
export default function LocaleSync() {
    const { user, loading } = useAuth()
    // Don't re-sync on every render - only once per signed-in UID, same
    // reasoning as ThemeSync: otherwise we'd fight the user's own picker
    // (their PUT updates the server, then a refetch races back with the
    // pre-change value).
    const lastSyncedUidRef = useRef<string | null>(null)

    useEffect(() => {
        if (loading) return
        const uid = user?.uid ?? null
        if (!uid) {
            lastSyncedUidRef.current = null
            return
        }
        if (lastSyncedUidRef.current === uid) return
        lastSyncedUidRef.current = uid

        let cancelled = false
        ;(async () => {
            try {
                const profile = await getProfile()
                if (cancelled) return
                const serverLocale = profile.language
                if (isLocale(serverLocale) && serverLocale !== getLocale()) {
                    setLocale(serverLocale)
                }
            } catch {
                // Network failure → leave local value alone.
            }
        })()
        return () => {
            cancelled = true
        }
    }, [user?.uid, loading])

    return null
}
