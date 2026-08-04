import { http } from "./http"

/* ──────────────────────────────────────────────────────────────────────────
   Team registration by form (backend: TeamRegistrationController).

   Two doors into one flow:
     - a PUBLIC link the organizer generates and sends to a club. No account:
       the person holding the squad list is a club contact who will not sign up
       to type eight names in, and requiring a login is what makes organizers
       enter rosters by hand instead.
     - the same form filed by a signed-in user from the tournament page.

   Both land the team as PENDING. Nothing a submission contains is publicly
   visible until the organizer approves it, so the worst a leaked link can do
   is put junk in a review queue.
   ────────────────────────────────────────────────────────────────────── */

/** One roster line in the form. Blank names are dropped by the backend. */
export type RegistrationPlayerInput = {
    name: string
    number?: number | null
    captain?: boolean
    goalkeeper?: boolean
}

export type TeamRegistrationInput = {
    teamName: string
    jerseyColor?: string | null
    shortsColor?: string | null
    /** Required by the public endpoint (the organizer's only way back to an
     *  anonymous submitter); optional when signed in. */
    contactName?: string | null
    contact?: string | null
    note?: string | null
    players: RegistrationPlayerInput[]
}

/** What the public form is told about the tournament it registers for. */
export type RegistrationFormInfo = {
    tournamentName: string
    tournamentSlug: string | null
    location: string | null
    startAt: string | null
    organizerName: string | null
    /** The organizer's note on the link ("NK Sokol") - shown back so the
     *  recipient can see the link was meant for them. */
    label: string | null
    /** False when the link was revoked or the tournament already started. */
    open: boolean
    /** null while open, else LINK_REVOKED / TOURNAMENT_ALREADY_STARTED. */
    closedCode: string | null
}

export type RegistrationSubmitResult = {
    teamName: string
    pending: boolean
    playerCount: number
}

/** A registration link as the organizer sees it - carries the raw token. */
export type RegistrationLink = {
    id: number
    token: string
    /** Absolute URL as the BACKEND built it, from `app.public-base-url`. Do
     *  not show this - use `registrationLinkUrl()` instead. Kept on the wire
     *  only so a non-browser caller has something usable. */
    url: string
    label: string | null
    active: boolean
    useCount: number
    teamCount: number
    createdAt: string | null
}

/**
 * The link an organizer actually copies.
 *
 * Built from the CURRENT origin, not from the backend's `url`: that field
 * comes from `app.public-base-url`, which is a single fixed value per
 * deployment and defaults to the production host. A link generated from a dev
 * or preview environment therefore pointed at production - where the token
 * does not exist - and opening it gave a 404. Same reasoning as
 * `shareRecordingUrl` in api/matchRecordings.ts.
 */
export function registrationLinkUrl(token: string): string {
    return `${window.location.origin}/prijava-ekipe/${token}`
}

/**
 * Public: load the form context. Fails QUIETLY - a bad or revoked token is a
 * normal thing for this page to render, not a red toast over it.
 */
export async function fetchRegistrationForm(token: string): Promise<RegistrationFormInfo> {
    const { data } = await http.get<RegistrationFormInfo>(`/registration/${token}`, {
        silent: true,
    })
    return data
}

/** Public: file the registration. */
export async function submitRegistration(
    token: string,
    payload: TeamRegistrationInput,
): Promise<RegistrationSubmitResult> {
    const { data } = await http.post<RegistrationSubmitResult>(
        `/registration/${token}`,
        payload,
        // The page renders its own success screen; a toast on top of it would
        // be the same message twice.
        { silent: true },
    )
    return data
}

/**
 * PUBLIC: the same form, filed straight from the tournament page by anyone -
 * no account and no link. Contact fields are mandatory; the entry still lands
 * pending, so nothing shows up publicly until the organizer approves it.
 */
export async function submitPublicRegistration(
    tournamentUuid: string,
    payload: TeamRegistrationInput,
): Promise<RegistrationSubmitResult> {
    const { data } = await http.post<RegistrationSubmitResult>(
        `/registration/tournaments/${tournamentUuid}/public`,
        payload,
        { silent: true },
    )
    return data
}

/** Signed-in: the same form, filed straight from the tournament page. */
export async function registerTeamAsUser(
    tournamentUuid: string,
    payload: TeamRegistrationInput,
): Promise<RegistrationSubmitResult> {
    const { data } = await http.post<RegistrationSubmitResult>(
        `/registration/tournaments/${tournamentUuid}/register`,
        payload,
        { silent: true },
    )
    return data
}

/* ── organizer: link management ─────────────────────────────────────────── */

export async function fetchRegistrationLinks(tournamentUuid: string): Promise<RegistrationLink[]> {
    const { data } = await http.get<RegistrationLink[]>(
        `/registration/tournaments/${tournamentUuid}/links`,
    )
    return data
}

export async function createRegistrationLink(
    tournamentUuid: string,
    label: string | null,
): Promise<RegistrationLink> {
    const { data } = await http.post<RegistrationLink>(
        `/registration/tournaments/${tournamentUuid}/links`,
        { label },
        { successMessage: "Poveznica za prijavu je stvorena." },
    )
    return data
}

/**
 * Delete a link outright. The registrations filed through it are NOT deleted -
 * the FK is ON DELETE SET NULL, so the teams stay and only stop recording
 * which link they arrived through. Use `setRegistrationLinkActive(id, false)`
 * to stop accepting entries while keeping that trail.
 */
export async function deleteRegistrationLink(linkId: number): Promise<void> {
    await http.delete(`/registration/links/${linkId}`, {
        successMessage: "Poveznica je obrisana.",
    })
}

/** Revoke (or restore) a link without deleting it. */
export async function setRegistrationLinkActive(
    linkId: number,
    active: boolean,
): Promise<RegistrationLink> {
    const { data } = await http.put<RegistrationLink>(
        `/registration/links/${linkId}/active`,
        { active },
        {
            successMessage: active
                ? "Poveznica je ponovno aktivna."
                : "Poveznica je ugašena i više ne prima prijave.",
        },
    )
    return data
}
