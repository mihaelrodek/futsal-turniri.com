import { useMemo, useRef, useState } from "react"
import {
    Badge,
    Box,
    Button,
    Card,
    HStack,
    Input,
    NativeSelect,
    Progress,
    Spinner,
    Text,
    VStack,
} from "@chakra-ui/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
    FiCheck,
    FiDownload,
    FiEdit2,
    FiPlus,
    FiRepeat,
    FiTrash2,
    FiUploadCloud,
    FiX,
} from "react-icons/fi"
import {
    completeMatchRecordingUpload,
    createMatchRecordingUploadUrl,
    deleteMatchRecording,
    fetchMatchRecordingDownloadLink,
    fetchMatchRecordings,
    reassignMatchRecording,
    renameMatchRecording,
    type MatchRecordingDto,
} from "../api/matchRecordings"
import { fetchTournaments } from "../api/tournaments"
import type { TournamentCard } from "../types/tournaments"
import { fetchSchedule } from "../api/schedule"
import { qk } from "../queryClient"
import { showError } from "../toaster"
import { t, useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   "Baza snimki" admin tab - the recording library, decoupled from any one
   paid request: upload a video once per match here, then link it into one
   or more recording requests from the "Zahtjevi za snimke" tab.
   ────────────────────────────────────────────────────────────────────── */

/** Sanitized default suggestion: "Turnir-Tim1_vs_Tim2". Admin can edit it. */
function suggestFileName(tournamentName: string, team1: string, team2: string): string {
    const clean = (s: string) => s.trim().replace(/[\\/\r\n\t"]/g, "").replace(/\s+/g, "_")
    return `${clean(tournamentName)}-${clean(team1)}_vs_${clean(team2)}`
}

function formatKickoff(iso: string | null | undefined): string {
    if (!iso) return ""
    try {
        return new Date(iso).toLocaleString("hr-HR", {
            day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
        })
    } catch {
        return ""
    }
}

/** "1,4 GB" / "230 MB" style size label. */
function formatFileSize(bytes: number | null | undefined): string {
    if (bytes == null) return ""
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} GB`
    if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Presigned PUT straight to MinIO. Deliberately XMLHttpRequest, not the app
 * axios instance: the URL is self-authenticating (an Authorization header
 * would break the signature) and XHR gives us upload progress for files in
 * the multi-GB range.
 */
function putFileWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open("PUT", url)
        if (file.type) xhr.setRequestHeader("Content-Type", file.type)
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
        }
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve()
            else reject(new Error(t.recordingRequest.adminLibrary.uploadRejected(xhr.status)))
        }
        xhr.onerror = () => reject(new Error(t.recordingRequest.adminLibrary.uploadNetworkError))
        xhr.onabort = () => reject(new Error(t.recordingRequest.adminLibrary.uploadAborted))
        xhr.send(file)
    })
}

/** Library list order - the backend always returns newest-first, the rest is
 *  applied client-side (the list is admin-only and small). */
type LibrarySort = "newest" | "oldest" | "largest" | "name"

export function AdminRecordingsLibraryTab() {
    const t = useTranslation()
    const SORT_LABELS: Record<LibrarySort, string> = t.recordingRequest.adminLibrary.sortLabels
    const queryClient = useQueryClient()

    // ── Filters ─────────────────────────────────────────────────────────
    // Tournament/match/text go to the BACKEND (it already accepts all three),
    // so the filtered list is never assembled from a partially loaded page.
    // Sorting stays local - it needs no round trip.
    const [query, setQuery] = useState("")
    const [filterTournamentUuid, setFilterTournamentUuid] = useState("")
    const [filterMatchId, setFilterMatchId] = useState<number | null>(null)
    const [sort, setSort] = useState<LibrarySort>("newest")

    const { data: recordings, isLoading } = useQuery({
        queryKey: [
            "matchRecordings",
            "library",
            query,
            filterTournamentUuid,
            filterMatchId,
        ] as const,
        queryFn: () =>
            fetchMatchRecordings({
                q: query.trim() || undefined,
                tournamentUuid: filterTournamentUuid || undefined,
                matchId: filterMatchId ?? undefined,
            }),
    })

    function invalidate() {
        void queryClient.invalidateQueries({ queryKey: ["matchRecordings"] })
    }

    // ── "Nova snimka" picker state ──────────────────────────────────────
    const [pickerOpen, setPickerOpen] = useState(false)
    const [tournamentUuid, setTournamentUuid] = useState("")
    const [pickedMatchId, setPickedMatchId] = useState<number | null>(null)
    const [fileName, setFileName] = useState("")
    const fileInputRef = useRef<HTMLInputElement | null>(null)
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [uploading, setUploading] = useState(false)
    const [uploadPct, setUploadPct] = useState<number | null>(null)

    // Shared by both the "Nova snimka" picker and each row's re-map picker -
    // fetched unconditionally since either can need it at any time.
    const { data: tournaments } = useQuery({
        queryKey: ["matchRecordings", "pickerTournaments"] as const,
        queryFn: async () => {
            const [upcoming, finished] = await Promise.all([
                fetchTournaments("upcoming"),
                fetchTournaments("finished"),
            ])
            return [...upcoming, ...finished]
        },
    })

    const { data: schedule, isLoading: scheduleLoading } = useQuery({
        queryKey: qk.schedule(tournamentUuid),
        queryFn: () => fetchSchedule(tournamentUuid),
        enabled: pickerOpen && !!tournamentUuid,
    })

    const pickableMatches = useMemo(
        () => (schedule?.matches ?? []).filter((m) => m.team1Name && m.team2Name),
        [schedule],
    )
    const pickedMatch = pickableMatches.find((m) => m.matchId === pickedMatchId) ?? null
    const pickedTournamentName = (tournaments ?? []).find((t) => t.uuid === tournamentUuid)?.name ?? ""

    // Matches of the tournament chosen in the FILTER bar - separate from the
    // upload picker's selection. Same query key as the picker's schedule, so
    // when both point at one tournament it's served from cache.
    const { data: filterSchedule, isLoading: filterScheduleLoading } = useQuery({
        queryKey: qk.schedule(filterTournamentUuid),
        queryFn: () => fetchSchedule(filterTournamentUuid),
        enabled: !!filterTournamentUuid,
    })
    const filterMatches = useMemo(
        () => (filterSchedule?.matches ?? []).filter((m) => m.team1Name && m.team2Name),
        [filterSchedule],
    )

    const sortedRecordings = useMemo(() => {
        const list = [...(recordings ?? [])]
        switch (sort) {
            case "oldest":
                return list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
            case "largest":
                return list.sort((a, b) => (b.videoSizeBytes ?? 0) - (a.videoSizeBytes ?? 0))
            case "name":
                return list.sort((a, b) =>
                    (a.fileName ?? a.uuid).localeCompare(b.fileName ?? b.uuid, "hr"),
                )
            default:
                // The backend already sorts newest-first; keep its order (and its
                // tiebreak) rather than re-sorting on a second-granularity string.
                return list
        }
    }, [recordings, sort])

    const filtersActive =
        query.trim() !== "" || filterTournamentUuid !== "" || filterMatchId != null

    function clearFilters() {
        setQuery("")
        setFilterTournamentUuid("")
        setFilterMatchId(null)
    }

    function pickMatch(matchId: number | null) {
        setPickedMatchId(matchId)
        const m = pickableMatches.find((x) => x.matchId === matchId)
        if (m && m.team1Name && m.team2Name) {
            setFileName(suggestFileName(pickedTournamentName, m.team1Name, m.team2Name))
        } else {
            setFileName("")
        }
    }

    function closePicker() {
        setPickerOpen(false)
        setTournamentUuid("")
        setPickedMatchId(null)
        setFileName("")
        setSelectedFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ""
    }

    async function upload() {
        if (uploading || !selectedFile || pickedMatchId == null) return
        try {
            setUploading(true)
            setUploadPct(0)
            const finalName = fileName.trim() || undefined
            const { uploadUrl, uuid } = await createMatchRecordingUploadUrl(pickedMatchId, finalName)
            await putFileWithProgress(uploadUrl, selectedFile, setUploadPct)
            await completeMatchRecordingUpload(uuid, finalName)
            closePicker()
            invalidate()
        } catch (e) {
            showError(t.recordingRequest.adminLibrary.uploadFailedTitle, e instanceof Error ? e.message : t.recordingRequest.adminLibrary.uploadFailedRetry)
        } finally {
            setUploading(false)
            setUploadPct(null)
        }
    }

    return (
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Body p={{ base: "4", md: "6" }}>
                <VStack align="stretch" gap="3">
                    {/* No card title: /admin/{slug} already names the module -
                        the row is just the action now. */}
                    <HStack justify="flex-end" wrap="wrap" gap="2">
                        <Button
                            size="xs"
                            variant={pickerOpen ? "outline" : "solid"}
                            colorPalette="pitch"
                            onClick={() => (pickerOpen ? closePicker() : setPickerOpen(true))}
                        >
                            {pickerOpen ? <FiX /> : <FiPlus />}
                            {pickerOpen ? t.common.close : t.recordingRequest.adminLibrary.newRecording}
                        </Button>
                    </HStack>

                    {pickerOpen && (
                        <Box borderWidth="1px" borderColor="border.emphasized" bg="bg.subtle" rounded="md" p="3">
                            <VStack align="stretch" gap="2.5">
                                <NativeSelect.Root size="sm">
                                    <NativeSelect.Field
                                        value={tournamentUuid}
                                        onChange={(e) => {
                                            setTournamentUuid((e.target as HTMLSelectElement).value)
                                            pickMatch(null)
                                        }}
                                    >
                                        <option value="">{t.recordingRequest.adminLibrary.pickTournament}</option>
                                        {(tournaments ?? []).map((tn) => (
                                            <option key={tn.uuid} value={tn.uuid}>{tn.name}</option>
                                        ))}
                                    </NativeSelect.Field>
                                </NativeSelect.Root>

                                {tournamentUuid && (
                                    scheduleLoading ? (
                                        <HStack gap="2" color="fg.muted">
                                            <Spinner size="xs" />
                                            <Text fontSize="sm">{t.recordingRequest.adminLibrary.loadingMatches}</Text>
                                        </HStack>
                                    ) : pickableMatches.length === 0 ? (
                                        <Text fontSize="sm" color="fg.muted">
                                            {t.recordingRequest.adminLibrary.noMatchesTeams}
                                        </Text>
                                    ) : (
                                        <NativeSelect.Root size="sm">
                                            <NativeSelect.Field
                                                value={pickedMatchId == null ? "" : String(pickedMatchId)}
                                                onChange={(e) => {
                                                    const v = (e.target as HTMLSelectElement).value
                                                    pickMatch(v ? Number(v) : null)
                                                }}
                                            >
                                                <option value="">{t.recordingRequest.adminLibrary.pickMatch}</option>
                                                {pickableMatches.map((m) => (
                                                    <option key={m.matchId} value={String(m.matchId)}>
                                                        {m.team1Name} – {m.team2Name}
                                                        {m.kickoffAt ? `, ${formatKickoff(m.kickoffAt)}` : ""}
                                                    </option>
                                                ))}
                                            </NativeSelect.Field>
                                        </NativeSelect.Root>
                                    )
                                )}

                                {pickedMatch && (
                                    <>
                                        <Input
                                            size="sm"
                                            placeholder={t.recordingRequest.adminLibrary.fileNamePlaceholder}
                                            value={fileName}
                                            onChange={(e) => setFileName(e.target.value)}
                                            disabled={uploading}
                                        />
                                        <HStack gap="2" wrap="wrap">
                                            <input
                                                ref={fileInputRef}
                                                type="file"
                                                accept="video/mp4,video/webm,video/quicktime,.mov"
                                                style={{ display: "none" }}
                                                onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                                            />
                                            <Button
                                                size="xs"
                                                variant="outline"
                                                disabled={uploading}
                                                onClick={() => fileInputRef.current?.click()}
                                            >
                                                {t.recordingRequest.adminLibrary.chooseFile}
                                            </Button>
                                            {selectedFile && (
                                                <Text fontSize="xs" color="fg.muted" truncate maxW="240px">
                                                    {selectedFile.name} ({formatFileSize(selectedFile.size)})
                                                </Text>
                                            )}
                                            <Button
                                                size="xs"
                                                variant="solid"
                                                colorPalette="pitch"
                                                disabled={!selectedFile}
                                                loading={uploading}
                                                onClick={upload}
                                            >
                                                <FiUploadCloud /> {t.recordingRequest.adminLibrary.uploadCta}
                                            </Button>
                                        </HStack>
                                        {uploadPct != null && (
                                            <Progress.Root value={uploadPct} size="sm" colorPalette="pitch">
                                                <HStack gap="2">
                                                    <Progress.Track flex="1" rounded="full">
                                                        <Progress.Range />
                                                    </Progress.Track>
                                                    <Progress.ValueText fontSize="xs" />
                                                </HStack>
                                            </Progress.Root>
                                        )}
                                        <Text fontSize="xs" color="fg.muted">
                                            {t.recordingRequest.adminLibrary.uploadHintLarge}
                                        </Text>
                                    </>
                                )}
                            </VStack>
                        </Box>
                    )}

                    {/* ── Filters ────────────────────────────────────────
                        Text + turnir + utakmica are server-side; sort is local.
                        The match select only appears once a tournament is
                        chosen - a match list across every tournament would be
                        thousands of rows long. */}
                    <VStack align="stretch" gap="2">
                        <Input
                            size="sm"
                            placeholder={t.recordingRequest.adminLibrary.searchPlaceholder}
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                        />
                        <HStack gap="2" wrap="wrap" align="center">
                            <NativeSelect.Root size="sm" w={{ base: "100%", md: "240px" }}>
                                <NativeSelect.Field
                                    value={filterTournamentUuid}
                                    onChange={(e) => {
                                        setFilterTournamentUuid((e.target as HTMLSelectElement).value)
                                        // A match belongs to one tournament only.
                                        setFilterMatchId(null)
                                    }}
                                >
                                    <option value="">{t.recordingRequest.adminLibrary.allTournaments}</option>
                                    {(tournaments ?? []).map((tn) => (
                                        <option key={tn.uuid} value={tn.uuid}>{tn.name}</option>
                                    ))}
                                </NativeSelect.Field>
                            </NativeSelect.Root>

                            {filterTournamentUuid && (
                                filterScheduleLoading ? (
                                    <HStack gap="2" color="fg.muted">
                                        <Spinner size="xs" />
                                        <Text fontSize="sm">{t.recordingRequest.adminLibrary.loadingMatches}</Text>
                                    </HStack>
                                ) : (
                                    <NativeSelect.Root size="sm" w={{ base: "100%", md: "260px" }}>
                                        <NativeSelect.Field
                                            value={filterMatchId == null ? "" : String(filterMatchId)}
                                            onChange={(e) => {
                                                const v = (e.target as HTMLSelectElement).value
                                                setFilterMatchId(v ? Number(v) : null)
                                            }}
                                        >
                                            <option value="">{t.recordingRequest.adminLibrary.allMatches}</option>
                                            {filterMatches.map((m) => (
                                                <option key={m.matchId} value={String(m.matchId)}>
                                                    {m.team1Name} – {m.team2Name}
                                                    {m.kickoffAt ? `, ${formatKickoff(m.kickoffAt)}` : ""}
                                                </option>
                                            ))}
                                        </NativeSelect.Field>
                                    </NativeSelect.Root>
                                )
                            )}

                            <NativeSelect.Root size="sm" w={{ base: "100%", md: "170px" }}>
                                <NativeSelect.Field
                                    value={sort}
                                    onChange={(e) =>
                                        setSort((e.target as HTMLSelectElement).value as LibrarySort)
                                    }
                                >
                                    {(Object.keys(SORT_LABELS) as LibrarySort[]).map((s) => (
                                        <option key={s} value={s}>{SORT_LABELS[s]}</option>
                                    ))}
                                </NativeSelect.Field>
                            </NativeSelect.Root>

                            {filtersActive && (
                                <Button size="xs" variant="ghost" onClick={clearFilters}>
                                    <FiX /> {t.recordingRequest.adminLibrary.clearFilters}
                                </Button>
                            )}

                            {!isLoading && (
                                <Text fontSize="xs" color="fg.muted" ml={{ base: "0", md: "auto" }}>
                                    {t.recordingRequest.adminLibrary.recordingsCount(sortedRecordings.length)}
                                </Text>
                            )}
                        </HStack>
                    </VStack>

                    {isLoading ? (
                        <HStack py="4" justify="center"><Spinner size="sm" /></HStack>
                    ) : sortedRecordings.length === 0 ? (
                        <Text py="2" fontSize="sm" color="fg.muted">
                            {filtersActive
                                ? t.recordingRequest.adminLibrary.noneForFilters
                                : t.recordingRequest.adminLibrary.empty}
                        </Text>
                    ) : (
                        <VStack align="stretch" gap="2">
                            {sortedRecordings.map((rec) => (
                                <RecordingRow
                                    key={rec.uuid}
                                    rec={rec}
                                    tournaments={tournaments ?? []}
                                    onChanged={invalidate}
                                />
                            ))}
                        </VStack>
                    )}
                </VStack>
            </Card.Body>
        </Card.Root>
    )
}

export default AdminRecordingsLibraryTab

function RecordingRow({
    rec,
    tournaments,
    onChanged,
}: {
    rec: MatchRecordingDto
    tournaments: TournamentCard[]
    onChanged: () => void
}) {
    const t = useTranslation()
    const [busy, setBusy] = useState<null | "download" | "rename" | "delete" | "reassign">(null)
    const [renaming, setRenaming] = useState(false)
    const [nameInput, setNameInput] = useState(rec.fileName ?? "")

    // Re-map picker: pre-filled with the recording's current tournament/match
    // so fixing a wrong match within the same tournament is a one-select fix.
    const [reassigning, setReassigning] = useState(false)
    const [reassignTournamentUuid, setReassignTournamentUuid] = useState(rec.tournamentUuid)
    const [reassignMatchId, setReassignMatchId] = useState<number | null>(rec.matchId)

    const { data: reassignSchedule, isLoading: reassignScheduleLoading } = useQuery({
        queryKey: qk.schedule(reassignTournamentUuid),
        queryFn: () => fetchSchedule(reassignTournamentUuid),
        enabled: reassigning && !!reassignTournamentUuid,
    })
    const reassignPickableMatches = (reassignSchedule?.matches ?? []).filter(
        (m) => m.team1Name && m.team2Name,
    )

    function openReassign() {
        setReassignTournamentUuid(rec.tournamentUuid)
        setReassignMatchId(rec.matchId)
        setReassigning(true)
    }

    async function confirmReassign() {
        if (busy || reassignMatchId == null || reassignMatchId === rec.matchId) return
        try {
            setBusy("reassign")
            await reassignMatchRecording(rec.uuid, reassignMatchId)
            setReassigning(false)
            onChanged()
        } finally {
            setBusy(null)
        }
    }

    async function download() {
        if (busy) return
        try {
            setBusy("download")
            const { url } = await fetchMatchRecordingDownloadLink(rec.uuid)
            window.open(url, "_blank")
        } finally {
            setBusy(null)
        }
    }

    async function confirmRename() {
        if (busy || !nameInput.trim()) return
        try {
            setBusy("rename")
            await renameMatchRecording(rec.uuid, nameInput.trim())
            setRenaming(false)
            onChanged()
        } finally {
            setBusy(null)
        }
    }

    async function remove() {
        if (busy) return
        if (!confirm(t.recordingRequest.adminLibrary.confirmDelete)) return
        try {
            setBusy("delete")
            await deleteMatchRecording(rec.uuid)
            onChanged()
        } finally {
            setBusy(null)
        }
    }

    return (
        <Box p="2.5" bg="bg.subtle" rounded="md" borderWidth="1px" borderColor="border.subtle">
            <VStack align="stretch" gap="2">
            <HStack justify="space-between" gap="2" wrap="wrap" align="start">
                <VStack align="start" gap="0.5" flex="1" minW="0">
                    <Text fontSize="sm" fontWeight={600} truncate>
                        {rec.team1Name ?? "?"} — {rec.team2Name ?? "?"}
                    </Text>
                    <Text fontSize="xs" color="fg.muted" truncate maxW="full">
                        {rec.tournamentName}{rec.kickoffAt ? ` · ${formatKickoff(rec.kickoffAt)}` : ""}
                    </Text>
                    {renaming ? (
                        <HStack gap="1.5" mt="1">
                            <Input
                                size="xs"
                                value={nameInput}
                                onChange={(e) => setNameInput(e.target.value)}
                                autoFocus
                            />
                            <Button size="2xs" variant="solid" colorPalette="pitch" loading={busy === "rename"} onClick={confirmRename}>
                                <FiCheck />
                            </Button>
                            <Button size="2xs" variant="ghost" onClick={() => setRenaming(false)}>
                                <FiX />
                            </Button>
                        </HStack>
                    ) : (
                        <Text fontSize="xs" fontFamily="mono" truncate maxW="full">
                            {rec.fileName ?? rec.uuid}
                        </Text>
                    )}
                </VStack>
                <VStack align="end" gap="1" flexShrink={0}>
                    {rec.videoSizeBytes != null && (
                        <Badge size="sm" variant="subtle" colorPalette="purple">
                            {formatFileSize(rec.videoSizeBytes)}
                        </Badge>
                    )}
                    <HStack gap="1">
                        <Button size="2xs" variant="ghost" loading={busy === "download"} onClick={download}>
                            <FiDownload />
                        </Button>
                        {!renaming && (
                            <Button size="2xs" variant="ghost" onClick={() => { setNameInput(rec.fileName ?? ""); setRenaming(true) }}>
                                <FiEdit2 />
                            </Button>
                        )}
                        <Button
                            size="2xs"
                            variant="ghost"
                            onClick={() => (reassigning ? setReassigning(false) : openReassign())}
                        >
                            <FiRepeat />
                        </Button>
                        <Button size="2xs" variant="ghost" colorPalette="red" loading={busy === "delete"} onClick={remove}>
                            <FiTrash2 />
                        </Button>
                    </HStack>
                </VStack>
            </HStack>

            {reassigning && (
                <Box borderWidth="1px" borderColor="border.emphasized" bg="bg.muted" rounded="md" p="2.5">
                    <VStack align="stretch" gap="2">
                        <Text fontSize="xs" color="fg.muted">{t.recordingRequest.adminLibrary.reassignLabel}</Text>
                        <NativeSelect.Root size="sm">
                            <NativeSelect.Field
                                value={reassignTournamentUuid}
                                onChange={(e) => {
                                    setReassignTournamentUuid((e.target as HTMLSelectElement).value)
                                    setReassignMatchId(null)
                                }}
                            >
                                <option value="">{t.recordingRequest.adminLibrary.pickTournament}</option>
                                {tournaments.map((tn) => (
                                    <option key={tn.uuid} value={tn.uuid}>{tn.name}</option>
                                ))}
                            </NativeSelect.Field>
                        </NativeSelect.Root>

                        {reassignTournamentUuid && (
                            reassignScheduleLoading ? (
                                <HStack gap="2" color="fg.muted">
                                    <Spinner size="xs" />
                                    <Text fontSize="sm">{t.recordingRequest.adminLibrary.loadingMatches}</Text>
                                </HStack>
                            ) : reassignPickableMatches.length === 0 ? (
                                <Text fontSize="sm" color="fg.muted">
                                    {t.recordingRequest.adminLibrary.noMatchesTeams}
                                </Text>
                            ) : (
                                <NativeSelect.Root size="sm">
                                    <NativeSelect.Field
                                        value={reassignMatchId == null ? "" : String(reassignMatchId)}
                                        onChange={(e) => {
                                            const v = (e.target as HTMLSelectElement).value
                                            setReassignMatchId(v ? Number(v) : null)
                                        }}
                                    >
                                        <option value="">{t.recordingRequest.adminLibrary.pickMatch}</option>
                                        {reassignPickableMatches.map((m) => (
                                            <option key={m.matchId} value={String(m.matchId)}>
                                                {m.team1Name} – {m.team2Name}
                                                {m.kickoffAt ? `, ${formatKickoff(m.kickoffAt)}` : ""}
                                            </option>
                                        ))}
                                    </NativeSelect.Field>
                                </NativeSelect.Root>
                            )
                        )}

                        <HStack gap="2" justify="flex-end">
                            <Button size="xs" variant="ghost" disabled={busy != null} onClick={() => setReassigning(false)}>
                                {t.common.cancel}
                            </Button>
                            <Button
                                size="xs"
                                variant="solid"
                                colorPalette="pitch"
                                disabled={busy != null || reassignMatchId == null || reassignMatchId === rec.matchId}
                                loading={busy === "reassign"}
                                onClick={confirmReassign}
                            >
                                <FiCheck /> {t.recordingRequest.adminLibrary.reassignConfirm}
                            </Button>
                        </HStack>
                    </VStack>
                </Box>
            )}
            </VStack>
        </Box>
    )
}
