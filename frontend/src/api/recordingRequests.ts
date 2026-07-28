import { http } from "./http"

/** Lifecycle of a recording request (backend enum, wire values). */
export type RecordingRequestStatus =
    | "REQUESTED"
    | "APPROVED"
    | "REJECTED"
    | "DELIVERED"
    | "CANCELLED"

/** Wire shape returned by the backend (RecordingRequestDto). */
export type RecordingRequestDto = {
    uuid: string
    matchId: number
    tournamentUuid: string
    tournamentName: string
    team1Name: string | null
    team2Name: string | null
    kickoffAt: string | null
    status: RecordingRequestStatus
    note: string | null
    contactEmail: string | null
    adminNote: string | null
    /** Price in euro cents (e.g. 2000 = 20 €). */
    priceEurCents: number
    paid: boolean
    /** True once a library recording has been linked in. */
    hasVideo: boolean
    /** Set once an admin links a library recording as this request's delivery. */
    recordingUuid: string | null
    recordingFileName: string | null
    recordingSizeBytes: number | null
    createdAt: string
    updatedAt: string
}

export type CreateRecordingRequestPayload = {
    note?: string | null
    contactEmail?: string | null
}

/**
 * Request a recording of a match. The backend answers 409 {"code":"DUPLICATE"}
 * when the caller already has a request for this match - the dialog shows its
 * own context-aware toast for that, so the generic red toast is suppressed.
 */
export async function createRecordingRequest(
    matchId: number,
    payload: CreateRecordingRequestPayload,
): Promise<RecordingRequestDto> {
    const { data } = await http.post<RecordingRequestDto>(
        `/recording-requests/by-match/${matchId}`,
        payload,
        // The dialog owns both the success and the duplicate UX.
        { silent: true, silentErrorStatuses: [409] },
    )
    return data
}

/** All recording requests of the current user, newest first. */
export async function listMyRecordingRequests(): Promise<RecordingRequestDto[]> {
    const { data } = await http.get<RecordingRequestDto[]>("/recording-requests/mine")
    return data
}

/** Admin: every recording request, optionally filtered by status. */
export async function fetchRecordingRequests(
    status?: RecordingRequestStatus,
): Promise<RecordingRequestDto[]> {
    const { data } = await http.get<RecordingRequestDto[]>("/recording-requests", {
        params: status ? { status } : undefined,
    })
    return data
}

/** Alias kept alongside {@link fetchRecordingRequests} (module naming parity
 *  with teamRequests.ts's listTeamRequests). */
export const listRecordingRequests = fetchRecordingRequests

export type UpdateRecordingStatusPayload = {
    status: RecordingRequestStatus
    adminNote?: string | null
}

/** Admin: move a request to a new status, optionally with a note to the user. */
export async function setRecordingRequestStatus(
    uuid: string,
    payload: UpdateRecordingStatusPayload,
): Promise<RecordingRequestDto> {
    const { data } = await http.put<RecordingRequestDto>(
        `/recording-requests/${uuid}/status`,
        payload,
        { successMessage: "Status zahtjeva je spremljen." },
    )
    return data
}

/** Admin: mark the request as paid / unpaid. */
export async function setRecordingRequestPaid(
    uuid: string,
    paid: boolean,
): Promise<RecordingRequestDto> {
    const { data } = await http.put<RecordingRequestDto>(
        `/recording-requests/${uuid}/paid`,
        { paid },
        { successMessage: paid ? "Označeno kao plaćeno." : "Oznaka plaćanja je uklonjena." },
    )
    return data
}

/**
 * Admin: deliver, or re-link, a recording from the library (see
 * `api/matchRecordings.ts`) - uploads never happen against a request
 * directly, and no external URL is ever accepted. Callable again after
 * DELIVERED to fix a wrongly mapped recording. 409 {"code":"MATCH_MISMATCH"}
 * when the recording belongs to a different match than this request.
 */
export async function linkRecordingToRequest(
    uuid: string,
    recordingUuid: string,
): Promise<RecordingRequestDto> {
    const { data } = await http.put<RecordingRequestDto>(
        `/recording-requests/${uuid}/link-recording`,
        { recordingUuid },
        { successMessage: "Snimka je povezana sa zahtjevom.", silentErrorStatuses: [409] },
    )
    return data
}

export type RecordingDownloadLink = {
    url: string
    expiresInSeconds: number
}

/**
 * Short-lived presigned download link for a DELIVERED request. Fetch fresh on
 * EVERY click - the link expires quickly. 409 {"code":"NOT_DELIVERED"} when
 * the recording isn't available yet (caller shows its own message).
 */
export async function fetchRecordingDownloadLink(
    uuid: string,
): Promise<RecordingDownloadLink> {
    const { data } = await http.get<RecordingDownloadLink>(
        `/recording-requests/${uuid}/download-link`,
        { silentErrorStatuses: [409] },
    )
    return data
}

/** Owner: cancel a request (only while it's still in status REQUESTED). */
export async function deleteRecordingRequest(uuid: string): Promise<void> {
    await http.delete(
        `/recording-requests/${uuid}`,
        { successMessage: "Zahtjev je otkazan." },
    )
}
