import { useState } from "react"
import {
    Badge,
    Box,
    Button,
    Card,
    HStack,
    Spinner,
    Stack,
    Text,
    Textarea,
    VStack,
} from "@chakra-ui/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
    FiCheck,
    FiDollarSign,
    FiEdit2,
    FiFilm,
    FiLink,
    FiX,
} from "react-icons/fi"
import {
    fetchRecordingDownloadLink,
    fetchRecordingRequests,
    linkRecordingToRequest,
    setRecordingRequestPaid,
    setRecordingRequestStatus,
    type RecordingRequestDto,
    type RecordingRequestStatus,
} from "../api/recordingRequests"
import { fetchMatchRecordingsForMatch } from "../api/matchRecordings"
import { showError, showSuccess } from "../toaster"
import { qk } from "../queryClient"

/**
 * Platform-admin management of paid match-recording requests (~20 €/match).
 *
 * <p>Lifecycle handled here: an organizer/visitor REQUESTED a recording →
 * admin approves or rejects (optionally with a note) → admin marks the
 * request paid → admin delivers the video by linking in a recording already
 * uploaded to the recording library (see the "Baza snimki" tab - uploads
 * never happen against a request directly, and no external link is ever
 * accepted) → the requester fetches a time-limited download link. The link
 * can be re-pointed at any time, even after delivery, to fix a wrongly
 * mapped recording.
 */

/** "ALL" disables server-side filtering; everything else maps 1:1 to the enum. */
type StatusFilter = RecordingRequestStatus | "ALL"

const FILTERS: { value: StatusFilter; label: string }[] = [
    { value: "ALL", label: "Svi" },
    { value: "REQUESTED", label: "Zatraženo" },
    { value: "APPROVED", label: "Odobreno" },
    { value: "DELIVERED", label: "Isporučeno" },
    { value: "REJECTED", label: "Odbijeno" },
    { value: "CANCELLED", label: "Otkazano" },
]

const STATUS_LABEL: Record<RecordingRequestStatus, string> = {
    REQUESTED: "Zatraženo",
    APPROVED: "Odobreno",
    REJECTED: "Odbijeno",
    DELIVERED: "Isporučeno",
    CANCELLED: "Otkazano",
}

const STATUS_PALETTE: Record<RecordingRequestStatus, string> = {
    REQUESTED: "orange",
    APPROVED: "blue",
    REJECTED: "red",
    DELIVERED: "green",
    CANCELLED: "gray",
}

export function AdminRecordingRequestsTab() {
    const queryClient = useQueryClient()
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("REQUESTED")

    const { data: requests, isLoading } = useQuery({
        queryKey: qk.adminRecordingRequests(statusFilter === "ALL" ? undefined : statusFilter),
        queryFn: () =>
            fetchRecordingRequests(statusFilter === "ALL" ? undefined : statusFilter),
    })

    // Every mutation funnels through this: drop ALL status-filter variants of
    // the list so switching filters after an action never shows a stale row.
    function invalidate() {
        void queryClient.invalidateQueries({ queryKey: ["recordingRequests"] })
    }

    return (
        <VStack align="stretch" gap="4">
            <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
                <Card.Body p={{ base: "4", md: "6" }}>
                    <Stack gap="3">
                        <Box>
                            <Text fontSize="lg" fontWeight="semibold">Zahtjevi za snimke</Text>
                            <Text fontSize="sm" color="fg.muted">
                                Upravljanje zahtjevima za snimke utakmica - odobri ili odbij
                                zahtjev, označi uplatu i isporuči snimku povezivanjem s bazom
                                snimki.
                            </Text>
                        </Box>

                        {/* Segmented status filter. Plain buttons (solid = active)
                            keep it consistent with the rest of the admin UI. */}
                        <HStack gap="1.5" wrap="wrap">
                            {FILTERS.map((f) => (
                                <Button
                                    key={f.value}
                                    size="xs"
                                    variant={statusFilter === f.value ? "solid" : "outline"}
                                    colorPalette={statusFilter === f.value ? "pitch" : "gray"}
                                    onClick={() => setStatusFilter(f.value)}
                                >
                                    {f.label}
                                </Button>
                            ))}
                        </HStack>

                        {isLoading ? (
                            <HStack py="4" justify="center"><Spinner size="sm" /></HStack>
                        ) : !requests || requests.length === 0 ? (
                            <Text py="2" fontSize="sm" color="fg.muted">
                                Nema zahtjeva za odabrani status.
                            </Text>
                        ) : (
                            <Stack gap="2.5">
                                {requests.map((r) => (
                                    <RecordingRequestRow key={r.uuid} req={r} onChanged={invalidate} />
                                ))}
                            </Stack>
                        )}
                    </Stack>
                </Card.Body>
            </Card.Root>
        </VStack>
    )
}

