import { http } from "./http"

export type MyTournamentParticipation = {
    tournamentUuid: string
    /** Pretty URL slug; null on legacy rows pre-backfill. */
    tournamentSlug?: string | null
    tournamentName: string
    tournamentLocation?: string | null
    tournamentStartAt?: string | null
    tournamentStatus?: "DRAFT" | "STARTED" | "FINISHED" | null
    winnerName?: string | null

    teamId: number
    teamName: string
    pendingApproval: boolean
    eliminated: boolean
    extraLife: boolean
    wins: number
    losses: number
    isWinner: boolean
}

export async function listMyTournaments(): Promise<MyTournamentParticipation[]> {
    const { data } = await http.get<MyTournamentParticipation[]>("/user/me/tournaments")
    return data
}

/** "Moji pari" row - teams the user is linked to across tournaments. */
export type MyTeamDto = {
    teamId: number
    teamName: string
    tournamentId: number
    tournamentName: string
    tournamentRef: string | null
    tournamentStartAt: string | null
    isPrimary: boolean
    pendingApproval: boolean
    primaryName: string | null
    primarySlug: string | null
    coOwnerName: string | null
    coOwnerSlug: string | null
    /** Only set when isPrimary - token used for the /claim-team/{token} share URL. */
    claimToken: string | null
}

export async function listMyTeams(): Promise<MyTeamDto[]> {
    const { data } = await http.get<MyTeamDto[]>("/user/me/teams", {
        silent: true,
    } as any)
    return data
}

export type UserProfile = {
    phoneCountry: string | null
    phone: string | null
    displayName?: string | null
    /** The username (also the public /profil/{slug} handle). */
    slug?: string | null
    avatarUrl?: string | null
    /** "light" or "dark"; null until the user picks one. */
    colorMode?: "light" | "dark" | null
    firstName?: string | null
    lastName?: string | null
}

/**
 * Complete registration: set the chosen username + first/last name right after
 * the Firebase sign-up. Silent - the register form owns the messaging (incl.
 * the 409 "username taken", which rejects here for the caller to handle).
 */
export async function registerProfile(payload: {
    firstName: string
    lastName: string
    username: string
}): Promise<UserProfile> {
    const { data } = await http.post<UserProfile>(
        "/user/me/register-profile",
        payload,
        { silent: true } as any,
    )
    return data
}

export async function getProfile(): Promise<UserProfile> {
    const { data } = await http.get<UserProfile>("/user/me/profile")
    return data
}

export async function updateProfile(payload: {
    phoneCountry: string | null
    phone: string | null
    firstName?: string | null
    lastName?: string | null
    /** New username; sent to the backend in the DTO's `slug` field. */
    username?: string | null
}): Promise<UserProfile> {
    const { firstName, lastName, username, ...rest } = payload
    const body: Record<string, unknown> = { ...rest }
    if (firstName !== undefined) body.firstName = firstName
    if (lastName !== undefined) body.lastName = lastName
    if (username != null && username !== "") body.slug = username
    const { data } = await http.put<UserProfile>(
        "/user/me/profile",
        body,
        // 400 (too short) / 409 (taken) are shown inline by the edit form.
        { successMessage: "Profil je spremljen.", silentErrorStatuses: [400, 409] } as any,
    )
    return data
}

/**
 * Persist the user's theme choice. Sent on its own (no contact fields)
 * because the toggle lives outside the contact-form UX. Silent - the
 * UI flips colors instantly, a "saved" toast would be redundant noise.
 */
export async function updateColorMode(mode: "light" | "dark"): Promise<UserProfile> {
    const { data } = await http.put<UserProfile>(
        "/user/me/profile",
        { colorMode: mode },
        { silent: true } as any,
    )
    return data
}

/**
 * Push the current Firebase displayName up to the backend so it can persist
 * it + assign a public slug. Idempotent - fire-and-forget on every login.
 * Silent so it doesn't fire a toast every time the auth context boots.
 */
export async function syncProfile(displayName: string | null | undefined): Promise<UserProfile> {
    const { data } = await http.post<UserProfile>(
        "/user/me/sync",
        { displayName: displayName ?? null },
        { silent: true } as any,
    )
    return data
}

export async function uploadAvatar(file: File): Promise<UserProfile> {
    const fd = new FormData()
    fd.append("avatar", file)
    const { data } = await http.post<UserProfile>(
        "/user/me/avatar",
        fd,
        {
            headers: { "Content-Type": "multipart/form-data" },
            successMessage: "Profilna slika je spremljena.",
        } as any,
    )
    return data
}

export async function deleteAvatar(): Promise<UserProfile> {
    const { data } = await http.delete<UserProfile>(
        "/user/me/avatar",
        { successMessage: "Profilna slika je uklonjena." } as any,
    )
    return data
}
