import { useEffect, useState } from "react"
import {
    Badge,
    Box,
    Button,
    Dialog,
    Flex,
    HStack,
    IconButton,
    Input,
    NativeSelect,
    Portal,
    Text,
    VStack,
} from "@chakra-ui/react"
import { LuShuffle } from "react-icons/lu"
import { FiTrash2 } from "react-icons/fi"
import { fetchGroups, drawGroups, recordGroupResult } from "../api/groups"
import type { Group, GroupMatch } from "../types/groups"
import { fetchPlayers } from "../api/players"
import type { PlayerDto } from "../types/players"
import {
    addMatchEvent,
    deleteMatchEvent,
    fetchMatchEvents,
    finishMatch,
    startMatch,
    startSecondHalf,
} from "../api/matchEvents"
import type {
    MatchEventDto,
    MatchEventType,
    MatchLiveMode,
} from "../types/matchEvents"
import { fetchSchedule } from "../api/schedule"
import { EmptyState, Loader, Panel } from "../ui/primitives"
import { GhostButton } from "../ui/pitch"
import { FiRefreshCw } from "react-icons/fi"
import { LiveClock, StartLivePopover, elapsedMinutes, matchPhase } from "./liveMatch"

/**
 * "Grupe" tab on the tournament detail page (Phase E2 + E5).
 *
 * Before the draw: an empty state with a button to run the automatic draw.
 * After the draw: one card per group — the live standings table (top
 * {@code advancePerGroup} rows highlighted as advancing) plus the group's
 * fixtures with inline result entry. Standings recompute on every save.
 *
 * Each fixture also supports a LIVE mode: the organizer starts a match
 * (SCHEDULED -> LIVE) picking TIMER or SIMPLE tracking, records goals and
 * cards from each team's roster, and finishes it (LIVE -> FINISHED).
 *
 * NOTE: draw / result / live entry are shown unconditionally for now because
 * Firebase auth is temporarily disabled project-wide.
 */
type EditForm = { s1: string; s2: string }

