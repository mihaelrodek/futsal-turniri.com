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
    /** True once the video file has been uploaded to storage. */
    hasVideo: boolean
    /** External delivery URL set by the admin (alternative to an upload). */
    deliveryUrl: string | null
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

/** Admin: deliver via an external URL instead of an upload. */
export async function deliverRecordingUrl(
    uuid: string,
    url: string,
): Promise<RecordingRequestDto> {
    const { data } = await http.put<RecordingRequestDto>(
        `/recording-requests/${uuid}/deliver-url`,
        { url },
        { successMessage: "Poveznica na snimku je spremljena." },
    )
    return data
}

export type RecordingUploadUrl = {
    uploadUrl: string
    objectKey: string
    expiresInSeconds: number
}

/** Admin: get a presigned upload URL for the recording file. */
export async function createRecordingUploadUrl(
    uuid: string,
): Promise<RecordingUploadUrl> {
    const { data } = await http.post<RecordingUploadUrl>(
        `/recording-requests/${uuid}/upload-url`,
        undefined,
        { silent: true },
    )
    return data
}

/** Admin: confirm the presigned upload finished for the given object key. */
export async function completeRecordingUpload(
    uuid: string,
    objectKey: string,
): Promise<RecordingRequestDto> {
    const { data } = await http.post<RecordingRequestDto>(
        `/recording-requests/${uuid}/upload-complete`,
        { objectKey },
        { successMessage: "Snimka je učitana." },
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
