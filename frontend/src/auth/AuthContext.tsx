import React, { createContext, useContext, useEffect, useMemo, useState } from "react"
import {
    createUserWithEmailAndPassword,
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signInWithPopup,
    signOut as fbSignOut,
    updateProfile,
    type User as FirebaseUser,
} from "firebase/auth"
import { auth, googleProvider } from "../firebase"
import { syncProfile } from "../api/userMe"

type AuthValue = {
    /** Currently signed-in Firebase user (null when signed out, undefined while loading). */
    user: FirebaseUser | null
    /** True only during the initial auth-state probe on app load. */
    loading: boolean
    /** Custom claims attached to the user (server-set via Firebase Admin SDK). */
    claims: Record<string, unknown>
    /** Convenience flag — true when the `role` custom claim equals `"admin"`. */
    isAdmin: boolean
    /** Slug returned by the backend after /user/me/sync — null until first sync. */
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
        // Fires once with the persisted user on load, then again on every change.
        // For each user we also pull the parsed token, so we know their role.
        const unsub = onAuthStateChanged(auth, async (u) => {
            setUser(u)
            if (u) {
                try {
                    const result = await u.getIdTokenResult()
                    setClaims(result.claims as Record<string, unknown>)
                } catch {
                    setClaims({})
                }
                // Fire-and-forget profile sync — pushes the Firebase displayName
                // up so the backend can persist it + assign a public slug. We
                // don't await this in the auth-state path because it's not
                // critical to the user being able to use the app.
                syncProfile(u.displayName ?? null)
                    .then((p) => setMySlug(p.slug ?? null))
                    .catch(() => { /* best-effort — ignore */ })
            } else {
                setClaims({})
                setMySlug(null)
            }
            setLoading(false)
        })
        return () => unsub()
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
                await signInWithEmailAndPassword(auth, email, password)
            },
            async signUp(email, password, displayName) {
                const cred = await createUserWithEmailAndPassword(auth, email, password)
                if (displayName && displayName.trim()) {
                    await updateProfile(cred.user, { displayName: displayName.trim() })
                }
            },
            async signInWithGoogle() {
                await signInWithPopup(auth, googleProvider)
            },
            async signOut() {
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
