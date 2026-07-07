import { useEffect, useMemo, useState, type ReactNode } from "react"
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
import { FiEdit2, FiArrowUp, FiArrowDown, FiClock } from "react-icons/fi"
import { fetchGroups, drawGroups, recordGroupResult, reorderGroup, resetGroups } from "../api/groups"
import type { Group, GroupMatch } from "../types/groups"
import type { TeamShort } from "../types/teams"
import {
    deleteMatchEvent,
    endFirstHalf,
    fetchMatchEvents,
    finishMatch,
    resetMatch,
    startMatch,
    startSecondHalf,
} from "../api/matchEvents"
import type {
    MatchEventDto,
    MatchLiveMode,
} from "../types/matchEvents"
import { fetchSchedule } from "../api/schedule"
import { ConfirmDialog, EmptyState, Loader, Panel } from "../ui/primitives"
import { GhostButton } from "../ui/pitch"
import { FiRefreshCw, FiTrash2 } from "react-icons/fi"
import { FoulControls, LiveClock, LiveEventRow, LiveGoalEntry, MatchTimelineModal, StartLivePopover, matchPhase } from "./liveMatch"

/**
 * "Grupe" tab on the tournament detail page (Phase E2 + E5).
 *
 * Before the draw: an empty state with a button to run the automatic draw.
 * After the draw: one card per group - the live standings table (top
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

/** Mono header cell for the SofaScore-style standings grid. */
function StHead({ label, mdOnly = false }: { label: string; mdOnly?: boolean }) {
    return (
        <Text
            display={mdOnly ? { base: "none", md: "block" } : undefined}
            fontFamily="mono"
            fontSize="9px"
            color="fg.muted"
            letterSpacing="0.08em"
            fontWeight={700}
            textAlign="center"
        >
            {label}
        </Text>
    )
}

/** Mono number cell for the standings grid. */
function StNum({
    value,
    mdOnly = false,
    color = "fg.soft",
    weight = 400,
}: {
    value: ReactNode
    mdOnly?: boolean
    color?: string
    weight?: number
}) {
    return (
        <Text
            display={mdOnly ? { base: "none", md: "block" } : undefined}
            fontFamily="mono"
            fontSize="13px"
            fontWeight={weight}
            color={color}
            textAlign="center"
        >
            {value}
        </Text>
    )
}

