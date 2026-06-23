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

/** "Moji pari" row — teams the user is linked to across tournaments. */
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
    /** Only set when isPrimary — token used for the /claim-team/{token} share URL. */
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
    slug?: string | null
    avatarUrl?: string | null
    /** "light" or "dark"; null until the user picks one. */
    colorMode?: "light" | "dark" | null
}

export async function getProfile(): Promise<UserProfile> {
    const { data } = await http.get<UserProfile>("/user/me/profile")
    return data
}

export async function updateProfile(payload: { phoneCountry: string | null; phone: string | null }): Promise<UserProfile> {
    const { data } = await http.put<UserProfile>(
        "/user/me/profile",
        payload,
        { successMessage: "Profil je spremljen." } as any,
    )
    return data
}

/**
 * Persist the user's theme choice. Sent on its own (no contact fields)
 * because the toggle lives outside the contact-form UX. Silent — the
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
 * it + assign a public slug. Idempotent — fire-and-forget on every login.
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
