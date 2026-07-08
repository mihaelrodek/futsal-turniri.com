import React, { createContext, useContext, useEffect, useMemo, useState } from "react"
import type { User as FirebaseUser } from "firebase/auth"
import { getFirebase } from "../firebase"
import { syncProfile } from "../api/userMe"

// NB: everything from "firebase/auth" is imported DYNAMICALLY (inside the
// effect / sign-in handlers) so the Firebase SDK stays out of the critical
// first-paint bundle - see firebase.ts. Only the `User` type is imported
// statically (type-only, erased at compile time).

/** True when running as an installed PWA (launched from the home screen). */
function isStandalonePwa(): boolean {
    if (typeof window === "undefined") return false
    return (
        window.matchMedia?.("(display-mode: standalone)").matches === true ||
        (navigator as any)?.standalone === true // iOS home-screen PWA
    )
}

/**
 * Whether to use the full-page redirect flow instead of a popup for Google
 * sign-in. Used ONLY for a plain mobile browser tab (not an installed PWA):
 * there a "popup" is really a new browser tab that, thanks to
 * Cross-Origin-Opener-Policy, can't close itself afterwards, stranding the
 * user on the Google tab - so the same-tab redirect behaves better.
 *
 * Installed PWAs (standalone) are deliberately EXCLUDED: there
 * signInWithRedirect silently loses the session on return (the return lands in
 * a partitioned storage context, so getRedirectResult / onAuthStateChanged
 * never see the sign-in and the user is bounced to the start screen "as if not
 * logged in"). Those use the popup flow instead, which returns the credential
 * to the still-alive app context. See Firebase "redirect-best-practices".
 */
function prefersRedirect(): boolean {
    if (typeof navigator === "undefined" || typeof window === "undefined") return false
    const ua = navigator.userAgent || ""
    const mobileUA = /Android|iPhone|iPad|iPod|Mobi|Windows Phone/i.test(ua)
    return mobileUA && !isStandalonePwa()
}

type AuthValue = {
    /** Currently signed-in Firebase user (null when signed out, undefined while loading). */
    user: FirebaseUser | null
    /** True only during the initial auth-state probe on app load. */
    loading: boolean
    /** Custom claims attached to the user (server-set via Firebase Admin SDK). */
    claims: Record<string, unknown>
    /** Convenience flag - true when the `role` custom claim equals `"admin"`. */
    isAdmin: boolean
    /** Slug returned by the backend after /user/me/sync - null until first sync. */
    mySlug: string | null
    /** Email + password sign-in. */
    signIn: (email: string, password: string) => Promise<void>
    /** Email + password registration. Optional displayName is set on the user profile. */
    signUp: (email: string, password: string, displayName?: string) => Promise<void>
    /** Google OAuth sign-in (popup on desktop; SDK handles redirect fallback). */
    signInWithGoogle: () => Promise<void>
    /** Sign out the current user. */
    signOut: () => Promise<void>
}

const Ctx = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<FirebaseUser | null>(null)
    const [loading, setLoading] = useState(true)
    const [claims, setClaims] = useState<Record<string, unknown>>({})
    const [mySlug, setMySlug] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        let unsub = () => {}
        ;(async () => {
            const [{ auth }, { getRedirectResult, onAuthStateChanged }] =
                await Promise.all([getFirebase(), import("firebase/auth")])
            if (cancelled) return

            // Complete any pending signInWithRedirect (mobile Google flow). The
            // success path also fires onAuthStateChanged below, so this is mainly
            // to consume the result and not silently swallow a redirect error.
            getRedirectResult(auth).catch(() => { /* surfaced on next attempt */ })

            // Fires once with the persisted user on load, then again on every change.
            // For each user we also pull the parsed token, so we know their role.
            unsub = onAuthStateChanged(auth, async (u) => {
                setUser(u)
                if (u) {
                    try {
                        const result = await u.getIdTokenResult()
                        setClaims(result.claims as Record<string, unknown>)
                    } catch {
                        setClaims({})
                    }
                    // Fire-and-forget profile sync - pushes the Firebase displayName
                    // up so the backend can persist it + assign a public slug. We
                    // don't await this in the auth-state path because it's not
                    // critical to the user being able to use the app.
                    syncProfile(u.displayName ?? null)
                        .then((p) => setMySlug(p.slug ?? null))
                        .catch(() => { /* best-effort - ignore */ })
                } else {
                    setClaims({})
                    setMySlug(null)
                }
                setLoading(false)
            })
        })()
        return () => {
            cancelled = true
            unsub()
        }
    }, [])

    const isAdmin = claims["role"] === "admin"

    const value = useMemo<AuthValue>(
        () => ({
            user,
            loading,
            claims,
            isAdmin,
            mySlug,
            async signIn(email, password) {
                const [{ auth }, { signInWithEmailAndPassword }] =
                    await Promise.all([getFirebase(), import("firebase/auth")])
                await signInWithEmailAndPassword(auth, email, password)
            },
            async signUp(email, password, displayName) {
                const [{ auth }, { createUserWithEmailAndPassword, updateProfile }] =
                    await Promise.all([getFirebase(), import("firebase/auth")])
                const cred = await createUserWithEmailAndPassword(auth, email, password)
                if (displayName && displayName.trim()) {
                    await updateProfile(cred.user, { displayName: displayName.trim() })
                }
            },
            async signInWithGoogle() {
                const [{ auth, googleProvider }, { signInWithPopup, signInWithRedirect }] =
                    await Promise.all([getFirebase(), import("firebase/auth")])
                // Plain mobile browser tab → full-page redirect (popup tabs
                // can't close themselves there and strand the user on Google).
                if (prefersRedirect()) {
                    await signInWithRedirect(auth, googleProvider)
                    return // page navigates away; onAuthStateChanged finishes on return
                }
                // Desktop AND installed PWAs → popup. In an installed PWA the
                // redirect flow silently loses the session on return, so popup
                // (credential returned to the live context) is the reliable path.
                try {
                    await signInWithPopup(auth, googleProvider)
                } catch (e: any) {
                    const code = e?.code ?? ""
                    const popupFailed =
                        code === "auth/popup-blocked" ||
                        code === "auth/popup-closed-by-user" ||
                        code === "auth/cancelled-popup-request" ||
                        code === "auth/operation-not-supported-in-this-environment"
                    // Fall back to redirect only in a real browser tab. In an
                    // installed PWA redirect is broken (lost session), so surface
                    // the error rather than bounce the user through a dead flow.
                    if (popupFailed && !isStandalonePwa()) {
                        await signInWithRedirect(auth, googleProvider)
                        return
                    }
                    throw e
                }
            },
            async signOut() {
                const [{ auth }, { signOut: fbSignOut }] =
                    await Promise.all([getFirebase(), import("firebase/auth")])
                await fbSignOut(auth)
            },
        }),
        [user, loading, claims, isAdmin, mySlug],
    )

    return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthValue {
    const v = useContext(Ctx)
    if (!v) throw new Error("useAuth must be used inside <AuthProvider>")
    return v
}