export default function GroupsTab({
    uuid,
    advancePerGroup,
    groupCount,
    teams,
    canEdit = false,
    tournamentStarted = false,
    onGoToSchedule,
}: {
    uuid: string
    advancePerGroup?: number | null
    /** Configured number of groups (from the tournament) - sizes the manual
     *  draw assignment editor. */
    groupCount?: number | null
    /** Registered teams - needed for the manual draw (assign each to a group). */
    teams?: TeamShort[]
    /** Owner / admin only - controls visibility of the draw button and
     *  every match-row edit / live action. Read-only by default. */
    canEdit?: boolean
    /** Set once any match goes LIVE / FINISHED. While true, "Ponovi
     *  ždrijeb" is hidden because re-drawing groups mid-tournament
     *  would wipe real played results. */
    tournamentStarted?: boolean
    /** Switch the tournament page to the Raspored tab (for the "Idi na
     *  raspored" shortcut shown once groups are drawn). */
    onGoToSchedule?: () => void
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
    /** Match whose read-only timeline modal is open (any viewer can open it). */
    const [timelineMatch, setTimelineMatch] = useState<GroupMatch | null>(null)
    /** Group whose manual-reorder dialog is open (organizer, finished group). */
    const [reorderGroupTarget, setReorderGroupTarget] = useState<Group | null>(null)
    // Half config (schedule) so the inline row clocks count UP and freeze at
    // each half boundary, just like the dialog clock - not a free-running timer.
    const [halfLengthMin, setHalfLengthMin] = useState<number | null>(null)
    const [halfCount, setHalfCount] = useState<number | null>(null)
    // Group draw - group count + advance-per-group are chosen here, then the
    // organizer previews an auto-shuffle (or assigns by hand) and confirms it
    // before it's persisted.
    const [drawOpen, setDrawOpen] = useState(false)
    const [drawMode, setDrawMode] = useState<"auto" | "manual">("auto")
    const [cfgGroups, setCfgGroups] = useState("4")
    const [cfgAdvance, setCfgAdvance] = useState("2")
    const [assign, setAssign] = useState<Record<number, number>>({})
    /** advance-per-group just drawn (the page's prop is stale until refetch). */
    const [advanceOverride, setAdvanceOverride] = useState<number | null>(null)
    const [resetting, setResetting] = useState(false)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        fetchGroups(uuid)
            .then((g) => { if (!cancelled) setGroups(g) })
            .catch(() => { if (!cancelled) setGroups([]) })
            .finally(() => { if (!cancelled) setLoading(false) })
        fetchSchedule(uuid)
            .then((s) => {
                if (cancelled) return
                setHalfLengthMin(s.halfLengthMin ?? null)
                setHalfCount(s.halfCount ?? null)
            })
            .catch(() => { /* schedule may not be generated yet - clock free-runs */ })
        return () => { cancelled = true }
    }, [uuid])

    // The next match to start: the earliest-kickoff SCHEDULED match across all
    // groups. Highlighted with a red border so the organizer sees what's on
    // deck. Null until the schedule is generated (no kickoffs yet). Declared
    // here, above any early return, so the hook order stays stable.
    const nextMatchId = useMemo<number | null>(() => {
        const scheduled = (groups ?? [])
            .flatMap((g) => g.matches)
            .filter((m) => m.status === "SCHEDULED" && m.kickoffAt)
        if (scheduled.length === 0) return null
        scheduled.sort(
            (a, b) => new Date(a.kickoffAt!).getTime() - new Date(b.kickoffAt!).getTime(),
        )
        return scheduled[0].matchId
    }, [groups])

    /** Re-fetch the groups (after a live action changed the score / status). */
    async function reloadGroups() {
        try {
            setGroups(await fetchGroups(uuid))
        } catch {
            /* error toast surfaced by the http interceptor */
        }
    }

    async function runResetGroups() {
        setResetting(true)
        try {
            setGroups(await resetGroups(uuid))
            setEditingId(null)
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setResetting(false)
        }
    }

    /** "Resetiraj" wipes every group match + the draw - confirm in a popup modal. */
    const [confirmResetGroupsOpen, setConfirmResetGroupsOpen] = useState(false)
    function confirmResetGroups() {
        setConfirmResetGroupsOpen(true)
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

    // Registered teams (pending self-registrations excluded - same rule the
    // backend draw uses) and the configured group count.
    const registeredTeams = (teams ?? []).filter((tm) => !tm.pendingApproval)
    const grpLabel = (i: number) => String.fromCharCode(65 + i)

    // Draw config (clamped) + derived preview.
    const maxGroups = Math.max(2, registeredTeams.length)
    const gcNum = Math.min(maxGroups, Math.max(2, parseInt(cfgGroups || "0", 10) || 0))
    const advNum = Math.max(1, parseInt(cfgAdvance || "0", 10) || 0)
    const enoughTeams = registeredTeams.length >= gcNum
    const effectiveAdvance = advanceOverride ?? advancePerGroup
    const grpOf = (id: number) => Math.min(gcNum - 1, assign[id] ?? 0)

    function shuffledTeams(): TeamShort[] {
        const arr = [...registeredTeams]
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            ;[arr[i], arr[j]] = [arr[j], arr[i]]
        }
        return arr
    }
    /** Spread teams round-robin (optionally shuffled) across `count` groups. */
    function buildAssign(count: number, shuffle: boolean): Record<number, number> {
        const order = shuffle ? shuffledTeams() : registeredTeams
        const next: Record<number, number> = {}
        order.forEach((tm, i) => { next[tm.id] = i % Math.max(1, count) })
        return next
    }

    function openDraw() {
        const cur = groups?.length || (groupCount && groupCount >= 2 ? groupCount : 0)
        const def = Math.min(maxGroups, cur >= 2 ? cur : 4)
        setCfgGroups(String(def))
        setCfgAdvance(String(effectiveAdvance && effectiveAdvance >= 1 ? effectiveAdvance : 2))
        setDrawMode("auto")
        setAssign(buildAssign(def, true))
        setDrawOpen(true)
    }
    function changeGroupCount(v: string) {
        const s = v.replace(/[^\d]/g, "")
        setCfgGroups(s)
        const c = Math.min(maxGroups, Math.max(2, parseInt(s || "0", 10) || 0))
        setAssign(buildAssign(c, drawMode === "auto"))
    }
    function chooseMode(m: "auto" | "manual") {
        setDrawMode(m)
        if (m === "auto") setAssign(buildAssign(gcNum, true))
    }

    async function submitDraw() {
        if (!enoughTeams) return
        const assignments = registeredTeams.map((tm) => ({
            teamId: tm.id,
            groupOrdinal: grpOf(tm.id),
        }))
        try {
            setDrawing(true)
            setGroups(await drawGroups(uuid, {
                mode: "MANUAL",
                groupCount: gcNum,
                advancePerGroup: advNum,
                assignments,
            }))
            setAdvanceOverride(advNum)
            setDrawOpen(false)
            setEditingId(null)
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setDrawing(false)
        }
    }

    const drawPanel = (
        <Panel p={{ base: "4", md: "5" }}>
            <VStack align="stretch" gap="4">
                <HStack justify="space-between" align="center">
                    <Text fontWeight="bold" fontSize="sm">Ždrijeb grupa</Text>
                    <Button size="xs" variant="ghost" onClick={() => setDrawOpen(false)} disabled={drawing}>
                        Odustani
                    </Button>
                </HStack>

                {/* Config: group count + advance, then auto/manual toggle. */}
                <Flex gap="4" align="flex-end" wrap="wrap">
                    <Box>
                        <Text fontSize="2xs" fontWeight="semibold" letterSpacing="wider" textTransform="uppercase" color="fg.muted" mb="1">
                            Broj grupa
                        </Text>
                        <Input size="sm" w="84px" inputMode="numeric" textAlign="center" value={cfgGroups} onChange={(e) => changeGroupCount(e.target.value)} />
                    </Box>
                    <Box>
                        <Text fontSize="2xs" fontWeight="semibold" letterSpacing="wider" textTransform="uppercase" color="fg.muted" mb="1">
                            Prolazi po grupi
                        </Text>
                        <Input size="sm" w="84px" inputMode="numeric" textAlign="center" value={cfgAdvance} onChange={(e) => setCfgAdvance(e.target.value.replace(/[^\d]/g, ""))} />
                    </Box>
                    <HStack gap="2">
                        <Button size="sm" variant={drawMode === "auto" ? "solid" : "outline"} colorPalette={drawMode === "auto" ? "brand" : "gray"} onClick={() => chooseMode("auto")}>
                            Automatski
                        </Button>
                        <Button size="sm" variant={drawMode === "manual" ? "solid" : "outline"} colorPalette={drawMode === "manual" ? "brand" : "gray"} onClick={() => chooseMode("manual")}>
                            Ručno
                        </Button>
                    </HStack>
                </Flex>

                {!enoughTeams && (
                    <Text fontSize="xs" color="red.fg">
                        Potrebno je barem {gcNum} ekipa za {gcNum} grupe (prijavljeno {registeredTeams.length}).
                    </Text>
                )}

                {drawMode === "auto" ? (
                    <VStack align="stretch" gap="2">
                        <HStack justify="space-between" align="center">
                            <Text fontFamily="mono" fontSize="2xs" fontWeight={800} letterSpacing="0.12em" color="fg.muted">
                                PREGLED ŽDRIJEBA
                            </Text>
                            <Button size="xs" variant="outline" onClick={() => setAssign(buildAssign(gcNum, true))}>
                                <HStack gap="1"><LuShuffle size={13} /> Promiješaj</HStack>
                            </Button>
                        </HStack>
                        <Box display="grid" gridTemplateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }} gap="3">
                            {Array.from({ length: gcNum }, (_, i) => (
                                <Box key={i} borderWidth="1px" borderColor="border" rounded="lg" p="3">
                                    <HStack justify="space-between" mb="2">
                                        <Text fontWeight="bold" fontSize="sm">Grupa {grpLabel(i)}</Text>
                                        <Badge variant="subtle" colorPalette="brand" size="sm">{advNum} prolaze</Badge>
                                    </HStack>
                                    <VStack align="stretch" gap="1">
                                        {registeredTeams.filter((tm) => grpOf(tm.id) === i).map((tm) => (
                                            <Text key={tm.id} fontSize="sm" truncate>
                                                {tm.name?.trim() || "Bez imena"}
                                            </Text>
                                        ))}
                                    </VStack>
                                </Box>
                            ))}
                        </Box>
                    </VStack>
                ) : (
                    <VStack align="stretch" gap="1.5">
                        {registeredTeams.map((tm) => (
                            <HStack key={tm.id} gap="3" justify="space-between" borderWidth="1px" borderColor="border" rounded="lg" px="3" py="2">
                                <Text fontSize="sm" flex="1" minW="0" truncate>
                                    {tm.name?.trim() || "Bez imena"}
                                </Text>
                                <NativeSelect.Root size="sm" w="140px" flexShrink={0}>
                                    <NativeSelect.Field
                                        value={String(grpOf(tm.id))}
                                        onChange={(e) => setAssign((a) => ({ ...a, [tm.id]: Number(e.target.value) }))}
                                    >
                                        {Array.from({ length: gcNum }, (_, i) => (
                                            <option key={i} value={i}>Grupa {grpLabel(i)}</option>
                                        ))}
                                    </NativeSelect.Field>
                                </NativeSelect.Root>
                            </HStack>
                        ))}
                    </VStack>
                )}

                <Button colorPalette="brand" onClick={submitDraw} loading={drawing} disabled={!enoughTeams}>
                    Potvrdi ždrijeb
                </Button>
            </VStack>
        </Panel>
    )

    if (loading) {
        return <Loader />
    }

    const hasGroups = groups != null && groups.length > 0

    // The tournament's status may not flip the moment a match goes LIVE, so
    // also treat the draw as "started" once any group match is being played
    // or finished - re-drawing then would wipe real results.
    const anyMatchPlayed = (groups ?? []).some((g) =>
        g.matches.some((m) => m.status === "LIVE" || m.status === "FINISHED"),
    )
    const started = tournamentStarted || anyMatchPlayed

    if (!hasGroups) {
        if (canEdit && drawOpen) return drawPanel
        return (
            <Panel>
                <EmptyState
                    icon={LuShuffle}
                    title="Grupe još nisu izvučene"
                    description={
                        canEdit
                            ? "Odaberi broj grupa i koliko ekipa prolazi dalje, pogledaj pregled (automatski ili ručno) pa potvrdi."
                            : "Organizator još nije izvukao grupe."
                    }
                    action={
                        canEdit ? (
                            <Button
                                colorPalette="brand"
                                onClick={openDraw}
                                disabled={registeredTeams.length < 2}
                            >
                                Izvuci grupe
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
        const hasScore = m.score1 != null && m.score2 != null
        const scoreboard = isLive || isFinished
        const isNext = m.matchId === nextMatchId
        return (
            <Box
                key={m.matchId}
                borderWidth={isLive || isNext ? "2px" : "1px"}
                borderColor={isLive || isNext ? "red.emphasized" : "border"}
                rounded="lg"
                px={{ base: "2.5", md: "3" }}
                py="1.5"
                bg="bg.panel"
                cursor="pointer"
                onClick={() => {
                    if (editing) return
                    // Organizer clicking a LIVE match → open the management modal
                    // (run the game). Everyone else, and non-live matches, get
                    // the read-only timeline. Action buttons stopPropagation.
                    if (canEdit && editable && isLive) {
                        setLiveMatch(m)
                    } else {
                        setTimelineMatch(m)
                    }
                }}
            >
                <VStack align="stretch" gap="0.5">
                    {/* Meta row - UŽIVO badge (+clock) top-left, kickoff time
                        centred, organizer control (Pokreni / Uživo / Rezultat /
                        Uredi) top-right. Equal flex on the side clusters keeps
                        the time centred regardless of their widths. */}
                    <Flex align="center" gap="2" wrap="wrap">
                        {/* Left: live / next badge */}
                        <HStack flex="1" minW="0" gap="2" justify="flex-start" wrap="wrap">
                            {isLive && <LivePill />}
                            {!isLive && isNext && (
                                <Box
                                    as="span"
                                    px="2"
                                    py="0.5"
                                    rounded="full"
                                    bg="red.subtle"
                                    color="red.fg"
                                    fontFamily="mono"
                                    fontSize="9px"
                                    fontWeight={800}
                                    letterSpacing="0.1em"
                                    textTransform="uppercase"
                                    flexShrink={0}
                                    whiteSpace="nowrap"
                                >
                                    Na redu
                                </Box>
                            )}
                        </HStack>

                        {/* Center: kickoff time */}
                        <Box flexShrink={0}>
                            {m.kickoffAt && (
                                <HStack
                                    gap="1.5"
                                    fontSize="2xs"
                                    fontWeight="600"
                                    color="fg.muted"
                                    fontFamily="mono"
                                >
                                    <FiClock size={11} />
                                    <Box>
                                        {(() => {
                                            const d = new Date(m.kickoffAt)
                                            const p = (n: number) => String(n).padStart(2, "0")
                                            return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
                                        })()}
                                    </Box>
                                </HStack>
                            )}
                        </Box>

                        {/* Right: live clock (time + half) for LIVE matches -
                            shown to everyone, top-right. No stopPropagation, so an
                            organizer clicking here still opens the management modal
                            (whole live row is clickable for them). For scheduled /
                            finished matches the organizer's action button sits here
                            and DOES stopPropagation. */}
                        <Flex flex="1" minW="0" justify="flex-end" align="center" gap="2">
                            {isLive && m.liveMode === "TIMER" && (
                                <LiveClock
                                    liveStartedAt={m.liveStartedAt}
                                    secondHalfStartedAt={m.secondHalfStartedAt}
                                    halfLengthMin={halfLengthMin}
                                    halfCount={halfCount}
                                    showLabel
                                />
                            )}
                            {canEdit && !editing && editable && (isScheduled || isFinished) && (
                                <Box onClick={(e) => e.stopPropagation()}>
                                    {isScheduled && (
                                        <StartLivePopover
                                            loading={startingId === m.matchId}
                                            onStart={(mode) => handleStartLive(m, mode)}
                                            onEnterResult={() => startEdit(m)}
                                        />
                                    )}
                                    {isFinished && (
                                        <Button
                                            size="xs"
                                            variant="ghost"
                                            colorPalette="gray"
                                            onClick={() => setLiveMatch(m)}
                                        >
                                            Uredi
                                        </Button>
                                    )}
                                </Box>
                            )}
                        </Flex>
                    </Flex>

                    {/* Teams + score - team1 right, score centre, team2 left
                        (mirrors the Raspored → završene utakmice layout). */}
                    <Box
                        display="grid"
                        gridTemplateColumns="1fr auto 1fr"
                        alignItems="center"
                        gap={{ base: "2", sm: "4" }}
                    >
                        <Text
                            fontSize="sm"
                            fontWeight={700}
                            color="fg.ink"
                            textAlign="right"
                            truncate
                        >
                            {m.team1Name ?? "-"}
                        </Text>
                        {editing ? (
                            // Result typed inline where the score sits, not below.
                            <HStack gap="1.5" justify="center" onClick={(e) => e.stopPropagation()}>
                                <Input
                                    size="sm"
                                    type="number"
                                    min={0}
                                    maxW="14"
                                    textAlign="center"
                                    rounded="lg"
                                    value={form.s1}
                                    onChange={(e) => setForm((f) => ({ ...f, s1: e.target.value }))}
                                />
                                <Text fontWeight={800} color="fg.muted">:</Text>
                                <Input
                                    size="sm"
                                    type="number"
                                    min={0}
                                    maxW="14"
                                    textAlign="center"
                                    rounded="lg"
                                    value={form.s2}
                                    onChange={(e) => setForm((f) => ({ ...f, s2: e.target.value }))}
                                />
                            </HStack>
                        ) : (
                            <Box
                                fontFamily="mono"
                                fontSize={scoreboard ? "md" : "sm"}
                                fontWeight={scoreboard ? 800 : 600}
                                letterSpacing="-0.02em"
                                color={isLive ? "red.fg" : scoreboard ? "fg.ink" : "fg.muted"}
                                bg={isLive ? "red.subtle" : scoreboard ? "bg.surfaceTint" : "transparent"}
                                px="2.5"
                                py="0.5"
                                rounded="lg"
                                minW="56px"
                                textAlign="center"
                                fontVariantNumeric="tabular-nums"
                            >
                                {hasScore ? `${m.score1}:${m.score2}` : scoreboard ? "-" : "vs"}
                            </Box>
                        )}
                        <Text
                            fontSize="sm"
                            fontWeight={700}
                            color="fg.ink"
                            textAlign="left"
                            truncate
                        >
                            {m.team2Name ?? "-"}
                        </Text>
                    </Box>
                </VStack>

                {editing && (
                    <Flex
                        gap="2"
                        mt="2.5"
                        wrap="wrap"
                        align="center"
                        justify="center"
                        onClick={(e) => e.stopPropagation()}
                    >
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
            {/* No top "Grupe" SectionCard - the group cards below carry
                 their own headings ("Grupa A", "Grupa B", …) which is
                 already enough context. "Ponovi ždrijeb" lives in a
                 right-aligned row above the cards; hidden once any
                 match has been played because re-drawing would wipe
                 real results. */}
            {canEdit && !started && (
                <Flex justify="flex-end" gap="2" wrap="wrap">
                    <GhostButton
                        danger
                        icon={<FiRefreshCw size={14} />}
                        onClick={openDraw}
                        disabled={drawing}
                    >
                        {drawing ? "Ždrijeb…" : "Ponovi ždrijeb"}
                    </GhostButton>
                    <GhostButton
                        danger
                        icon={<FiTrash2 size={14} />}
                        onClick={confirmResetGroups}
                        disabled={drawing || resetting}
                    >
                        {resetting ? "Resetiranje…" : "Resetiraj"}
                    </GhostButton>
                </Flex>
            )}

            {/* Manual re-draw editor (shown above the groups when opened). */}
            {canEdit && !started && drawOpen && drawPanel}

            <ConfirmDialog
                open={confirmResetGroupsOpen}
                busy={resetting}
                danger
                title="Resetirati grupnu fazu?"
                description="Sve utakmice grupne faze i podjela u grupe bit će obrisane."
                confirmLabel="Da, resetiraj"
                onClose={() => setConfirmResetGroupsOpen(false)}
                onConfirm={async () => { await runResetGroups(); setConfirmResetGroupsOpen(false) }}
            />

            {/* Groups are drawn but fixtures aren't generated until the
                schedule is created on the Raspored tab. */}
            {groups!.every((g) => g.matches.length === 0) && (
                <Box
                    bg="brand.subtle"
                    borderWidth="1px"
                    borderColor="brand.emphasized"
                    rounded="xl"
                    px="4"
                    py="3"
                >
                    <Flex justify="space-between" align="center" gap="3" wrap="wrap">
                        <Text fontSize="sm" color="fg.ink" fontWeight="medium">
                            Grupe su izvučene. Utakmice se generiraju kad{" "}
                            {canEdit ? "u tabu " : ""}
                            <Text as="span" fontWeight="bold">Raspored</Text>{" "}
                            {canEdit ? "generiraš raspored." : "organizator generira raspored."}
                        </Text>
                        {onGoToSchedule && (
                            <GhostButton
                                icon={<FiClock size={14} />}
                                onClick={onGoToSchedule}
                                flexShrink={0}
                            >
                                Idi na raspored
                            </GhostButton>
                        )}
                    </Flex>
                </Box>
            )}

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
                    {/* v3 group header - green letter tile + GRUPA X + N PROLAZE pill */}
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
                        <HStack gap="2" align="center">
                            {effectiveAdvance != null && effectiveAdvance > 0 && (
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
                                    {effectiveAdvance} PROLAZE
                                </Box>
                            )}
                            {/* Manual reorder - only the organizer, and only
                                once every match in this group is finished (the
                                override settles tiebreakers on a complete group). */}
                            {canEdit &&
                                g.matches.length > 0 &&
                                g.matches.every((m) => m.status === "FINISHED") && (
                                    <IconButton
                                        aria-label="Uredi poredak skupine"
                                        size="xs"
                                        variant="ghost"
                                        onClick={() => setReorderGroupTarget(g)}
                                    >
                                        <FiEdit2 />
                                    </IconButton>
                                )}
                        </HStack>
                    </Flex>

                    {/* v3 compact standings - CSS grid, not <table>.
                         Columns: # | EKIPA (w/ micro W·D·L | gf:ga line) | UT | GR | BOD.
                         Mobile drops UT column for room. Advancing rows
                         get green-tint bg + 3px green left border. */}
                    <Box>
                        {/* Column header - SofaScore-style: each stat its own
                            column, all on one row (no stacking under the name).
                            Mobile keeps the core P·N·I + BOD; md adds UT/GR/GOL/
                            Zadnjih 5. */}
                        <Box
                            display="grid"
                            gridTemplateColumns={{
                                base: "22px 1fr 22px 22px 22px 32px",
                                md: "24px 1fr 26px 24px 24px 24px 40px 48px 92px 34px",
                            }}
                            gap="1.5"
                            px={{ base: "3", md: "4" }}
                            py="2"
                            bg="bg.surfaceTint2"
                            borderBottomWidth="1px"
                            borderColor="border"
                        >
                            <StHead label="#" />
                            <Text
                                fontFamily="mono"
                                fontSize="9px"
                                color="fg.muted"
                                letterSpacing="0.08em"
                                fontWeight={700}
                            >
                                EKIPA
                            </Text>
                            <StHead label="UT" mdOnly />
                            <StHead label="P" />
                            <StHead label="N" />
                            <StHead label="I" />
                            <StHead label="GR" mdOnly />
                            <StHead label="GOL" mdOnly />
                            <StHead label="ZADNJIH 5" mdOnly />
                            <StHead label="BOD" />
                        </Box>

                        {/* Standings rows */}
                        {g.standings.map((row, idx) => {
                            const advances =
                                effectiveAdvance != null && idx < effectiveAdvance
                            return (
                                <Box
                                    key={row.teamId}
                                    display="grid"
                                    gridTemplateColumns={{
                                        base: "22px 1fr 22px 22px 22px 32px",
                                        md: "24px 1fr 26px 24px 24px 24px 40px 48px 92px 34px",
                                    }}
                                    gap="1.5"
                                    alignItems="center"
                                    px={{ base: "3", md: "4" }}
                                    py="2.5"
                                    bg={advances ? "rgba(58,165,107,0.08)" : undefined}
                                    borderLeftWidth="3px"
                                    borderLeftColor={advances ? "pitch.500" : "transparent"}
                                    borderTopWidth={idx === 0 ? "0" : "1px"}
                                    borderTopColor="border"
                                >
                                    {/* # */}
                                    <Text
                                        fontFamily="mono"
                                        fontSize="13px"
                                        fontWeight={800}
                                        color={advances ? "pitch.500" : "fg.muted"}
                                        textAlign="center"
                                    >
                                        {idx + 1}
                                    </Text>
                                    {/* Team name only - stats live in their own columns now */}
                                    <Text fontSize="14px" fontWeight={700} color="fg.ink" truncate minW="0">
                                        {row.teamName}
                                    </Text>
                                    {/* UT (odigrano) - md only */}
                                    <StNum value={row.played} mdOnly />
                                    {/* P · N · I */}
                                    <StNum value={row.won} />
                                    <StNum value={row.drawn} />
                                    <StNum value={row.lost} />
                                    {/* GR (gol-razlika) - md only */}
                                    <StNum
                                        mdOnly
                                        weight={600}
                                        value={row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
                                        color={
                                            row.goalDiff > 0
                                                ? "pitch.500"
                                                : row.goalDiff < 0
                                                ? "accent.red"
                                                : "fg.muted"
                                        }
                                    />
                                    {/* GOL (dani:primljeni) - md only */}
                                    <StNum value={`${row.goalsFor}:${row.goalsAgainst}`} mdOnly />
                                    {/* Zadnjih 5 - md only */}
                                    <HStack
                                        display={{ base: "none", md: "flex" }}
                                        gap="1"
                                        justify="center"
                                    >
                                        {(row.form ?? []).map((res, i) => {
                                            const isW = res === "W"
                                            const isL = res === "L"
                                            return (
                                                <Flex
                                                    key={i}
                                                    w="16px"
                                                    h="16px"
                                                    rounded="sm"
                                                    align="center"
                                                    justify="center"
                                                    fontFamily="mono"
                                                    fontSize="9px"
                                                    fontWeight={800}
                                                    color="white"
                                                    bg={isW ? "pitch.500" : isL ? "accent.red" : "#9aa6b2"}
                                                    title={isW ? "Pobjeda" : isL ? "Poraz" : "Neriješeno"}
                                                >
                                                    {isW ? "P" : isL ? "I" : "N"}
                                                </Flex>
                                            )
                                        })}
                                    </HStack>
                                    {/* BOD (bodovi) */}
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
                            px={{ base: "2.5", md: "3" }}
                            py="2.5"
                            borderTopWidth="1px"
                            borderColor="border"
                            bg="bg.subtle"
                        >
                            <VStack align="stretch" gap="1.5">
                                {g.matches.map(renderFixture)}
                            </VStack>
                        </Box>
                    )}
                </Box>
            ))}
            </Box>

            {/* Live-match dialog - goals, cards, finish (organizer only). */}
            {liveMatch && (
                <GroupLiveMatchDialog
                    uuid={uuid}
                    match={liveMatch}
                    onClose={() => setLiveMatch(null)}
                    onChanged={reloadGroups}
                />
            )}

            {/* Read-only timeline modal - opens for anyone clicking a match. */}
            {timelineMatch && (
                <MatchTimelineModal
                    uuid={uuid}
                    match={timelineMatch}
                    halfLengthMin={halfLengthMin}
                    onClose={() => setTimelineMatch(null)}
                />
            )}

            {/* Manual reorder dialog - organizer drags teams up/down to settle
                a tiebreaker by hand (only for a fully-finished group). */}
            {reorderGroupTarget && (
                <GroupReorderDialog
                    uuid={uuid}
                    group={reorderGroupTarget}
                    onClose={() => setReorderGroupTarget(null)}
                    onSaved={(updated) => {
                        setGroups(updated)
                        setReorderGroupTarget(null)
                    }}
                />
            )}
        </VStack>
    )
}

/* ── GroupReorderDialog - manual standings reorder (tiebreaker override).
   The organizer moves teams up/down; saving assigns each team a manual_rank
   by its position so the standings lock to this order. ────────────────────── */
function GroupReorderDialog({
    uuid,
    group,
    onClose,
    onSaved,
}: {
    uuid: string
    group: Group
    onClose: () => void
    onSaved: (groups: Group[]) => void
}) {
    // Seed from the current (computed) standings order.
    const [order, setOrder] = useState(() => group.standings.map((r) => r))
    const [saving, setSaving] = useState(false)

    function move(idx: number, dir: -1 | 1) {
        setOrder((prev) => {
            const next = [...prev]
            const j = idx + dir
            if (j < 0 || j >= next.length) return prev
            ;[next[idx], next[j]] = [next[j], next[idx]]
            return next
        })
    }

    async function handleSave() {
        setSaving(true)
        try {
            const updated = await reorderGroup(
                uuid,
                group.id,
                order.map((r) => r.teamId),
            )
            onSaved(updated)
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setSaving(false)
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
                    <Dialog.Content maxW={{ base: "92%", md: "440px" }}>
                        <Dialog.Header>
                            <Dialog.Title flex="1" textAlign="center">
                                Ručni poredak - Grupa {group.name}
                            </Dialog.Title>
                        </Dialog.Header>
                        <Dialog.Body pb="2">
                            <Text fontSize="xs" color="fg.muted" mb="3">
                                Posloži ekipe od najbolje prema najlošijoj. Koristi
                                strelice za promjenu poretka (npr. radi razrješenja
                                izjednačenja).
                            </Text>
                            <VStack align="stretch" gap="1.5">
                                {order.map((row, idx) => (
                                    <HStack
                                        key={row.teamId}
                                        gap="2"
                                        borderWidth="1px"
                                        borderColor="border"
                                        rounded="lg"
                                        px="3"
                                        py="2"
                                        bg="bg.panel"
                                    >
                                        <Text
                                            fontFamily="mono"
                                            fontSize="13px"
                                            fontWeight={800}
                                            color="fg.muted"
                                            minW="5"
                                            textAlign="center"
                                        >
                                            {idx + 1}
                                        </Text>
                                        <Text fontSize="sm" fontWeight={600} flex="1" minW="0" truncate>
                                            {row.teamName}
                                        </Text>
                                        <Text
                                            fontFamily="mono"
                                            fontSize="11px"
                                            color="fg.muted"
                                            flexShrink={0}
                                        >
                                            {row.points} b · {row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
                                        </Text>
                                        <HStack gap="0.5" flexShrink={0}>
                                            <IconButton
                                                aria-label="Pomakni gore"
                                                size="xs"
                                                variant="ghost"
                                                disabled={idx === 0}
                                                onClick={() => move(idx, -1)}
                                            >
                                                <FiArrowUp />
                                            </IconButton>
                                            <IconButton
                                                aria-label="Pomakni dolje"
                                                size="xs"
                                                variant="ghost"
                                                disabled={idx === order.length - 1}
                                                onClick={() => move(idx, 1)}
                                            >
                                                <FiArrowDown />
                                            </IconButton>
                                        </HStack>
                                    </HStack>
                                ))}
                            </VStack>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <HStack gap="2">
                                <Button variant="ghost" onClick={onClose}>
                                    Odustani
                                </Button>
                                <Button
                                    colorPalette="brand"
                                    loading={saving}
                                    onClick={handleSave}
                                >
                                    Spremi poredak
                                </Button>
                            </HStack>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}

/* ── LivePill - small red "UŽIVO" badge for a live match row. ─────────────── */
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
export function GroupLiveMatchDialog({
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
    // Players sent off (red card) - greyed out + locked in the entry roster.
    const sentOffIds = useMemo(
        () =>
            new Set(
                (events ?? [])
                    .filter((e) => e.type === "RED_CARD" && e.playerId != null)
                    .map((e) => e.playerId as number),
            ),
        [events],
    )
    const [score, setScore] = useState<{ s1: number; s2: number }>({
        s1: match.score1 ?? 0,
        s2: match.score2 ?? 0,
    })
    // Until the organizer adds/removes an event in this dialog the scoreboard
    // shows the stored score (so a result-only match - entered via "Unesi
    // samo rezultat" with no goal events - doesn't flash 0:0). After any event
    // mutation we recompute live from the event log.
    const [scoreDirty, setScoreDirty] = useState(false)

    /**
     * The half timing for this match. {@code secondHalfStartedAt} is tracked
     * locally so the dialog reflects the 2nd half the moment the organizer
     * starts it; the half config (length + count) comes from the schedule.
     */
    const [firstHalfEndedAt, setFirstHalfEndedAt] = useState<string | null>(
        match.firstHalfEndedAt ?? null,
    )
    const [secondHalfStartedAt, setSecondHalfStartedAt] = useState<string | null>(
        match.secondHalfStartedAt ?? null,
    )
    const [halfLengthMin, setHalfLengthMin] = useState<number | null>(null)
    const [halfCount, setHalfCount] = useState<number | null>(null)
    const [endingHalf, setEndingHalf] = useState(false)
    const [startingHalf, setStartingHalf] = useState(false)

    const [finishing, setFinishing] = useState(false)
    /** eventId currently being deleted. */
    const [deletingId, setDeletingId] = useState<number | null>(null)

    // Load events once (rosters are owned by LiveGoalEntry).
    useEffect(() => {
        let cancelled = false
        fetchMatchEvents(uuid, matchId)
            .then((ev) => { if (!cancelled) setEvents(ev) })
            .catch(() => { if (!cancelled) setEvents([]) })
        return () => { cancelled = true }
    }, [uuid, matchId])

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

    /** Re-fetch this match's row to pick up freshly-set half instants. */
    async function refreshMatchHalf() {
        try {
            const groups = await fetchGroups(uuid)
            for (const g of groups) {
                const found = g.matches.find((mm) => mm.matchId === matchId)
                if (found) {
                    setFirstHalfEndedAt(found.firstHalfEndedAt ?? null)
                    setSecondHalfStartedAt(found.secondHalfStartedAt ?? null)
                    return
                }
            }
        } catch {
            /* error toast surfaced by the http interceptor */
        }
    }

    /** End the 1st half (enter pauza), then refetch so the clock freezes. */
    async function handleEndFirstHalf() {
        setEndingHalf(true)
        try {
            await endFirstHalf(uuid, matchId)
            await refreshMatchHalf()
            await onChanged()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setEndingHalf(false)
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

    // Re-render every second while a TIMER match is running so `phase`
    // (and the halftime / full-time prompts below) flip the instant the
    // clock reaches the end of a half. LiveClock has its own internal tick
    // for its own display, but the dialog needs one too - otherwise the
    // "Poluvrijeme → Započni 2. poluvrijeme" box and the full-time "Završi"
    // never appear until some unrelated state change forces a re-render.
    const [, setClockTick] = useState(0)
    useEffect(() => {
        if (!isTimer || isFinished) return
        const id = setInterval(() => setClockTick((n) => n + 1), 1000)
        return () => clearInterval(id)
    }, [isTimer, isFinished])

    const phase =
        isTimer && !isFinished
            ? matchPhase({
                  liveStartedAt: match.liveStartedAt,
                  firstHalfEndedAt,
                  secondHalfStartedAt,
                  halfLengthMin,
                  halfCount,
              })
            : null
    // The app's own countdown is running (TIMER + a configured half length). With
    // no app clock (SIMPLE, or no half length) the organizer keeps their own time.
    const hasClock = isTimer && halfLengthMin != null && halfLengthMin > 0
    const twoHalves = halfCount !== 1
    // "Završi 1. poluvrijeme" - only for a two-half match, while the 1st half runs.
    const canEndFirstHalf = isTimer && twoHalves && phase === "FIRST_HALF"
    // "Započni 2. poluvrijeme" - once the 1st half has been ended (pauza).
    const canStartSecondHalf = isTimer && phase === "HALFTIME"
    // The half whose end is the match's end (single period → 1st; else 2nd).
    const inFinalHalf = phase === (twoHalves ? "SECOND_HALF" : "FIRST_HALF")
    // Finishing "early" needs a confirm: not at full time, unless we're in the
    // final half of a free-running match (no clock → manual end is the norm).
    const finishIsPremature =
        isTimer && phase !== "FULL_TIME" && !(inFinalHalf && !hasClock)
    // Half label shown in the centre of the modal header (TIMER matches).
    const halfLabel =
        phase === "FIRST_HALF" ? "1. POLUVRIJEME"
            : phase === "HALFTIME" ? "POLUVRIJEME"
                : phase === "SECOND_HALF" ? "2. POLUVRIJEME"
                    : phase === "FULL_TIME" ? "KRAJ"
                        : null

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
        setScoreDirty(true)
        try {
            const ev = await fetchMatchEvents(uuid, matchId)
            setEvents(ev)
        } catch {
            /* error toast surfaced by the http interceptor */
        }
        await onChanged()
    }

    // Keep the score in sync with the event log once the organizer has edited
    // events (see scoreDirty above).
    useEffect(() => {
        if (events && scoreDirty) setScore(scoreFromEvents(events))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [events, scoreDirty])

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

    const [resetting, setResetting] = useState(false)
    async function doReset() {
        setResetting(true)
        try {
            await resetMatch(uuid, matchId)
            await onChanged()
            onClose()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setResetting(false)
        }
    }
    const [confirmResetOpen, setConfirmResetOpen] = useState(false)
    function confirmReset() {
        setConfirmResetOpen(true)
    }
    const [confirmFinishOpen, setConfirmFinishOpen] = useState(false)
    function requestFinish() {
        if (finishIsPremature) {
            setConfirmFinishOpen(true)
            return
        }
        void handleFinish()
    }

    return (
        <>
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
                        <Dialog.Header pb="2">
                            <Dialog.Title flex="1">
                                {/* Compact scoreboard header. Top strip mirrors the
                                    match card: UŽIVO left, half centre, timer right. */}
                                <VStack gap="1.5" align="stretch" w="full">
                                    {!isFinished && (
                                        <Box
                                            display="grid"
                                            gridTemplateColumns="1fr auto 1fr"
                                            alignItems="center"
                                            gap="2"
                                            w="full"
                                        >
                                            <Box justifySelf="start">
                                                <LivePill />
                                            </Box>
                                            <Box justifySelf="center" minW="0">
                                                {halfLabel && (
                                                    <Text
                                                        fontFamily="mono"
                                                        fontSize="2xs"
                                                        fontWeight={800}
                                                        letterSpacing="0.12em"
                                                        textTransform="uppercase"
                                                        color="fg.muted"
                                                        whiteSpace="nowrap"
                                                    >
                                                        {halfLabel}
                                                    </Text>
                                                )}
                                            </Box>
                                            <Box justifySelf="end">
                                                {isTimer && (
                                                    <LiveClock
                                                        liveStartedAt={match.liveStartedAt}
                                                        firstHalfEndedAt={firstHalfEndedAt}
                                                        secondHalfStartedAt={secondHalfStartedAt}
                                                        halfLengthMin={halfLengthMin}
                                                        halfCount={halfCount}
                                                    />
                                                )}
                                            </Box>
                                        </Box>
                                    )}
                                    <HStack justify="center" gap="3" align="center" w="full">
                                        <Text fontSize="md" fontWeight={700} color="fg.ink" flex="1" minW="0" textAlign="right" truncate>
                                            {match.team1Name ?? "-"}
                                        </Text>
                                        <Text
                                            fontFamily="mono"
                                            fontSize="2xl"
                                            fontWeight={800}
                                            fontVariantNumeric="tabular-nums"
                                            color={isFinished ? "fg.ink" : "red.fg"}
                                            flexShrink={0}
                                        >
                                            {score.s1} : {score.s2}
                                        </Text>
                                        <Text fontSize="md" fontWeight={700} color="fg.ink" flex="1" minW="0" textAlign="left" truncate>
                                            {match.team2Name ?? "-"}
                                        </Text>
                                    </HStack>
                                </VStack>
                            </Dialog.Title>
                        </Dialog.Header>
                        <Dialog.Body>
                            <VStack align="stretch" gap="2.5">
                                {/* Accumulated team fouls - compact counters
                                    right below the scoreboard (deveterac). */}
                                <FoulControls
                                    uuid={uuid}
                                    matchId={matchId}
                                    half={secondHalfStartedAt ? 2 : 1}
                                    fouls1First={match.fouls1First}
                                    fouls1Second={match.fouls1Second}
                                    fouls2First={match.fouls2First}
                                    fouls2Second={match.fouls2Second}
                                />

                                {/* Add-event - fast one-tap entry. Shown for a
                                    finished match too so "Uredi" can fix a wrong
                                    scorer etc. (organizer-only dialog). */}
                                {(
                                    <LiveGoalEntry
                                        uuid={uuid}
                                        matchId={matchId}
                                        team1Id={match.team1Id ?? null}
                                        team1Name={match.team1Name ?? null}
                                        team2Id={match.team2Id ?? null}
                                        team2Name={match.team2Name ?? null}
                                        liveMode={match.liveMode}
                                        liveStartedAt={match.liveStartedAt}
                                        firstHalfEndedAt={firstHalfEndedAt}
                                        secondHalfStartedAt={secondHalfStartedAt}
                                        halfLengthMin={halfLengthMin}
                                        halfCount={halfCount}
                                        onAdded={refreshAfterMutation}
                                        sentOffPlayerIds={sentOffIds}
                                    />
                                )}

                                {/* Tijek utakmice - compact event log, centred,
                                    at the bottom (score + entry sit above it). */}
                                <Box textAlign="center">
                                    <Text
                                        fontSize="2xs"
                                        fontWeight="semibold"
                                        letterSpacing="wider"
                                        textTransform="uppercase"
                                        color="fg.muted"
                                        mb="1.5"
                                    >
                                        Tijek utakmice
                                    </Text>
                                    {events == null ? (
                                        <Text fontSize="sm" color="fg.muted">
                                            Učitavanje…
                                        </Text>
                                    ) : events.length === 0 ? (
                                        // A finished match with no events means the
                                        // organizer entered just the final score
                                        // without attributing scorers.
                                        isFinished ? (
                                            <Text fontSize="sm" color="fg.muted">
                                                Prikazan samo krajnji rezultat bez strijelca.
                                            </Text>
                                        ) : (
                                            <Text fontSize="sm" color="fg.muted">
                                                Još nema zabilježenih događaja.
                                            </Text>
                                        )
                                    ) : (
                                        <VStack align="stretch" gap="1" mx="auto" w="full" maxW="md">
                                            {events.map((ev) => (
                                                <LiveEventRow
                                                    key={ev.id}
                                                    ev={ev}
                                                    team1Id={match.team1Id}
                                                    canDelete
                                                    deleting={deletingId === ev.id}
                                                    onDelete={() => handleDelete(ev.id)}
                                                />
                                            ))}
                                        </VStack>
                                    )}
                                </Box>
                            </VStack>
                        </Dialog.Body>
                        <Dialog.Footer justifyContent="center">
                            <HStack gap="2" justify="center" wrap="wrap">
                                <Button variant="ghost" onClick={onClose}>
                                    Zatvori
                                </Button>
                                {!isFinished && (
                                    <Button
                                        variant="outline"
                                        colorPalette="red"
                                        loading={resetting}
                                        onClick={confirmReset}
                                        title="Vrati utakmicu na zakazano (npr. ako mjerač ne radi dobro)"
                                    >
                                        Resetiraj
                                    </Button>
                                )}
                                {!isFinished && canEndFirstHalf && (
                                    <Button
                                        colorPalette="red"
                                        loading={endingHalf}
                                        onClick={handleEndFirstHalf}
                                    >
                                        Završi 1. poluvrijeme
                                    </Button>
                                )}
                                {!isFinished && canStartSecondHalf && (
                                    <Button
                                        colorPalette="red"
                                        loading={startingHalf}
                                        onClick={handleStartSecondHalf}
                                    >
                                        Započni 2. poluvrijeme
                                    </Button>
                                )}
                                {!isFinished && (
                                    <Button
                                        colorPalette="red"
                                        loading={finishing}
                                        onClick={requestFinish}
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
        <ConfirmDialog
            open={confirmResetOpen}
            busy={resetting}
            danger
            title="Resetirati utakmicu?"
            description="Utakmica se vraća na 'zakazano' - brišu se rezultat, prekršaji i svi događaji. Kickoff termin ostaje."
            confirmLabel="Da, resetiraj"
            onClose={() => setConfirmResetOpen(false)}
            onConfirm={async () => { await doReset(); setConfirmResetOpen(false) }}
        />
        <ConfirmDialog
            open={confirmFinishOpen}
            busy={finishing}
            title="Završiti utakmicu prije kraja?"
            description="Vrijeme utakmice još nije isteklo. Jesi li siguran da želiš završiti utakmicu?"
            confirmLabel="Da, završi"
            onClose={() => setConfirmFinishOpen(false)}
            onConfirm={async () => { await handleFinish(); setConfirmFinishOpen(false) }}
        />
        </>
    )
}