export default function GroupsTab({
    uuid,
    advancePerGroup,
    canEdit = false,
    tournamentStarted = false,
}: {
    uuid: string
    advancePerGroup?: number | null
    /** Owner / admin only — controls visibility of the draw button and
     *  every match-row edit / live action. Read-only by default. */
    canEdit?: boolean
    /** Set once any match goes LIVE / FINISHED. While true, "Ponovi
     *  ždrijeb" is hidden because re-drawing groups mid-tournament
     *  would wipe real played results. */
    tournamentStarted?: boolean
}) {
    const [groups, setGroups] = useState<Group[] | null>(null)
    const [loading, setLoading] = useState(true)
    const [drawing, setDrawing] = useState(false)
    const [editingId, setEditingId] = useState<number | null>(null)
    const [form, setForm] = useState<EditForm>({ s1: "", s2: "" })
    const [saving, setSaving] = useState(false)
    /** matchId of the row whose "start live" call is in flight. */
    const [startingId, setStartingId] = useState<number | null>(null)
    /** The match currently open in the live dialog, or null. */
    const [liveMatch, setLiveMatch] = useState<GroupMatch | null>(null)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        fetchGroups(uuid)
            .then((g) => { if (!cancelled) setGroups(g) })
            .catch(() => { if (!cancelled) setGroups([]) })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [uuid])

    /** Re-fetch the groups (after a live action changed the score / status). */
    async function reloadGroups() {
        try {
            setGroups(await fetchGroups(uuid))
        } catch {
            /* error toast surfaced by the http interceptor */
        }
    }

    async function runAutoDraw() {
        setDrawing(true)
        try {
            setGroups(await drawGroups(uuid, { mode: "AUTO" }))
            setEditingId(null)
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setDrawing(false)
        }
    }

    function startEdit(m: GroupMatch) {
        setEditingId(m.matchId)
        setForm({
            s1: m.score1 != null ? String(m.score1) : "",
            s2: m.score2 != null ? String(m.score2) : "",
        })
    }

    async function saveResult(m: GroupMatch) {
        const s1 = parseInt(form.s1, 10)
        const s2 = parseInt(form.s2, 10)
        if (!Number.isFinite(s1) || !Number.isFinite(s2)) return
        setSaving(true)
        try {
            setGroups(await recordGroupResult(uuid, m.matchId, s1, s2))
            setEditingId(null)
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setSaving(false)
        }
    }

    /** SCHEDULED -> LIVE with the chosen tracking mode, then open the dialog. */
    async function handleStartLive(m: GroupMatch, mode: MatchLiveMode) {
        setStartingId(m.matchId)
        try {
            await startMatch(uuid, m.matchId, mode)
            await reloadGroups()
            setLiveMatch({
                ...m,
                status: "LIVE",
                liveMode: mode,
                liveStartedAt: new Date().toISOString(),
                secondHalfStartedAt: null,
            })
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setStartingId(null)
        }
    }

    if (loading) {
        return <Loader />
    }

    const hasGroups = groups != null && groups.length > 0

    if (!hasGroups) {
        return (
            <Panel>
                <EmptyState
                    icon={LuShuffle}
                    title="Grupe još nisu izvučene"
                    description={
                        canEdit
                            ? "Pokreni ždrijeb da rasporediš prijavljene ekipe u grupe i generiraš raspored utakmica."
                            : "Organizator još nije izvukao grupe."
                    }
                    action={
                        canEdit ? (
                            <Button
                                colorPalette="brand"
                                onClick={runAutoDraw}
                                loading={drawing}
                            >
                                Pokreni ždrijeb (automatski)
                            </Button>
                        ) : undefined
                    }
                />
            </Panel>
        )
    }

    const renderFixture = (m: GroupMatch) => {
        const editable = m.team1Id != null && m.team2Id != null
        const editing = editingId === m.matchId
        const isFinished = m.status === "FINISHED"
        const isLive = m.status === "LIVE"
        const isScheduled = m.status === "SCHEDULED"
        return (
            <Box
                key={m.matchId}
                borderWidth="1px"
                borderColor={isLive ? "red.emphasized" : "border"}
                rounded="xl"
                px={{ base: "3", md: "4" }}
                py="3"
                bg="bg.panel"
            >
                <Flex align="center" justify="space-between" gap="3" wrap="wrap">
                    <HStack flex="1" minW="0" gap="2">
                        <Text fontSize="sm">
                            {m.team1Name ?? "—"} – {m.team2Name ?? "—"}
                        </Text>
                        {isLive && <LivePill />}
                        {isLive && m.liveMode === "TIMER" && (
                            <LiveClock liveStartedAt={m.liveStartedAt} />
                        )}
                    </HStack>
                    <HStack gap="2" flexShrink={0} wrap="wrap" justify="flex-end">
                        {!editing && m.score1 != null && m.score2 != null && (
                            <Text
                                fontSize="sm"
                                fontWeight="bold"
                                fontVariantNumeric="tabular-nums"
                                color={isLive ? "red.fg" : "fg"}
                            >
                                {m.score1}:{m.score2}
                            </Text>
                        )}
                        {/* All match controls (Pokreni / Uživo / Tijek /
                             Rezultat) are owner-only. Viewers see just
                             the team names + score + live badge. */}
                        {canEdit && !editing && editable && isScheduled && (
                            <StartLivePopover
                                loading={startingId === m.matchId}
                                onStart={(mode) => handleStartLive(m, mode)}
                            />
                        )}
                        {canEdit && !editing && editable && isLive && (
                            <Button
                                size="sm"
                                colorPalette="red"
                                onClick={() => setLiveMatch(m)}
                            >
                                Uživo
                            </Button>
                        )}
                        {canEdit && !editing && editable && isFinished && (
                            <Button
                                size="sm"
                                variant="ghost"
                                colorPalette="gray"
                                onClick={() => setLiveMatch(m)}
                            >
                                Tijek
                            </Button>
                        )}
                        {canEdit && !editing && editable && !isLive && (
                            <Button
                                size="sm"
                                variant="ghost"
                                colorPalette={isFinished ? "gray" : "brand"}
                                onClick={() => startEdit(m)}
                            >
                                {isFinished ? "Uredi" : "Rezultat"}
                            </Button>
                        )}
                    </HStack>
                </Flex>
                {editing && (
                    <Flex gap="2" mt="3" wrap="wrap" align="center">
                        <Input
                            size="sm"
                            type="number"
                            placeholder="Golovi 1"
                            value={form.s1}
                            maxW="28"
                            onChange={(e) => setForm((f) => ({ ...f, s1: e.target.value }))}
                        />
                        <Input
                            size="sm"
                            type="number"
                            placeholder="Golovi 2"
                            value={form.s2}
                            maxW="28"
                            onChange={(e) => setForm((f) => ({ ...f, s2: e.target.value }))}
                        />
                        <Button
                            size="sm"
                            colorPalette="brand"
                            loading={saving}
                            onClick={() => saveResult(m)}
                        >
                            Spremi
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingId(null)}
                        >
                            Odustani
                        </Button>
                    </Flex>
                )}
            </Box>
        )
    }

    return (
        <VStack align="stretch" gap="6" py="2">
            {/* No top "Grupe" SectionCard — the group cards below carry
                 their own headings ("Grupa A", "Grupa B", …) which is
                 already enough context. "Ponovi ždrijeb" lives in a
                 right-aligned row above the cards; hidden once any
                 match has been played because re-drawing would wipe
                 real results. */}
            {canEdit && !tournamentStarted && (
                <Flex justify="flex-end">
                    <GhostButton
                        danger
                        icon={<FiRefreshCw size={14} />}
                        onClick={runAutoDraw}
                        disabled={drawing}
                    >
                        {drawing ? "Ždrijeb…" : "Ponovi ždrijeb"}
                    </GhostButton>
                </Flex>
            )}

            {/* ── v3 summary strip ──
                 GRUPE · EKIPE · PROLAZE · ODIGRANO + legend.
                 Wraps on narrow viewports so the four stats stack into
                 two rows of two on small mobile.  */}
            {(() => {
                const groupCount = groups!.length
                const teamCount = groups!.reduce((n, g) => n + g.standings.length, 0)
                const advanceCount = (advancePerGroup ?? 0) * groupCount
                const totalMatches = groups!.reduce((n, g) => n + g.matches.length, 0)
                const playedMatches = groups!.reduce(
                    (n, g) =>
                        n +
                        g.matches.filter(
                            (m) => m.status === "FINISHED" || m.score1 != null,
                        ).length,
                    0,
                )
                const stats = [
                    { label: "GRUPE", value: groupCount },
                    { label: "EKIPE", value: teamCount },
                    { label: "PROLAZE", value: advanceCount },
                    { label: "ODIGRANO", value: `${playedMatches} / ${totalMatches}` },
                ]
                return (
                    <Flex
                        align="center"
                        gap={{ base: "3", md: "4" }}
                        flexWrap="wrap"
                        px={{ base: "4", md: "5" }}
                        py="3"
                        bg="bg.panel"
                        borderWidth="1px"
                        borderColor="border"
                        rounded="xl"
                    >
                        {stats.map((s, i) => (
                            <Flex key={s.label} align="center" gap={{ base: "3", md: "4" }}>
                                {i > 0 && (
                                    <Box
                                        display={{ base: "none", sm: "block" }}
                                        w="1px"
                                        h="7"
                                        bg="border"
                                    />
                                )}
                                <Box>
                                    <Text
                                        fontFamily="mono"
                                        fontSize="9px"
                                        color="fg.muted"
                                        letterSpacing="0.1em"
                                        fontWeight={700}
                                    >
                                        {s.label}
                                    </Text>
                                    <Text
                                        fontSize="18px"
                                        fontWeight={800}
                                        color="fg.ink"
                                        letterSpacing="-0.02em"
                                        lineHeight={1.1}
                                    >
                                        {s.value}
                                    </Text>
                                </Box>
                            </Flex>
                        ))}
                        <HStack
                            ml={{ base: 0, md: "auto" }}
                            gap="2"
                            fontSize="12px"
                            color="fg.muted"
                        >
                            <Box
                                w="10px"
                                h="10px"
                                rounded="sm"
                                bg="rgba(58,165,107,0.35)"
                                borderWidth="1px"
                                borderColor="pitch.500"
                            />
                            <Text>Prolazi u eliminaciju</Text>
                        </HStack>
                    </Flex>
                )
            })()}

            <Box
                display="grid"
                gridTemplateColumns={{ base: "1fr", lg: "repeat(2, 1fr)" }}
                gap="4"
            >
            {groups!.map((g) => (
                <Box
                    key={g.id}
                    bg="bg.panel"
                    borderWidth="1px"
                    borderColor="border"
                    rounded="xl"
                    overflow="hidden"
                >
                    {/* v3 group header — green letter tile + GRUPA X + N PROLAZE pill */}
                    <Flex
                        justify="space-between"
                        align="center"
                        px="4"
                        py="3"
                        bg="bg.surfaceTint"
                        borderBottomWidth="1px"
                        borderColor="border"
                    >
                        <HStack gap="2.5" align="center">
                            <Flex
                                w="26px"
                                h="26px"
                                rounded="md"
                                bg="pitch.500"
                                color="white"
                                align="center"
                                justify="center"
                                fontFamily="heading"
                                fontSize="14px"
                                fontWeight={800}
                            >
                                {g.name}
                            </Flex>
                            <Text
                                fontFamily="mono"
                                fontSize="11px"
                                fontWeight={700}
                                letterSpacing="0.12em"
                                color="fg.ink"
                            >
                                GRUPA {g.name}
                            </Text>
                        </HStack>
                        {advancePerGroup != null && advancePerGroup > 0 && (
                            <Box
                                fontFamily="mono"
                                fontSize="9px"
                                fontWeight={700}
                                letterSpacing="0.06em"
                                color="pitch.500"
                                bg="rgba(58,165,107,0.12)"
                                px="2.5"
                                py="1"
                                rounded="full"
                            >
                                {advancePerGroup} PROLAZE
                            </Box>
                        )}
                    </Flex>

                    {/* v3 compact standings — CSS grid, not <table>.
                         Columns: # | EKIPA (w/ micro W·D·L | gf:ga line) | UT | GR | BOD.
                         Mobile drops UT column for room. Advancing rows
                         get green-tint bg + 3px green left border. */}
                    <Box>
                        {/* Column header */}
                        <Box
                            display="grid"
                            gridTemplateColumns={{
                                base: "24px 1fr 44px 36px",
                                md: "26px 1fr 34px 50px 40px",
                            }}
                            gap="2"
                            px={{ base: "3", md: "4" }}
                            py="2"
                            bg="bg.surfaceTint2"
                            borderBottomWidth="1px"
                            borderColor="border"
                        >
                            <Text
                                fontFamily="mono"
                                fontSize="9px"
                                color="fg.muted"
                                letterSpacing="0.1em"
                                fontWeight={700}
                                textAlign="center"
                            >
                                #
                            </Text>
                            <Text
                                fontFamily="mono"
                                fontSize="9px"
                                color="fg.muted"
                                letterSpacing="0.1em"
                                fontWeight={700}
                            >
                                EKIPA · P·N·I | GOL
                            </Text>
                            <Text
                                display={{ base: "none", md: "block" }}
                                fontFamily="mono"
                                fontSize="9px"
                                color="fg.muted"
                                letterSpacing="0.1em"
                                fontWeight={700}
                                textAlign="center"
                            >
                                UT
                            </Text>
                            <Text
                                fontFamily="mono"
                                fontSize="9px"
                                color="fg.muted"
                                letterSpacing="0.1em"
                                fontWeight={700}
                                textAlign="center"
                            >
                                GR
                            </Text>
                            <Text
                                fontFamily="mono"
                                fontSize="9px"
                                color="fg.muted"
                                letterSpacing="0.1em"
                                fontWeight={700}
                                textAlign="center"
                            >
                                BOD
                            </Text>
                        </Box>

                        {/* Standings rows */}
                        {g.standings.map((row, idx) => {
                            const advances =
                                advancePerGroup != null && idx < advancePerGroup
                            return (
                                <Box
                                    key={row.teamId}
                                    display="grid"
                                    gridTemplateColumns={{
                                        base: "24px 1fr 44px 36px",
                                        md: "26px 1fr 34px 50px 40px",
                                    }}
                                    gap="2"
                                    alignItems="center"
                                    px={{ base: "3", md: "4" }}
                                    py="2.5"
                                    bg={advances ? "rgba(58,165,107,0.08)" : undefined}
                                    borderLeftWidth="3px"
                                    borderLeftColor={advances ? "pitch.500" : "transparent"}
                                    borderTopWidth={idx === 0 ? "0" : "1px"}
                                    borderTopColor="border"
                                >
                                    {/* Position */}
                                    <Text
                                        fontFamily="mono"
                                        fontSize="13px"
                                        fontWeight={800}
                                        color={advances ? "pitch.500" : "fg.muted"}
                                        textAlign="center"
                                    >
                                        {idx + 1}
                                    </Text>
                                    {/* Team + micro W·D·L | gf:ga */}
                                    <Box minW="0">
                                        <Text
                                            fontSize="14px"
                                            fontWeight={700}
                                            color="fg.ink"
                                            truncate
                                        >
                                            {row.teamName}
                                        </Text>
                                        <Text
                                            fontFamily="mono"
                                            fontSize="10px"
                                            color="fg.muted"
                                            letterSpacing="0.03em"
                                            mt="0.5"
                                        >
                                            <Box as="span" color="pitch.500">
                                                {row.won}
                                            </Box>
                                            ·
                                            <Box as="span">{row.drawn}</Box>
                                            ·
                                            <Box
                                                as="span"
                                                color={row.lost > 0 ? "accent.red" : "fg.muted"}
                                            >
                                                {row.lost}
                                            </Box>
                                            <Box as="span" color="border" mx="1.5">
                                                |
                                            </Box>
                                            {row.goalsFor}:{row.goalsAgainst}
                                        </Text>
                                    </Box>
                                    {/* Played — hidden on mobile */}
                                    <Text
                                        display={{ base: "none", md: "block" }}
                                        fontFamily="mono"
                                        fontSize="13px"
                                        color="fg.soft"
                                        textAlign="center"
                                    >
                                        {row.played}
                                    </Text>
                                    {/* Goal diff */}
                                    <Text
                                        fontFamily="mono"
                                        fontSize="13px"
                                        fontWeight={600}
                                        textAlign="center"
                                        color={
                                            row.goalDiff > 0
                                                ? "pitch.500"
                                                : row.goalDiff < 0
                                                ? "accent.red"
                                                : "fg.muted"
                                        }
                                    >
                                        {row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
                                    </Text>
                                    {/* Points */}
                                    <Text
                                        fontFamily="heading"
                                        fontSize="18px"
                                        fontWeight={800}
                                        color="fg.ink"
                                        letterSpacing="-0.02em"
                                        textAlign="center"
                                    >
                                        {row.points}
                                    </Text>
                                </Box>
                            )
                        })}
                    </Box>

                    {/* Fixtures section */}
                    {g.matches.length > 0 && (
                        <Box
                            px={{ base: "3", md: "4" }}
                            py="3"
                            borderTopWidth="1px"
                            borderColor="border"
                            bg="bg.subtle"
                        >
                            <Text
                                fontFamily="mono"
                                fontSize="10px"
                                fontWeight={700}
                                letterSpacing="0.1em"
                                color="fg.muted"
                                mb="2"
                            >
                                UTAKMICE ({g.matches.length})
                            </Text>
                            <VStack align="stretch" gap="2">
                                {g.matches.map(renderFixture)}
                            </VStack>
                        </Box>
                    )}
                </Box>
            ))}
            </Box>

            {/* Live-match dialog — goals, cards, finish. */}
            {liveMatch && (
                <LiveMatchDialog
                    uuid={uuid}
                    match={liveMatch}
                    onClose={() => setLiveMatch(null)}
                    onChanged={reloadGroups}
                />
            )}
        </VStack>
    )
}

