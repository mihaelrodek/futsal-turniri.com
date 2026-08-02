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
    /** Not emitted by the backend DTO (legacy bela-era fields) - treat as
     *  absent and hide the corresponding badges rather than rendering
     *  "undefinedW – undefinedL". */
    extraLife?: boolean
    wins?: number
    losses?: number
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

/**
 * "Je li ovo ti?" suggestion - a roster player whose name matches the
 * signed-in user's registered first+last name and whose team nobody has
 * claimed yet. Returned by GET /user/me/player-suggestions.
 */
export type PlayerClaimSuggestion = {
    playerId: number
    playerName: string
    teamName: string
    tournamentName: string
    tournamentRef: string | null
    tournamentStartAt: string | null
}

export type PlayerSuggestionClaimResult = {
    claimed: boolean
    teamId: number
    teamName: string | null
}

/** Silent - the suggestion card simply doesn't render when this fails. */
export async function getPlayerSuggestions(): Promise<PlayerClaimSuggestion[]> {
    const { data } = await http.get<PlayerClaimSuggestion[]>(
        "/user/me/player-suggestions",
        { silent: true } as any,
    )
    return data
}

/**
 * "To sam ja" - self-claim the suggested player's team. The backend
 * re-checks the name match server-side and refuses (409) when the team
 * got claimed by someone else in the meantime. Silent - the suggestion
 * card owns both the success toast and the 409 copy (localized).
 */
export async function claimPlayerSuggestion(playerId: number): Promise<PlayerSuggestionClaimResult> {
    const { data } = await http.post<PlayerSuggestionClaimResult>(
        `/user/me/player-suggestions/${playerId}/claim`,
        null,
        { silent: true } as any,
    )
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
    /** "hr"/"en"/"sl"; null until the user explicitly picks one on this account. */
    language?: "hr" | "en" | "sl" | null
    /** Account-wide opt-in for promo / announcement e-mail. NOT the bell:
     *  per-tournament and per-match follows are independent of this. */
    promoEmail?: boolean
    /** Same, for push. */
    promoPush?: boolean
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
 * Persist the user's language choice (navbar `LanguagePicker`) to their
 * account, so it follows them across devices. Sent on its own, same pattern
 * as {@link updateColorMode} - silent, the picker already switches the UI
 * instantly.
 */
export async function updateLanguage(language: "hr" | "en" | "sl"): Promise<UserProfile> {
    const { data } = await http.put<UserProfile>(
        "/user/me/profile",
        { language },
        { silent: true } as any,
    )
    return data
}

/**
 * Persist the account-wide promo / announcement opt-ins. Either field may be
 * omitted to leave it unchanged. Same silent pattern as
 * {@link updateColorMode} - the switch already reflects the new state.
 *
 * Note the path is `/user/me/...` (singular), matching the rest of this
 * controller.
 */
export async function updateNotificationPrefs(prefs: {
    promoEmail?: boolean
    promoPush?: boolean
}): Promise<UserProfile> {
    const { data } = await http.put<UserProfile>(
        "/user/me/notification-prefs",
        prefs,
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
