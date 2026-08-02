import { createContext, useCallback, useContext, useMemo, useState } from "react"
import type { ReactNode } from "react"
import { useAuth } from "../auth/AuthContext"

/* ──────────────────────────────────────────────────────────────────────────
   Which "hat" the platform admin is currently wearing.

   The admin console (/admin) is the admin's DEFAULT landing view, but they
   also have to be able to look at the site exactly as an ordinary visitor
   does - a bug report is almost always about the user-facing view. Rather
   than duplicating screens, the whole app reads one flag: `mode`.

   Deliberately dependency-free (no react-query, no backend round-trip): this
   is a per-device UI preference, not a permission. The real authority is the
   Firebase `role` claim, which is why the value is ALWAYS forced to "user"
   for a non-admin - a leftover localStorage flag from a demoted account (or
   from a different person on a shared browser) must never render or even
   hint at admin UI.
   ────────────────────────────────────────────────────────────────────── */

export type AdminViewMode = "admin" | "user"

type AdminViewValue = {
    /** Effective mode - "user" for anyone who isn't an admin, whatever is stored. */
    mode: AdminViewMode
    /** No-op for non-admins. */
    setMode: (m: AdminViewMode) => void
    /** Mirrors `useAuth().isAdmin` - here so consumers need only this one hook. */
    isAdmin: boolean
}

const Ctx = createContext<AdminViewValue | null>(null)

/** Versioned so the shape can change later without decoding stale values. */
const STORAGE_KEY = "admin:view:v1"

function isMode(v: unknown): v is AdminViewMode {
    return v === "admin" || v === "user"
}

/** Read once, lazily (useState initialiser) - localStorage access throws in
 *  Safari private mode, and the stored string is user-editable, so it's
 *  validated against the union rather than cast. */
function loadStoredMode(): AdminViewMode {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (isMode(raw)) return raw
    } catch {
        /* private mode / storage disabled - fall through to the default */
    }
    return "admin"
}

export function AdminViewProvider({ children }: { children: ReactNode }) {
    const { isAdmin } = useAuth()
    const [storedMode, setStoredMode] = useState<AdminViewMode>(loadStoredMode)

    const setMode = useCallback(
        (m: AdminViewMode) => {
            if (!isAdmin) return
            setStoredMode(m)
            try {
                localStorage.setItem(STORAGE_KEY, m)
            } catch {
                /* private mode - the choice just won't survive a reload */
            }
        },
        [isAdmin],
    )

    const value = useMemo<AdminViewValue>(
        () => ({
            mode: isAdmin ? storedMode : "user",
            setMode,
            isAdmin,
        }),
        [isAdmin, storedMode, setMode],
    )

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAdminView(): AdminViewValue {
    const v = useContext(Ctx)
    if (!v) throw new Error("useAdminView must be used inside <AdminViewProvider>")
    return v
}
