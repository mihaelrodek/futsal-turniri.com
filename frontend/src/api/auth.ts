import { http } from "./http"

/**
 * Public auth helpers. Firebase Auth has no username concept, so username
 * availability (registration) and username→email lookup (login) go through
 * our backend. Both are anonymous + edge-rate-limited.
 */

export type UsernameCheck = {
    /** The value as it will actually be stored (lowercase, hyphenated). */
    normalized: string
    available: boolean
    tooShort: boolean
}

/** Live username-availability check for the registration form. */
export async function checkUsernameAvailable(username: string): Promise<UsernameCheck> {
    const { data } = await http.get<UsernameCheck>("/auth/username-available", {
        params: { u: username },
        silent: true,
    } as any)
    return data
}

/**
 * Resolve a username to its account email so we can complete a Firebase
 * email/password sign-in. Returns null when the username is unknown.
 */
export async function emailForUsername(username: string): Promise<string | null> {
    try {
        const { data } = await http.post<{ email: string }>(
            "/auth/email-for-username",
            { username },
            { silent: true, silentErrorStatuses: [404] } as any,
        )
        return data?.email ?? null
    } catch {
        return null
    }
}
