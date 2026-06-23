import { http } from "./http"

/** Public preview of a sharable team, returned by GET /teams/claim/{token}/preview. */
export type ClaimPreviewDto = {
    teamName: string
    tournamentName: string
    tournamentRef: string | null
    tournamentStartAt: string | null
    primaryName: string | null
    primarySlug: string | null
    alreadyClaimed: boolean
    coOwnerName: string | null
    coOwnerSlug: string | null
}

export type ClaimResultDto = {
    claimed: boolean
    teamId: number
}

/**
 * Fetch the preview info shown on the claim landing page so the partner
 * can see what they're about to claim before they tap Preuzmi.
 *
 * Public — no auth needed.
 */
export async function fetchClaimPreview(token: string): Promise<ClaimPreviewDto> {
    const { data } = await http.get<ClaimPreviewDto>(
        `/teams/claim/${encodeURIComponent(token)}/preview`,
        { silent: true } as any,
    )
    return data
}

/**
 * Claim co-ownership. Backend returns:
 *   200 — success (or idempotent re-claim by the same user)
 *   409 OWNER_SAME — viewer is the primary submitter (can't claim own team)
 *   409 ALREADY_CLAIMED — claimed by a different user
 *   404 — token unknown
 *
 * Auth required.
 */
export async function claimTeam(token: string): Promise<ClaimResultDto> {
    const { data } = await http.post<ClaimResultDto>(
        `/teams/claim/${encodeURIComponent(token)}`,
        null,
        {
            successMessage: "Ekipa preuzeta — pojavit će se na tvojem profilu.",
            // Custom UI in the page handles 409 with explicit copy.
            silentErrorStatuses: [409],
        } as any,
    )
    return data
}
