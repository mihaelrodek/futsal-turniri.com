import type { Auth, GoogleAuthProvider } from "firebase/auth"

/**
 * Firebase Web SDK config. These values are public by design - Firebase's
 * "API key" identifies the project, not a secret. Real security comes from
 * Firebase Auth rules + server-side ID-token verification.
 *
 * Set in `frontend/.env.local`:
 *   VITE_FIREBASE_API_KEY=...
 *   VITE_FIREBASE_AUTH_DOMAIN=...
 *   VITE_FIREBASE_PROJECT_ID=...
 *   VITE_FIREBASE_APP_ID=...
 *
 * LAZY INIT: the SDK (~100 kB gzip) used to be a static import in the
 * critical bundle even though nothing needs it before first paint. It now
 * loads through a cached dynamic import - callers `await getFirebase()`
 * (plus `await import("firebase/auth")` for the helper functions, which
 * resolves to the same split chunk). PSI's "unused JavaScript" flagged the
 * old static version as the biggest offender in the vendor chunk.
 */

export type Firebase = { auth: Auth; googleProvider: GoogleAuthProvider }

let cached: Promise<Firebase> | null = null

/** Load + initialize Firebase exactly once; every caller shares the promise. */
export function getFirebase(): Promise<Firebase> {
    cached ??= (async () => {
        const [{ initializeApp }, { getAuth, GoogleAuthProvider: Provider }] =
            await Promise.all([import("firebase/app"), import("firebase/auth")])
        const app = initializeApp({
            apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
            authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
            projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
            appId: import.meta.env.VITE_FIREBASE_APP_ID,
        })
        return { auth: getAuth(app), googleProvider: new Provider() }
    })()
    return cached
}
