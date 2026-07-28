import { http } from "./http"

/** Wire shape returned by the backend (MatchRecordingDto). */
export type MatchRecordingDto = {
    uuid: string
    matchId: number
    tournamentUuid: string
    tournamentName: string
    team1Name: string | null
    team2Name: string | null
    kickoffAt: string | null
    fileName: string | null
    videoSizeBytes: number | null
    uploadedByUid: string | null
    createdAt: string
}

export type FetchMatchRecordingsParams = {
    matchId?: number
    tournamentUuid?: string
    q?: string
}

/** Admin: the recording library, optionally filtered by match/tournament/search text. */
export async function fetchMatchRecordings(
    params: FetchMatchRecordingsParams = {},
): Promise<MatchRecordingDto[]> {
    const { data } = await http.get<MatchRecordingDto[]>("/match-recordings", { params })
    return data
}

/** Recordings already in the library for one match - candidates to link into a request. */
export async function fetchMatchRecordingsForMatch(matchId: number): Promise<MatchRecordingDto[]> {
    return fetchMatchRecordings({ matchId })
}

export type MatchRecordingUploadUrl = {
    uploadUrl: string
    uuid: string
    objectKey: string
    expiresInSeconds: number
}

/** Admin: create a new library entry for `matchId` and get a presigned upload URL for it. */
export async function createMatchRecordingUploadUrl(
    matchId: number,
    fileName?: string,
): Promise<MatchRecordingUploadUrl> {
    const { data } = await http.post<MatchRecordingUploadUrl>(
        `/match-recordings/by-match/${matchId}/upload-url`,
        { fileName },
        { silent: true },
    )
    return data
}

/** Admin: confirm the presigned upload finished; optionally set the final filename. */
export async function completeMatchRecordingUpload(
    uuid: string,
    fileName?: string,
): Promise<MatchRecordingDto> {
    const { data } = await http.post<MatchRecordingDto>(
        `/match-recordings/${uuid}/upload-complete`,
        { fileName },
        { successMessage: "Snimka je dodana u bazu." },
    )
    return data
}

/** Admin: rename a library recording (the download filename, not the storage key). */
export async function renameMatchRecording(
    uuid: string,
    fileName: string,
): Promise<MatchRecordingDto> {
    const { data } = await http.put<MatchRecordingDto>(
        `/match-recordings/${uuid}/file-name`,
        { fileName },
        { successMessage: "Naziv je spremljen." },
    )
    return data
}

/**
 * Admin: re-map a library recording to a different match (e.g. it was
 * uploaded against the wrong one). Any request currently DELIVERED via this
 * recording gets unlinked and reverted to APPROVED on the backend, since it
 * was necessarily linked under the old match.
 */
export async function reassignMatchRecording(
    uuid: string,
    matchId: number,
): Promise<MatchRecordingDto> {
    const { data } = await http.put<MatchRecordingDto>(
        `/match-recordings/${uuid}/match`,
        { matchId },
        { successMessage: "Snimka je premapirana na drugu utakmicu." },
    )
    return data
}

export type MatchRecordingDownloadLink = {
    url: string
    expiresInSeconds: number
}

/** Admin: presigned link to verify a library recording plays back correctly. */
export async function fetchMatchRecordingDownloadLink(
    uuid: string,
): Promise<MatchRecordingDownloadLink> {
    const { data } = await http.get<MatchRecordingDownloadLink>(
        `/match-recordings/${uuid}/download-link`,
    )
    return data
}

/** Admin: remove a library entry (DB row + the MinIO object). */
export async function deleteMatchRecording(uuid: string): Promise<void> {
    await http.delete(`/match-recordings/${uuid}`, { successMessage: "Snimka je uklonjena iz baze." })
}
