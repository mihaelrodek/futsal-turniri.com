import { http } from "./http"

/**
 * Admin-only API surface for the "Dashboard" tab on the profile page.
 * Every endpoint here requires the Firebase `role: "admin"` custom claim
 * on the caller; backend returns 403 to anyone without it.
 */

/** Tournament row in the dashboard's tournament picker. */
export type AdminTournamentDto = {
    id: number
    uuid: string | null
    slug: string | null
    name: string
    location: string | null
    startAt: string | null
    status: string | null
    /** Firebase UID of the current owner; null for legacy/imported rows. */
    createdByUid: string | null
    /** Display name snapshot copied at create/transfer time. */
    createdByName: string | null
    /** True when the tournament is hidden from all public reads (lists, details, sitemap, live). */
    hidden: boolean
}

/** Unclaimed team row in a tournament's team list. */
export type AdminTeamDto = {
    id: number
    name: string
    eliminated: boolean
    wins: number
    losses: number
}

/** User row in the attach-target picker. */
export type AdminUserDto = {
    userUid: string
    displayName: string | null
    slug: string | null
}

export type AttachTeamResponse = {
    teamId: number
    userUid: string
    displayName: string | null
    /** True when a matching UserTeamPreset was created as a side effect. */
    createdPreset: boolean
}

/** All non-deleted tournaments, newest first. */
export async function adminListTournaments(): Promise<AdminTournamentDto[]> {
    const { data } = await http.get<AdminTournamentDto[]>("/admin/tournaments")
    return data
}

/** Teams from the given tournament that don't yet belong to any registered user. */
export async function adminListUnclaimedTeams(
    tournamentId: number,
): Promise<AdminTeamDto[]> {
    const { data } = await http.get<AdminTeamDto[]>(
        `/admin/tournaments/${tournamentId}/teams`,
    )
    return data
}

/**
 * Substring match against displayName (case-insensitive). Empty query
 * returns the first ~25 profiles alphabetically so the dropdown has
 * something visible before the admin starts typing.
 */
export async function adminSearchUsers(query: string): Promise<AdminUserDto[]> {
    const { data } = await http.get<AdminUserDto[]>("/admin/users", {
        params: { q: query },
    })
    return data
}

/**
 * Full list of all registered profiles, alphabetical. Backs the admin
 * "Popis igrača" tab. Distinct from {@link adminSearchUsers} (which
 * is capped for the attach-target dropdown) - here we want every
 * profile so the admin can browse and jump to any user's page.
 */
export async function adminListAllUsers(): Promise<AdminUserDto[]> {
    const { data } = await http.get<AdminUserDto[]>("/admin/users/all")
    return data
}

/**
 * Attach a team to a user. Side-effects on the backend:
 *   - sets team.submittedByUid = userUid (team appears on the user's
 *     profile immediately via the existing participations query);
 *   - if the user has no matching UserTeamPreset, creates one so
 *     future tournaments with the same team name auto-claim too.
 *
 * Common error responses:
 *   - 409 ALREADY_CLAIMED - team was claimed by someone between the
 *     UI's list fetch and this request. Refresh the unclaimed list.
 *   - 404                  - team or user not found (user_uid invalid).
 */
export async function adminAttachTeam(
    teamId: number,
    userUid: string,
): Promise<AttachTeamResponse> {
    const { data } = await http.post<AttachTeamResponse>(
        `/admin/teams/${teamId}/attach`,
        { userUid },
        {
            successMessage: "Ekipa pridružena korisniku.",
            silentErrorStatuses: [409],
        } as any,
    )
    return data
}

export type TransferTournamentResponse = {
    tournamentId: number
    userUid: string
    displayName: string | null
}

/**
 * Transfer ownership of a tournament to another registered user.
 *
 * <p>After this call the target user is treated exactly as if they had
 * created the tournament themselves: they can edit details, manage
 * teams, generate rounds, set the podium, etc. The admin loses the
 * implicit-via-creation edit rights but retains admin powers.
 *
 * <p>Both `createdByUid` and `createdByName` are updated on the backend
 * - the latter is a snapshot of the target user's UserProfile
 * displayName so subsequent renders show the new owner without any
 * extra lookup.
 *
 * Common error responses:
 *   - 404 TOURNAMENT_NOT_FOUND - tournament id is invalid or soft-deleted.
 *   - 404 USER_NOT_FOUND       - target userUid has no UserProfile row.
 */