/* ── LivePill — small red "UŽIVO" badge for a live match row. ─────────────── */
function LivePill() {
    return (
        <Badge
            colorPalette="red"
            variant="solid"
            rounded="full"
            fontSize="2xs"
            letterSpacing="wider"
            textTransform="uppercase"
            px="2"
        >
            <Box as="span" display="inline-block" boxSize="1.5" rounded="full" bg="white" mr="1" />
            Uživo
        </Badge>
    )
}

/* ── LiveMatchDialog ─────────────────────────────────────────────────────────
   A modal that drives a single match while it is LIVE: shows the running
   score, the chronological event log, controls to add goals/cards and a
   "Završi" button. For a FINISHED match it shows the same log read-only.
   ────────────────────────────────────────────────────────────────────────── */
type LiveSide = "1" | "2"

function LiveMatchDialog({
    uuid,
    match,
    onClose,
    onChanged,
}: {
    uuid: string
    match: GroupMatch
    onClose: () => void
    onChanged: () => Promise<void> | void
}) {
    const matchId = match.matchId
    const isFinished = match.status === "FINISHED"
    const isTimer = match.liveMode === "TIMER"

    const [events, setEvents] = useState<MatchEventDto[] | null>(null)
    const [score, setScore] = useState<{ s1: number; s2: number }>({
        s1: match.score1 ?? 0,
        s2: match.score2 ?? 0,
    })

    /** Rosters per team, lazily loaded when the dialog opens. */
    const [rosters, setRosters] = useState<Record<number, PlayerDto[]>>({})

    /**
     * The half timing for this match. {@code secondHalfStartedAt} is tracked
     * locally so the dialog reflects the 2nd half the moment the organizer
     * starts it; the half config (length + count) comes from the schedule.
     */
    const [secondHalfStartedAt, setSecondHalfStartedAt] = useState<string | null>(
        match.secondHalfStartedAt ?? null,
    )
    const [halfLengthMin, setHalfLengthMin] = useState<number | null>(null)
    const [halfCount, setHalfCount] = useState<number | null>(null)
    const [startingHalf, setStartingHalf] = useState(false)

    // Add-event form state.
    const [side, setSide] = useState<LiveSide>("1")
    const [kind, setKind] = useState<MatchEventType>("GOAL")
    const [playerId, setPlayerId] = useState<string>("")
    const [assistId, setAssistId] = useState<string>("")
    const [minute, setMinute] = useState<string>("")
    const [adding, setAdding] = useState(false)
    const [finishing, setFinishing] = useState(false)
    /** eventId currently being deleted. */
    const [deletingId, setDeletingId] = useState<number | null>(null)

    // Load events + both rosters once.
    useEffect(() => {
        let cancelled = false
        fetchMatchEvents(uuid, matchId)
            .then((ev) => { if (!cancelled) setEvents(ev) })
            .catch(() => { if (!cancelled) setEvents([]) })
        async function loadRoster(teamId: number | null) {
            if (teamId == null) return
            try {
                const players = await fetchPlayers(uuid, teamId)
                if (!cancelled) {
                    setRosters((prev) => ({ ...prev, [teamId]: players }))
                }
            } catch {
                /* error toast surfaced by the http interceptor */
            }
        }
        void loadRoster(match.team1Id)
        void loadRoster(match.team2Id)
        return () => { cancelled = true }
    }, [uuid, matchId, match.team1Id, match.team2Id])

    // For TIMER matches, fetch the half config (length + count) once.
    useEffect(() => {
        if (!isTimer) return
        let cancelled = false
        fetchSchedule(uuid)
            .then((s) => {
                if (cancelled) return
                setHalfLengthMin(s.halfLengthMin ?? null)
                setHalfCount(s.halfCount ?? null)
            })
            .catch(() => { /* error toast surfaced by the http interceptor */ })
        return () => { cancelled = true }
    }, [uuid, isTimer])

    /** Re-fetch this match's row to pick up a freshly-set secondHalfStartedAt. */
    async function refreshMatchHalf() {
        try {
            const groups = await fetchGroups(uuid)
            for (const g of groups) {
                const found = g.matches.find((mm) => mm.matchId === matchId)
                if (found) {
                    setSecondHalfStartedAt(found.secondHalfStartedAt ?? null)
                    return
                }
            }
        } catch {
            /* error toast surfaced by the http interceptor */
        }
    }

    /** Begin the 2nd half, then refetch so the clock switches over. */
    async function handleStartSecondHalf() {
        setStartingHalf(true)
        try {
            await startSecondHalf(uuid, matchId)
            await refreshMatchHalf()
            await onChanged()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setStartingHalf(false)
        }
    }

    const phase =
        isTimer && !isFinished
            ? matchPhase({
                  liveStartedAt: match.liveStartedAt,
                  secondHalfStartedAt,
                  halfLengthMin,
                  halfCount,
              })
            : null
    const atHalftime = phase === "HALFTIME"
    const atFullTime = phase === "FULL_TIME"

    const selectedTeamId = side === "1" ? match.team1Id : match.team2Id
    const roster = selectedTeamId != null ? rosters[selectedTeamId] ?? [] : []
    const minuteNum = parseInt(minute, 10)
    const canAdd =
        !!playerId &&
        Number.isFinite(minuteNum) &&
        minuteNum >= 0 &&
        !adding

    function resetForm() {
        setPlayerId("")
        setAssistId("")
        setMinute("")
    }

    /** Recompute the displayed score from the event log. */
    function scoreFromEvents(list: MatchEventDto[]): { s1: number; s2: number } {
        let s1 = 0
        let s2 = 0
        for (const e of list) {
            if (e.type !== "GOAL") continue
            if (e.teamId === match.team1Id) s1 += 1
            else if (e.teamId === match.team2Id) s2 += 1
        }
        return { s1, s2 }
    }

    async function refreshAfterMutation() {
        try {
            const ev = await fetchMatchEvents(uuid, matchId)
            setEvents(ev)
        } catch {
            /* error toast surfaced by the http interceptor */
        }
        await onChanged()
    }

    // Keep the score in sync with the event log.
    useEffect(() => {
        if (events) setScore(scoreFromEvents(events))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [events])

    async function handleAdd() {
        if (!canAdd) return
        setAdding(true)
        try {
            await addMatchEvent(uuid, matchId, {
                type: kind,
                playerId: Number(playerId),
                minute: minuteNum,
                assistPlayerId:
                    kind === "GOAL" && assistId ? Number(assistId) : null,
            })
            resetForm()
            await refreshAfterMutation()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setAdding(false)
        }
    }

    async function handleDelete(eventId: number) {
        setDeletingId(eventId)
        try {
            await deleteMatchEvent(uuid, matchId, eventId)
            await refreshAfterMutation()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setDeletingId(null)
        }
    }

    async function handleFinish() {
        setFinishing(true)
        try {
            await finishMatch(uuid, matchId)
            await onChanged()
            onClose()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setFinishing(false)
        }
    }

    return (
        <Dialog.Root
            open
            onOpenChange={(e) => { if (!e.open) onClose() }}
            placement="center"
            motionPreset="slide-in-bottom"
            scrollBehavior="inside"
        >
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW={{ base: "94%", md: "560px" }}>
                        <Dialog.Header>
                            <Dialog.Title>
                                <HStack gap="2">
                                    <Text>
                                        {match.team1Name ?? "—"} – {match.team2Name ?? "—"}
                                    </Text>
                                    {!isFinished && <LivePill />}
                                    {!isFinished && isTimer && (
                                        <LiveClock
                                            liveStartedAt={match.liveStartedAt}
                                            secondHalfStartedAt={secondHalfStartedAt}
                                            halfLengthMin={halfLengthMin}
                                            halfCount={halfCount}
                                            showLabel
                                        />
                                    )}
                                </HStack>
                            </Dialog.Title>
                        </Dialog.Header>
                        <Dialog.Body>
                            <VStack align="stretch" gap="4">
                                {/* Scoreboard */}
                                <Box
                                    textAlign="center"
                                    py="3"
                                    rounded="xl"
                                    bg={isFinished ? "bg.subtle" : "red.subtle"}
                                >
                                    <Text
                                        fontSize="3xl"
                                        fontWeight="bold"
                                        fontVariantNumeric="tabular-nums"
                                        color={isFinished ? "fg" : "red.fg"}
                                    >
                                        {score.s1} : {score.s2}
                                    </Text>
                                </Box>

                                {/* Halftime — prompt to start the 2nd half. */}
                                {atHalftime && (
                                    <Box
                                        textAlign="center"
                                        py="3"
                                        px="3"
                                        rounded="xl"
                                        bg="bg.subtle"
                                        borderWidth="1px"
                                        borderColor="border"
                                    >
                                        <Text
                                            fontSize="sm"
                                            fontWeight="semibold"
                                            color="fg"
                                            mb="2"
                                        >
                                            Poluvrijeme
                                        </Text>
                                        <Button
                                            colorPalette="red"
                                            loading={startingHalf}
                                            onClick={handleStartSecondHalf}
                                        >
                                            Započni 2. poluvrijeme
                                        </Button>
                                    </Box>
                                )}

                                {/* Full time — the match clock has run out.
                                    The timer never auto-finishes; the
                                    organizer confirms with "Završi". */}
                                {atFullTime && (
                                    <Box
                                        textAlign="center"
                                        py="3"
                                        px="3"
                                        rounded="xl"
                                        bg="red.subtle"
                                        borderWidth="1px"
                                        borderColor="red.emphasized"
                                    >
                                        <Text
                                            fontSize="sm"
                                            fontWeight="semibold"
                                            color="red.fg"
                                            mb="2"
                                        >
                                            Vrijeme je isteklo
                                        </Text>
                                        <Button
                                            colorPalette="red"
                                            loading={finishing}
                                            onClick={handleFinish}
                                        >
                                            Završi utakmicu
                                        </Button>
                                    </Box>
                                )}

                                {/* Event log */}
                                <Box>
                                    <Text
                                        fontSize="2xs"
                                        fontWeight="semibold"
                                        letterSpacing="wider"
                                        textTransform="uppercase"
                                        color="fg.muted"
                                        mb="2"
                                    >
                                        Tijek utakmice
                                    </Text>
                                    {events == null ? (
                                        <Text fontSize="sm" color="fg.muted">
                                            Učitavanje…
                                        </Text>
                                    ) : events.length === 0 ? (
                                        <Text fontSize="sm" color="fg.muted">
                                            Još nema zabilježenih događaja.
                                        </Text>
                                    ) : (
                                        <VStack align="stretch" gap="1.5">
                                            {events.map((ev) => (
                                                <EventRow
                                                    key={ev.id}
                                                    ev={ev}
                                                    canDelete={!isFinished}
                                                    deleting={deletingId === ev.id}
                                                    onDelete={() => handleDelete(ev.id)}
                                                />
                                            ))}
                                        </VStack>
                                    )}
                                </Box>

                                {/* Add-event controls — only while LIVE */}
                                {!isFinished && (
                                    <Box borderWidth="1px" borderColor="border" rounded="xl" p="3">
                                        <Text
                                            fontSize="2xs"
                                            fontWeight="semibold"
                                            letterSpacing="wider"
                                            textTransform="uppercase"
                                            color="fg.muted"
                                            mb="2"
                                        >
                                            Dodaj događaj
                                        </Text>
                                        <VStack align="stretch" gap="2">
                                            <HStack gap="2" wrap="wrap">
                                                <NativeSelect.Root size="sm" flex="1" minW="36">
                                                    <NativeSelect.Field
                                                        value={side}
                                                        onChange={(e) => {
                                                            setSide(e.target.value as LiveSide)
                                                            setPlayerId("")
                                                            setAssistId("")
                                                        }}
                                                    >
                                                        <option value="1">
                                                            {match.team1Name ?? "Ekipa 1"}
                                                        </option>
                                                        <option value="2">
                                                            {match.team2Name ?? "Ekipa 2"}
                                                        </option>
                                                    </NativeSelect.Field>
                                                    <NativeSelect.Indicator />
                                                </NativeSelect.Root>
                                                <NativeSelect.Root size="sm" flex="1" minW="36">
                                                    <NativeSelect.Field
                                                        value={kind}
                                                        onChange={(e) => {
                                                            setKind(e.target.value as MatchEventType)
                                                            setAssistId("")
                                                        }}
                                                    >
                                                        <option value="GOAL">⚽ Gol</option>
                                                        <option value="YELLOW_CARD">🟨 Žuti karton</option>
                                                        <option value="RED_CARD">🟥 Crveni karton</option>
                                                    </NativeSelect.Field>
                                                    <NativeSelect.Indicator />
                                                </NativeSelect.Root>
                                            </HStack>

                                            <NativeSelect.Root size="sm">
                                                <NativeSelect.Field
                                                    value={playerId}
                                                    onChange={(e) => setPlayerId(e.target.value)}
                                                >
                                                    <option value="">— odaberi igrača —</option>
                                                    {roster.map((p) => (
                                                        <option key={p.id} value={p.id}>
                                                            {p.number != null ? `${p.number}. ` : ""}
                                                            {p.name}
                                                        </option>
                                                    ))}
                                                </NativeSelect.Field>
                                                <NativeSelect.Indicator />
                                            </NativeSelect.Root>

                                            {kind === "GOAL" && (
                                                <NativeSelect.Root size="sm">
                                                    <NativeSelect.Field
                                                        value={assistId}
                                                        onChange={(e) => setAssistId(e.target.value)}
                                                    >
                                                        <option value="">
                                                            — asistencija (neobavezno) —
                                                        </option>
                                                        {roster
                                                            .filter((p) => String(p.id) !== playerId)
                                                            .map((p) => (
                                                                <option key={p.id} value={p.id}>
                                                                    {p.number != null ? `${p.number}. ` : ""}
                                                                    {p.name}
                                                                </option>
                                                            ))}
                                                    </NativeSelect.Field>
                                                    <NativeSelect.Indicator />
                                                </NativeSelect.Root>
                                            )}

                                            <HStack gap="2">
                                                <Input
                                                    size="sm"
                                                    type="number"
                                                    min={0}
                                                    placeholder="Minuta"
                                                    value={minute}
                                                    maxW="28"
                                                    onChange={(e) => setMinute(e.target.value)}
                                                />
                                                {match.liveMode === "TIMER" && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        onClick={() =>
                                                            setMinute(String(elapsedMinutes(match.liveStartedAt)))
                                                        }
                                                    >
                                                        Sada
                                                    </Button>
                                                )}
                                                <Button
                                                    size="sm"
                                                    colorPalette="brand"
                                                    flex="1"
                                                    loading={adding}
                                                    disabled={!canAdd}
                                                    onClick={handleAdd}
                                                >
                                                    Dodaj
                                                </Button>
                                            </HStack>
                                        </VStack>
                                    </Box>
                                )}
                            </VStack>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <HStack gap="2">
                                <Button variant="ghost" onClick={onClose}>
                                    Zatvori
                                </Button>
                                {!isFinished && (
                                    <Button
                                        colorPalette="red"
                                        loading={finishing}
                                        onClick={handleFinish}
                                    >
                                        Završi
                                    </Button>
                                )}
                            </HStack>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}

/* ── EventRow — one line in the live-match event log. ─────────────────────── */
function EventRow({
    ev,
    canDelete,
    deleting,
    onDelete,
}: {
    ev: MatchEventDto
    canDelete: boolean
    deleting: boolean
    onDelete: () => void
}) {
    const icon =
        ev.type === "GOAL" ? "⚽" : ev.type === "YELLOW_CARD" ? "🟨" : "🟥"
    return (
        <HStack gap="2" px="2.5" py="1.5" rounded="lg" bg="bg.subtle" align="center">
            <Text
                fontSize="xs"
                fontWeight="bold"
                color="fg.muted"
                fontVariantNumeric="tabular-nums"
                minW="8"
            >
                {ev.minute}'
            </Text>
            <Text fontSize="sm" lineHeight="1">
                {icon}
            </Text>
            <Box flex="1" minW="0">
                <Text fontSize="sm" truncate>
                    {ev.playerName}
                </Text>
                {ev.assistPlayerName && (
                    <Text fontSize="2xs" color="fg.muted" truncate>
                        asist. {ev.assistPlayerName}
                    </Text>
                )}
            </Box>
            {canDelete && (
                <IconButton
                    aria-label="Ukloni događaj"
                    size="xs"
                    variant="ghost"
                    colorPalette="red"
                    loading={deleting}
                    onClick={onDelete}
                >
                    <FiTrash2 />
                </IconButton>
            )}
        </HStack>
    )
}
