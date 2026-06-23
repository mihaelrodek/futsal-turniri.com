import { useEffect, useRef } from "react"
import { useAuth } from "../auth/AuthContext"
import { useColorMode } from "../color-mode"
import { getProfile } from "../api/userMe"

/**
 * Mounted once at the app root. Pulls the user's saved colorMode from
 * /user/me/profile after login and applies it via next-themes — so the
 * theme follows you across devices/browsers, not just localStorage on
 * one machine.
 *
 * Order of precedence:
 *   1. Server-side preference (this component, on every login)
 *   2. Local next-themes value (last picked on this device)
 *   3. App default ("light", from ColorModeProvider)
 *
 * Writes (when the user toggles the theme in Postavke) go in the other
 * direction — see updateColorMode in api/userMe.ts. ThemeSync is read-only.
 */
export default function ThemeSync() {
    const { user, loading } = useAuth()
    const { colorMode, setColorMode } = useColorMode()
    // Don't re-sync on every render — only once per signed-in UID.
    // Otherwise we'd fight the user's own toggle (their PUT updates the
    // server, then a refetch races back with the old value).
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
                const serverMode = profile.colorMode
                if (serverMode && (serverMode === "light" || serverMode === "dark")) {
                    if (serverMode !== colorMode) {
                        setColorMode(serverMode)
                    }
                }
            } catch {
                // Network failure → leave local value alone; user can toggle.
            }
        })()
        return () => {
            cancelled = true
        }
        // colorMode/setColorMode intentionally omitted — we don't want
        // this effect to re-fire when the user toggles locally.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.uid, loading])

    return null
}
