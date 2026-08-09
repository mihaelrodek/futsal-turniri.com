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
import { Link as RouterLink } from "react-router-dom"
import {
    FiCheck,
    FiDollarSign,
    FiDownload,
    FiEdit2,
    FiFilm,
    FiLink,
    FiMail,
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
import { t, useTranslation } from "../i18n"

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
    { value: "ALL", label: t.recordingRequest.adminRequests.allFilter },
    { value: "REQUESTED", label: t.recordingRequest.statusLabels.REQUESTED },
    { value: "APPROVED", label: t.recordingRequest.statusLabels.APPROVED },
    { value: "DELIVERED", label: t.recordingRequest.statusLabels.DELIVERED },
    { value: "REJECTED", label: t.recordingRequest.statusLabels.REJECTED },
    { value: "CANCELLED", label: t.recordingRequest.statusLabels.CANCELLED },
]

const STATUS_PALETTE: Record<RecordingRequestStatus, string> = {
    REQUESTED: "orange",
    APPROVED: "blue",
    REJECTED: "red",
    DELIVERED: "green",
    CANCELLED: "gray",
}

export function AdminRecordingRequestsTab() {
    const t = useTranslation()
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
                        {/* No card title: /admin/{slug} already names the module. */}
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
                                {t.recordingRequest.adminRequests.noneForFilter}
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
    const t = useTranslation()
    const [busy, setBusy] = useState<
        null | "approve" | "reject" | "paid" | "linkRecording" | "link"
    >(null)

    // ONE optional message, shared by both decisions - the backend stores it
    // as `adminNote` either way and the notifier embeds the same "Napomena: …"
    // paragraph in the approved and the rejected mail. Left blank, both mails
    // go out exactly as before.
    //
    // Reject additionally keeps its two-step confirm (`rejecting`): rejecting
    // is the one irreversible decision here - the request can never leave
    // REJECTED - while approving is the expected outcome and stays one click.
    const [rejecting, setRejecting] = useState(false)
    const [noteOpen, setNoteOpen] = useState(false)
    const [adminNote, setAdminNote] = useState("")

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
            await setRecordingRequestStatus(req.uuid, {
                status: "APPROVED",
                adminNote: adminNote.trim() || undefined,
            })
            setNoteOpen(false)
            setAdminNote("")
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
                adminNote: adminNote.trim() || undefined,
            })
            setRejecting(false)
            setNoteOpen(false)
            setAdminNote("")
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
                t.recordingRequest.adminRequests.copySuccess,
                t.recordingRequest.adminRequests.copySuccessDesc(formatExpiry(expiresInSeconds)),
            )
        } catch {
            /* API errors surface via the http interceptor; clipboard denial
               is the only local failure worth naming. */
            showError(t.recordingRequest.adminRequests.copyFail)
        } finally {
            setBusy(null)
        }
    }

    function libraryPicker() {
        return candidatesLoading ? (
            <HStack py="1"><Spinner size="xs" /></HStack>
        ) : !candidates || candidates.length === 0 ? (
            <Text fontSize="xs" color="fg.muted">
                {req.kind === "GOAL"
                    ? t.recordingRequest.adminRequests.noRecordingGoal
                    : t.recordingRequest.adminRequests.noRecordingMatch}
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
                            <FiFilm /> {rec.uuid === req.recordingUuid ? t.recordingRequest.adminRequests.linked : t.recordingRequest.adminRequests.link}
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
                        {/* Which goal was ordered - a snapshot taken at request
                            time, so it survives the event being edited away. */}
                        {req.kind === "GOAL" && (
                            <Text fontSize="xs" color="pitch.fg" fontWeight="medium" truncate>
                                ⚽ {req.goalLabel ?? t.recordingRequest.adminRequests.goalLabelFallback}
                            </Text>
                        )}
                    </Box>
                    <HStack gap="1.5" flexShrink={0} wrap="wrap">
                        <Badge
                            size="sm"
                            variant="outline"
                            colorPalette={req.kind === "GOAL" ? "pitch" : "gray"}
                        >
                            {req.kind === "GOAL" ? t.recordingRequest.adminRequests.goalBadge : t.recordingRequest.adminRequests.matchBadge}
                        </Badge>
                        <Badge size="sm" variant="solid" colorPalette={STATUS_PALETTE[status] ?? "gray"}>
                            {t.recordingRequest.statusLabels[status] ?? req.status}
                        </Badge>
                        {req.paid && (
                            <Badge size="sm" variant="subtle" colorPalette="green">
                                {t.recordingRequest.adminRequests.paidBadge}
                            </Badge>
                        )}
                        {req.hasVideo && (
                            <Badge size="sm" variant="subtle" colorPalette="purple">
                                {t.recordingRequest.adminRequests.videoBadge}
                            </Badge>
                        )}
                    </HStack>
                </HStack>

                {/* Meta: contact, price, note(s) */}
                <HStack gap="3" wrap="wrap">
                    <Text fontSize="xs" color="fg.muted">
                        {t.recordingRequest.adminRequests.priceLabel} <Text as="span" fontWeight="medium" color="fg">{formatPrice(req.priceEurCents)}</Text>
                    </Text>
                    {req.contactEmail && (
                        <Text fontSize="xs" color="fg.muted" truncate>
                            {t.recordingRequest.adminRequests.contactLabel} <Text as="span" color="fg">{req.contactEmail}</Text>
                        </Text>
                    )}
                    {req.contactPhone && (
                        <Text fontSize="xs" color="fg.muted" truncate>
                            {t.recordingRequest.adminRequests.contactPhoneLabel} <Text as="span" color="fg">{req.contactPhone}</Text>
                        </Text>
                    )}
                    <Text fontSize="xs" color="fg.muted">
                        {t.recordingRequest.adminRequests.requestedLabel} {formatDateTime(req.createdAt)}
                    </Text>
                </HStack>
                {req.note && (
                    <Text fontSize="xs" color="fg.muted">
                        {t.recordingRequest.adminRequests.noteLabel} {req.note}
                    </Text>
                )}
                {req.adminNote && (
                    <Text fontSize="xs" color="fg.muted">
                        {t.recordingRequest.adminRequests.adminNoteLabel} {req.adminNote}
                    </Text>
                )}
                {/* Payment reference. The status link is a capability, so the
                    payer can be someone other than the requester - show who
                    actually paid + the Stripe session id to find the charge
                    in the dashboard. Absent for manual paid toggles. */}
                {req.paid && (req.payerEmail || req.stripeSessionId) && (
                    <Text fontSize="xs" color="fg.muted" css={{ overflowWrap: "anywhere" }}>
                        {t.recordingRequest.adminRequests.paidViaStripe}
                        {req.payerEmail ? <> — {t.recordingRequest.adminRequests.paidBy} <Text as="span" color="fg">{req.payerEmail}</Text></> : null}
                        {req.stripeSessionId ? <> · {t.recordingRequest.adminRequests.refLabel} <Text as="span" fontFamily="mono">{req.stripeSessionId}</Text></> : null}
                    </Text>
                )}

                {/* Reply to whoever filed this. Shown for every status: the
                    note on a request is often a question ("može li jeftinije",
                    "koja je ovo utakmica"), and answering it is not part of
                    the approve/reject flow. Hands the address and a subject to
                    the mailer module through the URL - it is mounted without
                    props, like every admin screen. The recipient's reply comes
                    back to app.mail.reply-to, NOT to the From address (that
                    domain has no MX record). */}
                {req.contactEmail && (
                    <HStack gap="2" wrap="wrap">
                        {/* No `disabled` gate: with asChild this renders an
                            <a>, and a disabled attribute there is invalid. */}
                        <Button asChild size="xs" variant="outline" colorPalette="pitch">
                            <RouterLink to={replyMailHref(req)}>
                                <FiMail /> {t.recordingRequest.adminRequests.replyAction}
                            </RouterLink>
                        </Button>
                    </HStack>
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
                                <FiCheck /> {t.common.approve}
                            </Button>
                            <Button
                                size="xs"
                                variant="outline"
                                colorPalette="red"
                                disabled={busy != null}
                                onClick={() => setRejecting((v) => !v)}
                            >
                                <FiX /> {t.common.reject}
                            </Button>
                            {/* Opens the same box the reject flow shows. Hidden
                                while rejecting - the box is already open then. */}
                            {!rejecting && (
                                <Button
                                    size="xs"
                                    variant="ghost"
                                    disabled={busy != null}
                                    onClick={() => setNoteOpen((v) => !v)}
                                >
                                    <FiEdit2 /> {t.recordingRequest.adminRequests.addMessage}
                                </Button>
                            )}
                        </HStack>
                        {(rejecting || noteOpen) && (
                            <Stack gap="2">
                                <Textarea
                                    size="sm"
                                    rows={2}
                                    maxLength={1000}
                                    placeholder={t.recordingRequest.adminRequests.messagePlaceholder}
                                    value={adminNote}
                                    onChange={(e) => setAdminNote(e.target.value)}
                                />
                                <Text fontSize="xs" color="fg.muted">
                                    {t.recordingRequest.adminRequests.messageHint}
                                </Text>
                                {rejecting ? (
                                    <HStack gap="2" justify="flex-end">
                                        <Button
                                            size="xs"
                                            variant="ghost"
                                            disabled={busy != null}
                                            onClick={() => { setRejecting(false); setAdminNote("") }}
                                        >
                                            {t.common.cancel}
                                        </Button>
                                        <Button
                                            size="xs"
                                            variant="solid"
                                            colorPalette="red"
                                            disabled={busy != null}
                                            loading={busy === "reject"}
                                            onClick={confirmReject}
                                        >
                                            {t.recordingRequest.adminRequests.confirmReject}
                                        </Button>
                                    </HStack>
                                ) : (
                                    <HStack gap="2" justify="flex-end">
                                        <Button
                                            size="xs"
                                            variant="ghost"
                                            disabled={busy != null}
                                            onClick={() => { setNoteOpen(false); setAdminNote("") }}
                                        >
                                            {t.common.cancel}
                                        </Button>
                                    </HStack>
                                )}
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
                                <FiDollarSign /> {req.paid ? t.recordingRequest.adminRequests.unmarkPaid : t.recordingRequest.adminRequests.markPaid}
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
                                    {t.recordingRequest.adminRequests.linkFromLibraryLabel}
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
                            {t.recordingRequest.adminRequests.deliveredRecordingLabel}{" "}
                            <Text as="span" color="fg">
                                {req.recordingFileName ?? req.recordingUuid}
                                {req.recordingSizeBytes != null
                                    ? ` (${formatFileSize(req.recordingSizeBytes)})`
                                    : ""}
                            </Text>
                        </Text>
                        <HStack gap="2" wrap="wrap">
                            <Badge size="sm" variant="subtle" colorPalette={req.downloadCount > 0 ? "blue" : "gray"}>
                                <FiDownload /> {t.recordingRequest.adminRequests.downloadCountLabel(req.downloadCount)}
                            </Badge>
                            {/* Payment gates the download, so the manual paid
                                toggle (the webhook stand-in) must stay
                                available after delivery too. */}
                            <Button
                                size="xs"
                                variant={req.paid ? "outline" : "solid"}
                                colorPalette={req.paid ? "gray" : "green"}
                                disabled={busy != null}
                                loading={busy === "paid"}
                                onClick={togglePaid}
                            >
                                <FiDollarSign /> {req.paid ? t.recordingRequest.adminRequests.unmarkPaid : t.recordingRequest.adminRequests.markPaid}
                            </Button>
                            <Button
                                size="xs"
                                variant="outline"
                                colorPalette="pitch"
                                disabled={busy != null}
                                loading={busy === "link"}
                                onClick={copyDownloadLink}
                            >
                                <FiLink /> {t.recordingRequest.adminRequests.copyLink}
                            </Button>
                            <Button
                                size="xs"
                                variant="ghost"
                                disabled={busy != null}
                                onClick={() => setEditingRecording((v) => !v)}
                            >
                                <FiEdit2 /> {editingRecording ? t.common.cancel : t.recordingRequest.adminRequests.editRecording}
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
                                        {t.recordingRequest.adminRequests.linkAnotherFromLibraryLabel}
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

/**
 * Deep link into the admin mailer with the recipient and a subject already
 * filled in - see the "Odgovori" button above. The mailer reads `to` /
 * `naslov` once on mount and leaves both editable, so this is a starting
 * point, not a locked-in send.
 */
function replyMailHref(req: RecordingRequestDto): string {
    const params = new URLSearchParams({
        to: req.contactEmail ?? "",
        naslov: t.recordingRequest.adminRequests.replySubject(
            `${req.team1Name} — ${req.team2Name}`,
        ),
    })
    return `/admin/posalji-mail?${params.toString()}`
}

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
