import { useMemo, useState } from "react"
import { isAxiosError } from "axios"
import {
    Badge,
    Box,
    Button,
    Card,
    chakra,
    Heading,
    HStack,
    NativeSelect,
    Spinner,
    Text,
    VStack,
} from "@chakra-ui/react"
import { FiCreditCard, FiDownload, FiPlus, FiVideo, FiX } from "react-icons/fi"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
    createRecordingCheckout,
    deleteRecordingRequest,
    fetchRecordingDownloadLink,
    listMyRecordingRequests,
    type RecordingRequestDto,
    type RecordingRequestStatus,
} from "../api/recordingRequests"
import { fetchTournaments } from "../api/tournaments"
import { fetchSchedule } from "../api/schedule"
import { qk } from "../queryClient"
import { showError } from "../toaster"
import RecordingRequestDialog from "./RecordingRequestDialog"

/* ──────────────────────────────────────────────────────────────────────────
   "Moje snimke" profile tab - every recording request of the signed-in
   user: match, status badge, price, admin note, plus per-status actions
   (cancel while REQUESTED, download once DELIVERED). Also hosts the
   "Novi zahtjev" flow: pick a tournament → pick a match → the shared
   RecordingRequestDialog files the request.
   ────────────────────────────────────────────────────────────────────── */

const STATUS_META: Record<RecordingRequestStatus, { label: string; palette: "yellow" | "blue" | "red" | "green" | "gray" }> = {
    REQUESTED: { label: "Zatraženo", palette: "yellow" },
    APPROVED: { label: "Odobreno", palette: "blue" },
    REJECTED: { label: "Odbijeno", palette: "red" },
    DELIVERED: { label: "Isporučeno", palette: "green" },
    CANCELLED: { label: "Otkazano", palette: "gray" },
}

