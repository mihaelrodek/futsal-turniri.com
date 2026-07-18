import {useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode} from "react"
import {
    Badge,
    Box,
    Button,
    Dialog,
    Flex,
    HStack,
    IconButton,
    Input,
    Portal,
    Text,
    VStack,
} from "@chakra-ui/react"
import {useNavigate} from "react-router-dom"
import {useQueryClient} from "@tanstack/react-query"
import {qk} from "../queryClient"
import {LuRotateCcw, LuShuffle, LuTrophy} from "react-icons/lu"
import {FiEdit2, FiArrowUp, FiArrowDown, FiChevronDown, FiChevronUp, FiClock, FiMinus, FiPlus} from "react-icons/fi"
import {
    fetchGroups,
    fetchThirdPlaced,
    drawGroups,
    recordGroupResult,
    reorderGroup,
    resetGroups,
    setGroupAdvance
} from "../api/groups"
import type {Group, GroupMatch, ThirdPlacedTable} from "../types/groups"
import type {TeamShort} from "../types/teams"
import {
    endFirstHalf,
    finishMatch,
    pauseMatch,
    resetMatch,
    resumeMatch,
    startMatch,
    startSecondHalf,
} from "../api/matchEvents"
import type {
    MatchEventDto,
    MatchLiveMode,
} from "../types/matchEvents"
import {fetchSchedule} from "../api/schedule"
import {useLiveSocket} from "../hooks/useLiveSocket"
import {usePolling} from "../hooks/usePolling"
import {useOfflineMatchEvents} from "../hooks/useOfflineMatchEvents"
import {
    liveGroupStandings,
    liveThirdTable,
    type LiveField,
    type LiveGroupStandings,
    type LiveThirdRow,
} from "./liveStandings"
import {LiveSyncIndicator} from "./LiveSyncIndicator"
import {ConfirmDialog, EmptyState, Loader, Panel} from "../ui/primitives"
import {GhostButton} from "../ui/pitch"
import {FiDownload, FiRefreshCw, FiTrash2} from "react-icons/fi"
import {ExportDialog, isMultiDay, kickoffLabel, type ExportMeta} from "./TournamentExport"
import {
    DirectScoreEditor,
    FoulControls,
    LiveClock,
    LiveConsoleHeader,
    LiveEventRow,
    LiveGoalEntry,
    MatchTimelineModal,
    StartLivePopover,
    matchPhase
} from "./liveMatch"

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

/** One config −N+ stepper on the draw board (broj grupa / prolazi / najbolje). */
function ConfigStepper({
    label,
    value,
    onDec,
    onInc,
    decDisabled,
    incDisabled,
}: {
    label: string
    value: number
    onDec: () => void
    onInc: () => void
    decDisabled?: boolean
    incDisabled?: boolean
}) {
    return (
        <Box>
            <Text fontSize="2xs" fontWeight={800} letterSpacing="wider" textTransform="uppercase" color="fg.muted" mb="1.5">
                {label}
            </Text>
            <Flex align="center" borderWidth="1px" borderColor="border" rounded="xl" overflow="hidden" w="fit-content">
                <IconButton aria-label={`Smanji: ${label}`} variant="ghost" rounded="none" h="44px" minW="38px"
                            color="pitch.500" disabled={decDisabled} onClick={onDec}>
                    <FiMinus size={16}/>
                </IconButton>
                <Text minW="44px" textAlign="center" fontSize="md" fontWeight={800} fontVariantNumeric="tabular-nums">
                    {value}
                </Text>
                <IconButton aria-label={`Povećaj: ${label}`} variant="ghost" rounded="none" h="44px" minW="38px"
                            color="pitch.500" disabled={incDisabled} onClick={onInc}>
                    <FiPlus size={16}/>
                </IconButton>
            </Flex>
        </Box>
    )
}

/** One draggable team pill ("kuglica") on the draw board - a ⠿ handle + the
 *  team name. Pointer-drag (same handlers as before); works on touch/iPad. */
function DrawChip({
    name,
    dragging,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
}: {
    name: string | null
    dragging: boolean
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void
    onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void
    onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void
}) {
    return (
        <Flex
            align="center"
            gap="2.5"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            style={{touchAction: "none", userSelect: "none"}}
            borderWidth="1px"
            borderColor="border"
            bg="bg.panel"
            rounded="xl"
            px="3.5"
            py="3"
            cursor="grab"
            opacity={dragging ? 0.35 : 1}
            _hover={{borderColor: "pitch.400"}}
            transition="border-color 120ms"
        >
            <Text as="span" color="fg.subtle" fontSize="md" flexShrink={0} lineHeight="1" css={{letterSpacing: "-2px"}}>⠿</Text>
            <Text fontSize="sm" fontWeight={700} truncate>{name?.trim() || "Bez imena"}</Text>
        </Flex>
    )
}