export async function adminTransferTournament(
    tournamentId: number,
    userUid: string,
): Promise<TransferTournamentResponse> {
    const { data } = await http.post<TransferTournamentResponse>(
        `/admin/tournaments/${tournamentId}/transfer`,
        { userUid },
        {
            successMessage: "Turnir prenesen novom vlasniku.",
        } as any,
    )
    return data
}

/* ───────────────────── Tournament editors (co-owners) ─────────────────────
   Grant management rights on a single tournament to registered users WITHOUT
   transferring ownership. The creator stays the owner; each editor also passes
   the edit gate (details, teams, schedule, Zapisnik…). Many allowed. */

/** Current editors of a tournament (with display info). */
export async function adminListEditors(tournamentId: number): Promise<AdminUserDto[]> {
    const { data } = await http.get<AdminUserDto[]>(
        `/admin/tournaments/${tournamentId}/editors`,
    )
    return data
}

/** Grant editor rights to a user (idempotent). Returns the granted user. */
export async function adminAddEditor(
    tournamentId: number,
    userUid: string,
): Promise<AdminUserDto> {
    const { data } = await http.post<AdminUserDto>(
        `/admin/tournaments/${tournamentId}/editors`,
        { userUid },
        { successMessage: "Prava na turnir dodijeljena." } as any,
    )
    return data
}

/** Revoke a user's editor rights (idempotent). */
export async function adminRemoveEditor(
    tournamentId: number,
    userUid: string,
): Promise<void> {
    await http.delete(
        `/admin/tournaments/${tournamentId}/editors/${encodeURIComponent(userUid)}`,
        { successMessage: "Prava na turnir uklonjena." } as any,
    )
}

/* ─────────────────────── Admin tournament actions ───────────────────────
   These wrap endpoints that admin already had access to via the regular
   ownership-check assertCanEdit (admin role bypasses owner check), plus
   the new admin-only raw status override. Surfacing them here lets the
   dashboard call them on any tournament without first navigating to its
   detail page. */

/** Force-set tournament status. Bypasses the business rules in
 *  /tournaments/{uuid}/start (INSUFFICIENT_TEAMS, etc.) - admin-only,
 *  for legacy or stuck tournaments where the normal flow can't recover. */
export async function adminSetTournamentStatus(
    uuid: string,
    status: "DRAFT" | "STARTED" | "FINISHED",
): Promise<void> {
    await http.post(
        `/admin/tournaments/${uuid}/status`,
        { status },
        { successMessage: `Status promijenjen na ${status}.` } as any,
    )
}

/** Admin-reset a tournament back to DRAFT, wiping rounds/bracket/schedule.
 *  Hits the normal /reset endpoint - assertCanEdit lets admin through.
 *  Destructive: surface a confirm prompt before calling. */
export async function adminResetTournament(uuid: string): Promise<void> {
    await http.post(
        `/tournaments/${uuid}/reset`,
        {},
        { successMessage: "Turnir je resetiran." } as any,
    )
}

/** Admin-delete (soft delete) any tournament. Hits the normal DELETE.
 *  Destructive: surface a confirm prompt. */
export async function adminDeleteTournament(uuid: string): Promise<void> {
    await http.delete(
        `/tournaments/${uuid}`,
        { successMessage: "Turnir obrisan." } as any,
    )
}

/** Admin-toggle the daily-highlight feature flag. Same endpoints as the
 *  Detalji-tab admin button, surfaced here so the admin can feature any
 *  tournament without navigating to its detail page first. */
export async function adminFeatureTournament(uuid: string): Promise<void> {
    await http.post(
        `/admin/tournaments/${uuid}/feature`,
        undefined,
        { successMessage: "Turnir istaknut za dan." } as any,
    )
}
export async function adminUnfeatureTournament(uuid: string): Promise<void> {
    await http.delete(
        `/admin/tournaments/${uuid}/feature`,
        { successMessage: "Istaknuto uklonjeno." } as any,
    )
}

/** Full JSON dump of one tournament - details, editors, groups, teams with
 *  rosters + kit colours, rounds, matches with live state and the complete
 *  event timeline. The dashboard turns the response into a .json download. */
export async function adminExportTournament(uuid: string): Promise<unknown> {
    const { data } = await http.get<unknown>(`/admin/tournaments/${uuid}/export`)
    return data
}
