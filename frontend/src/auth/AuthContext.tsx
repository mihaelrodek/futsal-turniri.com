import React, { createContext, useContext, useEffect, useMemo, useState } from "react"
import type { User as FirebaseUser } from "firebase/auth"
import { getFirebase } from "../firebase"
import { syncProfile, registerProfile } from "../api/userMe"
import { emailForUsername } from "../api/auth"

// NB: everything from "firebase/auth" is imported DYNAMICALLY (inside the
// effect / sign-in handlers) so the Firebase SDK stays out of the critical
// first-paint bundle - see firebase.ts. Only the `User` type is imported
// statically (type-only, erased at compile time).

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
    /**
     * Sign in with EITHER an email or a username. A username (no "@") is
     * resolved to its account email via the backend, then Firebase signs in.
     */
    signInWithIdentifier: (identifier: string, password: string) => Promise<void>
    /**
     * Email + password registration with the chosen username + first/last name.
     * Sets the Firebase displayName to "First Last" and registers the username
     * (+ names) on the backend.
     */
    signUp: (
        email: string,
        password: string,
        profile: { firstName: string; lastName: string; username: string },
    ) => Promise<void>
    /** Google OAuth sign-in (popup on desktop; SDK handles redirect fallback). */
    signInWithGoogle: () => Promise<void>
    /** Google OAuth sign-in from a Google Identity Services ID token (One Tap). */
    signInWithGoogleCredential: (idToken: string) => Promise<void>
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
            const [{ auth }, { onAuthStateChanged }] =
                await Promise.all([getFirebase(), import("firebase/auth")])
            if (cancelled) return

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
            async signInWithIdentifier(identifier, password) {
                const id = identifier.trim()
                // An email contains "@"; anything else is treated as a username
                // and resolved to its account email via the backend first.
                let email = id
                if (!id.includes("@")) {
                    const resolved = await emailForUsername(id)
                    if (!resolved) {
                        // Shape it like a Firebase error so LoginPage's mapper
                        // shows the same "wrong username/email or password".
                        const err: any = new Error("username-not-found")
                        err.code = "auth/invalid-credential"
                        throw err
                    }
                    email = resolved
                }
                const [{ auth }, { signInWithEmailAndPassword }] =
                    await Promise.all([getFirebase(), import("firebase/auth")])
                await signInWithEmailAndPassword(auth, email, password)
            },
            async signUp(email, password, profile) {
                const [{ auth }, { createUserWithEmailAndPassword, updateProfile }] =
                    await Promise.all([getFirebase(), import("firebase/auth")])
                const cred = await createUserWithEmailAndPassword(auth, email, password)
                const displayName = `${profile.firstName} ${profile.lastName}`.trim()
                if (displayName) {
                    await updateProfile(cred.user, { displayName })
                }
                // Register the chosen username + names on the backend. cred.user
                // is signed in now, so this request carries the auth token. Any
                // error (e.g. 409 username taken) propagates to the register form.
                await registerProfile({
                    firstName: profile.firstName.trim(),
                    lastName: profile.lastName.trim(),
                    username: profile.username.trim(),
                })
            },
            async signInWithGoogle() {
                const [{ auth, googleProvider }, { signInWithPopup }] =
                    await Promise.all([getFirebase(), import("firebase/auth")])
                await signInWithPopup(auth, googleProvider)
            },
            async signInWithGoogleCredential(idToken) {
                const [{ auth }, { GoogleAuthProvider, signInWithCredential }] =
                    await Promise.all([getFirebase(), import("firebase/auth")])
                await signInWithCredential(auth, GoogleAuthProvider.credential(idToken))
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