/** Mono header cell for the SofaScore-style standings grid. */
function StHead({
                    label,
                    mdOnly = false,
                    align = "center",
                }: {
    label: string
    mdOnly?: boolean
    align?: "left" | "center"
}) {
    return (
        <Text
            display={mdOnly ? {base: "none", md: "block"} : undefined}
            fontFamily="mono"
            fontSize="9px"
            color="fg.muted"
            letterSpacing="0.08em"
            fontWeight={700}
            textAlign={align}
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
            display={mdOnly ? {base: "none", md: "block"} : undefined}
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

/* ── Draw draft persistence ─────────────────────────────────────────────
   The draw board's in-progress work (config, kuglice assignments, group
   order) is mirrored to localStorage per tournament so a tab switch or an
   accidental close never loses it. Nothing is applied server-side until the
   organizer hits "Potvrdi ždrijeb" - the draft is purely local and cleared
   on a successful draw. */

type DrawDraft = {
    cfgGroups: string
    cfgAdvance: string
    cfgBestThird: string
    /** teamId → box id (see boxOrder in GroupsTab). */
    assign: Record<number, number>
    /** teamId → drop sequence (drag order = play order). */
    assignSeq: Record<number, number>
    /** Display order of the group boxes (position → box id). */
    boxOrder: number[]
    /** True while the board is open. An unmount mid-work (tab switch) leaves
     *  it true → the board auto-reopens on return; an explicit "Odustani"
     *  flips it false → the work is kept but the board stays closed. */
    open: boolean
}

const drawDraftKey = (uuid: string) => `futsal:draw-draft:${uuid}`

/** Load + sanitize the stored draft: drop assignments of teams that no
 *  longer exist / point past the group count, and reject a boxOrder that
 *  isn't a clean permutation (falls back to the identity order). */
function readDrawDraft(uuid: string, teams: TeamShort[]): DrawDraft | null {
    try {
        const raw = window.localStorage.getItem(drawDraftKey(uuid))
        if (!raw) return null
        const d = JSON.parse(raw) as Partial<DrawDraft>
        const parsed = parseInt(d.cfgGroups ?? "", 10)
        if (!Number.isFinite(parsed) || parsed < 2) return null
        // Teams may have (un)registered since the draft was written - clamp
        // the group count the same way the board does, so no assignment can
        // point at a box that no longer renders (it'd silently vanish from
        // both the pool and the groups).
        const count = Math.min(parsed, Math.max(2, teams.length))
        const ids = new Set(teams.map((t) => t.id))
        const assign: Record<number, number> = {}
        for (const [k, v] of Object.entries(d.assign ?? {})) {
            const id = Number(k)
            // Integer check matters: a fractional box id would strict-equality
            // match no box, leaving the team invisible yet "assigned".
            if (ids.has(id) && typeof v === "number" && Number.isInteger(v) && v >= 0 && v < count)
                assign[id] = v
        }
        const assignSeq: Record<number, number> = {}
        for (const [k, v] of Object.entries(d.assignSeq ?? {})) {
            const id = Number(k)
            if (ids.has(id) && typeof v === "number") assignSeq[id] = v
        }
        const rawOrder = Array.isArray(d.boxOrder) ? (d.boxOrder as number[]) : []
        const isPermutation =
            rawOrder.length === count &&
            [...rawOrder].sort((a, b) => a - b).every((v, i) => v === i)
        return {
            cfgGroups: String(count),
            cfgAdvance: typeof d.cfgAdvance === "string" ? d.cfgAdvance : "2",
            cfgBestThird: typeof d.cfgBestThird === "string" ? d.cfgBestThird : "0",
            assign,
            assignSeq,
            boxOrder: isPermutation ? rawOrder : [],
            // Legacy drafts (written before the flag existed) count as open.
            open: d.open !== false,
        }
    } catch {
        return null
    }
}

function clearDrawDraft(uuid: string) {
    try {
        window.localStorage.removeItem(drawDraftKey(uuid))
    } catch {
        /* private mode - nothing to clear */
    }
}

export default function GroupsTab({
                                      uuid,
                                      advancePerGroup,
                                      groupCount,
                                      bestThirdCount,
                                      teams,
                                      canEdit = false,
                                      tournamentStarted = false,
                                      onGoToSchedule,
                                      exportMeta,
                                  }: {
    uuid: string
    advancePerGroup?: number | null
    /** Configured number of groups (from the tournament) - sizes the manual
     *  draw assignment editor. */
    groupCount?: number | null
    /** How many best "third-placed" teams also advance (0 = feature off).
     *  Seeds the draw config default and gates the third-placed table. */
    bestThirdCount?: number | null
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
    /** Tournament meta for the branded "Export grupe" poster. */
    exportMeta?: ExportMeta
}) {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    // Seed from the react-query cache so returning to the Grupe tab (or a
    // recently-opened tournament) renders instantly instead of refetching.
    const cachedGroups = queryClient.getQueryData<Group[]>(qk.groups(uuid))
    const [groups, setGroups] = useState<Group[] | null>(cachedGroups ?? null)
    const [loading, setLoading] = useState(!cachedGroups)
    const [drawing, setDrawing] = useState(false)
    const [editingId, setEditingId] = useState<number | null>(null)
    const [form, setForm] = useState<EditForm>({s1: "", s2: ""})
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
    // True once the knockout bracket is generated (the schedule carries
    // non-GROUP matches). Locks the per-group advance stepper - changing it
    // then wouldn't retroactively rebuild the already-seeded bracket.
    const [bracketGenerated, setBracketGenerated] = useState(false)
    // Group draw - group count + advance-per-group are chosen here, then the
    // organizer previews an auto-shuffle (or assigns by hand) and confirms it
    // before it's persisted.
    const [drawOpen, setDrawOpen] = useState(false)
    const [cfgGroups, setCfgGroups] = useState("4")
    const [cfgAdvance, setCfgAdvance] = useState("2")
    /** How many best "third-placed" teams also advance (draw config). */
    const [cfgBestThird, setCfgBestThird] = useState("0")
    const [assign, setAssign] = useState<Record<number, number>>({})
    /** teamId → drop sequence, so teams keep their drag order within a group
     (a newly dropped team goes to the bottom). Sent to the backend as the
     draw position, which orders the generated round-robin fixtures. */
    const [assignSeq, setAssignSeq] = useState<Record<number, number>>({})
    /** Draw-board display order: position → box id. Teams are assigned to a
     BOX (stable id, carries its capacity); the letter follows the POSITION
     (slot 0 is always "A"), so moving the bigger box last makes the last
     group the 4-team one. Empty = identity order. */
    const [boxOrder, setBoxOrder] = useState<number[]>([])
    /** Box ids the organizer minimized on the draw board (e.g. full groups). */
    const [collapsedBoxes, setCollapsedBoxes] = useState<Set<number>>(new Set())
    /** advance-per-group just drawn (the page's prop is stale until refetch). */
    const [advanceOverride, setAdvanceOverride] = useState<number | null>(null)
    /** best-third count just drawn (the page's prop is stale until refetch). */
    const [bestThirdOverride, setBestThirdOverride] = useState<number | null>(null)
    /** Live "best third-placed" ranking; null before the group draw. */
    const [thirdTable, setThirdTable] = useState<ThirdPlacedTable | null>(null)
    /** Group ids whose fixtures are expanded. Empty = all collapsed (default). */
    const [expandedGroups, setExpandedGroups] = useState<Set<number>>(new Set())
    const toggleGroup = (id: number) =>
        setExpandedGroups((prev) => {
            const next = new Set(prev)
            next.has(id) ? next.delete(id) : next.add(id)
            return next
        })
    const [resetting, setResetting] = useState(false)
    /** Branded "Export grupe" poster dialog. */
    const [exportOpen, setExportOpen] = useState(false)
    /** Scope to preselect when the export dialog opens - undefined = all groups
     *  (the toolbar Export button); "g:{id}" from a per-group quick download. */
    const [exportScope, setExportScope] = useState<string | undefined>(undefined)

    // Manual-draw drag & drop ("kuglice" board). In MANUAL mode a team with no
    // `assign` entry sits in the left-hand pool; dragging a chip onto a group
    // box assigns it, dragging it back onto the pool unassigns. Pointer events
    // (not HTML5 DnD) so it also works on touch screens - same approach as the
    // schedule tab's drag-to-reorder. Refs mirror the state for the pointer
    // handlers; the ghost chip follows the finger via direct style writes so
    // nothing re-renders on every pointermove.
    const [dragTeam, setDragTeam] = useState<TeamShort | null>(null)
    const [dragOver, setDragOver] = useState<string | null>(null) // "pool" | group ordinal as string
    const dragRef = useRef<TeamShort | null>(null)
    const dragOverRef = useRef<string | null>(null)
    const dragPosRef = useRef({x: 0, y: 0})
    const ghostRef = useRef<HTMLDivElement | null>(null)
    /** rAF id of the drag auto-scroll loop (page scrolls itself when the
     pointer nears the viewport edge - touch drags block native scroll). */
    const scrollRafRef = useRef<number | null>(null)

    useEffect(() => {
        let cancelled = false
        // Only show the spinner on a cold load; a cache hit is already painted.
        if (!queryClient.getQueryData(qk.groups(uuid))) setLoading(true)
        queryClient
            .fetchQuery({queryKey: qk.groups(uuid), queryFn: () => fetchGroups(uuid), staleTime: 15_000})
            .then((g) => {
                if (!cancelled) setGroups(g)
            })
            .catch(() => {
                if (!cancelled) setGroups([])
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        // Schedule is shared with the Raspored + Eliminacija tabs - one cache
        // entry dedupes the clock-config fetch across all three.
        queryClient
            .fetchQuery({queryKey: qk.schedule(uuid), queryFn: () => fetchSchedule(uuid), staleTime: 15_000})
            .then((s) => {
                if (cancelled) return
                setHalfLengthMin(s.halfLengthMin ?? null)
                setHalfCount(s.halfCount ?? null)
                setBracketGenerated((s.matches ?? []).some((m) => m.stage && m.stage !== "GROUP"))
            })
            .catch(() => { /* schedule may not be generated yet - clock free-runs */
            })
        return () => {
            cancelled = true
        }
    }, [uuid])

    // Mirror groups into the cache so a tab-switch / reopen reflects the latest
    // standings instead of a stale snapshot.
    useEffect(() => {
        if (groups) queryClient.setQueryData(qk.groups(uuid), groups)
    }, [groups, uuid, queryClient])

    // Refresh the "best third-placed" ranking whenever the standings change
    // (draw, a result, a reset). Kept in a separate effect keyed on `groups`
    // so it stays in sync with exactly what's displayed. The endpoint returns
    // bestThirdCount = 0 when the feature is off; the table then hides itself.
    useEffect(() => {
        if (!groups || groups.length === 0) {
            setThirdTable(null);
            return
        }
        let cancelled = false
        fetchThirdPlaced(uuid)
            .then((t) => {
                if (!cancelled) setThirdTable(t)
            })
            .catch(() => {
                if (!cancelled) setThirdTable(null)
            })
        return () => {
            cancelled = true
        }
    }, [uuid, groups])

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

    // True when the group fixtures span >1 local date - then every kickoff line
    // shows the short day+date, not just HH:mm. Computed once per render.
    const multiDay = useMemo(
        () => isMultiDay((groups ?? []).flatMap((g) => g.matches).map((m) => m.kickoffAt)),
        [groups],
    )

    // Live standings overlay - the backend rows count FINISHED matches only,
    // so LIVE scores are folded in client-side (provisional points / GD /
    // form, re-ranked with the backend's tie-break rules) with per-cell
    // change-tracking that the grid paints red. See liveStandings.ts.
    const liveOverlays = useMemo(() => {
        const map = new Map<number, LiveGroupStandings>()
        for (const g of groups ?? []) map.set(g.id, liveGroupStandings(g))
        return map
    }, [groups])
    /** True while any group match is in progress - drives the live refresh. */
    const anyGroupLive = useMemo(
        () => (groups ?? []).some((g) => g.matches.some((m) => m.status === "LIVE")),
        [groups],
    )
    // Third-place rows: backend truth when nothing is live (it carries any
    // manual ranking), re-derived from the overlaid groups during a match.
    const thirdRows = useMemo<LiveThirdRow[]>(() => {
        if (!thirdTable || !groups) return []
        if (anyGroupLive) return liveThirdTable(thirdTable, groups, liveOverlays)
        return thirdTable.rows.map((tr) => ({
            ...tr,
            standing: {...tr.standing, liveChanged: new Set<LiveField>(), liveForm: null},
        }))
    }, [thirdTable, groups, anyGroupLive, liveOverlays])

    // Keep the tables fresh for spectators while matches run: refetch on every
    // websocket push for this tournament (goal, finish, recorded result - the
    // finish push is also what clears the red overlay), plus a light poll as
    // fallback while any group match is LIVE.
    useLiveSocket((msg) => {
        if (msg.tournamentUuid && msg.tournamentUuid !== uuid) return
        void reloadGroups()
    }, (groups?.length ?? 0) > 0)
    usePolling(() => {
        void reloadGroups()
    }, 10_000, anyGroupLive)

    // Registered teams (pending self-registrations excluded - same rule the
    // backend draw uses). Declared above the draft effects so they can gate on
    // "teams loaded" and re-run when the team list finally arrives (on a page
    // refresh the parent supplies `teams` a beat after this mounts).
    const registeredTeams = (teams ?? []).filter((tm) => !tm.pendingApproval)

    // Mirror the open draw board into its localStorage draft on every change,
    // so the work survives tab switches / closes. Applied only on confirm.
    useEffect(() => {
        if (!drawOpen) return
        // Never persist until the team list has loaded: on a refresh the board
        // can auto-reopen before `teams` arrives, restore an EMPTY board (no
        // ids to match), and this effect would then clobber the real draft.
        if (registeredTeams.length === 0) return
        try {
            window.localStorage.setItem(
                drawDraftKey(uuid),
                JSON.stringify({
                    cfgGroups,
                    cfgAdvance,
                    cfgBestThird,
                    assign,
                    assignSeq,
                    boxOrder,
                    open: true,
                } satisfies DrawDraft),
            )
        } catch {
            /* storage full / private mode - the draft just won't survive */
        }
    }, [drawOpen, cfgGroups, cfgAdvance, cfgBestThird, assign, assignSeq, boxOrder, uuid, registeredTeams.length])

    // Reopen the draw board automatically when a draft exists and no groups
    // are drawn yet - a tab switch unmounts this component, and without this
    // the organizer would come back to the empty state thinking the work is
    // gone. One-shot per mount; openDraw() itself restores the draft.
    const autoReopenRef = useRef(false)
    useEffect(() => {
        if (autoReopenRef.current || loading || drawOpen || !canEdit) return
        if (groups && groups.length > 0) return
        // Wait for the team list: restoring with an empty `teams` would drop
        // every assignment. This effect re-runs when registeredTeams.length
        // changes, so it fires the moment the teams arrive.
        if (registeredTeams.length === 0) return
        try {
            const raw = window.localStorage.getItem(drawDraftKey(uuid))
            if (!raw) return
            // Only reopen work that was interrupted (tab switch / reload) -
            // an explicitly cancelled board stays closed until the organizer
            // reopens it themselves (the draft is still restored then).
            if ((JSON.parse(raw) as Partial<DrawDraft>).open === false) return
        } catch {
            return
        }
        autoReopenRef.current = true
        openDraw()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, groups, canEdit, drawOpen, registeredTeams.length])

    // Kill a still-running drag auto-scroll loop on unmount.
    useEffect(() => () => {
        if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current)
    }, [])

    /** Re-fetch the groups (after a live action changed the score / status).
     *  Sequenced: with the socket push + 10s poll both firing this, a slow
     *  earlier response could otherwise resolve after a newer one and revert
     *  the table to a stale snapshot (goal briefly "disappearing"). Only the
     *  latest in-flight request is allowed to apply. */
    const reloadSeqRef = useRef(0)

    async function reloadGroups() {
        const seq = ++reloadSeqRef.current
        try {
            const g = await fetchGroups(uuid)
            if (seq === reloadSeqRef.current) setGroups(g)
        } catch {
            /* error toast surfaced by the http interceptor */
        }
    }

    async function runResetGroups() {
        setResetting(true)
        try {
            setGroups(await resetGroups(uuid))
            setEditingId(null)
            // Wiping the group stage invalidates any generated schedule/bracket.
            queryClient.removeQueries({queryKey: qk.schedule(uuid)})
            queryClient.removeQueries({queryKey: qk.bracket(uuid)})
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
            s1: m.score1 != null ? String(m.score1) : "0",
            s2: m.score2 != null ? String(m.score2) : "0",
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

    const grpLabel = (i: number) => String.fromCharCode(65 + i)

    // Draw config (clamped) + derived preview.
    const maxGroups = Math.max(2, registeredTeams.length)
    const gcNum = Math.min(maxGroups, Math.max(2, parseInt(cfgGroups || "0", 10) || 0))
    const advNum = Math.max(1, parseInt(cfgAdvance || "0", 10) || 0)
    // Best "third-placed" that also advance - at most one per group.
    const bestThirdNum = Math.max(0, Math.min(gcNum, parseInt(cfgBestThird || "0", 10) || 0))
    const enoughTeams = registeredTeams.length >= gcNum
    const effectiveAdvance = advanceOverride ?? advancePerGroup
    /** How many advance from THIS group. Uses the backend-resolved value so it
     *  is reliable after a refresh (the tournament-level default on the client
     *  can be stale). Falls back to the client default only for a group not yet
     *  in the payload. */
    const advForGroup = (g: Group): number | null =>
        g.effectiveAdvance ?? (g.advanceCount != null ? g.advanceCount : effectiveAdvance ?? null)
    /** matchId-free: the group whose advance-count save is in flight. */
    const [advSavingGroup, setAdvSavingGroup] = useState<number | null>(null)

    /** Change a group's per-group advance count (organizer). Clamped to the
     *  group size; the backend clamps too. */
    async function changeGroupAdvance(g: Group, next: number) {
        const size = g.standings.length
        const clamped = Math.max(1, Math.min(size, next))
        if (clamped === advForGroup(g)) return
        setAdvSavingGroup(g.id)
        try {
            const updated = await setGroupAdvance(uuid, g.id, clamped)
            // Invalidate any in-flight poll/socket reload so a stale snapshot
            // (fetched before this change committed) can't revert the pill.
            reloadSeqRef.current++
            setGroups(updated)
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setAdvSavingGroup(null)
        }
    }

    /** Effective board order (position → box id); identity until reordered
     or when the stored permutation no longer matches the group count. */
    const boxOrderEff =
        boxOrder.length === gcNum ? boxOrder : Array.from({length: gcNum}, (_, i) => i)

    /** Swap the group box at `pos` with its neighbour (arrow buttons). */
    function moveGroupBox(pos: number, dir: -1 | 1) {
        const to = pos + dir
        if (to < 0 || to >= gcNum) return
        const next = [...boxOrderEff]
        ;[next[pos], next[to]] = [next[to], next[pos]]
        setBoxOrder(next)
    }

    const toggleBoxCollapsed = (b: number) =>
        setCollapsedBoxes((prev) => {
            const next = new Set(prev)
            next.has(b) ? next.delete(b) : next.add(b)
            return next
        })

    /** Enforce per-box capacities for `count` groups: keep assignments that
     *  fit (registration order), overflow drops back to the pool. Shared by
     *  the group-count input and the draft restore - a draft written before
     *  teams (un)registered could otherwise overfill boxes (or submit an
     *  empty group) in ways the drag&drop guard would never allow. */
    function rebalanceAssign(a: Record<number, number>, count: number): Record<number, number> {
        const base = Math.floor(registeredTeams.length / count)
        const rem = registeredTeams.length % count
        const cap = (i: number) => base + (i < rem ? 1 : 0)
        const counts = new Array(count).fill(0)
        const next: Record<number, number> = {}
        for (const tm of registeredTeams) {
            const gi = a[tm.id]
            if (gi != null && gi < count && counts[gi] < cap(gi)) {
                next[tm.id] = gi
                counts[gi]++
            }
        }
        return next
    }

    /** Reset the board to its defaults (fresh pool, config from the props). */
    function resetDrawBoard() {
        const cur = groups?.length || (groupCount && groupCount >= 2 ? groupCount : 0)
        const def = Math.min(maxGroups, cur >= 2 ? cur : 4)
        setCfgGroups(String(def))
        setCfgAdvance(String(effectiveAdvance && effectiveAdvance >= 1 ? effectiveAdvance : 2))
        setCfgBestThird(String((bestThirdOverride ?? bestThirdCount) || 0))
        // Every team starts in the pool; the organizer drags them into groups
        // (or clicks "Nasumično rasporedi" for a shuffle).
        setAssign({})
        setAssignSeq({})
        setBoxOrder([])
        setCollapsedBoxes(new Set())
    }

    function openDraw() {
        // A stored draft (in-progress work from a previous open / tab switch)
        // wins over the defaults; confirming or discarding clears it.
        const draft = readDrawDraft(uuid, registeredTeams)
        if (draft) {
            const c = Math.min(maxGroups, Math.max(2, parseInt(draft.cfgGroups, 10) || 0))
            setCfgGroups(draft.cfgGroups)
            setCfgAdvance(draft.cfgAdvance)
            setCfgBestThird(draft.cfgBestThird)
            // Re-apply capacities: the roster may have changed since the
            // draft was written; trimmed teams drop back into the pool.
            setAssign(rebalanceAssign(draft.assign, c))
            setAssignSeq(draft.assignSeq)
            setBoxOrder(draft.boxOrder)
            setCollapsedBoxes(new Set())
        } else {
            resetDrawBoard()
        }
        setDrawOpen(true)
    }

    /** Throw away the stored draft and start over with a clean board. */
    function discardDraft() {
        clearDrawDraft(uuid)
        resetDrawBoard()
    }

    /** Close the board keeping the draft, but marked closed - "Odustani"
     *  shouldn't force-reopen the board on the next mount the way an
     *  interrupted (tab-switch) session does. */
    function closeDraw() {
        try {
            const raw = window.localStorage.getItem(drawDraftKey(uuid))
            if (raw) {
                const d = JSON.parse(raw) as Partial<DrawDraft>
                d.open = false
                window.localStorage.setItem(drawDraftKey(uuid), JSON.stringify(d))
            }
        } catch {
            /* private mode - the draft doesn't exist anyway */
        }
        setDrawOpen(false)
    }

    function changeGroupCount(v: string) {
        const s = v.replace(/[^\d]/g, "")
        setCfgGroups(s)
        const c = Math.min(maxGroups, Math.max(2, parseInt(s || "0", 10) || 0))
        // A different group count invalidates the custom box order/collapse.
        setBoxOrder([])
        setCollapsedBoxes(new Set())
        // Keep what fits the new group count/capacities, overflow goes back
        // to the pool.
        setAssign((a) => rebalanceAssign(a, c))
    }

    /* ── Draw board helpers ───────────────────────────────────────────── */

    // Per-group capacity: teams split as evenly as possible, the first
    // `remainder` groups take one extra (12 teams / 4 groups → 3,3,3,3;
    // 13 → 4,3,3,3).
    const capOf = (i: number) =>
        Math.floor(registeredTeams.length / gcNum) + (i < registeredTeams.length % gcNum ? 1 : 0)
    // Teams in a group, in the order they were dropped (drag order = play order).
    const teamsInGroup = (i: number) =>
        registeredTeams
            .filter((tm) => assign[tm.id] === i)
            .sort((a, b) =>
                (assignSeq[a.id] ?? Number.MAX_SAFE_INTEGER) -
                (assignSeq[b.id] ?? Number.MAX_SAFE_INTEGER))
    const poolTeams = registeredTeams.filter((tm) => assign[tm.id] == null)
    /** Next drop sequence (one past the current max) so drops append to the end. */
    const nextSeq = (o: Record<number, number>) => {
        let m = 0
        for (const v of Object.values(o)) if (v > m) m = v
        return m + 1
    }
    const allAssigned = poolTeams.length === 0

    /** Randomly place every still-pooled team into the emptiest groups. */
    function fillRemaining() {
        const placed: number[] = []
        setAssign((a) => {
            const counts = new Array(gcNum).fill(0)
            for (const tm of registeredTeams) {
                const gi = a[tm.id]
                if (gi != null && gi < gcNum) counts[gi]++
            }
            const pool = registeredTeams.filter((tm) => a[tm.id] == null)
            for (let i = pool.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1))
                ;[pool[i], pool[j]] = [pool[j], pool[i]]
            }
            const next = {...a}
            for (const tm of pool) {
                let best = -1
                let bestFree = 0
                for (let i = 0; i < gcNum; i++) {
                    const free = capOf(i) - counts[i]
                    if (free > bestFree) {
                        bestFree = free;
                        best = i
                    }
                }
                if (best < 0) break
                next[tm.id] = best
                counts[best]++
                placed.push(tm.id)
            }
            return next
        })
        // Give the newly placed teams sequences so they order after existing ones.
        setAssignSeq((o) => {
            const next = {...o}
            let seq = nextSeq(o)
            for (const id of placed) next[id] = seq++
            return next
        })
    }

    /* Pointer-drag mechanics. The chip captures the pointer, a fixed-position
       ghost follows it, and drop targets are found by hit-testing
       [data-drop] wrappers under the pointer. */
    function moveGhost(x: number, y: number) {
        dragPosRef.current = {x, y}
        const el = ghostRef.current
        if (el) el.style.transform = `translate(${x + 14}px, ${y - 14}px)`
    }

    function zoneAt(x: number, y: number): string | null {
        const el = document.elementFromPoint(x, y) as HTMLElement | null
        return el?.closest<HTMLElement>("[data-drop]")?.dataset.drop ?? null
    }

    /* Drag auto-scroll: chips set touch-action:none, so on touch devices the
       page can't scroll natively mid-drag - on an iPad the organizer couldn't
       reach group boxes below the fold. While a drag is active, a rAF loop
       nudges the window whenever the pointer sits near the viewport's
       top/bottom edge (speed scales with proximity) and re-hit-tests the
       drop zone as the content slides under the finger. */
    function autoScrollTick() {
        if (!dragRef.current) {
            scrollRafRef.current = null
            return
        }
        const {x, y} = dragPosRef.current
        const EDGE = 90
        const h = window.innerHeight
        let dy = 0
        if (y < EDGE) dy = -Math.ceil((EDGE - y) / 5)
        else if (y > h - EDGE) dy = Math.ceil((y - (h - EDGE)) / 5)
        if (dy !== 0) {
            window.scrollBy(0, dy)
            const z = zoneAt(x, y)
            if (z !== dragOverRef.current) {
                dragOverRef.current = z
                setDragOver(z)
            }
        }
        scrollRafRef.current = requestAnimationFrame(autoScrollTick)
    }

    function stopAutoScroll() {
        if (scrollRafRef.current != null) {
            cancelAnimationFrame(scrollRafRef.current)
            scrollRafRef.current = null
        }
    }

    function startDrag(e: React.PointerEvent<HTMLElement>, tm: TeamShort) {
        if (drawing) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = tm
        moveGhost(e.clientX, e.clientY)
        setDragTeam(tm)
        if (scrollRafRef.current == null) {
            scrollRafRef.current = requestAnimationFrame(autoScrollTick)
        }
    }

    function dragMove(e: React.PointerEvent<HTMLElement>) {
        if (!dragRef.current) return
        moveGhost(e.clientX, e.clientY)
        const z = zoneAt(e.clientX, e.clientY)
        if (z !== dragOverRef.current) {
            dragOverRef.current = z
            setDragOver(z)
        }
    }

    function endDrag(e: React.PointerEvent<HTMLElement>) {
        const tm = dragRef.current
        if (!tm) return
        stopAutoScroll()
        const z = zoneAt(e.clientX, e.clientY)
        dragRef.current = null
        dragOverRef.current = null
        setDragTeam(null)
        setDragOver(null)
        if (z == null) return
        if (z === "pool") {
            setAssign((a) => {
                const next = {...a}
                delete next[tm.id]
                return next
            })
            setAssignSeq((o) => {
                const next = {...o}
                delete next[tm.id]
                return next
            })
            return
        }
        const gi = parseInt(z, 10)
        if (!Number.isFinite(gi) || gi < 0 || gi >= gcNum) return
        // A full group only accepts the drop if the team is already in it.
        if (assign[tm.id] !== gi && teamsInGroup(gi).length >= capOf(gi)) return
        setAssign((a) => ({...a, [tm.id]: gi}))
        // Append to the bottom of the group (a fresh sequence past the max),
        // so re-dropping a team also moves it to the end of its group.
        setAssignSeq((o) => ({...o, [tm.id]: nextSeq(o)}))
    }

    function cancelDrag() {
        stopAutoScroll()
        dragRef.current = null
        dragOverRef.current = null
        setDragTeam(null)
        setDragOver(null)
    }

    async function submitDraw() {
        if (!enoughTeams) return
        // Every kuglica must be dragged into a group first.
        if (!allAssigned) return
        // Send the assignments grouped and in draw-board order so the backend
        // records each team's draw position (which orders the fixtures). The
        // ordinal is the box's display POSITION - the backend derives group
        // letters from ordinals, so a reordered board maps 1:1 (position 0 is
        // always group A).
        const assignments: { teamId: number; groupOrdinal: number }[] = []
        for (let pos = 0; pos < gcNum; pos++) {
            for (const tm of teamsInGroup(boxOrderEff[pos])) {
                assignments.push({teamId: tm.id, groupOrdinal: pos})
            }
        }
        try {
            setDrawing(true)
            setGroups(await drawGroups(uuid, {
                mode: "MANUAL",
                groupCount: gcNum,
                advancePerGroup: advNum,
                bestThirdCount: bestThirdNum,
                assignments,
            }))
            setAdvanceOverride(advNum)
            setBestThirdOverride(bestThirdNum)
            setDrawOpen(false)
            setEditingId(null)
            // A (re)draw rebuilds the group structure and invalidates any
            // existing schedule / bracket - drop those tab caches so they
            // refetch fresh instead of showing stale fixtures.
            queryClient.removeQueries({queryKey: qk.schedule(uuid)})
            queryClient.removeQueries({queryKey: qk.bracket(uuid)})
            // The draft is applied - drop it (and the board customizations).
            clearDrawDraft(uuid)
            setBoxOrder([])
            setCollapsedBoxes(new Set())
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setDrawing(false)
        }
    }

    // Subtle green-tinted surface that adapts to light/dark (mirrors the
    // handoff's sage group cards without breaking dark mode).
    const groupTintBg = "color-mix(in srgb, var(--chakra-colors-pitch-500) 6%, var(--chakra-colors-bg-panel))"
    const groupTintBgHover = "color-mix(in srgb, var(--chakra-colors-pitch-500) 12%, var(--chakra-colors-bg-panel))"
    const poolTintBg = "color-mix(in srgb, var(--chakra-colors-pitch-500) 3%, var(--chakra-colors-bg-panel))"
    const ekipaWord = (n: number) => (n === 1 ? "ekipa" : "ekipe")

    const drawPanel = (
        <Panel p={{base: "4", md: "6"}}>
            <VStack align="stretch" gap="5">
                <Box>
                    <Text fontWeight={800} fontSize={{base: "lg", md: "xl"}}>Ždrijeb grupa</Text>
                    <Text fontSize="sm" color="fg.muted" fontWeight={500}>
                        Skica se sprema automatski — primjenjuje se tek klikom na „Potvrdi ždrijeb".
                    </Text>
                </Box>

                {/* Config steppers: group count / advance / best next-placed. */}
                <Flex gap={{base: "5", md: "7"}} wrap="wrap">
                    <ConfigStepper
                        label="Broj grupa"
                        value={gcNum}
                        onDec={() => changeGroupCount(String(gcNum - 1))}
                        onInc={() => changeGroupCount(String(gcNum + 1))}
                        decDisabled={gcNum <= 2 || drawing}
                        incDisabled={gcNum >= maxGroups || drawing}
                    />
                    <ConfigStepper
                        label="Prolazi po grupi"
                        value={advNum}
                        onDec={() => setCfgAdvance(String(Math.max(1, advNum - 1)))}
                        onInc={() => setCfgAdvance(String(advNum + 1))}
                        decDisabled={advNum <= 1}
                    />
                    {/* Best next-placed ("third") teams; label position tracks advNum. */}
                    <ConfigStepper
                        label={`Najbolje ${advNum + 1}. plasirane`}
                        value={bestThirdNum}
                        onDec={() => setCfgBestThird(String(Math.max(0, bestThirdNum - 1)))}
                        onInc={() => setCfgBestThird(String(Math.min(gcNum, bestThirdNum + 1)))}
                        decDisabled={bestThirdNum <= 0}
                        incDisabled={bestThirdNum >= gcNum}
                    />
                </Flex>

                {bestThirdNum > 0 && (
                    <Text fontSize="xs" color="fg.muted">
                        U eliminaciju prolazi {gcNum} × {advNum} = {gcNum * advNum} po grupama
                        {" + "}
                        {bestThirdNum} najbolje {advNum + 1}. plasirane ={" "}
                        <Text as="span" fontWeight={700} color="fg.ink">{gcNum * advNum + bestThirdNum} ekipa</Text>.
                    </Text>
                )}

                {!enoughTeams && (
                    <Text fontSize="xs" color="red.fg">
                        Potrebno je barem {gcNum} ekipa za {gcNum} grupe (prijavljeno {registeredTeams.length}).
                    </Text>
                )}

                {/* ── Toolbar: status + tools (hairline top+bottom). ────── */}
                <Flex
                    align="center"
                    gap="3"
                    wrap="wrap"
                    py="3.5"
                    borderTopWidth="1px"
                    borderBottomWidth="1px"
                    borderColor="border"
                >
                    <Text fontSize="sm" fontWeight={700} color="fg.muted" flex="1" minW="180px">
                        Povuci kuglicu u željenu skupinu. {poolTeams.length > 0
                        ? `Raspoređeno ${registeredTeams.length - poolTeams.length}/${registeredTeams.length}.`
                        : "Sve ekipe su raspoređene."}
                    </Text>
                    <Button
                        size="sm"
                        colorPalette="brand"
                        onClick={fillRemaining}
                        disabled={poolTeams.length === 0}
                    >
                        <LuShuffle size={15}/> Nasumično rasporedi
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        colorPalette="brand"
                        onClick={() => setAssign({})}
                        disabled={registeredTeams.length === poolTeams.length}
                    >
                        <LuRotateCcw size={14}/> Isprazni
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        colorPalette="red"
                        onClick={discardDraft}
                        disabled={drawing}
                    >
                        <FiTrash2 size={14}/> Odbaci skicu
                    </Button>
                    <Button
                        size="sm"
                        colorPalette="brand"
                        onClick={submitDraw}
                        loading={drawing}
                        disabled={!enoughTeams || !allAssigned}
                        title={!allAssigned ? "Rasporedi sve kuglice u skupine prije potvrde" : undefined}
                    >
                        Potvrdi ždrijeb
                    </Button>
                    <Button size="sm" variant="ghost" colorPalette="gray" onClick={closeDraw} disabled={drawing}>
                        Odustani
                    </Button>
                </Flex>

                {/* ── Drag & drop board: pool (left) + group cards (right). */}
                <Box display="grid" gridTemplateColumns={{base: "1fr", md: "300px 1fr"}} gap="5" alignItems="start">
                    {/* Pool ("kuglice") - dashed drop zone, also unassigns. */}
                    <Box position="relative">
                        <Box
                            data-drop="pool"
                            borderWidth="2px"
                            borderStyle="dashed"
                            borderColor="border"
                            rounded="2xl"
                            p="3.5"
                            minH="280px"
                            css={{background: poolTintBg}}
                            transition="border-color 120ms"
                        >
                            <Flex align="center" justify="space-between" mb="3">
                                <Text fontWeight={800} fontSize="md">Kuglice / ekipe</Text>
                                <Box
                                    as="span"
                                    bg="pitch.500"
                                    color="white"
                                    fontSize="xs"
                                    fontWeight={800}
                                    px="2.5"
                                    py="1"
                                    rounded="full"
                                    fontVariantNumeric="tabular-nums"
                                >
                                    {poolTeams.length}
                                </Box>
                            </Flex>
                            {poolTeams.length === 0 && (
                                <Text fontSize="sm" color="fg.muted" fontWeight={500} py="8" textAlign="center">
                                    Sve raspoređeno — povuci ekipu ovamo da je vratiš.
                                </Text>
                            )}
                            <VStack align="stretch" gap="2">
                                {poolTeams.map((tm) => (
                                    <DrawChip
                                        key={tm.id}
                                        name={tm.name}
                                        dragging={dragTeam?.id === tm.id}
                                        onPointerDown={(e) => startDrag(e, tm)}
                                        onPointerMove={dragMove}
                                        onPointerUp={endDrag}
                                        onPointerCancel={cancelDrag}
                                    />
                                ))}
                            </VStack>
                        </Box>
                        {dragOver === "pool" && (
                            <Box position="absolute" inset="0" rounded="2xl" borderWidth="2px" borderColor="pitch.500"
                                 css={{background: "color-mix(in srgb, var(--chakra-colors-pitch-500) 8%, transparent)"}}
                                 pointerEvents="none"/>
                        )}
                    </Box>

                    {/* Group cards. Boxes are stable ids carrying teams + capacity;
                        the LETTER follows the display position (slot 0 = "A"), so
                        the arrow buttons move e.g. the 4-team group to the end.
                        Full boxes can be collapsed. */}
                    <Box display="grid" gridTemplateColumns={{base: "1fr", sm: "repeat(auto-fill, minmax(240px, 1fr))"}}
                         gap="3.5">
                        {Array.from({length: gcNum}, (_, pos) => {
                            const i = boxOrderEff[pos]
                            const inGroup = teamsInGroup(i)
                            const cap = capOf(i)
                            const full = inGroup.length >= cap
                            const hovered = dragOver === String(i)
                            const isCollapsed = collapsedBoxes.has(i)
                            return (
                                <Box key={i} position="relative">
                                    <Box
                                        data-drop={String(i)}
                                        borderWidth="1px"
                                        borderColor="border"
                                        rounded="2xl"
                                        overflow="hidden"
                                        minH={isCollapsed ? undefined : "200px"}
                                        css={{background: hovered && !full ? groupTintBgHover : groupTintBg}}
                                        transition="background 120ms"
                                    >
                                        <HStack justify="space-between" px="3.5" py="2.5" gap="1">
                                            <Text fontSize="xs" fontWeight={800} letterSpacing="0.06em" color="fg.ink">
                                                SKUPINA {grpLabel(pos)}
                                            </Text>
                                            <HStack gap="0.5">
                                                <Box
                                                    as="span"
                                                    bg="bg.panel"
                                                    borderWidth="1px"
                                                    borderColor="pitch.muted"
                                                    color="pitch.500"
                                                    fontSize="xs"
                                                    fontWeight={800}
                                                    px="2.5"
                                                    py="0.5"
                                                    rounded="full"
                                                    mr="1"
                                                    fontVariantNumeric="tabular-nums"
                                                    whiteSpace="nowrap"
                                                >
                                                    {inGroup.length} {ekipaWord(inGroup.length)}
                                                </Box>
                                                <IconButton
                                                    aria-label="Pomakni skupinu gore" size="xs" h="22px" minW="22px"
                                                    variant="ghost" disabled={pos === 0 || drawing}
                                                    onClick={() => moveGroupBox(pos, -1)}
                                                >
                                                    <FiArrowUp size={12}/>
                                                </IconButton>
                                                <IconButton
                                                    aria-label="Pomakni skupinu dolje" size="xs" h="22px" minW="22px"
                                                    variant="ghost" disabled={pos === gcNum - 1 || drawing}
                                                    onClick={() => moveGroupBox(pos, 1)}
                                                >
                                                    <FiArrowDown size={12}/>
                                                </IconButton>
                                                <IconButton
                                                    aria-label={isCollapsed ? "Proširi skupinu" : "Minimiziraj skupinu"}
                                                    size="xs" h="22px" minW="22px" variant="ghost"
                                                    onClick={() => toggleBoxCollapsed(i)}
                                                >
                                                    {isCollapsed ? <FiChevronDown size={13}/> : <FiChevronUp size={13}/>}
                                                </IconButton>
                                            </HStack>
                                        </HStack>
                                        {/* Collapsed: a one-line roster summary (still a drop target). */}
                                        {isCollapsed && (
                                            <Text px="3.5" pb="2.5" fontSize="xs" color="fg.muted" truncate>
                                                {inGroup.length > 0
                                                    ? inGroup.map((tm) => tm.name?.trim() || "Bez imena").join(" · ")
                                                    : "Prazno"}
                                            </Text>
                                        )}
                                        {!isCollapsed && (
                                            <VStack align="stretch" gap="2" px="3.5" pb="3.5">
                                                {inGroup.length === 0 && (
                                                    <Flex align="center" justify="center" py="8" px="3"
                                                          borderWidth="1px" borderStyle="dashed" borderColor="border"
                                                          rounded="xl" color="fg.muted" fontSize="sm" fontWeight={500}>
                                                        Povuci ekipu ovamo
                                                    </Flex>
                                                )}
                                                {inGroup.map((tm) => (
                                                    <DrawChip
                                                        key={tm.id}
                                                        name={tm.name}
                                                        dragging={dragTeam?.id === tm.id}
                                                        onPointerDown={(e) => startDrag(e, tm)}
                                                        onPointerMove={dragMove}
                                                        onPointerUp={endDrag}
                                                        onPointerCancel={cancelDrag}
                                                    />
                                                ))}
                                            </VStack>
                                        )}
                                    </Box>
                                    {hovered && (
                                        <Box position="absolute" inset="0" rounded="2xl" borderWidth="2px"
                                             borderColor={full ? "red.500" : "pitch.500"}
                                             css={{background: full
                                                 ? "color-mix(in srgb, var(--chakra-colors-red-500) 8%, transparent)"
                                                 : "color-mix(in srgb, var(--chakra-colors-pitch-500) 9%, transparent)"}}
                                             pointerEvents="none"/>
                                    )}
                                </Box>
                            )
                        })}
                    </Box>
                </Box>

                {/* Floating chip that follows the pointer while dragging. */}
                {dragTeam && (
                    <Box
                        ref={ghostRef}
                        position="fixed"
                        top="0"
                        left="0"
                        zIndex={1500}
                        pointerEvents="none"
                        px="3"
                        py="1.5"
                        rounded="lg"
                        bg="pitch.500"
                        color="white"
                        fontSize="sm"
                        fontWeight={700}
                        boxShadow="lg"
                        style={{
                            transform: `translate(${dragPosRef.current.x + 14}px, ${dragPosRef.current.y - 14}px)`,
                            willChange: "transform",
                        }}
                    >
                        {dragTeam.name?.trim() || "Bez imena"}
                    </Box>
                )}
            </VStack>
        </Panel>
    )

    if (loading) {
        return <Loader/>
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

    // Group fixtures in play order: by scheduled kickoff (soonest first), so a
    // rescheduled match lands in the right spot instead of staying in id order.
    // Matches without a kickoff (not yet scheduled) fall to the end, by id.
    const matchesByKickoff = (ms: GroupMatch[]) =>
        [...ms].sort((a, b) => {
            const ta = a.kickoffAt ? new Date(a.kickoffAt).getTime() : Number.POSITIVE_INFINITY
            const tb = b.kickoffAt ? new Date(b.kickoffAt).getTime() : Number.POSITIVE_INFINITY
            if (ta !== tb) return ta - tb
            return a.matchId - b.matchId
        })

    const renderFixture = (m: GroupMatch) => {
        const editable = m.team1Id != null && m.team2Id != null
        const editing = editingId === m.matchId
        const isFinished = m.status === "FINISHED"
        const isLive = m.status === "LIVE"
        const isScheduled = m.status === "SCHEDULED"
        const hasScore = m.score1 != null && m.score2 != null
        const scoreboard = isLive || isFinished
        const isNext = m.matchId === nextMatchId
        // Long club names shrink a touch and wrap (up to three lines) so they
        // stay readable instead of truncating.
        const maxLen = Math.max((m.team1Name ?? "").length, (m.team2Name ?? "").length)
        const nameFont = maxLen > 26 ? {base: "12px", md: "13px"} : "sm"
        return (
            <Box
                key={m.matchId}
                borderWidth={isLive || isNext ? "2px" : "1px"}
                borderColor={isLive || isNext ? "red.emphasized" : "border"}
                rounded="lg"
                px={{base: "2.5", md: "3"}}
                py="1.5"
                bg="bg.panel"
                cursor="pointer"
                onClick={() => {
                    if (editing) return
                    // Organizer clicking a LIVE match → open the management modal
                    // (run the game). A played (FINISHED) match opens the full
                    // "detalji utakmice" page. Everything else (scheduled, or a
                    // spectator on a live match) gets the read-only timeline
                    // modal. Action buttons stopPropagation.
                    if (canEdit && editable && isLive) {
                        setLiveMatch(m)
                    } else if (isFinished) {
                        navigate(`/turniri/${uuid}/utakmica/${m.matchId}`)
                    } else {
                        setTimelineMatch(m)
                    }
                }}
            >
                <VStack align="stretch" gap="1">
                    {/* Teams + score - team1 right, score centre, team2 left. Names
                        wrap to max 2 lines; the centre cell keeps a fixed height so
                        toggling the score editor doesn't shift the row. Teams sit ON
                        TOP; the time / action row is below. */}
                    <Box
                        display="grid"
                        gridTemplateColumns={editing ? "1fr 120px 1fr" : "1fr 84px 1fr"}
                        alignItems="center"
                        gap={{base: "2", sm: "4"}}
                    >
                        <Text
                            fontSize={nameFont}
                            fontWeight={700}
                            color="fg.ink"
                            textAlign="right"
                            lineClamp="3"
                        >
                            {m.team1Name ?? "-"}
                        </Text>
                        <Flex justify="center" align="center" minH="9">
                            {editing ? (
                                // Result typed inline where the score sits.
                                <HStack gap="1" justify="center" onClick={(e) => e.stopPropagation()}>
                                    <Input
                                        size="sm"
                                        type="number"
                                        min={0}
                                        w="12"
                                        textAlign="center"
                                        rounded="lg"
                                        value={form.s1}
                                        onChange={(e) => setForm((f) => ({...f, s1: e.target.value}))}
                                    />
                                    <Text fontWeight={800} color="fg.muted">:</Text>
                                    <Input
                                        size="sm"
                                        type="number"
                                        min={0}
                                        w="12"
                                        textAlign="center"
                                        rounded="lg"
                                        value={form.s2}
                                        onChange={(e) => setForm((f) => ({...f, s2: e.target.value}))}
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
                        </Flex>
                        <Text
                            fontSize={nameFont}
                            fontWeight={700}
                            color="fg.ink"
                            textAlign="left"
                            lineClamp="3"
                        >
                            {m.team2Name ?? "-"}
                        </Text>
                    </Box>

                    {/* Meta row (below) - live badge left, kickoff time centred,
                        organizer control (Start / Uredi) + live clock bottom-right,
                        in the same row / column as the time. Fixed minH so the time
                        doesn't nudge when the action toggles on edit. "Na redu"
                        removed - the red border already marks the next match. */}
                    <Flex align="center" gap="2" wrap="wrap" minH="8">
                        {/* Left: live badge */}
                        <HStack flex="1" minW="0" gap="2" justify="flex-start" wrap="wrap">
                            {isLive && <LivePill/>}
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
                                    <FiClock size={11}/>
                                    <Box>
                                        {kickoffLabel(m.kickoffAt, multiDay)}
                                    </Box>
                                </HStack>
                            )}
                        </Box>

                        {/* Right: live clock + organizer action (Start / Uredi) */}
                        <Flex flex="1" minW="0" justify="flex-end" align="center" gap="2">
                            {isLive && m.liveMode === "TIMER" && (
                                <LiveClock
                                    liveStartedAt={m.liveStartedAt}
                                    firstHalfEndedAt={m.firstHalfEndedAt}
                                    secondHalfStartedAt={m.secondHalfStartedAt}
                                    livePausedAt={m.livePausedAt}
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
            {/* Actions row - the branded Export is always available (viewers
                too); the destructive draw actions stay organizer-only and
                hidden once a match has been played. */}
            <Flex justify="flex-end" gap="2" wrap="wrap">
                <GhostButton
                    icon={<FiDownload size={14}/>}
                    onClick={() => {
                        setExportScope(undefined)
                        setExportOpen(true)
                    }}
                >
                    Preuzmi
                </GhostButton>
                {canEdit && !started && (
                    <>
                        <GhostButton
                            danger
                            icon={<FiRefreshCw size={14}/>}
                            onClick={openDraw}
                            disabled={drawing}
                        >
                            {drawing ? "Ždrijeb…" : "Ponovi ždrijeb"}
                        </GhostButton>
                        <GhostButton
                            danger
                            icon={<FiTrash2 size={14}/>}
                            onClick={confirmResetGroups}
                            disabled={drawing || resetting}
                        >
                            {resetting ? "Resetiranje…" : "Resetiraj"}
                        </GhostButton>
                    </>
                )}
            </Flex>

            {/* Branded groups poster (PDF / JPG). */}
            <ExportDialog
                open={exportOpen}
                onClose={() => setExportOpen(false)}
                kind="groups"
                meta={exportMeta ?? { tournamentName: "Turnir", tournamentUrl: `${window.location.origin}/turniri/${uuid}` }}
                groups={groups ?? []}
                initialScope={exportScope}
            />

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
                onConfirm={async () => {
                    await runResetGroups();
                    setConfirmResetGroupsOpen(false)
                }}
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
                                icon={<FiClock size={14}/>}
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
                gridTemplateColumns={{base: "1fr", lg: "repeat(2, 1fr)"}}
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
                                {/* "N PROLAZE" - a read-only pill for viewers; the
                                organizer gets −/+ steppers to set how many
                                advance from THIS group (e.g. 2 from the 4-team
                                group, 1 from the rest). A per-group override is
                                marked so it's clear it differs from the default. */}
                                {(() => {
                                    const adv = advForGroup(g)
                                    if (adv == null || adv <= 0) return null
                                    const overridden = g.advanceCount != null
                                    // Read-only for viewers, and once the bracket is
                                    // generated (changing it wouldn't rebuild it).
                                    if (!canEdit || bracketGenerated) {
                                        return (
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
                                                {adv} PROLAZE
                                            </Box>
                                        )
                                    }
                                    const busy = advSavingGroup === g.id
                                    return (
                                        <HStack
                                            gap="0.5"
                                            bg={overridden ? "rgba(58,165,107,0.18)" : "rgba(58,165,107,0.12)"}
                                            borderWidth={overridden ? "1px" : "0"}
                                            borderColor="pitch.500"
                                            rounded="full"
                                            pl="1"
                                            pr="1.5"
                                            py="0.5"
                                            title={overridden ? "Prilagođeno za ovu skupinu (klik za promjenu)" : "Koliko ekipa prolazi iz ove skupine"}
                                        >
                                            <IconButton
                                                aria-label="Manje prolaznika"
                                                size="2xs"
                                                h="18px"
                                                minW="18px"
                                                variant="ghost"
                                                color="pitch.600"
                                                disabled={busy || adv <= 1}
                                                onClick={() => changeGroupAdvance(g, adv - 1)}
                                            >
                                                <FiMinus size={11}/>
                                            </IconButton>
                                            <Box fontFamily="mono" fontSize="9px" fontWeight={800}
                                                 letterSpacing="0.04em" color="pitch.600" px="0.5" whiteSpace="nowrap">
                                                {adv} PROLAZE
                                            </Box>
                                            <IconButton
                                                aria-label="Više prolaznika"
                                                size="2xs"
                                                h="18px"
                                                minW="18px"
                                                variant="ghost"
                                                color="pitch.600"
                                                disabled={busy || adv >= g.standings.length}
                                                onClick={() => changeGroupAdvance(g, adv + 1)}
                                            >
                                                <FiPlus size={11}/>
                                            </IconButton>
                                        </HStack>
                                    )
                                })()}
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
                                            <FiEdit2/>
                                        </IconButton>
                                    )}
                                {/* Per-group quick export (everyone) - opens the poster
                                    dialog with this group's scope preselected. */}
                                <IconButton
                                    aria-label={`Izvezi grupu ${g.name}`}
                                    size="sm"
                                    variant="ghost"
                                    colorPalette="brand"
                                    onClick={() => {
                                        setExportScope(`g:${g.id}`)
                                        setExportOpen(true)
                                    }}
                                >
                                    <FiDownload size={15}/>
                                </IconButton>
                            </HStack>
                        </Flex>

                        {/* v3 compact standings - CSS grid, not <table>.
                         Columns: # | EKIPA | UT | P | N | I | GR | (GOL |
                         ZADNJIH 5 md-only) | BOD. LIVE matches count in
                         provisionally - cells they modified render red until
                         the match finishes. Advancing rows get green-tint bg
                         + 3px green left border. */}
                        <Box>
                            {/* Column header - SofaScore-style: each stat its own
                            column, all on one row (no stacking under the name).
                            Mobile keeps UT + P·N·I + GR + BOD; md adds GOL/
                            Zadnjih 5. */}
                            <Box
                                display="grid"
                                gridTemplateColumns={{
                                    base: "22px 1fr 20px 20px 20px 20px 28px 30px",
                                    md: "24px 1fr 26px 24px 24px 24px 40px 48px 92px 34px",
                                }}
                                gap="1.5"
                                px={{base: "3", md: "4"}}
                                py="2"
                                bg="bg.surfaceTint2"
                                borderBottomWidth="1px"
                                borderColor="border"
                            >
                                <StHead label="#"/>
                                <Text
                                    fontFamily="mono"
                                    fontSize="9px"
                                    color="fg.muted"
                                    letterSpacing="0.08em"
                                    fontWeight={700}
                                >
                                    EKIPA
                                </Text>
                                <StHead label="UT"/>
                                <StHead label="P"/>
                                <StHead label="N"/>
                                <StHead label="I"/>
                                <StHead label="GR"/>
                                <StHead label="GOL" mdOnly/>
                                <StHead label="ZADNJIH 5" mdOnly align="left"/>
                                <StHead label="BOD"/>
                            </Box>

                            {/* Standings rows - live-overlaid: cells a LIVE match
                            modified render red until the result is persisted. */}
                            {(liveOverlays.get(g.id)?.rows ?? []).map((row, idx) => {
                                const advForG = advForGroup(g)
                                const advances = advForG != null && idx < advForG
                                const lc = (f: LiveField) => row.liveChanged.has(f)
                                return (
                                    <Box
                                        key={row.teamId}
                                        display="grid"
                                        gridTemplateColumns={{
                                            base: "22px 1fr 20px 20px 20px 20px 28px 30px",
                                            md: "24px 1fr 26px 24px 24px 24px 40px 48px 92px 34px",
                                        }}
                                        gap="1.5"
                                        alignItems="center"
                                        minH="56px"
                                        px={{base: "3", md: "4"}}
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
                                        {/* Team name only - stats live in their own columns
                                        now. Clamped to 2 lines with a fixed row min-height
                                        (above) so single- and two-line groups render the
                                        same height and side-by-side cards stay aligned. */}
                                        <Text fontSize="14px" fontWeight={700} color="fg.ink" lineClamp="2" lineHeight="1.25" minW="0">
                                            {row.teamName}
                                        </Text>
                                        {/* UT (odigrano) */}
                                        <StNum
                                            value={row.played}
                                            color={lc("played") ? "accent.red" : undefined}
                                            weight={lc("played") ? 700 : undefined}
                                        />
                                        {/* P · N · I */}
                                        <StNum
                                            value={row.won}
                                            color={lc("won") ? "accent.red" : undefined}
                                            weight={lc("won") ? 700 : undefined}
                                        />
                                        <StNum
                                            value={row.drawn}
                                            color={lc("drawn") ? "accent.red" : undefined}
                                            weight={lc("drawn") ? 700 : undefined}
                                        />
                                        <StNum
                                            value={row.lost}
                                            color={lc("lost") ? "accent.red" : undefined}
                                            weight={lc("lost") ? 700 : undefined}
                                        />
                                        {/* GR (gol-razlika) - shown on mobile too */}
                                        <StNum
                                            weight={lc("goalDiff") ? 700 : 600}
                                            value={row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}
                                            color={
                                                lc("goalDiff")
                                                    ? "accent.red"
                                                    : row.goalDiff > 0
                                                        ? "pitch.500"
                                                        : row.goalDiff < 0
                                                            ? "accent.red"
                                                            : "fg.muted"
                                            }
                                        />
                                        {/* GOL (dani:primljeni) - md only */}
                                        <StNum
                                            value={`${row.goalsFor}:${row.goalsAgainst}`}
                                            mdOnly
                                            color={lc("goals") ? "accent.red" : undefined}
                                            weight={lc("goals") ? 700 : undefined}
                                        />
                                        {/* Zadnjih 5 - md only. Left-aligned so the
                                        badges line up across rows even when
                                        teams have played a different number of
                                        matches. A team playing right now gets a
                                        red OUTLINED provisional badge appended. */}
                                        <HStack
                                            display={{base: "none", md: "flex"}}
                                            gap="1"
                                            justify="flex-start"
                                        >
                                            {/* Cap at 5 badges total: drop the oldest
                                            finished result while the provisional
                                            live badge is appended, so the strip
                                            never overflows its 92px track. */}
                                            {(row.liveForm ? (row.form ?? []).slice(-4) : row.form ?? []).map((res, i) => {
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
                                            {row.liveForm && (
                                                <Flex
                                                    w="16px"
                                                    h="16px"
                                                    rounded="sm"
                                                    align="center"
                                                    justify="center"
                                                    fontFamily="mono"
                                                    fontSize="9px"
                                                    fontWeight={800}
                                                    color="accent.red"
                                                    borderWidth="2px"
                                                    borderColor="accent.red"
                                                    title="Utakmica u tijeku"
                                                >
                                                    {row.liveForm === "W" ? "P" : row.liveForm === "L" ? "I" : "N"}
                                                </Flex>
                                            )}
                                        </HStack>
                                        {/* BOD (bodovi) */}
                                        <Text
                                            fontFamily="heading"
                                            fontSize="18px"
                                            fontWeight={800}
                                            color={lc("points") ? "accent.red" : "fg.ink"}
                                            letterSpacing="-0.02em"
                                            textAlign="center"
                                        >
                                            {row.points}
                                        </Text>
                                    </Box>
                                )
                            })}
                        </Box>

                        {/* Fixtures section - collapsed by default; "Prikaži
                        utakmice" expands this group's matches. */}
                        {g.matches.length > 0 && (
                            <Box
                                px={{base: "2.5", md: "3"}}
                                py="2.5"
                                borderTopWidth="1px"
                                borderColor="border"
                                bg="bg.subtle"
                            >
                                {expandedGroups.has(g.id) ? (
                                    <VStack align="stretch" gap="1.5">
                                        <Flex justify="center" pb="1">
                                            <Button
                                                size="xs"
                                                variant="ghost"
                                                colorPalette="brand"
                                                onClick={() => toggleGroup(g.id)}
                                            >
                                                <FiChevronUp/> Sakrij utakmice
                                            </Button>
                                        </Flex>
                                        {matchesByKickoff(g.matches).map(renderFixture)}
                                    </VStack>
                                ) : (
                                    <Flex justify="center">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            colorPalette="brand"
                                            onClick={() => toggleGroup(g.id)}
                                        >
                                            <FiChevronDown/> Prikaži utakmice ({g.matches.length})
                                        </Button>
                                    </Flex>
                                )}
                            </Box>
                        )}
                    </Box>
                ))}

                {/* ── Best "third-placed" ranking ─────────────────────────────
                 In the group grid so it sits alongside the last group when
                 there's an odd number of groups (2 per row); spans the full
                 width when the group count is even. Not collapsible - it's
                 shown expanded like the group tables. Only when the organizer
                 enabled it at draw time and the tier exists. */}
                {thirdTable && thirdTable.bestThirdCount > 0 && thirdRows.length > 0 && (
                    <Box
                        gridColumn={{lg: (groups!.length % 2 === 0) ? "1 / -1" : undefined}}
                        borderWidth="1px"
                        borderColor="border"
                        rounded="xl"
                        overflow="hidden"
                        bg="bg.panel"
                        h="fit-content"
                    >
                        <Flex
                            align="center"
                            justify="space-between"
                            gap="2"
                            px={{base: "3", md: "4"}}
                            py="3"
                            borderBottomWidth="1px"
                            borderColor="border"
                            wrap="wrap"
                        >
                            <HStack gap="2.5" align="center">
                                <Flex w="26px" h="26px" rounded="md" bg="pitch.500" color="white" align="center"
                                      justify="center">
                                    <LuTrophy size={12}/>
                                </Flex>
                                <Text fontFamily="mono" fontSize="11px" fontWeight={700} letterSpacing="0.1em"
                                      color="fg.ink">
                                    NAJBOLJE {thirdTable.advancePerGroup + 1}. PLASIRANE
                                </Text>
                            </HStack>
                            <Box fontFamily="mono" fontSize="9px" fontWeight={700} letterSpacing="0.06em"
                                 color="pitch.500" bg="rgba(58,165,107,0.12)" px="2.5" py="1" rounded="full">
                                {thirdTable.bestThirdCount} PROLAZE
                            </Box>
                        </Flex>

                        {/* Same column set as the group tables (plus GRP): mobile
                        shows GRP + UT + P·N·I + GR + BOD, md adds GOL and
                        Zadnjih 5. Live-modified cells render red, identically
                        to the group standings. */}
                        <Box
                            display="grid"
                            gridTemplateColumns={{
                                base: "22px 1fr 20px 20px 20px 20px 20px 28px 30px",
                                md: "24px 1fr 36px 26px 24px 24px 24px 40px 48px 92px 34px",
                            }}
                            gap="1.5"
                            px={{base: "3", md: "4"}}
                            py="2"
                            bg="bg.surfaceTint2"
                            borderBottomWidth="1px"
                            borderColor="border"
                        >
                            <StHead label="#"/>
                            <Text fontFamily="mono" fontSize="9px" color="fg.muted" letterSpacing="0.08em"
                                  fontWeight={700}>
                                EKIPA
                            </Text>
                            <StHead label="GRP"/>
                            <StHead label="UT"/>
                            <StHead label="P"/>
                            <StHead label="N"/>
                            <StHead label="I"/>
                            <StHead label="GR"/>
                            <StHead label="GOL" mdOnly/>
                            <StHead label="ZADNJIH 5" mdOnly align="left"/>
                            <StHead label="BOD"/>
                        </Box>

                        {thirdRows.map((tr, idx) => {
                            const q = tr.qualifies
                            const lc = (f: LiveField) => tr.standing.liveChanged.has(f)
                            return (
                                <Box
                                    key={tr.standing.teamId}
                                    display="grid"
                                    gridTemplateColumns={{
                                        base: "22px 1fr 20px 20px 20px 20px 20px 28px 30px",
                                        md: "24px 1fr 36px 26px 24px 24px 24px 40px 48px 92px 34px",
                                    }}
                                    gap="1.5"
                                    alignItems="center"
                                    px={{base: "3", md: "4"}}
                                    py="2.5"
                                    bg={q ? "rgba(58,165,107,0.08)" : undefined}
                                    borderLeftWidth="3px"
                                    borderLeftColor={q ? "pitch.500" : "transparent"}
                                    borderTopWidth={idx === 0 ? "0" : "1px"}
                                    borderTopColor="border"
                                >
                                    <Text fontFamily="mono" fontSize="13px" fontWeight={800}
                                          color={q ? "pitch.500" : "fg.muted"} textAlign="center">
                                        {tr.rank}
                                    </Text>
                                    <Text fontSize="14px" fontWeight={700} color="fg.ink" lineClamp="3" minW="0">
                                        {tr.standing.teamName}
                                    </Text>
                                    <Text fontFamily="mono" fontSize="12px" fontWeight={700} color="fg.muted"
                                          textAlign="center">
                                        {tr.groupName}
                                    </Text>
                                    {/* UT (odigrano) */}
                                    <StNum
                                        value={tr.standing.played}
                                        color={lc("played") ? "accent.red" : undefined}
                                        weight={lc("played") ? 700 : undefined}
                                    />
                                    {/* P · N · I */}
                                    <StNum
                                        value={tr.standing.won}
                                        color={lc("won") ? "accent.red" : undefined}
                                        weight={lc("won") ? 700 : undefined}
                                    />
                                    <StNum
                                        value={tr.standing.drawn}
                                        color={lc("drawn") ? "accent.red" : undefined}
                                        weight={lc("drawn") ? 700 : undefined}
                                    />
                                    <StNum
                                        value={tr.standing.lost}
                                        color={lc("lost") ? "accent.red" : undefined}
                                        weight={lc("lost") ? 700 : undefined}
                                    />
                                    {/* GR (gol-razlika) - shown on mobile too */}
                                    <StNum
                                        weight={lc("goalDiff") ? 700 : 600}
                                        value={tr.standing.goalDiff > 0 ? `+${tr.standing.goalDiff}` : tr.standing.goalDiff}
                                        color={
                                            lc("goalDiff")
                                                ? "accent.red"
                                                : tr.standing.goalDiff > 0
                                                    ? "pitch.500"
                                                    : tr.standing.goalDiff < 0
                                                        ? "accent.red"
                                                        : "fg.muted"
                                        }
                                    />
                                    {/* GOL (dani:primljeni) - md only */}
                                    <StNum
                                        value={`${tr.standing.goalsFor}:${tr.standing.goalsAgainst}`}
                                        mdOnly
                                        color={lc("goals") ? "accent.red" : undefined}
                                        weight={lc("goals") ? 700 : undefined}
                                    />
                                    {/* Zadnjih 5 - md only, with the red outlined
                                    provisional badge while the team plays. */}
                                    <HStack
                                        display={{base: "none", md: "flex"}}
                                        gap="1"
                                        justify="flex-start"
                                    >
                                        {(tr.standing.liveForm
                                                ? (tr.standing.form ?? []).slice(-4)
                                                : tr.standing.form ?? []
                                        ).map((res, i) => {
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
                                        {tr.standing.liveForm && (
                                            <Flex
                                                w="16px"
                                                h="16px"
                                                rounded="sm"
                                                align="center"
                                                justify="center"
                                                fontFamily="mono"
                                                fontSize="9px"
                                                fontWeight={800}
                                                color="accent.red"
                                                borderWidth="2px"
                                                borderColor="accent.red"
                                                title="Utakmica u tijeku"
                                            >
                                                {tr.standing.liveForm === "W" ? "P" : tr.standing.liveForm === "L" ? "I" : "N"}
                                            </Flex>
                                        )}
                                    </HStack>
                                    {/* BOD (bodovi) */}
                                    <Text
                                        fontFamily="mono"
                                        fontSize="14px"
                                        fontWeight={800}
                                        color={lc("points") ? "accent.red" : q ? "pitch.500" : "fg.ink"}
                                        textAlign="center"
                                    >
                                        {tr.standing.points}
                                    </Text>
                                </Box>
                            )
                        })}
                    </Box>
                )}
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
                ;
            [next[idx], next[j]] = [next[j], next[idx]]
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
            onOpenChange={(e) => {
                if (!e.open) onClose()
            }}
            placement="center"
            motionPreset="slide-in-bottom"
            scrollBehavior="inside"
        >
            <Portal>
                <Dialog.Backdrop/>
                <Dialog.Positioner>
                    <Dialog.Content maxW={{base: "92%", md: "440px"}}>
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
                                                <FiArrowUp/>
                                            </IconButton>
                                            <IconButton
                                                aria-label="Pomakni dolje"
                                                size="xs"
                                                variant="ghost"
                                                disabled={idx === order.length - 1}
                                                onClick={() => move(idx, 1)}
                                            >
                                                <FiArrowDown/>
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
            <Box as="span" display="inline-block" boxSize="1.5" rounded="full" bg="white" mr="1"/>
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

    // Offline-first live events: optimistic add/delete, queued while offline,
    // replayed on reconnect (idempotent via a client key).
    const {
        events,
        loaded: eventsLoaded,
        pending: pendingCount,
        online,
        syncing,
        addEvent,
        deleteEvent,
        refetch: refetchEvents,
    } = useOfflineMatchEvents(uuid, matchId)
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
    // Yellow-carded players - marked with 🟨 in the entry roster.
    const yellowIds = useMemo(
        () =>
            new Set(
                (events ?? [])
                    .filter((e) => e.type === "YELLOW_CARD" && e.playerId != null)
                    .map((e) => e.playerId as number),
            ),
        [events],
    )
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
    const [livePausedAt, setLivePausedAt] = useState<string | null>(
        match.livePausedAt ?? null,
    )
    const [halfLengthMin, setHalfLengthMin] = useState<number | null>(null)
    const [halfCount, setHalfCount] = useState<number | null>(null)
    const [endingHalf, setEndingHalf] = useState(false)
    const [startingHalf, setStartingHalf] = useState(false)
    const [pauseBusy, setPauseBusy] = useState(false)

    const [finishing, setFinishing] = useState(false)
    /** Saving a directly-entered final score (no scorers). */
    const [savingScore, setSavingScore] = useState(false)
    /** Live value of the result-only score editor, so the footer "Spremi
     *  rezultat" button (which sits outside the editor) can read it. */
    const [directScore, setDirectScore] = useState<{ s1: number; s2: number }>({
        s1: match.score1 ?? 0,
        s2: match.score2 ?? 0,
    })

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
            .catch(() => { /* error toast surfaced by the http interceptor */
            })
        return () => {
            cancelled = true
        }
    }, [uuid, isTimer])

    /** Re-fetch this match's row to pick up freshly-set live instants. */
    async function refreshMatchHalf() {
        try {
            const groups = await fetchGroups(uuid)
            for (const g of groups) {
                const found = g.matches.find((mm) => mm.matchId === matchId)
                if (found) {
                    setFirstHalfEndedAt(found.firstHalfEndedAt ?? null)
                    setSecondHalfStartedAt(found.secondHalfStartedAt ?? null)
                    setLivePausedAt(found.livePausedAt ?? null)
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

    /** Pause / resume the live clock (optimistic flip + refetch). */
    async function handlePause() {
        setPauseBusy(true)
        try {
            await pauseMatch(uuid, matchId)
            setLivePausedAt(new Date().toISOString())
            await refreshMatchHalf()
            await onChanged()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setPauseBusy(false)
        }
    }

    async function handleResume() {
        setPauseBusy(true)
        try {
            await resumeMatch(uuid, matchId)
            setLivePausedAt(null)
            await refreshMatchHalf()
            await onChanged()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setPauseBusy(false)
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
                livePausedAt,
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

    /** Recompute the displayed score from the event log. An OWN_GOAL's teamId
     *  is the beneficiary, so both goal kinds count the same way. */
    function scoreFromEvents(list: MatchEventDto[]): { s1: number; s2: number } {
        let s1 = 0
        let s2 = 0
        for (const e of list) {
            if (e.type !== "GOAL" && e.type !== "OWN_GOAL") continue
            if (e.teamId === match.team1Id) s1 += 1
            else if (e.teamId === match.team2Id) s2 += 1
        }
        return {s1, s2}
    }

    // Live score derives from the (optimistic) event log; before any event
    // exists fall back to the stored score so a result-only match doesn't
    // flash 0:0. Adding a goal offline updates this instantly.
    const score = events.length > 0
        ? scoreFromEvents(events)
        : {s1: match.score1 ?? 0, s2: match.score2 ?? 0}

    async function refreshAfterMutation() {
        await refetchEvents()
        await onChanged()
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

    /** Save the final score directly (no scorers) via recordGroupResult. We
     *  set the displayed score straight from the entered value and do NOT flag
     *  scoreDirty, so the event-log recompute (which would show 0:0 for a
     *  result-only match) doesn't clobber it. */
    async function handleSaveDirectScore(s1: number, s2: number) {
        setSavingScore(true)
        try {
            await recordGroupResult(uuid, matchId, s1, s2)
            await onChanged()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setSavingScore(false)
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

    // A finished match with no scorer/card events was entered as a plain result
    // ("Unesi samo rezultat"). Editing scorers / cards / fouls is meaningless
    // then, so the dialog collapses to just the score editor + "Poništi
    // utakmicu" (which annuls the result so it can be re-entered).
    const resultOnly = isFinished && eventsLoaded && events.length === 0

    return (
        <>
            <Dialog.Root
                open
                onOpenChange={(e) => {
                    if (!e.open) onClose()
                }}
                placement="center"
                motionPreset="slide-in-bottom"
                scrollBehavior="inside"
            >
                <Portal>
                    <Dialog.Backdrop/>
                    <Dialog.Positioner>
                        <Dialog.Content maxW={{base: "94%", md: "560px"}}>
                            <Dialog.Header pb="2">
                                <Dialog.Title flex="1">
                                    {/* Result-only edit: the score editor below already
                                    shows the names + score, so the big scoreboard
                                    would just duplicate them - use a plain title. */}
                                    {resultOnly ? (
                                        <Text textAlign="center" fontWeight={800} fontSize="md" color="fg.ink">
                                            Uredi rezultat
                                        </Text>
                                    ) : (
                                        /* Big scoreboard header: BIG timer with
                                           pause/play, phase label, teams + score. */
                                        <LiveConsoleHeader
                                            team1Name={match.team1Name ?? null}
                                            team2Name={match.team2Name ?? null}
                                            score1={score.s1}
                                            score2={score.s2}
                                            isLive={!isFinished}
                                            isFinished={isFinished}
                                            isTimer={isTimer}
                                            liveStartedAt={match.liveStartedAt}
                                            firstHalfEndedAt={firstHalfEndedAt}
                                            secondHalfStartedAt={secondHalfStartedAt}
                                            livePausedAt={livePausedAt}
                                            halfLengthMin={halfLengthMin}
                                            halfCount={halfCount}
                                            onPause={handlePause}
                                            onResume={handleResume}
                                            pauseBusy={pauseBusy}
                                            belowTeams={
                                                <FoulControls
                                                    uuid={uuid}
                                                    matchId={matchId}
                                                    half={secondHalfStartedAt ? 2 : 1}
                                                    fouls1First={match.fouls1First}
                                                    fouls1Second={match.fouls1Second}
                                                    fouls2First={match.fouls2First}
                                                    fouls2Second={match.fouls2Second}
                                                />
                                            }
                                        />
                                    )}
                                </Dialog.Title>
                            </Dialog.Header>
                            <Dialog.Body>
                                <VStack align="stretch" gap="2.5">

                                    {/* Direct score entry - only for a result-only
                                    finished match (no scorers to attribute), so
                                    "Uredi" just fixes the number. A live match
                                    tracks goals below instead. */}
                                    {resultOnly && (
                                        <DirectScoreEditor
                                            team1Name={match.team1Name ?? null}
                                            team2Name={match.team2Name ?? null}
                                            initialS1={match.score1 ?? 0}
                                            initialS2={match.score2 ?? 0}
                                            saving={savingScore}
                                            onSave={handleSaveDirectScore}
                                            onChange={(a, b) => setDirectScore({s1: a, s2: b})}
                                            hideSaveButton
                                        />
                                    )}

                                    {/* Add-event - fast one-tap entry. Shown for a
                                    finished match too so "Uredi" can fix a wrong
                                    scorer etc. Hidden for a result-only match -
                                    there are no scorers to attribute. */}
                                    {!resultOnly && (
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
                                            livePausedAt={livePausedAt}
                                            halfLengthMin={halfLengthMin}
                                            halfCount={halfCount}
                                            onAdded={refreshAfterMutation}
                                            onAddEvent={addEvent}
                                            sentOffPlayerIds={sentOffIds}
                                            yellowCardedPlayerIds={yellowIds}
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
                                        {!eventsLoaded && events.length === 0 ? (
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
                                                        key={ev.clientEventId ?? ev.id}
                                                        ev={ev}
                                                        team1Id={match.team1Id}
                                                        canDelete
                                                        deleting={false}
                                                        onDelete={() => deleteEvent(ev)}
                                                    />
                                                ))}
                                            </VStack>
                                        )}
                                        {(!online || pendingCount > 0 || syncing) && (
                                            <Flex justify="center" mt="2">
                                                <LiveSyncIndicator online={online} pending={pendingCount}
                                                                   syncing={syncing}/>
                                            </Flex>
                                        )}
                                    </Box>
                                </VStack>
                            </Dialog.Body>
                            <Dialog.Footer justifyContent="center">
                                {/* Zatvori · the one primary phase button (Završi 1.
                                poluvrijeme → Započni 2. poluvrijeme → Završi; plain
                                "Završi" without the app timer) · Poništi utakmicu. */}
                                <HStack gap="2" justify="center" w="full" maxW="md" wrap="wrap">
                                    <Button variant="ghost" onClick={onClose} flexShrink={0}>
                                        Zatvori
                                    </Button>
                                    {/* Result-only: save the direct score from the footer. */}
                                    {resultOnly && (
                                        <Button
                                            colorPalette="pitch"
                                            flex="1"
                                            loading={savingScore}
                                            onClick={() => handleSaveDirectScore(directScore.s1, directScore.s2)}
                                        >
                                            <FiEdit2/> Spremi rezultat
                                        </Button>
                                    )}
                                    {!isFinished && (
                                        canEndFirstHalf ? (
                                            <Button
                                                colorPalette="red"
                                                flex="1"
                                                loading={endingHalf}
                                                onClick={handleEndFirstHalf}
                                            >
                                                Završi 1. poluvrijeme
                                            </Button>
                                        ) : canStartSecondHalf ? (
                                            <Button
                                                colorPalette="red"
                                                flex="1"
                                                loading={startingHalf}
                                                onClick={handleStartSecondHalf}
                                            >
                                                Započni 2. poluvrijeme
                                            </Button>
                                        ) : (
                                            <Button
                                                colorPalette="red"
                                                flex="1"
                                                loading={finishing}
                                                onClick={requestFinish}
                                            >
                                                Završi
                                            </Button>
                                        )
                                    )}
                                    <Button
                                        colorPalette="red"
                                        variant="outline"
                                        flex="1"
                                        loading={resetting}
                                        onClick={confirmReset}
                                    >
                                        Poništi utakmicu
                                    </Button>
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
                title="Poništiti utakmicu?"
                description="Rezultat i svi događaji se brišu, a utakmica se vraća na 'neodigrano'. Termin ostaje - možeš zatim ponovno unijeti rezultat."
                confirmLabel="Da, poništi"
                onClose={() => setConfirmResetOpen(false)}
                onConfirm={async () => {
                    await doReset();
                    setConfirmResetOpen(false)
                }}
            />
            <ConfirmDialog
                open={confirmFinishOpen}
                busy={finishing}
                title="Završiti utakmicu prije kraja?"
                description="Vrijeme utakmice još nije isteklo. Jesi li siguran da želiš završiti utakmicu?"
                confirmLabel="Da, završi"
                onClose={() => setConfirmFinishOpen(false)}
                onConfirm={async () => {
                    await handleFinish();
                    setConfirmFinishOpen(false)
                }}
            />
        </>
    )
}

