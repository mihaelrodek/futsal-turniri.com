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
import { FiDownload, FiPlus, FiVideo, FiX } from "react-icons/fi"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
    deleteRecordingRequest,
    fetchRecordingDownloadLink,
    listMyRecordingRequests,
    GOAL_CLIP_REQUESTS_ENABLED,
    type RecordingRequestDto,
    type RecordingRequestStatus,
} from "../api/recordingRequests"
import { fetchTournaments } from "../api/tournaments"
import { fetchSchedule } from "../api/schedule"
import { fetchMatchEvents } from "../api/matchEvents"
import type { MatchEventDto } from "../types/matchEvents"
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

/** Only scored goals can be clipped - cards and missed penalties can't. */
function isGoalEvent(e: MatchEventDto): boolean {
    return e.type === "GOAL" || e.type === "OWN_GOAL" || e.type === "PENALTY_GOAL"
}

/** "12' — M. Rodek" label for the goal picker, mirroring the match timeline. */
function goalOptionLabel(e: MatchEventDto): string {
    const who =
        e.type === "OWN_GOAL"
            ? e.playerName
                ? `${e.playerName} (ag)`
                : "autogol"
            : e.playerName ?? "nepoznat strijelac"
    const when = e.type === "PENALTY_GOAL" ? "Penali" : `${e.minute}'`
    return `${when} — ${who}`
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
    // Whole match (20 €) or one goal of it (5 €); the goal is picked below.
    const [pickedKind, setPickedKind] = useState<"FULL_MATCH" | "GOAL">("FULL_MATCH")
    const [pickedGoalId, setPickedGoalId] = useState<number | null>(null)
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

    // Only matches with both teams known can be requested meaningfully. A whole
    // match may be ordered upfront (any status); a goal clip only off a FINISHED
    // match - while it's live an event can still be corrected or deleted, so the
    // ordered goal wouldn't be stable. The backend enforces the same rule.
    const pickableMatches = useMemo(
        () =>
            (schedule?.matches ?? []).filter(
                (m) =>
                    m.team1Name &&
                    m.team2Name &&
                    (pickedKind === "FULL_MATCH" || m.status === "FINISHED"),
            ),
        [schedule, pickedKind],
    )
    const pickedMatch = pickableMatches.find((m) => m.matchId === pickedMatchId) ?? null

    // Goals of the picked match - only needed once the user switches the picker
    // to "snimka gola", so the fetch is gated on that.
    const { data: goals, isLoading: goalsLoading } = useQuery({
        queryKey: ["recordingRequests", "pickerGoals", tournamentUuid, pickedMatchId] as const,
        queryFn: async () => {
            const all = await fetchMatchEvents(tournamentUuid, pickedMatchId!)
            return all.filter(isGoalEvent)
        },
        enabled: pickerOpen && pickedKind === "GOAL" && !!tournamentUuid && pickedMatchId != null,
    })
    const pickedGoal = (goals ?? []).find((g) => g.id === pickedGoalId) ?? null

    /** Collapse the whole picker back to its initial state. */
    function resetPicker() {
        setTournamentUuid("")
        setPickedMatchId(null)
        setPickedKind("FULL_MATCH")
        setPickedGoalId(null)
    }

    // ── Per-row actions ─────────────────────────────────────────────────
    const [busyUuid, setBusyUuid] = useState<string | null>(null)

    async function onCancel(r: RecordingRequestDto) {
        const what = r.kind === "GOAL" ? "gola" : "ove utakmice"
        if (!confirm(`Otkazati zahtjev za snimku ${what}?`)) return
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
            if (isAxiosError(err) && err.response?.status === 409) {
                showError("Snimka još nije dostupna", "Pokušaj ponovno malo kasnije.")
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
                                {GOAL_CLIP_REQUESTS_ENABLED
                                    ? "Zahtjevi za video snimke — 20 € cijela utakmica, 5 € pojedini gol."
                                    : "Zahtjevi za video snimke utakmica — 20 € po utakmici."}
                            </Text>
                        </Box>
                        <Button
                            size="xs"
                            variant={pickerOpen ? "outline" : "solid"}
                            colorPalette="pitch"
                            onClick={() => {
                                setPickerOpen((v) => !v)
                                resetPicker()
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

                                {/* What is being ordered. Switching to "gol"
                                    only reveals the goal list; the match stays
                                    picked so toggling back and forth is free.
                                    Hidden entirely while goal clips are off -
                                    then the picker is whole-match only, exactly
                                    as before the feature existed. */}
                                {GOAL_CLIP_REQUESTS_ENABLED && (
                                    <HStack gap="1.5" wrap="wrap">
                                        <Button
                                            size="2xs"
                                            variant={pickedKind === "FULL_MATCH" ? "solid" : "outline"}
                                            colorPalette={pickedKind === "FULL_MATCH" ? "pitch" : "gray"}
                                            onClick={() => {
                                                setPickedKind("FULL_MATCH")
                                                setPickedGoalId(null)
                                            }}
                                        >
                                            Cijela utakmica · 20 €
                                        </Button>
                                        <Button
                                            size="2xs"
                                            variant={pickedKind === "GOAL" ? "solid" : "outline"}
                                            colorPalette={pickedKind === "GOAL" ? "pitch" : "gray"}
                                            onClick={() => {
                                                setPickedKind("GOAL")
                                                // The match list narrows to FINISHED
                                                // ones - drop a pick that just fell
                                                // out of it.
                                                if (pickedMatch && pickedMatch.status !== "FINISHED") {
                                                    setPickedMatchId(null)
                                                }
                                            }}
                                        >
                                            Pojedini gol · 5 €
                                        </Button>
                                    </HStack>
                                )}

                                {pickedKind === "GOAL" && (
                                    <Text fontSize="xs" color="fg.muted">
                                        Snimku pojedinog gola možeš zatražiti samo za završene
                                        utakmice. Snimku cijele utakmice možeš zatražiti i unaprijed.
                                    </Text>
                                )}

                                {tournamentUuid && (
                                    scheduleLoading ? (
                                        <HStack gap="2" color="fg.muted">
                                            <Spinner size="xs" />
                                            <Text fontSize="sm">Učitavanje utakmica…</Text>
                                        </HStack>
                                    ) : pickableMatches.length === 0 ? (
                                        <Text fontSize="sm" color="fg.muted">
                                            {pickedKind === "GOAL"
                                                ? "Ovaj turnir još nema odigranih utakmica."
                                                : "Ovaj turnir još nema utakmica s poznatim ekipama."}
                                        </Text>
                                    ) : (
                                        <NativeSelect.Root size="sm">
                                            <NativeSelect.Field
                                                value={pickedMatchId == null ? "" : String(pickedMatchId)}
                                                onChange={(e) => {
                                                    const v = (e.target as HTMLSelectElement).value
                                                    setPickedMatchId(v ? Number(v) : null)
                                                    // A goal belongs to one match only.
                                                    setPickedGoalId(null)
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

                                {/* Goal picker - only for a 5 € single-goal clip. */}
                                {pickedKind === "GOAL" && pickedMatchId != null && (
                                    goalsLoading ? (
                                        <HStack gap="2" color="fg.muted">
                                            <Spinner size="xs" />
                                            <Text fontSize="sm">Učitavanje golova…</Text>
                                        </HStack>
                                    ) : (goals ?? []).length === 0 ? (
                                        <Text fontSize="sm" color="fg.muted">
                                            Na ovoj utakmici nema zabilježenih golova.
                                        </Text>
                                    ) : (
                                        <NativeSelect.Root size="sm">
                                            <NativeSelect.Field
                                                value={pickedGoalId == null ? "" : String(pickedGoalId)}
                                                onChange={(e) => {
                                                    const v = (e.target as HTMLSelectElement).value
                                                    setPickedGoalId(v ? Number(v) : null)
                                                }}
                                            >
                                                <option value="">Odaberi gol…</option>
                                                {(goals ?? []).map((g) => (
                                                    <option key={g.id} value={String(g.id)}>
                                                        {goalOptionLabel(g)}
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
                                    disabled={
                                        pickedMatchId == null ||
                                        (pickedKind === "GOAL" && pickedGoalId == null)
                                    }
                                    onClick={() => setDialogOpen(true)}
                                >
                                    <FiVideo />{" "}
                                    {pickedKind === "GOAL" ? "Zatraži snimku gola" : "Zatraži snimku"}
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
                        resetPicker()
                    }}
                    matchId={pickedMatchId}
                    team1Name={pickedMatch?.team1Name ?? null}
                    team2Name={pickedMatch?.team2Name ?? null}
                    kind={pickedKind}
                    matchEventId={pickedGoalId}
                    goalLabel={pickedGoal ? goalOptionLabel(pickedGoal) : null}
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
}: {
    r: RecordingRequestDto
    busy: boolean
    onCancel: () => void
    onDownload: () => void
}) {
    const meta = STATUS_META[r.status] ?? { label: r.status, palette: "gray" }
    const kickoff = formatKickoff(r.kickoffAt)
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
                    {r.kind === "GOAL" && (
                        <Text fontSize="xs" color="pitch.fg" fontWeight={600} truncate maxW="full">
                            ⚽ {r.goalLabel ?? "gol"}
                        </Text>
                    )}
                    {r.adminNote && (
                        <Text fontSize="xs" color="fg.muted">
                            Napomena: <chakra.span fontStyle="italic">{r.adminNote}</chakra.span>
                        </Text>
                    )}
                </VStack>
                <VStack align="end" gap="1" flexShrink={0}>
                    <HStack gap="1">
                        <Badge
                            variant="outline"
                            colorPalette={r.kind === "GOAL" ? "pitch" : "gray"}
                            size="sm"
                        >
                            {r.kind === "GOAL" ? "Gol" : "Utakmica"}
                        </Badge>
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

            {(r.status === "REQUESTED" || r.status === "DELIVERED") && (
                <HStack justify="flex-end" mt="1.5" gap="2">
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
                    {r.status === "DELIVERED" && (
                        <Button
                            size="2xs"
                            variant="solid"
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