export default AdminRecordingRequestsTab

/* ──────────────────────────────────────────────────────────────────────
   One request row. Owns all per-row state (busy flags, reject note,
   edit-recording toggle) so a long list doesn't hoist a pile of maps
   into the parent.
   ────────────────────────────────────────────────────────────────────── */
function RecordingRequestRow({
    req,
    onChanged,
}: {
    req: RecordingRequestDto
    onChanged: () => void
}) {
    const [busy, setBusy] = useState<
        null | "approve" | "reject" | "paid" | "linkRecording" | "link"
    >(null)

    // Reject flow: the button first reveals an inline textarea for the
    // (optional) admin note, the second click confirms.
    const [rejecting, setRejecting] = useState(false)
    const [rejectNote, setRejectNote] = useState("")

    // DELIVERED requests hide the library picker behind an "Uredi" toggle so
    // the common case (already correctly linked) stays a one-liner.
    const [editingRecording, setEditingRecording] = useState(false)

    const status = req.status as RecordingRequestStatus

    // Library recordings already uploaded for this match - the only delivery
    // path a request can be fulfilled with. Fetched lazily: while APPROVED
    // (the picker is always shown) or while DELIVERED and the admin opened
    // the "Uredi" panel to fix a wrongly mapped recording.
    const { data: candidates, isLoading: candidatesLoading } = useQuery({
        queryKey: ["matchRecordings", "by-match", req.matchId],
        queryFn: () => fetchMatchRecordingsForMatch(req.matchId),
        enabled: status === "APPROVED" || (status === "DELIVERED" && editingRecording),
    })

    async function approve() {
        if (busy) return
        try {
            setBusy("approve")
            await setRecordingRequestStatus(req.uuid, { status: "APPROVED" })
            onChanged()
        } finally {
            setBusy(null)
        }
    }

    async function confirmReject() {
        if (busy) return
        try {
            setBusy("reject")
            await setRecordingRequestStatus(req.uuid, {
                status: "REJECTED",
                adminNote: rejectNote.trim() || undefined,
            })
            setRejecting(false)
            setRejectNote("")
            onChanged()
        } finally {
            setBusy(null)
        }
    }

    async function togglePaid() {
        if (busy) return
        try {
            setBusy("paid")
            await setRecordingRequestPaid(req.uuid, !req.paid)
            onChanged()
        } finally {
            setBusy(null)
        }
    }

    async function linkRecording(recordingUuid: string) {
        if (busy) return
        try {
            setBusy("linkRecording")
            await linkRecordingToRequest(req.uuid, recordingUuid)
            setEditingRecording(false)
            onChanged()
        } finally {
            setBusy(null)
        }
    }

    async function copyDownloadLink() {
        if (busy) return
        try {
            setBusy("link")
            const { url, expiresInSeconds } = await fetchRecordingDownloadLink(req.uuid)
            await navigator.clipboard.writeText(url)
            showSuccess(
                "Poveznica kopirana u međuspremnik.",
                `Vrijedi još ${formatExpiry(expiresInSeconds)}.`,
            )
        } catch {
            /* API errors surface via the http interceptor; clipboard denial
               is the only local failure worth naming. */
            showError("Kopiranje poveznice nije uspjelo.")
        } finally {
            setBusy(null)
        }
    }

    function libraryPicker() {
        return candidatesLoading ? (
            <HStack py="1"><Spinner size="xs" /></HStack>
        ) : !candidates || candidates.length === 0 ? (
            <Text fontSize="xs" color="fg.muted">
                Nema snimke u bazi za ovu utakmicu — otvori „Baza snimki" i uploadaj je tamo.
            </Text>
        ) : (
            <Stack gap="1.5">
                {candidates.map((rec) => (
                    <HStack key={rec.uuid} gap="2" wrap="wrap">
                        <Text fontSize="xs" truncate maxW="240px">
                            {rec.fileName ?? rec.uuid}
                            {rec.videoSizeBytes != null
                                ? ` (${formatFileSize(rec.videoSizeBytes)})`
                                : ""}
                        </Text>
                        <Button
                            size="xs"
                            variant="solid"
                            colorPalette="pitch"
                            disabled={busy != null || rec.uuid === req.recordingUuid}
                            loading={busy === "linkRecording"}
                            onClick={() => linkRecording(rec.uuid)}
                        >
                            <FiFilm /> {rec.uuid === req.recordingUuid ? "Povezano" : "Poveži"}
                        </Button>
                    </HStack>
                ))}
            </Stack>
        )
    }

    return (
        <Box
            p="3"
            bg="bg.subtle"
            rounded="md"
            borderWidth="1px"
            borderColor="border.subtle"
        >
            <Stack gap="2">
                {/* Header: teams + badges */}
                <HStack justify="space-between" gap="2" wrap="wrap">
                    <Box minW="0">
                        <Text fontSize="sm" fontWeight="semibold" truncate>
                            {req.team1Name} — {req.team2Name}
                        </Text>
                        <Text fontSize="xs" color="fg.muted" truncate>
                            {req.tournamentName} • {formatDateTime(req.kickoffAt)}
                        </Text>
                    </Box>
                    <HStack gap="1.5" flexShrink={0} wrap="wrap">
                        <Badge size="sm" variant="solid" colorPalette={STATUS_PALETTE[status] ?? "gray"}>
                            {STATUS_LABEL[status] ?? req.status}
                        </Badge>
                        {req.paid && (
                            <Badge size="sm" variant="subtle" colorPalette="green">
                                Plaćeno
                            </Badge>
                        )}
                        {req.hasVideo && (
                            <Badge size="sm" variant="subtle" colorPalette="purple">
                                Video
                            </Badge>
                        )}
                    </HStack>
                </HStack>

                {/* Meta: contact, price, note(s) */}
                <HStack gap="3" wrap="wrap">
                    <Text fontSize="xs" color="fg.muted">
                        Cijena: <Text as="span" fontWeight="medium" color="fg">{formatPrice(req.priceEurCents)}</Text>
                    </Text>
                    {req.contactEmail && (
                        <Text fontSize="xs" color="fg.muted" truncate>
                            Kontakt: <Text as="span" color="fg">{req.contactEmail}</Text>
                        </Text>
                    )}
                    <Text fontSize="xs" color="fg.muted">
                        Zatraženo: {formatDateTime(req.createdAt)}
                    </Text>
                </HStack>
                {req.note && (
                    <Text fontSize="xs" color="fg.muted">
                        Napomena: {req.note}
                    </Text>
                )}
                {req.adminNote && (
                    <Text fontSize="xs" color="fg.muted">
                        Napomena admina: {req.adminNote}
                    </Text>
                )}

                {/* ── REQUESTED: approve / reject ── */}
                {status === "REQUESTED" && (
                    <Stack gap="2">
                        <HStack gap="2" wrap="wrap">
                            <Button
                                size="xs"
                                variant="solid"
                                colorPalette="pitch"
                                disabled={busy != null}
                                loading={busy === "approve"}
                                onClick={approve}
                            >
                                <FiCheck /> Odobri
                            </Button>
                            <Button
                                size="xs"
                                variant="outline"
                                colorPalette="red"
                                disabled={busy != null}
                                onClick={() => setRejecting((v) => !v)}
                            >
                                <FiX /> Odbij
                            </Button>
                        </HStack>
                        {rejecting && (
                            <Stack gap="2">
                                <Textarea
                                    size="sm"
                                    rows={2}
                                    placeholder="Razlog odbijanja (nije obavezno)…"
                                    value={rejectNote}
                                    onChange={(e) => setRejectNote(e.target.value)}
                                />
                                <HStack gap="2" justify="flex-end">
                                    <Button
                                        size="xs"
                                        variant="ghost"
                                        disabled={busy != null}
                                        onClick={() => { setRejecting(false); setRejectNote("") }}
                                    >
                                        Odustani
                                    </Button>
                                    <Button
                                        size="xs"
                                        variant="solid"
                                        colorPalette="red"
                                        disabled={busy != null}
                                        loading={busy === "reject"}
                                        onClick={confirmReject}
                                    >
                                        Potvrdi odbijanje
                                    </Button>
                                </HStack>
                            </Stack>
                        )}
                    </Stack>
                )}

                {/* ── APPROVED: paid toggle + delivery ── */}
                {status === "APPROVED" && (
                    <Stack gap="2.5">
                        <HStack gap="2" wrap="wrap">
                            <Button
                                size="xs"
                                variant={req.paid ? "outline" : "solid"}
                                colorPalette={req.paid ? "gray" : "green"}
                                disabled={busy != null}
                                loading={busy === "paid"}
                                onClick={togglePaid}
                            >
                                <FiDollarSign /> {req.paid ? "Poništi plaćeno" : "Označi plaćeno"}
                            </Button>
                        </HStack>

                        {/* Delivery: link a recording already in the library */}
                        <Box
                            p="2.5"
                            bg="bg.muted"
                            rounded="md"
                            borderWidth="1px"
                            borderColor="border.subtle"
                        >
                            <Stack gap="1.5">
                                <Text fontSize="xs" color="fg.muted">
                                    POVEŽI SNIMKU IZ BAZE
                                </Text>
                                {libraryPicker()}
                            </Stack>
                        </Box>
                    </Stack>
                )}

                {/* ── DELIVERED: download link + delivery info + edit ── */}
                {status === "DELIVERED" && (
                    <Stack gap="1.5">
                        <Text fontSize="xs" color="fg.muted" truncate>
                            Povezana snimka iz baze:{" "}
                            <Text as="span" color="fg">
                                {req.recordingFileName ?? req.recordingUuid}
                                {req.recordingSizeBytes != null
                                    ? ` (${formatFileSize(req.recordingSizeBytes)})`
                                    : ""}
                            </Text>
                        </Text>
                        <HStack gap="2">
                            <Button
                                size="xs"
                                variant="outline"
                                colorPalette="pitch"
                                disabled={busy != null}
                                loading={busy === "link"}
                                onClick={copyDownloadLink}
                            >
                                <FiLink /> Poveznica
                            </Button>
                            <Button
                                size="xs"
                                variant="ghost"
                                disabled={busy != null}
                                onClick={() => setEditingRecording((v) => !v)}
                            >
                                <FiEdit2 /> {editingRecording ? "Odustani" : "Uredi snimku"}
                            </Button>
                        </HStack>
                        {editingRecording && (
                            <Box
                                p="2.5"
                                bg="bg.muted"
                                rounded="md"
                                borderWidth="1px"
                                borderColor="border.subtle"
                            >
                                <Stack gap="1.5">
                                    <Text fontSize="xs" color="fg.muted">
                                        POVEŽI DRUGU SNIMKU IZ BAZE
                                    </Text>
                                    {libraryPicker()}
                                </Stack>
                            </Box>
                        )}
                    </Stack>
                )}
            </Stack>
        </Box>
    )
}

/* ──────────────────────────── helpers ──────────────────────────── */

/** dd.mm.yyyy HH:mm, "-" for missing/unparsable values. */
function formatDateTime(iso: string | null | undefined): string {
    if (!iso) return "-"
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return String(iso)
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Cents → "20,00 €" (hr-HR formatting). */
function formatPrice(cents: number | null | undefined): string {
    if (cents == null) return "-"
    try {
        return new Intl.NumberFormat("hr-HR", {
            style: "currency",
            currency: "EUR",
        }).format(cents / 100)
    } catch {
        return `${(cents / 100).toFixed(2)} €`
    }
}

/** Human expiry for the presigned download link ("2 h" / "45 min"). */
function formatExpiry(seconds: number): string {
    if (seconds >= 3600) {
        const h = Math.round(seconds / 3600)
        return `${h} h`
    }
    return `${Math.max(1, Math.round(seconds / 60))} min`
}

/** "1,4 GB" / "230 MB" style size label for the picked file. */
function formatFileSize(bytes: number): string {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} GB`
    if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
