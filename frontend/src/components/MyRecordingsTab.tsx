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
import { t, useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   "Moje snimke" profile tab - every recording request of the signed-in
   user: match, status badge, price, admin note, plus per-status actions
   (cancel while REQUESTED, download once DELIVERED). Also hosts the
   "Novi zahtjev" flow: pick a tournament → pick a match → the shared
   RecordingRequestDialog files the request.
   ────────────────────────────────────────────────────────────────────── */

const STATUS_PALETTE: Record<RecordingRequestStatus, "yellow" | "blue" | "red" | "green" | "gray"> = {
    REQUESTED: "yellow",
    APPROVED: "blue",
    REJECTED: "red",
    DELIVERED: "green",
    CANCELLED: "gray",
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
                : t.matchLive.ownGoal
            : e.playerName ?? t.matchLive.unknownScorer
    const when = e.type === "PENALTY_GOAL" ? t.matchLive.penaltiesShort : `${e.minute}'`
    return `${when} — ${who}`
}

export default function MyRecordingsTab() {
    const t = useTranslation()
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
        const what = r.kind === "GOAL" ? t.recordingRequest.mine.cancelWhatGoal : t.recordingRequest.mine.cancelWhatMatch
        if (!confirm(t.recordingRequest.mine.confirmCancel(what))) return
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
                showError(t.recordingRequest.mine.downloadErrorNotPaidTitle, t.recordingRequest.mine.downloadErrorNotPaidDesc)
            } else if (isAxiosError(err) && err.response?.status === 409) {
                showError(t.recordingRequest.mine.downloadErrorGenericTitle, t.recordingRequest.mine.downloadErrorGenericDesc)
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
                showError(t.recordingRequest.mine.checkoutErrorNotConfiguredTitle, t.recordingRequest.mine.checkoutErrorNotConfiguredDesc)
            } else if (code === "ALREADY_PAID") {
                showError(t.recordingRequest.mine.checkoutErrorAlreadyPaidTitle)
                queryClient.invalidateQueries({ queryKey: qk.myRecordingRequests })
            } else if (code === "NOT_APPROVED") {
                showError(t.recordingRequest.mine.checkoutErrorNotApprovedTitle)
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
                            <Heading size="sm">{t.recordingRequest.mine.title}</Heading>
                            <Text fontSize="xs" color="fg.muted">
                                {GOAL_CLIP_REQUESTS_ENABLED
                                    ? t.recordingRequest.mine.subtitleWithGoals
                                    : t.recordingRequest.mine.subtitleMatchOnly}
                            </Text>
                            <Text fontSize="xs" color="fg.muted">
                                {t.recordingRequest.mine.subtitleFlow}
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
                            {pickerOpen ? t.common.close : t.recordingRequest.mine.newRequest}
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
                                        <option value="">{t.recordingRequest.mine.pickTournament}</option>
                                        {(tournaments ?? []).map((tn) => (
                                            <option key={tn.uuid} value={tn.uuid}>
                                                {tn.name}
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
                                            {t.recordingRequest.mine.fullMatchOption}
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
                                            {t.recordingRequest.mine.goalOption}
                                        </Button>
                                    </HStack>
                                )}

                                {pickedKind === "GOAL" && (
                                    <Text fontSize="xs" color="fg.muted">
                                        {t.recordingRequest.mine.goalOnlyFinishedNote}
                                    </Text>
                                )}

                                {tournamentUuid && (
                                    scheduleLoading ? (
                                        <HStack gap="2" color="fg.muted">
                                            <Spinner size="xs" />
                                            <Text fontSize="sm">{t.recordingRequest.mine.loadingMatches}</Text>
                                        </HStack>
                                    ) : pickableMatches.length === 0 ? (
                                        <Text fontSize="sm" color="fg.muted">
                                            {pickedKind === "GOAL"
                                                ? t.recordingRequest.mine.noMatchesGoal
                                                : t.recordingRequest.mine.noMatchesTeams}
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
                                                <option value="">{t.recordingRequest.mine.pickMatch}</option>
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
                                            <Text fontSize="sm">{t.recordingRequest.mine.loadingGoals}</Text>
                                        </HStack>
                                    ) : (goals ?? []).length === 0 ? (
                                        <Text fontSize="sm" color="fg.muted">
                                            {t.recordingRequest.mine.noGoals}
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
                                                <option value="">{t.recordingRequest.mine.pickGoal}</option>
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
                                    {pickedKind === "GOAL" ? t.recordingRequest.mine.requestGoalCta : t.recordingRequest.mine.requestMatchCta}
                                </Button>
                            </VStack>
                        </Box>
                    )}

                    {/* ── Requests list ────────────────────────────────── */}
                    {isLoading ? (
                        <HStack gap="2" color="fg.muted" py="4">
                            <Spinner size="xs" />
                            <Text fontSize="sm">{t.common.loading}</Text>
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
                                {t.recordingRequest.mine.emptyState}
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
    onCheckout,
}: {
    r: RecordingRequestDto
    busy: boolean
    onCancel: () => void
    onDownload: () => void
    onCheckout: () => void
}) {
    const t = useTranslation()
    const statusLabel = t.recordingRequest.statusLabels[r.status] ?? r.status
    const statusPalette = STATUS_PALETTE[r.status] ?? "gray"
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
                    {r.kind === "GOAL" && (
                        <Text fontSize="xs" color="pitch.fg" fontWeight={600} truncate maxW="full">
                            ⚽ {r.goalLabel ?? t.recordingRequest.adminRequests.goalLabelFallback}
                        </Text>
                    )}
                    {r.adminNote && (
                        <Text fontSize="xs" color="fg.muted">
                            {t.recordingRequest.mine.noteLabel} <chakra.span fontStyle="italic">{r.adminNote}</chakra.span>
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
                            {r.kind === "GOAL" ? t.recordingRequest.mine.goalBadge : t.recordingRequest.mine.matchBadge}
                        </Badge>
                        {r.paid && (
                            <Badge variant="subtle" colorPalette="green" size="sm">
                                {t.recordingRequest.mine.paidBadge}
                            </Badge>
                        )}
                        <Badge variant="solid" colorPalette={statusPalette} size="sm">
                            {statusLabel}
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
                            <FiX /> {t.recordingRequest.mine.cancelButton}
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
                            <FiCreditCard /> {t.recordingRequest.mine.payButton}
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
                            <FiDownload /> {t.recordingRequest.mine.downloadButton}
                        </Button>
                    )}
                </HStack>
            )}
        </Box>
    )
}