function formatKickoff(iso: string | null | undefined): string {
    if (!iso) return ""
    try {
        return new Date(iso).toLocaleString("hr-HR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        })
    } catch {
        return ""
    }
}

function formatPrice(cents: number | null | undefined): string {
    if (cents == null) return ""
    const eur = cents / 100
    return `${Number.isInteger(eur) ? eur : eur.toFixed(2).replace(".", ",")} €`
}

/** Pull `{"code": "..."}` out of a 409 response body, if present. */
function errorCode(err: unknown): string | undefined {
    if (!isAxiosError(err) || err.response?.status !== 409) return undefined
    const data = err.response.data as { code?: string } | undefined
    return data?.code
}

export default function MyRecordingsTab() {
    const queryClient = useQueryClient()

    const { data: requests, isLoading } = useQuery({
        queryKey: qk.myRecordingRequests,
        queryFn: listMyRecordingRequests,
    })

    // ── "Novi zahtjev" picker state ─────────────────────────────────────
    const [pickerOpen, setPickerOpen] = useState(false)
    const [tournamentUuid, setTournamentUuid] = useState("")
    const [pickedMatchId, setPickedMatchId] = useState<number | null>(null)
    const [dialogOpen, setDialogOpen] = useState(false)

    // Both status buckets merged - a recording usually concerns a started or
    // finished tournament, but upcoming ones with played matches count too.
    const { data: tournaments } = useQuery({
        queryKey: ["recordingRequests", "pickerTournaments"] as const,
        queryFn: async () => {
            const [upcoming, finished] = await Promise.all([
                fetchTournaments("upcoming"),
                fetchTournaments("finished"),
            ])
            return [...upcoming, ...finished]
        },
        enabled: pickerOpen,
    })

    const { data: schedule, isLoading: scheduleLoading } = useQuery({
        queryKey: qk.schedule(tournamentUuid),
        queryFn: () => fetchSchedule(tournamentUuid),
        enabled: pickerOpen && !!tournamentUuid,
    })

    // Only matches with both teams known can be requested meaningfully.
    const pickableMatches = useMemo(
        () => (schedule?.matches ?? []).filter((m) => m.team1Name && m.team2Name),
        [schedule],
    )
    const pickedMatch = pickableMatches.find((m) => m.matchId === pickedMatchId) ?? null

    // ── Per-row actions ─────────────────────────────────────────────────
    const [busyUuid, setBusyUuid] = useState<string | null>(null)

    async function onCancel(r: RecordingRequestDto) {
        if (!confirm("Otkazati zahtjev za snimku ove utakmice?")) return
        try {
            setBusyUuid(r.uuid)
            await deleteRecordingRequest(r.uuid)
            queryClient.invalidateQueries({ queryKey: qk.myRecordingRequests })
        } catch {
            /* toast surfaced by the interceptor */
        } finally {
            setBusyUuid(null)
        }
    }

    async function onDownload(r: RecordingRequestDto) {
        // Fresh link on EVERY click - the presigned URL is short-lived, so a
        // cached one from an earlier click could already be expired.
        try {
            setBusyUuid(r.uuid)
            const { url } = await fetchRecordingDownloadLink(r.uuid)
            window.open(url, "_blank")
        } catch (err) {
            const code = errorCode(err)
            if (code === "NOT_PAID") {
                showError("Snimka još nije plaćena", "Plati snimku prije preuzimanja.")
            } else if (isAxiosError(err) && err.response?.status === 409) {
                showError("Snimka još nije dostupna", "Pokušaj ponovno malo kasnije.")
            }
            /* other errors toasted by the interceptor */
        } finally {
            setBusyUuid(null)
        }
    }

    async function onCheckout(r: RecordingRequestDto) {
        try {
            setBusyUuid(r.uuid)
            const { url } = await createRecordingCheckout(r.uuid)
            window.location.href = url
        } catch (err) {
            const code = errorCode(err)
            if (code === "NOT_CONFIGURED") {
                showError("Plaćanje trenutno nije dostupno", "Pokušaj ponovno za koji trenutak.")
            } else if (code === "ALREADY_PAID") {
                showError("Snimka je već plaćena")
                queryClient.invalidateQueries({ queryKey: qk.myRecordingRequests })
            } else if (code === "NOT_APPROVED") {
                showError("Zahtjev još nije odobren")
            }
            /* other errors toasted by the interceptor */
        } finally {
            setBusyUuid(null)
        }
    }

    return (
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Body p={{ base: "4", md: "5" }}>
                <VStack align="stretch" gap="3">
                    <HStack justify="space-between" wrap="wrap" gap="2">
                        <Box>
                            <Heading size="sm">Moje snimke</Heading>
                            <Text fontSize="xs" color="fg.muted">
                                Zahtjevi za video snimke utakmica — 20 € po utakmici.
                            </Text>
                            <Text fontSize="xs" color="fg.muted">
                                Nakon odobrenja plaćaš karticom, zatim preuzimaš snimku.
                            </Text>
                        </Box>
                        <Button
                            size="xs"
                            variant={pickerOpen ? "outline" : "solid"}
                            colorPalette="pitch"
                            onClick={() => {
                                setPickerOpen((v) => !v)
                                setTournamentUuid("")
                                setPickedMatchId(null)
                            }}
                        >
                            {pickerOpen ? <FiX /> : <FiPlus />}
                            {pickerOpen ? "Zatvori" : "Novi zahtjev"}
                        </Button>
                    </HStack>

                    {/* ── New request: tournament → match picker ───────── */}
                    {pickerOpen && (
                        <Box
                            borderWidth="1px"
                            borderColor="border.emphasized"
                            bg="bg.subtle"
                            rounded="md"
                            p="3"
                        >
                            <VStack align="stretch" gap="2.5">
                                <NativeSelect.Root size="sm">
                                    <NativeSelect.Field
                                        value={tournamentUuid}
                                        onChange={(e) => {
                                            setTournamentUuid((e.target as HTMLSelectElement).value)
                                            setPickedMatchId(null)
                                        }}
                                    >
                                        <option value="">Odaberi turnir…</option>
                                        {(tournaments ?? []).map((t) => (
                                            <option key={t.uuid} value={t.uuid}>
                                                {t.name}
                                            </option>
                                        ))}
                                    </NativeSelect.Field>
                                </NativeSelect.Root>

                                {tournamentUuid && (
                                    scheduleLoading ? (
                                        <HStack gap="2" color="fg.muted">
                                            <Spinner size="xs" />
                                            <Text fontSize="sm">Učitavanje utakmica…</Text>
                                        </HStack>
                                    ) : pickableMatches.length === 0 ? (
                                        <Text fontSize="sm" color="fg.muted">
                                            Ovaj turnir još nema utakmica s poznatim ekipama.
                                        </Text>
                                    ) : (
                                        <NativeSelect.Root size="sm">
                                            <NativeSelect.Field
                                                value={pickedMatchId == null ? "" : String(pickedMatchId)}
                                                onChange={(e) => {
                                                    const v = (e.target as HTMLSelectElement).value
                                                    setPickedMatchId(v ? Number(v) : null)
                                                }}
                                            >
                                                <option value="">Odaberi utakmicu…</option>
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

                                <Button
                                    size="sm"
                                    variant="solid"
                                    colorPalette="pitch"
                                    alignSelf="flex-start"
                                    disabled={pickedMatchId == null}
                                    onClick={() => setDialogOpen(true)}
                                >
                                    <FiVideo /> Zatraži snimku
                                </Button>
                            </VStack>
                        </Box>
                    )}

                    {/* ── Requests list ────────────────────────────────── */}
                    {isLoading ? (
                        <HStack gap="2" color="fg.muted" py="4">
                            <Spinner size="xs" />
                            <Text fontSize="sm">Učitavanje…</Text>
                        </HStack>
                    ) : !requests || requests.length === 0 ? (
                        <Box
                            borderWidth="1px"
                            borderColor="border.emphasized"
                            borderStyle="dashed"
                            rounded="md"
                            py="6"
                            px="4"
                            textAlign="center"
                        >
                            <Text color="fg.muted" fontSize="sm">
                                Još nemaš zahtjeva za snimke. Snimku možeš zatražiti sa stranice
                                utakmice ili gumbom „Novi zahtjev“.
                            </Text>
                        </Box>
                    ) : (
                        <VStack align="stretch" gap="2">
                            {requests.map((r) => (
                                <RequestRow
                                    key={r.uuid}
                                    r={r}
                                    busy={busyUuid === r.uuid}
                                    onCancel={() => onCancel(r)}
                                    onDownload={() => onDownload(r)}
                                    onCheckout={() => onCheckout(r)}
                                />
                            ))}
                        </VStack>
                    )}
                </VStack>
            </Card.Body>

            {pickedMatchId != null && (
                <RecordingRequestDialog
                    open={dialogOpen}
                    onClose={() => {
                        setDialogOpen(false)
                        // Collapse the picker after a filed request so the fresh
                        // row (invalidated by the dialog) is front and centre.
                        setPickerOpen(false)
                        setTournamentUuid("")
                        setPickedMatchId(null)
                    }}
                    matchId={pickedMatchId}
                    team1Name={pickedMatch?.team1Name ?? null}
                    team2Name={pickedMatch?.team2Name ?? null}
                />
            )}
        </Card.Root>
    )
}

function RequestRow({
    r,
    busy,
    onCancel,
    onDownload,
    onCheckout,
}: {
    r: RecordingRequestDto
    busy: boolean
    onCancel: () => void
    onDownload: () => void
    onCheckout: () => void
}) {
    const meta = STATUS_META[r.status] ?? { label: r.status, palette: "gray" }
    const kickoff = formatKickoff(r.kickoffAt)
    // Payment is due whenever a request has moved past REQUESTED but hasn't
    // been paid yet - the normal APPROVED-then-pay step, plus a
    // DELIVERED-before-paid edge (video linked ahead of payment), in which
    // case the download button below stays visible but 409s with NOT_PAID.
    const paymentDue = !r.paid && (r.status === "APPROVED" || r.status === "DELIVERED")
    const showActions = r.status === "REQUESTED" || r.status === "DELIVERED" || paymentDue
    return (
        <Box
            borderWidth="1px"
            borderColor="border.emphasized"
            rounded="md"
            shadow="sm"
            p="2.5"
        >
            <HStack justify="space-between" gap="2" wrap="wrap" align="start">
                <VStack align="start" gap="0.5" flex="1" minW="0">
                    <Text fontSize="sm" fontWeight={600} lineHeight="short">
                        {r.team1Name ?? "?"} — {r.team2Name ?? "?"}
                    </Text>
                    <Text fontSize="xs" color="fg.muted" truncate maxW="full">
                        {r.tournamentName}
                        {kickoff ? ` · ${kickoff}` : ""}
                    </Text>
                    {r.adminNote && (
                        <Text fontSize="xs" color="fg.muted">
                            Napomena: <chakra.span fontStyle="italic">{r.adminNote}</chakra.span>
                        </Text>
                    )}
                </VStack>
                <VStack align="end" gap="1" flexShrink={0}>
                    <HStack gap="1">
                        {r.paid && (
                            <Badge variant="subtle" colorPalette="green" size="sm">
                                Plaćeno
                            </Badge>
                        )}
                        <Badge variant="solid" colorPalette={meta.palette} size="sm">
                            {meta.label}
                        </Badge>
                    </HStack>
                    <Text fontSize="xs" fontFamily="mono" fontWeight={700} color="fg.muted">
                        {formatPrice(r.priceEurCents)}
                    </Text>
                </VStack>
            </HStack>

            {showActions && (
                <HStack justify="flex-end" mt="1.5" gap="2" wrap="wrap">
                    {r.status === "REQUESTED" && (
                        <Button
                            size="2xs"
                            variant="ghost"
                            colorPalette="red"
                            loading={busy}
                            onClick={onCancel}
                        >
                            <FiX /> Otkaži
                        </Button>
                    )}
                    {paymentDue && (
                        <Button
                            size="2xs"
                            variant="solid"
                            colorPalette="pitch"
                            loading={busy}
                            onClick={onCheckout}
                        >
                            <FiCreditCard /> Plati snimku
                        </Button>
                    )}
                    {r.status === "DELIVERED" && (
                        <Button
                            size="2xs"
                            variant={paymentDue ? "outline" : "solid"}
                            colorPalette="pitch"
                            loading={busy}
                            onClick={onDownload}
                        >
                            <FiDownload /> Preuzmi snimku
                        </Button>
                    )}
                </HStack>
            )}
        </Box>
    )
}
