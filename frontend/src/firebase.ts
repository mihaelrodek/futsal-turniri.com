import { initializeApp, type FirebaseOptions } from "firebase/app"
import { getAuth, GoogleAuthProvider } from "firebase/auth"

/**
 * Firebase Web SDK config. These values are public by design — Firebase's
 * "API key" identifies the project, not a secret. Real security comes from
 * Firebase Auth rules + server-side ID-token verification.
 *
 * Set in `frontend/.env.local`:
 *   VITE_FIREBASE_API_KEY=...
 *   VITE_FIREBASE_AUTH_DOMAIN=...
 *   VITE_FIREBASE_PROJECT_ID=...
 *   VITE_FIREBASE_APP_ID=...
 */
const firebaseConfig: FirebaseOptions = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()
