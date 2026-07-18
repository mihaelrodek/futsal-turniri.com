import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react"
import {
    Badge,
    Box,
    Button,
    Dialog,
    Flex,
    HStack,
    Input,
    Portal,
    Text,
    VStack,
} from "@chakra-ui/react"
import {
    SingleEliminationBracket,
    createTheme,
    type MatchComponentProps,
    type MatchType,
} from "@g-loot/react-tournament-brackets"
import {
    confirmBracket,
    fetchBracket,
    fetchBracketQualifiers,
    generateBracket,
    generateBracketManual,
    resetBracket,
    recordKnockoutResult,
    setManualBracketPositions,
    type BracketCandidate,
    type ManualBracketPairing,
    type ManualPositionPairing,
} from "../api/bracket"
import type { Bracket, BracketMatch, BracketRound } from "../types/bracket"
import { fetchGroups, fetchThirdPlaced } from "../api/groups"
import type { Group, ThirdPlacedTable } from "../types/groups"
import { showError, toaster } from "../toaster"
import {
    endFirstHalf,
    pauseMatch,
    resetMatch,
    resumeMatch,
    startSecondHalf,
} from "../api/matchEvents"
import type { MatchEventDto } from "../types/matchEvents"
import { fetchSchedule, updateKickoff } from "../api/schedule"
import type { ScheduledMatch } from "../types/schedule"
import { useOfflineMatchEvents } from "../hooks/useOfflineMatchEvents"
import { LiveSyncIndicator } from "./LiveSyncIndicator"
import { DateTimeField } from "./DateTimeField"
import { ConfirmDialog, EmptyState, Loader, Panel } from "../ui/primitives"
import { GhostButton } from "../ui/pitch"
import { DirectScoreEditor, FoulControls, LiveClock, LiveConsoleHeader, LiveEventRow, LiveGoalEntry, MatchTimelineModal, PenaltyShootout, matchPhase } from "./liveMatch"
import { useTeamColors, teamKit } from "./jersey"
import type { TeamKit } from "../api/tournaments"
import { FiCheck, FiChevronLeft, FiClock, FiCrosshair, FiDownload, FiEdit2, FiRefreshCw, FiShare2, FiTrash2, FiX } from "react-icons/fi"
import { LuRotateCcw, LuShuffle } from "react-icons/lu"
import { useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { qk } from "../queryClient"
import { ExportDialog, isMultiDay, kickoffLabel, type ExportMeta } from "./TournamentExport"

/* ──────────────────────────────────────────────────────────────────────────
   Library data-shape adapter.

   `@g-loot/react-tournament-brackets` consumes a flat MatchType[] where each
   match carries a `nextMatchId` pointing to its successor. We compute that
   by walking adjacent rounds: matches[i] in round R feeds match[floor(i/2)]
   in round R+1. The library handles all column layout + SVG connectors
   from there; we just provide identity + ordering.

   Round titles come straight from our backend (BracketRound.title) - set
   on the lib via `tournamentRoundText` which the lib renders as the column
   heading. State maps PLAYED/RUNNING/SCHEDULED so the lib's hover and
   "winner" styles can fire (though our custom matchComponent ignores
   most of them in favour of the BracketMatch).

   The 3rd-place fixture is intentionally NOT in this list - it stays as a
   separate Panel below the bracket. Putting it in the chain would force
   the lib to draw a spurious connector to the Finale.
   ────────────────────────────────────────────────────────────────────── */
/* Pitch-themed bracket theme - what the library uses for round-header
   pills, connector lines, the SVG canvas background, and the default
   text colour. We pass it via the `theme` prop; without it the library
   falls back to its dark "g-loot" theme (the navy/black round headers
   in the bug screenshot).

   Note: the public ThemeType in the lib's typings is slightly stale -
   it declares `roundHeaders.background`, but the actual createTheme
   implementation reads `roundHeader.backgroundColor` (singular,
   no `s`). The cast to `any` here lets us pass the real schema. */
const bracketTheme = createTheme({
    textColor: {
        main: "#0e1f15",       // fg.ink
        highlighted: "#0b6b3a", // pitch.500
        dark: "#3a4046",
        disabled: "#9ca3af",
    } as any,
    matchBackground: {
        wonColor: "#f0faf4",   // very subtle pitch tint
        lostColor: "#ffffff",
    },
    score: {
        background: {
            wonColor: "#e9f7ee",
            lostColor: "#f3f4f6",
        },
        text: {
            highlightedWonColor: "#0b6b3a",
            highlightedLostColor: "#6b7280",
        },
    },
    border: {
        color: "#e5e7eb",          // border
        highlightedColor: "#0b6b3a", // pitch.500
    },
    // The lib reads `roundHeader.backgroundColor` (singular). Light
    // pitch-tinted pill on a clean cream label.
    roundHeader: {
        backgroundColor: "#e9f7ee", // pitch.50
        fontColor: "#0b6b3a",        // pitch.500
    },
    connectorColor: "#c7d4c9",       // muted sage so connectors sit in the pitch palette
    connectorColorHighlight: "#0b6b3a",
    svgBackground: "transparent",
    fontFamily: "'Inter', system-ui, sans-serif",
    transitionTimingFunction: "ease-out",
    disabledColor: "#9ca3af",
} as any)

function bracketToLibraryMatches(rounds: BracketRound[]): MatchType[] {
    if (rounds.length === 0) return []
    const out: MatchType[] = []
    rounds.forEach((round, roundIdx) => {
        const nextRound = rounds[roundIdx + 1]
        round.matches.forEach((m, matchIdx) => {
            // Pair (0,1) → 0; (2,3) → 1; …
            const successor = nextRound?.matches[Math.floor(matchIdx / 2)]
            const state =
                m.status === "FINISHED"
                    ? "DONE"
                    : m.status === "LIVE"
                        ? "RUNNING"
                        : "SCHEDULED"
            out.push({
                id: m.matchId,
                nextMatchId: successor ? successor.matchId : null,
                tournamentRoundText: round.title,
                startTime: "",
                state,
                participants: [
                    {
                        id: m.team1Id ?? `slot-${m.matchId}-1`,
                        name: m.team1Name ?? "",
                        isWinner:
                            m.winnerTeamId != null &&
                            m.winnerTeamId === m.team1Id,
                        status: null,
                        resultText: m.score1 != null ? String(m.score1) : null,
                    },
                    {
                        id: m.team2Id ?? `slot-${m.matchId}-2`,
                        name: m.team2Name ?? "",
                        isWinner:
                            m.winnerTeamId != null &&
                            m.winnerTeamId === m.team2Id,
                        status: null,
                        resultText: m.score2 != null ? String(m.score2) : null,
                    },
                ],
            })
        })
    })
    return out
}

/**
 * "Eliminacija" tab - the knockout bracket.
 *
 * Before generation: EmptyState with a "generate" button.
 * After: rounds as scrollable columns, podium banner, third-place section,
 * and inline result entry (goals + optional penalty row when level).
 *
 * Each match also supports a LIVE mode: the organizer can start a match
 * (SCHEDULED -> LIVE), record goals and cards from each team's roster, and
 * finish it (LIVE -> FINISHED). Adding/removing a goal makes the backend
 * recompute the score, so the bracket is re-fetched after live actions.
 */
type EditForm = { s1: string; s2: string; p1: string; p2: string }

/**
 * Drag-to-pan for the bracket. Grab with the mouse (or pen) and drag to scroll
 * the bracket in any direction; touch keeps the browser's native momentum
 * scrolling, so we only hijack mouse/pen. A small move threshold tells a real
 * pan apart from a click, and the click that ends a pan is swallowed so it
 * doesn't open a match dialog.
 */
function useDragPan() {
    const ref = useRef<HTMLDivElement>(null)
    const drag = useRef({ down: false, x: 0, y: 0, left: 0, top: 0, moved: false })
    const [dragging, setDragging] = useState(false)

    const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
        if (e.pointerType === "touch") return // native scroll on touch
        // Clear any stale "moved" from a previous drag that didn't end in a
        // click, so it can't wrongly swallow this press's click.
        drag.current.moved = false
        // Don't start a pan when pressing an interactive control (Start menu,
        // result inputs, edit buttons, links…) - otherwise the swallow-click
        // logic below eats their click and e.g. the "Start" menu never opens.
        // Pan only from the empty bracket background / non-interactive areas.
        const target = e.target as HTMLElement | null
        if (
            target?.closest(
                'button, a, input, select, textarea, label, [role="button"], [role="menu"], [role="menuitem"], [data-scope="menu"]',
            )
        ) {
            return
        }
        const el = ref.current
        if (!el) return
        drag.current = {
            down: true,
            x: e.clientX,
            y: e.clientY,
            left: el.scrollLeft,
            top: el.scrollTop,
            moved: false,
        }
        // NOTE: do NOT setDragging(true) here. A press that turns out to be a
        // plain click must not trigger a re-render between pointerdown and the
        // click - the library re-renders each match inside an SVG foreignObject,
        // which would replace the card's DOM node and the browser would then
        // never fire the click (so "open timeline" silently failed on desktop;
        // touch was unaffected because it returns early above). Flip to the
        // grabbing cursor only once a real drag actually starts (in move).
    }
    const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
        const d = drag.current
        if (!d.down) return
        const el = ref.current
        if (!el) return
        const dx = e.clientX - d.x
        const dy = e.clientY - d.y
        if (!d.moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
            d.moved = true
            setDragging(true) // real drag → grabbing cursor (and click-swallow)
        }
        el.scrollLeft = d.left - dx
        el.scrollTop = d.top - dy
    }
    const end = () => {
        if (!drag.current.down) return
        drag.current.down = false
        setDragging(false)
    }
    // Swallow the click that ends a real drag so it doesn't open a match card.
    const onClickCapture = (e: ReactMouseEvent) => {
        if (drag.current.moved) {
            e.preventDefault()
            e.stopPropagation()
            drag.current.moved = false
        }
    }

    return {
        ref,
        dragging,
        handlers: { onPointerDown, onPointerMove, onPointerUp: end, onPointerLeave: end, onClickCapture },
    }
}

/** `canEdit` - true when the viewer is the tournament owner or an admin.
 *  Drives all mutating UI: regenerate bracket, enter result, start a live
 *  match. When false the tab is read-only and the toolbar is collapsed.
 *
 *  `tournamentStarted` - set once any match goes LIVE or FINISHED. When
 *  true, the draw toolbar (manual draw / reset) is removed (re-drawing
 *  mid-tournament would wipe live scores). canEdit controls visibility of
 *  result entry on individual matches; tournamentStarted controls the
 *  destructive whole-bracket draw actions. */
/** One draggable team pill on the manual bracket board - a ⠿ handle + the
 *  team name. Pointer-drag (works on touch/iPad), matching the group board. */
function BracketChip({
    name,
    sub,
    dragging,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
}: {
    name: string | null
    /** Secured-position subtitle (the resolved team name) shown muted under the
     *  label in position mode; null/undefined in team mode. */
    sub?: string | null
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
            w="full"
            minW="0"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            style={{ touchAction: "none", userSelect: "none" }}
            borderWidth="1px"
            borderColor="border"
            bg="bg.panel"
            rounded="xl"
            px="3"
            py="2.5"
            cursor="grab"
            opacity={dragging ? 0.35 : 1}
            _hover={{ borderColor: "pitch.400" }}
            transition="border-color 120ms"
        >
            <Text as="span" color="fg.subtle" fontSize="md" flexShrink={0} lineHeight="1" css={{ letterSpacing: "-2px" }}>⠿</Text>
            <Box minW="0" flex="1">
                <Text fontSize="sm" fontWeight={700} truncate>{name?.trim() || "Bez imena"}</Text>
                {sub ? (
                    <Text fontSize="2xs" color="fg.muted" fontWeight={500} truncate>{sub}</Text>
                ) : null}
            </Box>
        </Flex>
    )
}

/** Knockout round name for a round with the given number of matches. */
function koStageName(matchesInRound: number): string {
    switch (matchesInRound) {
        case 1: return "Finale"
        case 2: return "Polufinale"
        case 4: return "Četvrtfinale"
        case 8: return "Osmina finala"
        case 16: return "Šesnaestina finala"
        default: return `Kolo (${matchesInRound})`
    }
}
/** Short round tag (for "Pobjednik ..." placeholders in the sketch). */
function koStageAbbrev(matchesInRound: number): string {
    switch (matchesInRound) {
        case 1: return "F"
        case 2: return "PF"
        case 4: return "ČF"
        case 8: return "R16"
        case 16: return "R32"
        default: return `K${matchesInRound}`
    }
}

/**
 * Standard single-elimination seed slot order for a bracket of size n (a power
 * of two): per slot, the 1-based seed that belongs there - e.g. n=8 →
 * [1,8,4,5,2,7,3,6]. This is the classic bracket layout (top seed vs bottom
 * seed, halves/quarters split by seed), so that phantom seeds (the byes) are
 * spread evenly across the bracket the way Challonge & co. place them, instead
 * of clustering at the top.
 */
function seedSlotOrder(n: number): number[] {
    let pls = [1, 2]
    while (pls.length < n) {
        const sum = pls.length * 2 + 1
        const next: number[] = []
        for (const p of pls) { next.push(p); next.push(sum - p) }
        pls = next
    }
    return pls
}

/**
 * Lay seed-ordered team ids into a bracket of `n` slots by standard seeding.
 * Seeds beyond the team count are phantom → empty slots, so the resulting
 * first-round pairs put each top seed opposite a phantom (a distributed bye)
 * rather than filling the top of the bracket with byes and the bottom with
 * real matches.
 */
function standardSeedSlots(orderedIds: number[], n: number): (number | null)[] {
    const order = seedSlotOrder(n)
    const out: (number | null)[] = new Array(n).fill(null)
    for (let slot = 0; slot < n; slot++) {
        const seed = order[slot] // 1-based
        out[slot] = seed <= orderedIds.length ? orderedIds[seed - 1] : null
    }
    return out
}

/** One draggable/placeable item on the manual board. Both modes expose
 *  `{ id, name }` so the shared board machinery (drag/drop, slots, sketch)
 *  treats them uniformly:
 *   - team mode (KNOCKOUT_ONLY): a real team; `name` is the team name.
 *   - position mode (GROUPS_KNOCKOUT): a group / best-third placeholder; `name`
 *     is the visible label ("A1", "Najbolji 3. (1)"), `submitLabel` is what the
 *     backend expects ("A1", "3-1"), and `teamName` is the resolved team once
 *     that position is secured (its group's matches are all finished). */
type BoardItem = { id: number; name: string; submitLabel?: string; teamName?: string | null }

/** One slot in the bracket sketch: a placed team, the winner of an earlier
 *  match (placeholder), or an empty slot (a bye's free side). */
type SketchDisp = { kind: "team"; name: string } | { kind: "ph"; label: string } | { kind: "empty" }
type SketchMatch = { a: SketchDisp; b: SketchDisp }
type SketchRound = { stage: string; matches: SketchMatch[] }

/**
 * Build the full elimination sketch from the manual first-round `slots`: the
 * real first-round pairs, then each later round fed by the previous round's
 * winners ("Pobjednik ČF1" placeholders; a bye team propagates through).
 */
function buildBracketSketch(
    slots: (number | null)[],
    matchCount: number,
    bracketN: number,
    teamName: (id: number) => string,
): SketchRound[] {
    const nm = (id: number | null | undefined): string | null => (id != null ? teamName(id) : null)
    // Winner of each match, computed bottom-up so byes carry forward.
    const winners: SketchDisp[][] = []
    const w0: SketchDisp[] = []
    for (let i = 0; i < matchCount; i++) {
        const a = nm(slots[2 * i])
        const b = nm(slots[2 * i + 1])
        if (a && b) w0.push({ kind: "ph", label: `Pobj. ${koStageAbbrev(matchCount)}${i + 1}` })
        else if (a) w0.push({ kind: "team", name: a })
        else if (b) w0.push({ kind: "team", name: b })
        else w0.push({ kind: "empty" })
    }
    winners.push(w0)
    const totalRounds = Math.max(1, Math.round(Math.log2(bracketN)))
    for (let r = 1; r < totalRounds; r++) {
        const prev = winners[r - 1]
        const roundMatches = matchCount / Math.pow(2, r)
        const cur: SketchDisp[] = []
        for (let i = 0; i < roundMatches; i++) {
            const fa = prev[2 * i]
            const fb = prev[2 * i + 1]
            if (fa.kind === "empty" && fb.kind === "empty") cur.push({ kind: "empty" })
            else if (fa.kind === "empty") cur.push(fb)
            else if (fb.kind === "empty") cur.push(fa)
            else cur.push({ kind: "ph", label: `Pobj. ${koStageAbbrev(roundMatches)}${i + 1}` })
        }
        winners.push(cur)
    }
    // Display rounds: round 0 shows the real slots; each later round shows the
    // two feeding matches' winners.
    const rounds: SketchRound[] = []
    const m0: SketchMatch[] = []
    for (let i = 0; i < matchCount; i++) {
        const a = nm(slots[2 * i])
        const b = nm(slots[2 * i + 1])
        m0.push({
            a: a ? { kind: "team", name: a } : { kind: "empty" },
            b: b ? { kind: "team", name: b } : { kind: "empty" },
        })
    }
    rounds.push({ stage: koStageName(matchCount), matches: m0 })
    for (let r = 1; r < totalRounds; r++) {
        const prevWin = winners[r - 1]
        const roundMatches = matchCount / Math.pow(2, r)
        const ms: SketchMatch[] = []
        for (let i = 0; i < roundMatches; i++) ms.push({ a: prevWin[2 * i], b: prevWin[2 * i + 1] })
        rounds.push({ stage: koStageName(roundMatches), matches: ms })
    }
    return rounds
}

/** One line (slot) of a bracket-sketch match card. */
function SketchLine({ disp }: { disp: SketchDisp }) {
    const muted = disp.kind !== "team"
    const text = disp.kind === "team" ? disp.name : disp.kind === "ph" ? disp.label : "slobodan prolaz"
    return (
        <Text px="3" py="2" fontSize="sm" fontWeight={muted ? 500 : 700} fontStyle={muted ? "italic" : undefined} color={muted ? "fg.muted" : "fg.ink"} truncate>
            {text}
        </Text>
    )
}

export default function BracketTab({
    uuid,
    canEdit = false,
    tournamentName,
    format,
    exportMeta,
    onGoToSchedule,
}: {
    uuid: string
    canEdit?: boolean
    /** Accepted for API compatibility; the bracket's "started" lock is derived
     *  from the elimination matches, not the tournament status. */
    tournamentStarted?: boolean
    /** Used for the shared bracket image's filename + share title. */
    tournamentName?: string
    /** Tournament format. GROUPS_KNOCKOUT uses the position-based manual board
     *  (drag group/best-third placeholders); KNOCKOUT_ONLY keeps the team board. */
    format?: string | null
    /** Tournament meta for the branded "Završnica" bracket poster. Optional -
     *  falls back to a name + URL built from `tournamentName` / `uuid`. */
    exportMeta?: ExportMeta
    /** After a position save, jump to the Raspored section (and optionally
     *  auto-open the schedule planner) so the organizer confirms the new times. */
    onGoToSchedule?: (openPlanner: boolean) => void
}) {
    const queryClient = useQueryClient()
    // Seed from the react-query cache so returning to the Eliminacija tab (or a
    // recently-viewed tournament) paints instantly instead of refetching.
    const cachedBracket = queryClient.getQueryData<Bracket>(qk.bracket(uuid))
    const [bracket, setBracket] = useState<Bracket | null>(cachedBracket ?? null)
    const [loading, setLoading] = useState(!cachedBracket)
    const [generating, setGenerating] = useState(false)
    const [editingId, setEditingId] = useState<number | null>(null)
    const [form, setForm] = useState<EditForm>({ s1: "", s2: "", p1: "", p2: "" })
    const [saving, setSaving] = useState(false)
    /** matchId of the card whose "start live" call is in flight. */
    /** The match currently open in the live dialog, or null. */
    const [liveMatch, setLiveMatch] = useState<BracketMatch | null>(null)
    /** Match whose read-only timeline modal is open (any viewer can open it). */
    const [timelineMatch, setTimelineMatch] = useState<BracketMatch | null>(null)
    /** Branded "Završnica" bracket poster dialog. */
    const [exportOpen, setExportOpen] = useState(false)
    // Half config (schedule) so inline row clocks count UP + freeze at each
    // half boundary, like the dialog clock - not a free-running timer.
    const [halfLengthMin, setHalfLengthMin] = useState<number | null>(null)
    const [halfCount, setHalfCount] = useState<number | null>(null)
    // Manual draw - organizer arranges teams into the bracket's first-round slots.
    const [manualOpen, setManualOpen] = useState(false)
    // "Skiciraj završnicu" step: preview the full bracket structure before it's
    // actually generated (only meaningful while the manual board is open).
    const [sketchOpen, setSketchOpen] = useState(false)
    const [slots, setSlots] = useState<(number | null)[]>([])
    const [generatingManual, setGeneratingManual] = useState(false)
    const [resetting, setResetting] = useState(false)
    // Manual draw drag & drop: a team dragged from the pool into a first-round
    // slot (same proven pointer-drag as the group draw board, incl. iPad
    // auto-scroll). `dragOver` is the hovered slot index (as a string) or "pool".
    const [dragTeam, setDragTeam] = useState<BoardItem | null>(null)
    const [dragOver, setDragOver] = useState<string | null>(null)
    const dragRef = useRef<BoardItem | null>(null)
    const dragOverRef = useRef<string | null>(null)
    const dragPosRef = useRef({ x: 0, y: 0 })
    const ghostRef = useRef<HTMLDivElement | null>(null)
    const scrollRafRef = useRef<number | null>(null)
    // Bye picker - when the qualifier count isn't a power of two, the organizer
    // chooses which teams advance directly (round-one bye) before generating.
    const [byeOpen, setByeOpen] = useState(false)
    const [byeIds, setByeIds] = useState<Set<number>>(new Set())
    /** Which destructive bracket action awaits confirmation in the popup. */
    const [confirmAction, setConfirmAction] = useState<null | "reset">(null)
    /** Bracket-confirmation flow (only for brackets with confirmationRequired):
     *  the "Potvrdi ždrijeb" dialog (offer to edit knockout times, then confirm). */
    const [confirmBracketOpen, setConfirmBracketOpen] = useState(false)
    // Eligible teams for the bracket (group qualifiers / all teams) + whether
    // the group stage is finished - both come from the qualifiers endpoint.
    const [qualifiers, setQualifiers] = useState<BracketCandidate[]>([])
    const [groupStageComplete, setGroupStageComplete] = useState(true)
    // Position mode (GROUPS_KNOCKOUT): the group tables + best-third ranking feed
    // the placeholder pool ("A1", "B2", "3-1"…). Fetched on mount so the board is
    // ready even before the group stage finishes.
    const positionMode = format === "GROUPS_KNOCKOUT"
    const [groups, setGroups] = useState<Group[]>([])
    const [thirdPlaced, setThirdPlaced] = useState<ThirdPlacedTable | null>(null)
    // After a position save: prompt the organizer to confirm the schedule times.
    const [positionsSavedOpen, setPositionsSavedOpen] = useState(false)

    useEffect(() => {
        let cancelled = false
        // Only spinner on a cold load; a cache hit is already painted.
        if (!queryClient.getQueryData(qk.bracket(uuid))) setLoading(true)
        queryClient
            .fetchQuery({ queryKey: qk.bracket(uuid), queryFn: () => fetchBracket(uuid), staleTime: 15_000 })
            .then((b) => { if (!cancelled) setBracket(b) })
            .catch(() => { if (!cancelled) setBracket(null) })
            .finally(() => { if (!cancelled) setLoading(false) })
        // Schedule is shared with the Grupe + Raspored tabs - one cache entry.
        queryClient
            .fetchQuery({ queryKey: qk.schedule(uuid), queryFn: () => fetchSchedule(uuid), staleTime: 15_000 })
            .then((s) => {
                if (cancelled) return
                setHalfLengthMin(s.halfLengthMin ?? null)
                setHalfCount(s.halfCount ?? null)
            })
            .catch(() => { /* schedule may not be generated yet - clock free-runs */ })
        fetchBracketQualifiers(uuid)
            .then((q) => {
                if (cancelled) return
                setQualifiers(q.teams)
                setGroupStageComplete(q.groupStageComplete)
            })
            .catch(() => { /* leave defaults - manual draw stays gated */ })
        // Position mode: pull the group tables + best-third ranking so the
        // placeholder pool ("A1", "3-1"…) can be built and secured positions can
        // show the resolved team name.
        if (format === "GROUPS_KNOCKOUT") {
            fetchGroups(uuid, { silent: true })
                .then((gs) => { if (!cancelled) setGroups(gs) })
                .catch(() => { /* leave empty - board just has no positions yet */ })
            fetchThirdPlaced(uuid)
                .then((tp) => { if (!cancelled) setThirdPlaced(tp) })
                .catch(() => { /* best-third stays off */ })
        }
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uuid])

    // Mirror the bracket into the cache so a tab-switch / reopen reflects the
    // latest scores + progression instead of a stale snapshot.
    useEffect(() => {
        if (bracket) queryClient.setQueryData(qk.bracket(uuid), bracket)
    }, [bracket, uuid, queryClient])

    // Cancel any in-flight manual-draw auto-scroll rAF loop on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => () => stopAutoScroll(), [])

    /** Re-fetch the bracket (after a live action changed the score / status). */
    async function reloadBracket() {
        try {
            setBracket(await fetchBracket(uuid))
        } catch {
            /* error toast surfaced by the http interceptor */
        }
    }

    // Generating/resetting the bracket creates/removes knockout fixtures that
    // the Raspored tab schedules (its "Potvrdi raspored" banner waits on the
    // new unscheduled knockout matches) and marks group standings as final.
    // Those tabs read their own cached queries, so drop them to force a fresh
    // fetch instead of showing stale state until staleTime elapses.
    const refreshLinkedTabs = () => {
        queryClient.removeQueries({ queryKey: qk.schedule(uuid) })
        queryClient.removeQueries({ queryKey: qk.groups(uuid) })
    }

    async function runGenerate(byeIds?: number[], shuffleRest?: boolean) {
        setGenerating(true)
        try {
            setBracket(await generateBracket(uuid, byeIds, shuffleRest))
            refreshLinkedTabs()
            setByeOpen(false)
            setEditingId(null)
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setGenerating(false)
        }
    }

    function startEdit(m: BracketMatch) {
        setEditingId(m.matchId)
        setForm({
            s1: m.score1 != null ? String(m.score1) : "",
            s2: m.score2 != null ? String(m.score2) : "",
            p1: m.penalties1 != null ? String(m.penalties1) : "",
            p2: m.penalties2 != null ? String(m.penalties2) : "",
        })
    }

    async function saveResult(m: BracketMatch) {
        const s1 = parseInt(form.s1, 10)
        const s2 = parseInt(form.s2, 10)
        if (!Number.isFinite(s1) || !Number.isFinite(s2)) return
        const body: {
            score1: number
            score2: number
            penalties1?: number
            penalties2?: number
        } = { score1: s1, score2: s2 }
        if (s1 === s2) {
            const p1 = parseInt(form.p1, 10)
            const p2 = parseInt(form.p2, 10)
            if (!Number.isFinite(p1) || !Number.isFinite(p2)) return
            body.penalties1 = p1
            body.penalties2 = p2
        }
        setSaving(true)
        try {
            setBracket(await recordKnockoutResult(uuid, m.matchId, body))
            setEditingId(null)
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setSaving(false)
        }
    }

    /** Save a level knockout result decided by the guided penalty shootout. */
    async function saveResultWithPenalties(m: BracketMatch, pen1: number, pen2: number) {
        const s1 = parseInt(form.s1, 10)
        const s2 = parseInt(form.s2, 10)
        if (!Number.isFinite(s1) || !Number.isFinite(s2)) return
        setSaving(true)
        try {
            setBracket(
                await recordKnockoutResult(uuid, m.matchId, {
                    score1: s1,
                    score2: s2,
                    penalties1: pen1,
                    penalties2: pen2,
                }),
            )
            setEditingId(null)
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setSaving(false)
        }
    }

    async function runResetBracket() {
        setResetting(true)
        try {
            setBracket(await resetBracket(uuid))
            refreshLinkedTabs()
            setEditingId(null)
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setResetting(false)
        }
    }

    /** "Resetiraj" wipes every elimination match - confirm in a popup modal. */
    function confirmResetBracket() {
        setConfirmAction("reset")
    }

    /** SCHEDULED -> LIVE, then open the live dialog and re-fetch. */
    /* ── Library bridge + auto-scroll - every hook here MUST run on
       every render regardless of the loading / no-bracket early
       returns below. React's "Rules of Hooks" rejects any render where
       the hook count changes from the previous render, which is what
       happened the last two times I added a `useMemo` / `useEffect`
       below the gate. Keep them all above. */
    const safeRounds = bracket?.rounds ?? []
    const libraryMatches = useMemo(
        () => bracketToLibraryMatches(safeRounds),
        [safeRounds],
    )
    const matchById = useMemo(() => {
        const m = new Map<string | number, BracketMatch>()
        for (const r of safeRounds) {
            for (const bm of r.matches) m.set(bm.matchId, bm)
        }
        return m
    }, [safeRounds])

    /* Auto-scroll to the currently-LIVE match. Falls back to null
       when the bracket isn't loaded yet - the effect early-returns
       on null so the scroll only fires after data + DOM both exist. */
    const liveMatchId = useMemo(() => {
        for (const r of safeRounds) {
            for (const m of r.matches) {
                if (m.status === "LIVE") return m.matchId
            }
        }
        if (bracket?.thirdPlace?.status === "LIVE") {
            return bracket.thirdPlace.matchId
        }
        return null
    }, [safeRounds, bracket?.thirdPlace])

    /* The match to jump to from the floating "Na redu" button: the LIVE match
       if any, else the next SCHEDULED one by kickoff time (earliest first). */
    const focusTargetId = useMemo(() => {
        const all = [
            ...safeRounds.flatMap((r) => r.matches),
            ...(bracket?.thirdPlace ? [bracket.thirdPlace] : []),
        ]
        const live = all.find((m) => m.status === "LIVE")
        if (live) return live.matchId
        const next = all
            .filter((m) => m.status === "SCHEDULED")
            .sort((a, b) => {
                const ka = a.kickoffAt ? new Date(a.kickoffAt).getTime() : Number.POSITIVE_INFINITY
                const kb = b.kickoffAt ? new Date(b.kickoffAt).getTime() : Number.POSITIVE_INFINITY
                return ka - kb
            })[0]
        return next?.matchId ?? null
    }, [safeRounds, bracket?.thirdPlace])

    // True when the bracket's matches span >1 local date - then every kickoff
    // display carries the short day+date, not just HH:mm. Computed once here
    // (above the early returns) so the hook order stays stable.
    const bracketMultiDay = useMemo(
        () =>
            isMultiDay([
                ...safeRounds.flatMap((r) => r.matches).map((m) => m.kickoffAt),
                ...(bracket?.thirdPlace ? [bracket.thirdPlace.kickoffAt] : []),
            ]),
        [safeRounds, bracket?.thirdPlace],
    )

    const liveRefs = useRef<Map<number, HTMLDivElement>>(new Map())

    /** Scroll the LIVE / next match into the centre of the bracket viewport. */
    function focusMatch() {
        if (focusTargetId == null) return
        const el = liveRefs.current.get(focusTargetId)
        if (el && typeof el.scrollIntoView === "function") {
            el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" })
        }
    }
    useEffect(() => {
        if (liveMatchId == null) return
        // Defer one tick so the library's foreignObject has mounted
        // by the time we look up its ref.
        const t = setTimeout(() => {
            const el = liveRefs.current.get(liveMatchId)
            if (el && typeof el.scrollIntoView === "function") {
                el.scrollIntoView({
                    behavior: "smooth",
                    block: "nearest",
                    inline: "center",
                })
            }
        }, 80)
        return () => clearTimeout(t)
    }, [liveMatchId])

    // Grab-to-pan the bracket viewport (mouse/pen; touch scrolls natively).
    const pan = useDragPan()

    // Kit (dres + hlače) colours → the initials tile on every team row.
    const kitColors = useTeamColors(uuid)

    // Share the public tournament page URL: native share sheet on mobile
    // (WhatsApp etc.), clipboard-copy fallback on desktop browsers without the
    // Web Share API.
    const [sharing, setSharing] = useState(false)
    async function shareBracket() {
        if (sharing) return
        const url = exportMeta?.tournamentUrl ?? `${window.location.origin}/turniri/${uuid}`
        const title = tournamentName ?? "Eliminacijska ljestvica"
        setSharing(true)
        try {
            const nav = navigator as any
            if (nav.share) {
                try {
                    await nav.share({ title, url })
                } catch {
                    /* user cancelled the share sheet - no-op */
                }
            } else {
                await navigator.clipboard.writeText(url)
                toaster.create({
                    type: "success",
                    title: "Link kopiran.",
                    duration: 4000,
                })
            }
        } catch {
            showError("Nije moguće podijeliti poveznicu.")
        } finally {
            setSharing(false)
        }
    }

    // Place the 3rd-place card directly under the Finale. The library centres
    // the final vertically, so we measure the final card's actual position
    // (relative to the scroll content) and pin the 3rd-place card just below it
    // - anchoring to the bracket bottom would drift far away on tall brackets.
    const contentRef = useRef<HTMLDivElement>(null)
    const finalCardRef = useRef<HTMLDivElement>(null)
    const [thirdPos, setThirdPos] = useState<
        { top: number; right: number; width: number } | null
    >(null)
    useLayoutEffect(() => {
        if (!bracket?.thirdPlace) {
            setThirdPos(null)
            return
        }
        const compute = () => {
            const content = contentRef.current
            const fin = finalCardRef.current
            if (!content || !fin) return
            const c = content.getBoundingClientRect()
            const f = fin.getBoundingClientRect()
            if (f.width === 0) return
            setThirdPos({
                top: f.bottom - c.top + 16, // 16px below the final card
                right: Math.max(0, c.right - f.right), // align right edges
                width: f.width,
            })
        }
        // Measure now (before paint) so it lands under the final without a
        // visible jump; re-measure after the library's foreignObject layout
        // settles (mirrors the auto-scroll defer) and on size/viewport changes.
        compute()
        const id = setTimeout(compute, 90)
        const ro =
            typeof ResizeObserver !== "undefined" ? new ResizeObserver(compute) : null
        if (ro && contentRef.current) ro.observe(contentRef.current)
        window.addEventListener("resize", compute)
        return () => {
            clearTimeout(id)
            ro?.disconnect()
            window.removeEventListener("resize", compute)
        }
    }, [bracket, editingId, liveMatch])

    // ─── Manual draw - organizer arranges teams into first-round slots ───
    const nextPow2 = (x: number) => {
        let p = 2
        while (p < x) p <<= 1
        return p
    }
    // Pool = group qualifiers (or all teams for KNOCKOUT_ONLY) from the backend.
    // Drives the automatic + bye flows (always team-based).
    const pool = qualifiers
    const bracketN = pool.length >= 2 ? nextPow2(pool.length) : 2
    // How many teams get a round-one bye (direct advance) - only when the
    // qualifier count isn't already a power of two.
    const byesNeeded = pool.length >= 2 ? bracketN - pool.length : 0

    // ─── Position pool (GROUPS_KNOCKOUT manual board) ───────────────────────
    // Ranked names of the best-third teams that qualify (only settled once every
    // group is finished - the ranking can still change while games remain).
    const thirdRankedNames = useMemo(
        () =>
            (thirdPlaced?.rows ?? [])
                .filter((r) => r.qualifies)
                .sort((a, b) => a.rank - b.rank)
                .map((r) => r.standing.teamName),
        [thirdPlaced],
    )
    // True once every group's matches are FINISHED → the third-place ranking is
    // final, so the "3-<rank>" slots can show their secured team.
    const allGroupsFinished = useMemo(
        () =>
            groups.length > 0 &&
            groups.every((g) => g.matches.length > 0 && g.matches.every((m) => m.status === "FINISHED")),
        [groups],
    )
    // Placeholder items: each group's places (A1..A<adv>, B1..) then the best-third
    // slots (3-1..3-k). A group whose matches are all finished shows the secured
    // team under its label; best-third names appear once every group is finished.
    const positionItems = useMemo<BoardItem[]>(() => {
        const items: BoardItem[] = []
        let idx = 0
        const sorted = [...groups].sort((a, b) => a.ordinal - b.ordinal)
        for (const g of sorted) {
            const finished = g.matches.length > 0 && g.matches.every((m) => m.status === "FINISHED")
            for (let p = 1; p <= g.effectiveAdvance; p++) {
                const label = `${g.name}${p}`
                items.push({
                    id: idx++,
                    name: label,
                    submitLabel: label,
                    teamName: finished ? (g.standings[p - 1]?.teamName ?? null) : null,
                })
            }
        }
        const bestThirdCount = thirdPlaced?.bestThirdCount ?? 0
        for (let r = 1; r <= bestThirdCount; r++) {
            items.push({
                id: idx++,
                name: `Najbolji 3. (${r})`,
                submitLabel: `3-${r}`,
                teamName: allGroupsFinished ? (thirdRankedNames[r - 1] ?? null) : null,
            })
        }
        return items
    }, [groups, thirdPlaced, allGroupsFinished, thirdRankedNames])

    // Items + size for the manual board. Position placeholders for
    // GROUPS_KNOCKOUT, real teams for KNOCKOUT_ONLY (then equal to pool/bracketN).
    const boardItems: BoardItem[] = positionMode ? positionItems : qualifiers
    const boardN = boardItems.length >= 2 ? nextPow2(boardItems.length) : 2
    const boardMatchCount = boardN / 2

    function openManualBracket() {
        // Standard bracket seeding of the board items (qualifiers, or the group /
        // best-third positions in position mode): top seed vs bottom seed, so the
        // byes land distributed across the bracket instead of stacking the free
        // slots at the top.
        setSlots(standardSeedSlots(boardItems.map((t) => t.id), boardN))
        setSketchOpen(false)
        setManualOpen(true)
    }

    function setSlot(idx: number, v: number | null) {
        setSlots((s) => {
            const c = [...s]
            c[idx] = v
            return c
        })
    }

    async function submitManualBracket() {
        const chosen = slots.filter((s): s is number => s != null)
        if (new Set(chosen).size !== chosen.length) {
            showError("Greška", positionMode ? "Ista pozicija je odabrana u više utakmica." : "Ista ekipa je odabrana u više utakmica.")
            return
        }
        if (chosen.length < 2) {
            showError("Greška", positionMode ? "Potrebne su barem 2 pozicije za ljestvicu." : "Potrebne su barem 2 ekipe za ljestvicu.")
            return
        }
        try {
            setGeneratingManual(true)
            if (positionMode) {
                // Map each placed slot back to its backend label ("A1", "3-1"); an
                // empty slot stays null (a bye).
                const labelOf = (id: number | null) =>
                    id != null ? (boardItems.find((it) => it.id === id)?.submitLabel ?? null) : null
                const pairs: ManualPositionPairing[] = []
                for (let i = 0; i < boardMatchCount; i++) {
                    pairs.push({ slot1: labelOf(slots[2 * i] ?? null), slot2: labelOf(slots[2 * i + 1] ?? null) })
                }
                setBracket(await setManualBracketPositions(uuid, pairs))
                refreshLinkedTabs()
                setManualOpen(false)
                setSketchOpen(false)
                setEditingId(null)
                // Positions saved → nudge the organizer to confirm the schedule.
                setPositionsSavedOpen(true)
            } else {
                const pairs: ManualBracketPairing[] = []
                for (let i = 0; i < boardMatchCount; i++) {
                    pairs.push({ team1Id: slots[2 * i] ?? null, team2Id: slots[2 * i + 1] ?? null })
                }
                setBracket(await generateBracketManual(uuid, pairs))
                refreshLinkedTabs()
                setManualOpen(false)
                setSketchOpen(false)
                setEditingId(null)
            }
        } catch {
            /* error toast surfaced by the http interceptor (incl. 409 BRACKET_ALREADY_DRAWN) */
        } finally {
            setGeneratingManual(false)
        }
    }

    // ─── Manual draw drag & drop (same pointer-drag as the group board) ──
    function moveGhost(x: number, y: number) {
        dragPosRef.current = { x, y }
        const el = ghostRef.current
        if (el) el.style.transform = `translate(${x + 14}px, ${y - 14}px)`
    }
    function zoneAt(x: number, y: number): string | null {
        const el = document.elementFromPoint(x, y) as HTMLElement | null
        return el?.closest<HTMLElement>("[data-drop]")?.dataset.drop ?? null
    }
    function autoScrollTick() {
        if (!dragRef.current) { scrollRafRef.current = null; return }
        const { x, y } = dragPosRef.current
        const EDGE = 90
        const h = window.innerHeight
        let dy = 0
        if (y < EDGE) dy = -Math.ceil((EDGE - y) / 5)
        else if (y > h - EDGE) dy = Math.ceil((y - (h - EDGE)) / 5)
        if (dy !== 0) {
            window.scrollBy(0, dy)
            const z = zoneAt(x, y)
            if (z !== dragOverRef.current) { dragOverRef.current = z; setDragOver(z) }
        }
        scrollRafRef.current = requestAnimationFrame(autoScrollTick)
    }
    function stopAutoScroll() {
        if (scrollRafRef.current != null) { cancelAnimationFrame(scrollRafRef.current); scrollRafRef.current = null }
    }
    function startDrag(e: ReactPointerEvent<HTMLElement>, tm: BoardItem) {
        if (generatingManual) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        dragRef.current = tm
        moveGhost(e.clientX, e.clientY)
        setDragTeam(tm)
        if (scrollRafRef.current == null) scrollRafRef.current = requestAnimationFrame(autoScrollTick)
    }
    function dragMove(e: ReactPointerEvent<HTMLElement>) {
        if (!dragRef.current) return
        moveGhost(e.clientX, e.clientY)
        const z = zoneAt(e.clientX, e.clientY)
        if (z !== dragOverRef.current) { dragOverRef.current = z; setDragOver(z) }
    }
    function endDrag(e: ReactPointerEvent<HTMLElement>) {
        const tm = dragRef.current
        if (!tm) return
        stopAutoScroll()
        const z = zoneAt(e.clientX, e.clientY)
        dragRef.current = null; dragOverRef.current = null
        setDragTeam(null); setDragOver(null)
        if (z == null) return
        const from = slots.findIndex((s) => s === tm.id)
        if (z === "pool") { if (from >= 0) setSlot(from, null); return }
        const idx = parseInt(z, 10)
        if (!Number.isFinite(idx) || idx < 0 || idx >= boardN || from === idx) return
        // Drop into the target slot; a team already there swaps back to the
        // dragged team's old slot (or the pool, if it came from the pool).
        setSlots((s) => {
            const c = [...s]
            const occupant = c[idx]
            c[idx] = tm.id
            if (from >= 0) c[from] = occupant
            return c
        })
    }
    function cancelDrag() {
        stopAutoScroll()
        dragRef.current = null; dragOverRef.current = null
        setDragTeam(null); setDragOver(null)
    }

    /** Random draw: shuffle the qualifiers to assign random seeds, then lay
     *  them out by standard bracket seeding - so the byes stay distributed
     *  across the bracket (Challonge-style) rather than stacked at the top. */
    function fillBracketRandom() {
        const ids = boardItems.map((t) => t.id)
        for (let i = ids.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1))
            ;[ids[i], ids[j]] = [ids[j], ids[i]]
        }
        setSlots(standardSeedSlots(ids, boardN))
    }
    function clearSlots() { setSlots(new Array(boardN).fill(null)) }

    // Subtle green-tinted surfaces (adapt to light/dark) matching the group board.
    const bPoolTintBg = "color-mix(in srgb, var(--chakra-colors-pitch-500) 3%, var(--chakra-colors-bg-panel))"
    const bGroupTintBg = "color-mix(in srgb, var(--chakra-colors-pitch-500) 6%, var(--chakra-colors-bg-panel))"
    const manualPool = boardItems.filter((q) => !slots.includes(q.id))
    const manualAssigned = boardItems.length - manualPool.length

    const renderSlot = (idx: number) => {
        const teamId = slots[idx]
        const tm = teamId != null ? boardItems.find((q) => q.id === teamId) ?? null : null
        const hovered = dragOver === String(idx)
        return (
            <Box position="relative">
                <Flex
                    data-drop={String(idx)}
                    align="center"
                    minH="46px"
                    px="1.5"
                    py="1.5"
                    rounded="xl"
                    borderWidth="1px"
                    borderStyle={tm ? "solid" : "dashed"}
                    borderColor="border"
                    bg="bg.panel"
                >
                    {tm ? (
                        <BracketChip
                            name={tm.name}
                            sub={tm.teamName ?? null}
                            dragging={dragTeam?.id === tm.id}
                            onPointerDown={(e) => startDrag(e, tm)}
                            onPointerMove={dragMove}
                            onPointerUp={endDrag}
                            onPointerCancel={cancelDrag}
                        />
                    ) : (
                        <Text fontSize="xs" color="fg.subtle" fontWeight={500} px="2">
                            {positionMode ? "Povuci poziciju · prazno = prolaz" : "Povuci ekipu · prazno = prolaz"}
                        </Text>
                    )}
                </Flex>
                {hovered && (
                    <Box position="absolute" inset="0" rounded="xl" borderWidth="2px" borderColor="pitch.500"
                         css={{ background: "color-mix(in srgb, var(--chakra-colors-pitch-500) 9%, transparent)" }}
                         pointerEvents="none" />
                )}
            </Box>
        )
    }

    const manualBracketPanel = (
        <Panel p={{ base: "4", md: "6" }}>
            <VStack align="stretch" gap="5">
                <Box>
                    <Text fontWeight={800} fontSize={{ base: "lg", md: "xl" }}>Ručni ždrijeb</Text>
                    <Text fontSize="sm" color="fg.muted" fontWeight={500}>
                        {positionMode
                            ? "Povuci pozicije (npr. A1, B2) u parove 1. kola. Kad grupe završe, pozicije postaju ekipe. Prazan slot = slobodan prolaz (bye)."
                            : "Povuci ekipe u parove 1. kola. Prazan slot = slobodan prolaz (bye) u sljedeće kolo."}
                    </Text>
                </Box>

                {/* Toolbar */}
                <Flex align="center" gap="3" wrap="wrap" py="3.5" borderTopWidth="1px" borderBottomWidth="1px" borderColor="border">
                    <Text fontSize="sm" fontWeight={700} color="fg.muted" flex="1" minW="180px">
                        {manualPool.length > 0
                            ? `Raspoređeno ${manualAssigned}/${boardItems.length}.`
                            : positionMode ? "Sve pozicije su raspoređene." : "Sve ekipe su raspoređene."}
                    </Text>
                    <Button size="sm" colorPalette="brand" onClick={fillBracketRandom} disabled={boardItems.length < 2}>
                        <LuShuffle size={15} /> Nasumično rasporedi
                    </Button>
                    <Button size="sm" variant="outline" colorPalette="brand" onClick={clearSlots} disabled={manualAssigned === 0}>
                        <LuRotateCcw size={14} /> Isprazni
                    </Button>
                    <Button size="sm" colorPalette="brand" onClick={() => setSketchOpen(true)} disabled={manualAssigned < 2}>
                        <FiCrosshair size={14} /> Skiciraj završnicu
                    </Button>
                    <Button size="sm" variant="ghost" colorPalette="gray" onClick={() => setManualOpen(false)} disabled={generatingManual}>
                        Odustani
                    </Button>
                </Flex>

                {/* Board: pool (left) + first-round match cards (right). */}
                <Box display="grid" gridTemplateColumns={{ base: "1fr", md: "300px 1fr" }} gap="5" alignItems="start">
                    <Box position="relative">
                        <Box
                            data-drop="pool"
                            borderWidth="2px"
                            borderStyle="dashed"
                            borderColor="border"
                            rounded="2xl"
                            p="3.5"
                            minH="280px"
                            css={{ background: bPoolTintBg }}
                        >
                            <Flex align="center" justify="space-between" mb="3">
                                <Text fontWeight={800} fontSize="md">{positionMode ? "Pozicije" : "Ekipe"}</Text>
                                <Box as="span" bg="pitch.500" color="white" fontSize="xs" fontWeight={800} px="2.5" py="1" rounded="full" fontVariantNumeric="tabular-nums">
                                    {manualPool.length}
                                </Box>
                            </Flex>
                            {manualPool.length === 0 && (
                                <Text fontSize="sm" color="fg.muted" fontWeight={500} py="8" textAlign="center">
                                    {positionMode
                                        ? "Sve raspoređeno — povuci poziciju ovamo da je vratiš."
                                        : "Sve raspoređeno — povuci ekipu ovamo da je vratiš."}
                                </Text>
                            )}
                            <VStack align="stretch" gap="2">
                                {manualPool.map((tm) => (
                                    <BracketChip
                                        key={tm.id}
                                        name={tm.name}
                                        sub={tm.teamName ?? null}
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
                                 css={{ background: "color-mix(in srgb, var(--chakra-colors-pitch-500) 8%, transparent)" }}
                                 pointerEvents="none" />
                        )}
                    </Box>

                    <VStack align="stretch" gap="3">
                        <Text fontSize="xs" fontWeight={800} letterSpacing="0.08em" textTransform="uppercase" color="fg.muted">
                            {koStageName(boardMatchCount)} · parovi 1. kola
                        </Text>
                        {Array.from({ length: boardMatchCount }, (_, i) => (
                            <Flex
                                key={i}
                                direction={{ base: "column", sm: "row" }}
                                align={{ base: "stretch", sm: "center" }}
                                gap="2"
                                borderWidth="1px"
                                borderColor="border"
                                rounded="2xl"
                                px="3"
                                py="2.5"
                                css={{ background: bGroupTintBg }}
                            >
                                <Box flex="1" minW="0">{renderSlot(2 * i)}</Box>
                                <Text px="1" fontSize="2xs" fontWeight={800} color="fg.muted" flexShrink={0} textAlign="center">vs</Text>
                                <Box flex="1" minW="0">{renderSlot(2 * i + 1)}</Box>
                            </Flex>
                        ))}
                    </VStack>
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

    // ─── "Skiciraj završnicu" - preview the full bracket before generating ──
    const sketchRounds = buildBracketSketch(
        slots,
        boardMatchCount,
        boardN,
        (id) => {
            const it = boardItems.find((q) => q.id === id)
            // Position mode: prefer the secured team name, else the label ("A1").
            return (it?.teamName?.trim() || it?.name?.trim()) || "Bez imena"
        },
    )
    const sketchPanel = (
        <Panel p={{ base: "4", md: "6" }}>
            <VStack align="stretch" gap="5">
                <Box>
                    <Text fontWeight={800} fontSize={{ base: "lg", md: "xl" }}>Skica završnice</Text>
                    <Text fontSize="sm" color="fg.muted" fontWeight={500}>
                        Ovako će izgledati eliminacija — provjeri parove pa potvrdi. Kasnija kola pune se pobjednicima.
                    </Text>
                </Box>
                <Box overflowX="auto" pb="2">
                    <Flex gap="5" align="stretch" minW="min-content">
                        {sketchRounds.map((round, ri) => (
                            <VStack key={ri} minW="200px" flexShrink={0} gap="3">
                                <Text fontSize="2xs" fontWeight={800} letterSpacing="0.08em" textTransform="uppercase" color="fg.muted">
                                    {round.stage}
                                </Text>
                                <VStack gap="4" justify="space-around" flex="1" w="full">
                                    {round.matches.map((m, mi) => (
                                        <Box key={mi} w="full" borderWidth="1px" borderColor="border" rounded="xl" overflow="hidden" css={{ background: bGroupTintBg }}>
                                            <SketchLine disp={m.a} />
                                            <Box borderTopWidth="1px" borderColor="border" />
                                            <SketchLine disp={m.b} />
                                        </Box>
                                    ))}
                                </VStack>
                            </VStack>
                        ))}
                    </Flex>
                </Box>
                <Flex gap="3" justify="space-between" wrap="wrap">
                    <Button variant="ghost" colorPalette="gray" onClick={() => setSketchOpen(false)} disabled={generatingManual}>
                        <FiChevronLeft /> Natrag na uređivanje
                    </Button>
                    <Button colorPalette="brand" onClick={submitManualBracket} loading={generatingManual}>
                        <FiCheck /> Potvrdi završnicu
                    </Button>
                </Flex>
            </VStack>
        </Panel>
    )

    // ─── Bye picker - choose who advances directly when not a power of two ───
    function openByePicker() {
        setByeIds(new Set(pool.slice(0, byesNeeded).map((tm) => tm.id)))
        setByeOpen(true)
    }
    function toggleBye(id: number) {
        setByeIds((s) => {
            const c = new Set(s)
            if (c.has(id)) c.delete(id)
            // Single bye: clicking another team just swaps the selection.
            else if (byesNeeded === 1) { c.clear(); c.add(id) }
            // Otherwise cap at the exact number of byes (deselect one to change).
            else if (c.size < byesNeeded) c.add(id)
            return c
        })
    }

    const byePanel = (
        <Panel p={{ base: "4", md: "5" }}>
            <VStack align="stretch" gap="3">
                <HStack justify="space-between" align="center">
                    <Text fontWeight="bold" fontSize="sm">Tko prolazi direktno dalje?</Text>
                    <Button size="xs" variant="ghost" onClick={() => setByeOpen(false)} disabled={generating}>
                        Odustani
                    </Button>
                </HStack>
                <Text fontSize="xs" color="fg.muted">
                    {pool.length} ekipa ne popunjava ljestvicu od {bracketN}. Odaberi {byesNeeded}{" "}
                    {byesNeeded === 1 ? "ekipu koja preskače" : "ekipe koje preskaču"} prvo kolo
                    (slobodan prolaz u sljedeće).
                </Text>
                <VStack align="stretch" gap="1.5">
                    {pool.map((tm, idx) => {
                        const on = byeIds.has(tm.id)
                        // For a single bye, others stay clickable (they swap);
                        // for multiple, dim once the cap is reached.
                        const atCap = !on && byesNeeded > 1 && byeIds.size >= byesNeeded
                        return (
                            <HStack
                                as="button"
                                key={tm.id}
                                onClick={() => toggleBye(tm.id)}
                                gap="3"
                                borderWidth="1px"
                                borderColor={on ? "pitch.500" : "border"}
                                bg={on ? "pitch.50" : "bg.panel"}
                                rounded="lg"
                                px="3"
                                py="2"
                                textAlign="left"
                                opacity={atCap ? 0.45 : 1}
                                cursor={atCap ? "not-allowed" : "pointer"}
                            >
                                <Box
                                    w="18px"
                                    h="18px"
                                    rounded="md"
                                    flexShrink={0}
                                    borderWidth="2px"
                                    borderColor={on ? "pitch.500" : "border.emphasized"}
                                    bg={on ? "pitch.500" : "transparent"}
                                    color="white"
                                    display="flex"
                                    alignItems="center"
                                    justifyContent="center"
                                    fontSize="11px"
                                    fontWeight={800}
                                >
                                    {on ? "✓" : ""}
                                </Box>
                                <Text fontSize="2xs" fontFamily="mono" color="fg.muted" w="5" flexShrink={0}>
                                    {idx + 1}.
                                </Text>
                                <Text fontSize="sm" fontWeight={600} flex="1" minW="0" truncate>
                                    {tm.name?.trim() || "Bez imena"}
                                </Text>
                            </HStack>
                        )
                    })}
                </VStack>
                {byeIds.size !== byesNeeded && (
                    <Text fontSize="xs" color="red.fg">
                        Odabrano {byeIds.size} / {byesNeeded}.
                    </Text>
                )}
                <Button
                    colorPalette="brand"
                    onClick={() => runGenerate([...byeIds], true)}
                    loading={generating}
                    disabled={byeIds.size !== byesNeeded}
                >
                    Generiraj ljestvicu
                </Button>
            </VStack>
        </Panel>
    )

    if (loading) {
        return <Loader label="Učitavanje ljestvice…" />
    }

    // A bracket is worth rendering once teams are placed OR the predicted
    // pairing labels exist - the whole point of predictions is that everyone
    // sees the pairings ("A1", "Pobj. ČF1", …) in advance, before the group
    // stage decides the real teams. A truly empty skeleton (no teams, no
    // labels - e.g. a KNOCKOUT_ONLY schedule generated ahead of the draw)
    // still counts as not-yet-drawn and shows the draw buttons.
    const hasBracket =
        bracket != null &&
        bracket.rounds.some((r) =>
            r.matches.some(
                (m) =>
                    m.team1Id != null ||
                    m.team2Id != null ||
                    m.slot1Label != null ||
                    m.slot2Label != null,
            ),
        )

    if (!hasBracket) {
        if (canEdit && byeOpen) return byePanel
        if (canEdit && manualOpen && sketchOpen) return sketchPanel
        if (canEdit && manualOpen) return manualBracketPanel
        return (
            <Panel p="0">
                <EmptyState
                    title="Eliminacijska ljestvica još nije generirana"
                    description={
                        !canEdit
                            ? "Organizator još nije generirao eliminacijsku ljestvicu."
                            : positionMode
                                ? "Složi parove završnice po pozicijama iz grupa (npr. A1, B2). Kad grupna faza završi, pozicije postaju ekipe."
                                : !groupStageComplete
                                    ? "Završi sve utakmice grupne faze (upiši rezultate) da bi mogao generirati eliminaciju."
                                    : "Ručno složi parove povlačenjem ekipa, ili generiraj automatski (nasumično)."
                    }
                    action={
                        canEdit ? (
                            <HStack gap="2" wrap="wrap" justify="center">
                                {/* Manual (drag the pairs yourself) is the default.
                                    In position mode it works at all times (even
                                    before the group stage finishes); the automatic
                                    team draw stays gated on a finished group stage. */}
                                <Button
                                    colorPalette="brand"
                                    size="sm"
                                    onClick={openManualBracket}
                                    disabled={positionMode ? boardItems.length < 2 : (!groupStageComplete || pool.length < 2)}
                                >
                                    Ručni ždrijeb
                                </Button>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => { if (byesNeeded > 0) openByePicker(); else void runGenerate() }}
                                    loading={generating}
                                    disabled={!groupStageComplete || pool.length < 2}
                                >
                                    Automatski
                                </Button>
                            </HStack>
                        ) : undefined
                    }
                />
            </Panel>
        )
    }

    // Penalty row visibility is derived from the currently active edit form.
    const editA = parseInt(form.s1, 10)
    const editB = parseInt(form.s2, 10)
    const showPenaltyRow = Number.isFinite(editA) && Number.isFinite(editB) && editA === editB

    const roundCount = bracket.rounds.length

    // Once a real ELIMINATION match is played the draw is locked - re-drawing
    // would wipe results - so the draw buttons disappear. Based only on bracket
    // matches (NOT the tournament status). A bye match is auto-FINISHED on
    // generation (one team, no game) - it must NOT count as "played", otherwise
    // a freshly-drawn bracket with byes would hide the reset button.
    const started =
        [...bracket.rounds.flatMap((r) => r.matches), ...(bracket.thirdPlace ? [bracket.thirdPlace] : [])]
            .some(
                (m) =>
                    m.status === "LIVE" ||
                    (m.status === "FINISHED" && m.team1Id != null && m.team2Id != null),
            )

    // `libraryMatches` + `matchById` are computed above (before the
    // early returns) - re-aliasing here for readability only. Each
    // matchComponent invocation looks up the ORIGINAL BracketMatch by
    // id to recover all the live state the lib doesn't carry (score,
    // liveStartedAt, status, etc.).

    // Stage of the final round, used to flag Finale rendering in the
    // matchComponent (yellow theme + trophy header).
    // `liveMatchId`, `liveRefs` and the auto-scroll useEffect were
    // hoisted ABOVE the early returns at the top of the function to
    // satisfy React's hook-order rule (see comment up there).
    const finalStage = bracket.rounds[roundCount - 1]?.stage ?? null

    // The knockout draw still needs the organizer's confirmation before matches
    // can be started / results entered (KNOCKOUT_ONLY never requires it).
    const needsConfirm = bracket.confirmationRequired && bracket.confirmedAt == null

    /** Block the start-live / result-entry paths until the draw is confirmed. */
    function guardConfirmed(): boolean {
        if (needsConfirm) {
            toaster.create({
                type: "info",
                title: "Prvo potvrdi ždrijeb završnice.",
                duration: 3000,
            })
            return false
        }
        return true
    }
    const handleEdit = (m: BracketMatch) => { if (guardConfirmed()) startEdit(m) }
    const handleOpenLive = (m: BracketMatch) => { if (guardConfirmed()) setLiveMatch(m) }

    const renderLibraryMatch = (props: MatchComponentProps) => {
        const original = matchById.get(props.match.id)
        if (!original) return null
        const isFinalCard = original.stage === finalStage && roundCount > 0
        // The library renders us inside a fixed-size SVG foreignObject
        // (`width` × `boxHeight` from options.style) and draws bracket
        // connectors from BOX-CENTER to next BOX-CENTER. If our card
        // renders shorter than the foreignObject (e.g. an empty card
        // with just two "- -" placeholder rows), it sits at the TOP of
        // the box and the connector line visually misses it.
        //
        // Wrapping the card in a flex container that fills the
        // foreignObject and centres its child vertically restores the
        // alignment: short cards render at the box midpoint, tall
        // cards (live + edit buttons) overflow symmetrically.
        return (
            <Box
                w="100%"
                h="100%"
                display="flex"
                alignItems="center"
                justifyContent="stretch"
                // NOTE: do NOT put a CSS transform (e.g. translateZ(0)) on
                // anything inside the SVG <foreignObject> here. WebKit (iOS
                // Safari) positions transformed foreignObject content relative
                // to the SVG ROOT instead of its own box - every card then
                // renders stacked at the top-left corner of the bracket. A
                // previous "compositing layer" nudge did exactly that and
                // broke the whole bracket on iPhones.
                ref={(el: HTMLDivElement | null) => {
                    // Track refs for every match by id. The auto-scroll
                    // effect picks the LIVE one out of this map and
                    // calls scrollIntoView on it. We register every
                    // card (not just live) because the live status can
                    // change between renders and we want the ref ready
                    // by the time the effect fires.
                    if (el) liveRefs.current.set(original.matchId, el)
                    else liveRefs.current.delete(original.matchId)
                }}
            >
                <Box flex="1" minW="0" ref={isFinalCard ? finalCardRef : undefined}>
                    <MatchCard
                        match={original}
                        canEdit={canEdit}
                        isFinal={isFinalCard}
                        multiDay={bracketMultiDay}
                        editing={editingId === original.matchId}
                        form={form}
                        showPenaltyRow={showPenaltyRow}
                        saving={saving}
                        halfLengthMin={halfLengthMin}
                        halfCount={halfCount}
                        onEdit={handleEdit}
                        uuid={uuid}
                        colors={kitColors}
                        onSave={saveResult}
                        onSavePenalties={saveResultWithPenalties}
                        onCancel={() => setEditingId(null)}
                        onFormChange={setForm}
                        onOpenLive={handleOpenLive}
                        onOpenTimeline={setTimelineMatch}
                    />
                </Box>
            </Box>
        )
    }

    return (
        <VStack align="stretch" gap="5" py="2">
            {/* Owner draw controls - right-aligned. Hidden once any match is
                LIVE/FINISHED (re-drawing would destroy real results). The
                "Podijeli bracket" button now floats at the bottom (below). */}
            {canEdit && !started && (
                <Flex justify="flex-end" gap="2" wrap="wrap">
                    <GhostButton
                        icon={<FiRefreshCw size={14} />}
                        onClick={openManualBracket}
                        disabled={generating || generatingManual}
                    >
                        Ručni ždrijeb
                    </GhostButton>
                    <GhostButton
                        danger
                        icon={<FiTrash2 size={14} />}
                        onClick={confirmResetBracket}
                        disabled={generating || generatingManual || resetting}
                    >
                        {resetting ? "Resetiranje…" : "Resetiraj"}
                    </GhostButton>
                </Flex>
            )}

            {/* Bracket-confirmation state - only for brackets that require it
                (a group stage feeds the knockout). Three shapes: a subtle green
                "confirmed" chip once done; a prominent CTA bar once the group
                stage is over and the organizer can confirm; else a small neutral
                "not confirmed yet" chip (viewers, or the organizer pre-finish). */}
            {bracket.confirmationRequired && (
                bracket.confirmedAt != null ? (
                    <Flex justify="flex-end">
                        <Flex
                            as="span"
                            display="inline-flex"
                            align="center"
                            gap="1.5"
                            bg="green.subtle"
                            color="green.fg"
                            rounded="full"
                            px="3"
                            py="1"
                            fontSize="xs"
                            fontWeight={700}
                        >
                            <FiCheck size={12} /> Ždrijeb potvrđen
                        </Flex>
                    </Flex>
                ) : groupStageComplete && canEdit ? (
                    <Flex
                        align="center"
                        justify="space-between"
                        gap="3"
                        wrap="wrap"
                        bg="brand.subtle"
                        borderWidth="1px"
                        borderColor="brand.emphasized"
                        rounded="xl"
                        px="4"
                        py="3"
                    >
                        <HStack gap="2" minW="0">
                            <Box color="brand.fg" flexShrink={0} display="inline-flex">
                                <FiCheck size={16} />
                            </Box>
                            <Text fontSize="sm" color="fg.ink" fontWeight={500}>
                                Grupna faza je gotova - potvrdi ždrijeb završnice da krenu utakmice.
                            </Text>
                        </HStack>
                        <Button colorPalette="brand" onClick={() => setConfirmBracketOpen(true)}>
                            <FiCheck /> Potvrdi ždrijeb
                        </Button>
                    </Flex>
                ) : (
                    <Flex justify="flex-end">
                        <Flex
                            as="span"
                            display="inline-flex"
                            align="center"
                            gap="1.5"
                            bg="bg.surfaceTint"
                            color="fg.muted"
                            borderWidth="1px"
                            borderColor="border"
                            rounded="full"
                            px="3"
                            py="1"
                            fontSize="xs"
                            fontWeight={700}
                        >
                            Ždrijeb nije potvrđen
                        </Flex>
                    </Flex>
                )
            )}

            {/* Confirm popup for resetting (wiping) the elimination bracket. */}
            <ConfirmDialog
                open={confirmAction !== null}
                busy={resetting}
                danger
                title="Resetirati eliminaciju?"
                description="Sve utakmice eliminacijske faze bit će obrisane."
                confirmLabel="Da, resetiraj"
                onClose={() => setConfirmAction(null)}
                onConfirm={async () => {
                    await runResetBracket()
                    setConfirmAction(null)
                }}
            />

            {/* Manual draw editor - shown above the bracket when opened. The
                "Skiciraj završnicu" step swaps the board for the sketch preview
                (same as the pre-draw path), so it works for re-draws too. */}
            {canEdit && !started && manualOpen && (sketchOpen ? sketchPanel : manualBracketPanel)}

            {/* ── Bracket - driven by @g-loot/react-tournament-brackets.
                 The library renders the SVG layout + connectors; our
                 custom matchComponent feeds each match into the same
                 MatchCard we used before, so the Pitch theme (yellow
                 Finale, live red border, edit / Pokreni uživo buttons)
                 stays visually identical. The 3rd-place fixture renders
                 in its own Panel BELOW the bracket - keeping it out of
                 the matches[] array prevents the lib from drawing a
                 spurious connector to the Finale. */}
            <Panel p="0" overflow="hidden" position="relative">
                <Box
                    ref={pan.ref}
                    overflow="auto"
                    maxH={{ base: "70vh", md: "78vh" }}
                    px={{ base: "3", md: "5" }}
                    py="5"
                    cursor={pan.dragging ? "grabbing" : "grab"}
                    userSelect="none"
                    {...pan.handlers}
                >
                    {/* inline-block shrink-wraps to the bracket SVG width so the
                        3rd-place card can be absolutely placed under the Finale
                        column even when the bracket is wider than the viewport. */}
                    <Box ref={contentRef} display="inline-block" minW="100%" position="relative">
                    {(() => {
                        // SingleEliminationBracket's typings carry the
                        // older JSX.Element global that React 19 removed,
                        // so we cast to `any` once at the call site.
                        const Bracket: any = SingleEliminationBracket
                        return (
                            <Bracket
                                matches={libraryMatches}
                                matchComponent={renderLibraryMatch}
                                theme={bracketTheme}
                                options={{
                                    style: {
                                        roundHeader: {
                                            isShown: true,
                                            height: 32,
                                            marginBottom: 16,
                                            fontSize: 11,
                                            fontFamily:
                                                "'JetBrains Mono', ui-monospace, monospace",
                                            // Override the lib's
                                            // "Round {N}" default - return
                                            // OUR backend round titles
                                            // ("Četvrtfinale", "Polufinale",
                                            // "Finale", …). 1-indexed.
                                            roundTextGenerator: (
                                                currentRoundNumber: number,
                                            ) => {
                                                const r =
                                                    bracket.rounds[
                                                        currentRoundNumber - 1
                                                    ]
                                                return r?.title ?? undefined
                                            },
                                        },
                                        // Match-box dimensions. boxHeight
                                        // has to be ≥ the TALLEST possible
                                        // MatchCard render (Finale header
                                        // strip + 2 team rows + "Pocni
                                        // uzivo" + "Unesi rezultat" stack
                                        // ≈ 270px). The card wrapper above
                                        // vertically centres shorter cards
                                        // inside this box so the bracket
                                        // connectors always land on the
                                        // visible centre of the card, not
                                        // an empty box top.
                                        width: 260,
                                        boxHeight: 280,
                                        canvasPadding: 16,
                                        spaceBetweenColumns: 64,
                                        spaceBetweenRows: 48,
                                        roundSeparatorWidth: 24,
                                    },
                                }}
                            />
                        )
                    })()}

                    {/* 3rd-place playoff sits directly under the Finale -
                        positioned from the measured final-card geometry
                        (thirdPos). Until measured it falls back to the
                        bottom-right corner. Kept out of the lib's match chain so
                        no connector is drawn to it. */}
                    {bracket.thirdPlace && (
                        <Box
                            position="absolute"
                            ref={(el: HTMLDivElement | null) => {
                                // Register so the "Na redu" focus button can
                                // scroll to a live/next 3rd-place match too.
                                const id = bracket.thirdPlace?.matchId
                                if (id == null) return
                                if (el) liveRefs.current.set(id, el)
                                else liveRefs.current.delete(id)
                            }}
                            {...(thirdPos
                                ? {
                                      top: `${thirdPos.top}px`,
                                      right: `${thirdPos.right}px`,
                                      w: `${thirdPos.width}px`,
                                  }
                                : { bottom: "16px", right: "16px", w: "260px" })}
                        >
                            <Box>
                                
                                <MatchCard
                                    match={bracket.thirdPlace}
                                    canEdit={canEdit}
                                    isThirdPlace
                                    multiDay={bracketMultiDay}
                                    editing={editingId === bracket.thirdPlace.matchId}
                                    form={form}
                                    showPenaltyRow={showPenaltyRow}
                                    saving={saving}
                                    halfLengthMin={halfLengthMin}
                                    halfCount={halfCount}
                                    onEdit={handleEdit}
                                    uuid={uuid}
                                    colors={kitColors}
                                    onSave={saveResult}
                                    onSavePenalties={saveResultWithPenalties}
                                    onCancel={() => setEditingId(null)}
                                    onFormChange={setForm}
                                    onOpenLive={handleOpenLive}
                                    onOpenTimeline={setTimelineMatch}
                                />
                            </Box>
                        </Box>
                    )}
                    </Box>
                </Box>

                {/* Floating action bar - anchored to the bottom-centre of the
                    bracket panel itself (not the viewport), floating over the
                    bracket. "Na redu" jumps to the LIVE (or next scheduled)
                    match; "Podijeli" shares the tournament page link. */}
                <Flex
                    position="absolute"
                    bottom={{ base: "3", md: "4" }}
                    left="50%"
                    transform="translateX(-50%)"
                    zIndex={2}
                    align="center"
                    gap="1"
                    bg="bg.panel"
                    borderWidth="1px"
                    borderColor="border.emphasized"
                    rounded="full"
                    shadow="lg"
                    px="2"
                    py="1.5"
                >
                    <Button
                        size="sm"
                        variant="ghost"
                        colorPalette="red"
                        onClick={focusMatch}
                        disabled={focusTargetId == null}
                        title={
                            liveMatchId != null
                                ? "Idi na utakmicu koja se igra uživo"
                                : "Idi na sljedeću utakmicu na rasporedu"
                        }
                    >
                        <FiCrosshair size={15} />
                        {liveMatchId != null ? "Uživo" : "Na redu"}
                    </Button>
                    <Box w="1px" alignSelf="stretch" my="1" bg="border" />
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={shareBracket}
                        disabled={sharing}
                        title="Podijeli poveznicu na turnir"
                    >
                        <FiShare2 size={15} />
                        {sharing ? "Pripremam…" : "Podijeli"}
                    </Button>
                    <Box w="1px" alignSelf="stretch" my="1" bg="border" />
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setExportOpen(true)}
                        title="Preuzmi završnicu kao plakat (PDF / JPG)"
                    >
                        <FiDownload size={15} />
                        Preuzmi
                    </Button>
                </Flex>
            </Panel>

            {/* Branded "Završnica" bracket poster (landscape PDF / JPG). */}
            <ExportDialog
                open={exportOpen}
                onClose={() => setExportOpen(false)}
                kind="bracket"
                meta={
                    exportMeta ?? {
                        tournamentName: tournamentName ?? "Turnir",
                        tournamentUrl: `${window.location.origin}/turniri/${uuid}`,
                    }
                }
                bracket={bracket ?? undefined}
            />

            {/* ── Live-match dialog - goals, cards, finish. ──────────────── */}
            {liveMatch && (
                <BracketLiveMatchDialog
                    uuid={uuid}
                    match={liveMatch}
                    onClose={() => setLiveMatch(null)}
                    onChanged={reloadBracket}
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

            {/* Confirm-draw dialog: offers to edit knockout times first, then
                confirms the draw so the knockout can start. */}
            {confirmBracketOpen && (
                <ConfirmBracketDialog
                    uuid={uuid}
                    onClose={() => setConfirmBracketOpen(false)}
                    onConfirmed={(b) => {
                        setBracket(b)
                        refreshLinkedTabs()
                        setConfirmBracketOpen(false)
                    }}
                />
            )}

            {/* Position save → schedule mockup step: the saved pairs re-label the
                skeleton (bracket + schedule + sketch), so send the organizer to
                the Raspored planner to confirm/adjust the times. */}
            <ConfirmDialog
                open={positionsSavedOpen}
                title="Parovi su spremljeni"
                description="Parovi su spremljeni - potvrdi termine u rasporedu."
                confirmLabel="Otvori raspored"
                onClose={() => setPositionsSavedOpen(false)}
                onConfirm={() => {
                    setPositionsSavedOpen(false)
                    onGoToSchedule?.(true)
                }}
            />

        </VStack>
    )
}

/** Knockout stage → readable Croatian label for the confirm-draw time editor. */
const KO_STAGE_LABEL: Record<string, string> = {
    ROUND_OF_32: "1/16 finala",
    ROUND_OF_16: "Osmina finala",
    QUARTERFINAL: "Četvrtfinale",
    SEMIFINAL: "Polufinale",
    FINAL: "Finale",
    THIRD_PLACE: "Za 3. mjesto",
}

/** Pairing text for a knockout match in the confirm-draw list: real names when
 *  known, otherwise the predicted names / slot codes ("A1", "Pobj. ČF1"). */
function koPairingText(m: ScheduledMatch): string {
    const side = (name: string | null, pred?: string | null, label?: string | null) =>
        name ?? pred ?? label ?? "?"
    return (
        `${side(m.team1Name, m.slot1PredictedName, m.slot1Label)}` +
        ` - ${side(m.team2Name, m.slot2PredictedName, m.slot2Label)}`
    )
}

/* ── ConfirmBracketDialog ────────────────────────────────────────────────────
   Two-step "Potvrda ždrijeba" flow. Step 1 asks whether to adjust the knockout
   kickoff times first; step 2 lists the knockout matches, each with a
   DateTimeField (same single-match kickoff edit as the Raspored tab). Either
   step confirms the draw (confirmBracket), which unlocks the knockout.
   ────────────────────────────────────────────────────────────────────────── */
function ConfirmBracketDialog({
    uuid,
    onClose,
    onConfirmed,
}: {
    uuid: string
    onClose: () => void
    onConfirmed: (b: Bracket) => void
}) {
    const [step, setStep] = useState<"ask" | "times">("ask")
    const [matches, setMatches] = useState<ScheduledMatch[] | null>(null)
    const [loadingTimes, setLoadingTimes] = useState(false)
    const [confirming, setConfirming] = useState(false)

    // Knockout matches still to play (drop GROUP + already-finished byes).
    const koPending = (list: ScheduledMatch[]) =>
        list.filter((m) => m.stage !== "GROUP" && m.status !== "FINISHED")

    async function openTimes() {
        setStep("times")
        if (matches != null) return
        setLoadingTimes(true)
        try {
            const s = await fetchSchedule(uuid)
            setMatches(koPending(s.matches))
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setLoadingTimes(false)
        }
    }

    /** Mirror ScheduleTab's single-match kickoff edit: local string → ISO. */
    async function changeTime(m: ScheduledMatch, d: Date) {
        const p = (n: number) => String(n).padStart(2, "0")
        const local =
            `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
            `T${p(d.getHours())}:${p(d.getMinutes())}`
        try {
            const s = await updateKickoff(uuid, m.matchId, new Date(local).toISOString())
            setMatches(koPending(s.matches))
        } catch {
            /* error toast surfaced by the http interceptor */
        }
    }

    async function confirm() {
        setConfirming(true)
        try {
            onConfirmed(await confirmBracket(uuid))
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setConfirming(false)
        }
    }

    return (
        <Dialog.Root
            open
            onOpenChange={(e) => { if (!e.open && !confirming) onClose() }}
            placement="center"
            scrollBehavior="inside"
        >
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW={{ base: "94%", md: "560px" }}>
                        <Dialog.Header pb="2">
                            <Flex align="center" justify="space-between" w="full" gap="2">
                                <Dialog.Title>Potvrda ždrijeba</Dialog.Title>
                                <Button
                                    aria-label="Zatvori"
                                    variant="ghost"
                                    size="xs"
                                    onClick={onClose}
                                    disabled={confirming}
                                >
                                    <FiX size={16} />
                                </Button>
                            </Flex>
                        </Dialog.Header>
                        <Dialog.Body>
                            {step === "ask" ? (
                                <Text color="fg.muted">
                                    Želiš li prije potvrde urediti termine utakmica završnice?
                                </Text>
                            ) : loadingTimes ? (
                                <Loader label="Učitavanje termina…" />
                            ) : matches && matches.length > 0 ? (
                                <VStack align="stretch" gap="2.5">
                                    {matches.map((m) => (
                                        <Flex
                                            key={m.matchId}
                                            align="center"
                                            justify="space-between"
                                            gap="3"
                                            wrap="wrap"
                                            borderWidth="1px"
                                            borderColor="border"
                                            rounded="lg"
                                            px="3"
                                            py="2.5"
                                        >
                                            <Box minW="0" flex="1">
                                                <Text
                                                    fontFamily="mono"
                                                    fontSize="2xs"
                                                    fontWeight={800}
                                                    letterSpacing="0.06em"
                                                    textTransform="uppercase"
                                                    color="fg.muted"
                                                >
                                                    {KO_STAGE_LABEL[m.stage] ?? m.stage}
                                                </Text>
                                                <Text fontSize="sm" fontWeight={600} color="fg.ink" lineClamp="1">
                                                    {koPairingText(m)}
                                                </Text>
                                            </Box>
                                            <Box w={{ base: "full", sm: "200px" }} maxW="full">
                                                <DateTimeField
                                                    compact
                                                    value={m.kickoffAt ? new Date(m.kickoffAt) : null}
                                                    onChange={(d) => { if (d) void changeTime(m, d) }}
                                                />
                                            </Box>
                                        </Flex>
                                    ))}
                                </VStack>
                            ) : (
                                <Text color="fg.muted" fontSize="sm">
                                    Nema utakmica završnice za uređivanje termina.
                                </Text>
                            )}
                        </Dialog.Body>
                        <Dialog.Footer>
                            {step === "ask" ? (
                                <>
                                    <Button variant="outline" onClick={openTimes} disabled={confirming}>
                                        Uredi termine
                                    </Button>
                                    <Button colorPalette="brand" loading={confirming} onClick={confirm}>
                                        Potvrdi ždrijeb
                                    </Button>
                                </>
                            ) : (
                                <>
                                    <Button variant="ghost" onClick={() => setStep("ask")} disabled={confirming}>
                                        Natrag
                                    </Button>
                                    <Button colorPalette="brand" loading={confirming} onClick={confirm}>
                                        Potvrdi ždrijeb
                                    </Button>
                                </>
                            )}
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}

/* ── MatchCard ──────────────────────────────────────────────────────────────
   A single match: two team rows, optional inline result-entry form, plus
   live-match controls (start live / open live panel).
   ────────────────────────────────────────────────────────────────────────── */
type MatchCardProps = {
    match: BracketMatch
    /** Owner / admin only - controls visibility of every mutating action
     *  (result entry, start-live, open-live management). When false the
     *  card is purely informational. */
    canEdit: boolean
    editing: boolean
    form: EditForm
    showPenaltyRow: boolean
    saving: boolean
    isFinal?: boolean
    isThirdPlace?: boolean
    /** True when the bracket's matches span >1 local date - the kickoff line
     *  then shows the short day+date, not just HH:mm. */
    multiDay?: boolean
    /** Tournament half config - drives the inline TIMER clock countdown. */
    halfLengthMin?: number | null
    halfCount?: number | null
    /** Tournament uuid - needed to persist the optional penalty shooter. */
    uuid: string
    /** Kit colours per team ({teamId → {jersey, shorts}}) - the initials tile. */
    colors: Record<string, TeamKit>
    onEdit: (m: BracketMatch) => void
    onSave: (m: BracketMatch) => void
    onSavePenalties: (m: BracketMatch, pen1: number, pen2: number) => void
    onCancel: () => void
    onFormChange: (updater: (prev: EditForm) => EditForm) => void
    onOpenLive: (m: BracketMatch) => void
    /** Open the read-only timeline (tijek) - clicking the match result. */
    onOpenTimeline: (m: BracketMatch) => void
}

function MatchCard({
    match: m,
    canEdit,
    editing,
    form,
    showPenaltyRow,
    saving,
    isFinal = false,
    isThirdPlace = false,
    multiDay = false,
    halfLengthMin = null,
    halfCount = null,
    uuid,
    colors,
    onEdit,
    onSave,
    onSavePenalties,
    onCancel,
    onFormChange,
    onOpenLive,
    onOpenTimeline,
}: MatchCardProps) {
    const navigate = useNavigate()
    const editable = m.team1Id != null && m.team2Id != null
    const w1 = m.winnerTeamId != null && m.winnerTeamId === m.team1Id
    const w2 = m.winnerTeamId != null && m.winnerTeamId === m.team2Id
    const isFinished = m.status === "FINISHED"
    const isLive = m.status === "LIVE"
    const isScheduled = m.status === "SCHEDULED"

    const accentBorder = isLive
        ? "red.emphasized"
        : isFinal
            ? "yellow.emphasized"
            : "border"

    // SafeFlow-style "mlabel": FINALE / ZA 3. MJESTO tag + kickoff, falling
    // back to the round name when no kickoff is set yet. On a multi-day
    // tournament the kickoff carries the short day+date, else just HH:mm.
    const kick = m.kickoffAt ? (multiDay ? kickoffLabel(m.kickoffAt, true) : fmtKick(m.kickoffAt)) : null
    const headerLabel =
        [isFinal ? "FINALE" : isThirdPlace ? "ZA 3. MJESTO" : null, kick]
            .filter(Boolean)
            .join(" · ") || (STAGE_SHORT[m.stage] ?? "UTAKMICA")

    return (
        <Box
            bg="bg.panel"
            borderWidth={isLive ? "2px" : isFinal ? "1.5px" : "1px"}
            borderColor={accentBorder}
            rounded="xl"
            shadow={isFinal ? "md" : "xs"}
            overflow="hidden"
            cursor={editing ? "default" : "pointer"}
            // Soft red halo while live - same convention as the MiniBracket.
            css={
                isLive
                    ? { boxShadow: "0 0 0 3px color-mix(in srgb, var(--chakra-colors-accent-red) 18%, transparent)" }
                    : undefined
            }
            // Click anywhere on the card → a played (FINISHED) match opens the
            // full "detalji utakmice" page; anything else opens the read-only
            // match timeline (tijek) modal. Clicks on the action controls (start
            // menu, edit/score inputs, live/result buttons) are ignored so they
            // keep their own behaviour.
            onClick={(e) => {
                if (editing) return
                const t = e.target as HTMLElement
                if (
                    t.closest(
                        'button, a, input, select, textarea, label, [role="button"], [role="menu"], [role="menuitem"], [data-scope="menu"]',
                    )
                ) {
                    return
                }
                if (isFinished) {
                    navigate(`/turniri/${uuid}/utakmica/${m.matchId}`)
                } else {
                    onOpenTimeline(m)
                }
            }}
        >
            {/* Header strip - the SafeFlow "mlabel": tag + kickoff left, live
                state right. Always shown so every card carries its context
                (groups-style bg.surfaceTint strip on regular matches). */}
            <Flex
                align="center"
                justify="space-between"
                gap="2"
                px="2.5"
                py="1.5"
                bg={isLive ? "red.subtle" : isFinal ? "yellow.subtle" : "bg.surfaceTint"}
                borderBottomWidth="1px"
                borderColor="border"
            >
                <HStack gap="1.5" minW="0">
                    {isFinal ? (
                        <Text fontSize="xs" lineHeight="1">🏆</Text>
                    ) : !isLive && kick ? (
                        <Box color="fg.muted" display="inline-flex" flexShrink={0}>
                            <FiClock size={10} />
                        </Box>
                    ) : null}
                    <Text
                        fontFamily="mono"
                        fontSize="9px"
                        fontWeight={800}
                        letterSpacing="0.08em"
                        color={isLive ? "red.fg" : isFinal ? "yellow.fg" : "fg.muted"}
                        truncate
                    >
                        {headerLabel}
                    </Text>
                </HStack>
                {isLive && (
                    <HStack gap="2" flexShrink={0}>
                        {m.liveMode === "TIMER" && (
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
                        <LivePill />
                    </HStack>
                )}
            </Flex>

            {/* Two team rows. The whole card opens the timeline (see the card
                onClick above); while entering a result the score inputs sit in
                each team row and the card's interactive-target guard ignores
                their clicks. */}
            <Box px="2.5" py="2">
                <Box>
                    <TeamRow
                        name={m.team1Name}
                        slotLabel={m.slot1Label}
                        slotPredictedName={m.slot1PredictedName}
                        score={m.score1}
                        pen={m.penalties1}
                        winner={w1}
                        loser={w2}
                        live={isLive}
                        kit={teamKit(colors, m.team1Id)}
                        edit={editing
                            ? { value: form.s1, onChange: (v) => onFormChange((f) => ({ ...f, s1: v })) }
                            : undefined}
                    />
                    <Box h="1px" bg="border" my="1.5" />
                    <TeamRow
                        name={m.team2Name}
                        slotLabel={m.slot2Label}
                        slotPredictedName={m.slot2PredictedName}
                        score={m.score2}
                        pen={m.penalties2}
                        winner={w2}
                        loser={w1}
                        live={isLive}
                        kit={teamKit(colors, m.team2Id)}
                        edit={editing
                            ? { value: form.s2, onChange: (v) => onFormChange((f) => ({ ...f, s2: v })) }
                            : undefined}
                    />
                </Box>

                {editing ? (
                    <VStack align="stretch" gap="2" mt="3">
                    {/* Neriješeno → guided penalty shootout (decides + saves). */}
                    {showPenaltyRow && (
                        <PenaltyShootout
                            uuid={uuid}
                            matchId={m.matchId}
                            team1Id={m.team1Id}
                            team1Name={m.team1Name}
                            team2Id={m.team2Id}
                            team2Name={m.team2Name}
                            saving={saving}
                            onConfirm={(p1, p2) => onSavePenalties(m, p1, p2)}
                        />
                    )}

                    {/* Action buttons - for a level score the shootout above
                        does the saving, so only show "Spremi" for a decisive
                        result. */}
                    <HStack gap="2">
                        {!showPenaltyRow && (
                            <Button
                                size="xs"
                                colorPalette="brand"
                                loading={saving}
                                onClick={() => onSave(m)}
                                rounded="lg"
                            >
                                Spremi
                            </Button>
                        )}
                        <Button
                            size="xs"
                            variant="ghost"
                            onClick={onCancel}
                            rounded="lg"
                        >
                            Odustani
                        </Button>
                    </HStack>
                </VStack>
            ) : (
                // Action stack only renders when the viewer is the
                // organizer / admin. Anonymous and regular-user viewers
                // get a read-only scoreboard - no "Unesi rezultat",
                // "Pokreni" or live-management controls leak through.
                canEdit && (isLive || isFinished || (isScheduled && editable)) && (
                    <VStack align="stretch" gap="1.5" mt="2">
                        {/* Knockout matches are STARTED from the Zapisnik - the
                            bracket's live-start popover was removed (it broke the
                            iOS layout and made accidental live-starts too easy).
                            The bracket only enters/edits a result and opens an
                            already-live match ("Uživo" → "Poništi utakmicu"). */}
                        {isScheduled && editable && (
                            <Button
                                size="xs"
                                variant="outline"
                                colorPalette="pitch"
                                rounded="lg"
                                onClick={() => onEdit(m)}
                            >
                                <FiEdit2 /> Unesi rezultat
                            </Button>
                        )}
                        {isLive && (
                            <Button
                                size="xs"
                                colorPalette="red"
                                rounded="lg"
                                onClick={() => onOpenLive(m)}
                            >
                                Uživo
                            </Button>
                        )}
                        {isFinished && (
                            <Button
                                size="xs"
                                variant="ghost"
                                colorPalette="brand"
                                rounded="lg"
                                onClick={() => onOpenLive(m)}
                            >
                                Uredi rezultat
                            </Button>
                        )}
                    </VStack>
                )
            )}
            </Box>
        </Box>
    )
}

/* ── TeamRow ────────────────────────────────────────────────────────────────
   One team line inside a match card, SafeFlow-style: initials tile in the
   team's kit colour · name · score. The winner's row gets the groups' green
   tint + bold; the loser is muted; a live score reads red; TBD is italic.
   ────────────────────────────────────────────────────────────────────────── */

/** Compact kickoff for the card header strip: "11.07. 19:30". */
function fmtKick(iso: string): string {
    const d = new Date(iso)
    const p = (n: number) => String(n).padStart(2, "0")
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Round name fallback for a card with no kickoff yet (mono uppercase). */
const STAGE_SHORT: Record<string, string> = {
    ROUND_OF_32: "1/16 FINALA",
    ROUND_OF_16: "OSMINA FINALA",
    QUARTERFINAL: "ČETVRTFINALE",
    SEMIFINAL: "POLUFINALE",
    FINAL: "FINALE",
    THIRD_PLACE: "ZA 3. MJESTO",
}

/** Two-letter initials: first letters of the first two words, else the first
 *  two characters. "?" for a TBD slot. */
function teamInitials(name: string | null): string {
    if (!name) return "?"
    const words = name.trim().split(/\s+/).filter((w) => w.length > 0)
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
    return name.trim().slice(0, 2).toUpperCase()
}

/** Black-or-white ink for a "#rrggbb" background (perceived luminance). */
function contrastInk(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16) || 0
    const g = parseInt(hex.slice(3, 5), 16) || 0
    const b = parseInt(hex.slice(5, 7), 16) || 0
    return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111418" : "#ffffff"
}

/** SafeFlow-style ".av" tile: team initials on the kit colour (jersey over
 *  shorts when both are set). Neutral tile when no colour / TBD. */
function TeamTile({ name, kit }: { name: string | null; kit?: TeamKit }) {
    const jersey = kit?.jersey ?? null
    const shorts = kit?.shorts ?? null
    const base = jersey ?? shorts
    return (
        <Flex
            w="22px"
            h="22px"
            rounded="md"
            align="center"
            justify="center"
            flexShrink={0}
            fontFamily="heading"
            fontSize="9px"
            fontWeight={800}
            lineHeight="1"
            color={base ? contrastInk(base) : "fg.muted"}
            bg={base ? undefined : "bg.surfaceTint"}
            borderWidth="1px"
            borderColor={base ? "blackAlpha.300" : "border"}
            css={
                base
                    ? {
                          background:
                              jersey && shorts
                                  ? `linear-gradient(180deg, ${jersey} 62%, ${shorts} 62%)`
                                  : base,
                      }
                    : undefined
            }
            aria-hidden
        >
            {teamInitials(name)}
        </Flex>
    )
}

/** Tiny mono chip of a slot's predicted code ("A1", "Pobj. ČF1") shown next to
 *  a predicted team name in a bracket team row. */
function SlotChip({ label }: { label: string }) {
    return (
        <Box
            as="span"
            flexShrink={0}
            fontFamily="mono"
            fontSize="9px"
            fontWeight={800}
            letterSpacing="0.04em"
            color="fg.muted"
            bg="bg.surfaceTint"
            borderWidth="1px"
            borderColor="border"
            rounded="sm"
            px="1"
            py="0.5"
            lineHeight="1.1"
        >
            {label}
        </Box>
    )
}

function TeamRow({
    name,
    slotLabel,
    slotPredictedName,
    score,
    pen,
    winner,
    loser,
    live,
    kit,
    edit,
}: {
    name: string | null
    /** Predicted-pairing code for an undecided slot ("A1", "Pobj. ČF1"). */
    slotLabel?: string | null
    /** Predicted team name for an undecided slot (real name once its group is
     *  done, before the backend places it as a real team). */
    slotPredictedName?: string | null
    score: number | null
    pen: number | null
    winner: boolean
    loser: boolean
    /** Score reads red while the match is live (groups' live convention). */
    live?: boolean
    /** Team kit colours for the initials tile. */
    kit?: TeamKit
    /** When set, the score slot becomes an input (entering a result) - so the
     *  score is typed right where the "–" sits, not in a separate row. */
    edit?: { value: string; onChange: (v: string) => void }
}) {
    return (
        <HStack
            justify="space-between"
            gap="2"
            mx="-1"
            px="1"
            py="1"
            rounded="md"
            bg={winner ? "green.subtle" : "transparent"}
        >
            <HStack gap="2" minW="0" flex="1">
                <TeamTile name={name ?? slotPredictedName ?? null} kit={kit} />
                {name != null ? (
                    <Text
                        fontSize="13px"
                        fontWeight={winner ? 800 : 600}
                        color={loser ? "fg.muted" : "fg.ink"}
                        lineClamp="2"
                        minW="0"
                    >
                        {name}
                    </Text>
                ) : slotPredictedName != null ? (
                    // The slot's group has finished (real name known) but it isn't
                    // placed as a real team yet - muted name + tiny slot-code chip.
                    <HStack gap="1.5" minW="0" flex="1">
                        <Text fontSize="13px" fontWeight={600} color="fg.muted" lineClamp="2" minW="0">
                            {slotPredictedName}
                        </Text>
                        {slotLabel != null && <SlotChip label={slotLabel} />}
                    </HStack>
                ) : slotLabel != null ? (
                    // Nothing decided yet - the predicted pairing code ("A1", "Pobj. ČF1").
                    <Text
                        fontFamily="mono"
                        fontSize="12px"
                        fontWeight={700}
                        color="fg.muted"
                        lineClamp="2"
                        minW="0"
                    >
                        {slotLabel}
                    </Text>
                ) : (
                    <Text
                        fontSize="13px"
                        fontWeight={600}
                        color="fg.muted"
                        fontStyle="italic"
                        lineClamp="2"
                        minW="0"
                    >
                        TBD
                    </Text>
                )}
            </HStack>
            {edit ? (
                <Input
                    size="xs"
                    type="number"
                    min={0}
                    maxW="12"
                    rounded="md"
                    textAlign="center"
                    flexShrink={0}
                    value={edit.value}
                    onChange={(e) => edit.onChange(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                />
            ) : (
                <HStack gap="1" flexShrink={0} align="baseline">
                    <Text
                        fontFamily="mono"
                        fontSize="sm"
                        fontWeight={winner ? 800 : 600}
                        color={live ? "red.fg" : winner ? "brand.fg" : loser ? "fg.muted" : "fg.ink"}
                        fontVariantNumeric="tabular-nums"
                        minW="5"
                        textAlign="right"
                    >
                        {score != null ? score : "–"}
                    </Text>
                    {pen != null && (
                        <Text
                            fontFamily="mono"
                            fontSize="2xs"
                            fontWeight={winner ? 800 : 600}
                            color={winner ? "brand.fg" : "fg.muted"}
                            fontVariantNumeric="tabular-nums"
                        >
                            ({pen})
                        </Text>
                    )}
                </HStack>
            )}
        </HStack>
    )
}

/* ── LivePill - small red "UŽIVO" badge for a live match. ─────────────────── */
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

export function BracketLiveMatchDialog({
    uuid,
    match,
    onClose,
    onChanged,
}: {
    uuid: string
    match: BracketMatch
    onClose: () => void
    onChanged: () => Promise<void> | void
}) {
    const matchId = match.matchId
    const isFinished = match.status === "FINISHED"
    const isTimer = match.liveMode === "TIMER"
    // A knockout match decided by penalties: the regulation flow (goals) is
    // locked - the result lives in the penalty shootout. The organizer can
    // re-do the penalties, or tick "penali se nisu igrali" to unlock the goal
    // editing (e.g. the shootout was entered by mistake).
    const decidedOnPenalties =
        isFinished && match.penalties1 != null && match.penalties2 != null
    // For a penalty-decided match the two parts are edited separately:
    // "Uredi penale" (the shootout) and "Uredi utakmicu" (the goals/timeline).
    const [editGoals, setEditGoals] = useState(false)
    const lockGoals = decidedOnPenalties && !editGoals

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
    /** True once the organizer hits "Završi" on a level knockout match -
     *  shows the guided penalty shootout instead of finishing as a draw. */
    const [shootout, setShootout] = useState(false)
    // Direct final-score entry (no scorers). `pendingScore` carries an entered
    // score into the penalty shootout for a level knockout result.
    const [savingScore, setSavingScore] = useState(false)
    const [pendingScore, setPendingScore] = useState<{ s1: number; s2: number } | null>(null)
    /** Live value of the result-only score editor, so the footer "Spremi
     *  rezultat" button (which sits outside the editor) can read it. */
    const [directScore, setDirectScore] = useState<{ s1: number; s2: number }>({
        s1: match.score1 ?? 0,
        s2: match.score2 ?? 0,
    })
    /** Penalty result (as text) for a level result-only score - a knockout
     *  can't end drawn, so a level score needs a penalty tally. */
    const [directPens, setDirectPens] = useState<{ p1: string; p2: string }>({ p1: "", p2: "" })

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

    /** Re-fetch this match from the bracket to pick up freshly-set half instants. */
    async function refreshMatchHalf() {
        try {
            const bracket = await fetchBracket(uuid)
            const all: BracketMatch[] = [
                ...bracket.rounds.flatMap((r) => r.matches),
                ...(bracket.thirdPlace ? [bracket.thirdPlace] : []),
            ]
            const found = all.find((mm) => mm.matchId === matchId)
            if (found) {
                setFirstHalfEndedAt(found.firstHalfEndedAt ?? null)
                setSecondHalfStartedAt(found.secondHalfStartedAt ?? null)
                setLivePausedAt(found.livePausedAt ?? null)
            }
        } catch {
            /* error toast surfaced by the http interceptor */
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
    // (and the halftime / full-time prompts) flip the instant the clock
    // reaches the end of a half - LiveClock ticks its own display, but the
    // dialog needs its own tick to recompute `phase`.
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
    // App countdown running (TIMER + configured half length). With no app clock
    // (SIMPLE, or no half length) the organizer keeps their own time.
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
        return { s1, s2 }
    }

    // Live score derives from the (optimistic) event log; before any event
    // exists fall back to the stored score so a result-only match doesn't
    // flash 0:0. Adding a goal offline updates this instantly.
    const score = events.length > 0
        ? scoreFromEvents(events)
        : { s1: match.score1 ?? 0, s2: match.score2 ?? 0 }

    async function refreshAfterMutation() {
        await refetchEvents()
        await onChanged()
    }

    async function handleFinish() {
        // Knockout matches can't end level - a draw goes to penalties. Record
        // through recordKnockoutResult (not the generic finish) so the winner
        // advances the bracket.
        if (score.s1 === score.s2) {
            setShootout(true)
            return
        }
        setFinishing(true)
        try {
            await recordKnockoutResult(uuid, matchId, {
                score1: score.s1,
                score2: score.s2,
            })
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

    /** Penalty shootout decided - persist the level score + penalty result
     *  (the backend sets the winner and advances the bracket). */
    async function confirmShootout(pen1: number, pen2: number) {
        setFinishing(true)
        try {
            // Prefer a directly-entered score (shootout reached from the
            // direct-score editor); otherwise the event-derived score.
            const base = pendingScore ?? score
            await recordKnockoutResult(uuid, matchId, {
                score1: base.s1,
                score2: base.s2,
                penalties1: pen1,
                penalties2: pen2,
            })
            setPendingScore(null)
            await onChanged()
            onClose()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setFinishing(false)
        }
    }

    /** Save a final knockout score directly (no scorers). A level score can't
     *  win a knockout, so the organizer just types the penalty tally alongside
     *  it (no guided one-by-one shootout) and we save both at once. */
    async function handleSaveDirectScore(s1: number, s2: number) {
        let penalties1: number | undefined
        let penalties2: number | undefined
        if (s1 === s2) {
            const p1 = directPens.p1.trim()
            const p2 = directPens.p2.trim()
            if (p1 === "" || p2 === "") {
                showError("Penali", "Neriješena eliminacijska utakmica - upiši rezultat penala za obje ekipe.")
                return
            }
            penalties1 = Number(p1)
            penalties2 = Number(p2)
            if (penalties1 === penalties2) {
                showError("Penali", "Rezultat penala ne može biti neriješen.")
                return
            }
        }
        setSavingScore(true)
        try {
            await recordKnockoutResult(uuid, matchId, {
                score1: s1,
                score2: s2,
                penalties1,
                penalties2,
            })
            await onChanged()
            onClose()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setSavingScore(false)
        }
    }

    // A finished match entered as a plain result - no scorer/card events and
    // not decided on penalties. Editing scorers / cards / fouls is meaningless
    // then, so the dialog collapses to just the score editor + "Poništi
    // utakmicu" (annuls the result so it can be re-entered).
    const resultOnly =
        isFinished && !decidedOnPenalties && eventsLoaded && events.length === 0

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
                                            !shootout ? (
                                                <FoulControls
                                                    uuid={uuid}
                                                    matchId={matchId}
                                                    half={secondHalfStartedAt ? 2 : 1}
                                                    fouls1First={match.fouls1First}
                                                    fouls1Second={match.fouls1Second}
                                                    fouls2First={match.fouls2First}
                                                    fouls2Second={match.fouls2Second}
                                                />
                                            ) : undefined
                                        }
                                    />
                                )}
                            </Dialog.Title>
                        </Dialog.Header>
                        <Dialog.Body>
                            <VStack align="stretch" gap="2.5">

                                {/* Penalty shootout - a level knockout match
                                    is decided here (guided, alternating kicks). */}
                                {shootout && (
                                    <PenaltyShootout
                                        uuid={uuid}
                                        matchId={matchId}
                                        team1Id={match.team1Id ?? null}
                                        team1Name={match.team1Name ?? null}
                                        team2Id={match.team2Id ?? null}
                                        team2Name={match.team2Name ?? null}
                                        saving={finishing}
                                        onConfirm={confirmShootout}
                                        onCancel={() => setShootout(false)}
                                    />
                                )}

                                {/* Decided on penalties - the two parts of the
                                    match are edited separately: "Uredi penale"
                                    (the shootout) and "Uredi utakmicu" (goals). */}
                                {decidedOnPenalties && !shootout && (
                                    <Box borderWidth="1px" borderColor="border" rounded="lg" p="3">
                                        <Text
                                            fontSize="2xs"
                                            fontWeight="semibold"
                                            letterSpacing="wider"
                                            textTransform="uppercase"
                                            color="fg.muted"
                                            textAlign="center"
                                            mb="2"
                                        >
                                            Odlučeno penalima:{" "}
                                            <Box as="span" fontFamily="mono" color="fg.ink">
                                                {match.penalties1} : {match.penalties2}
                                            </Box>
                                        </Text>
                                        <HStack gap="2" justify="center" wrap="wrap">
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                colorPalette="red"
                                                onClick={() => setShootout(true)}
                                            >
                                                Uredi penale
                                            </Button>
                                            <Button
                                                size="sm"
                                                variant={editGoals ? "solid" : "outline"}
                                                colorPalette="brand"
                                                onClick={() => setEditGoals((v) => !v)}
                                            >
                                                Uredi utakmicu
                                            </Button>
                                        </HStack>
                                    </Box>
                                )}

                                {/* Direct score entry - only for a result-only
                                    finished match (no scorers). A level score just
                                    adds a penalty tally (below); no guided shootout.
                                    A live match tracks goals below instead. */}
                                {!shootout && resultOnly && (
                                    <DirectScoreEditor
                                        team1Name={match.team1Name ?? null}
                                        team2Name={match.team2Name ?? null}
                                        initialS1={match.score1 ?? 0}
                                        initialS2={match.score2 ?? 0}
                                        saving={savingScore}
                                        onSave={handleSaveDirectScore}
                                        onChange={(a, b) => setDirectScore({ s1: a, s2: b })}
                                        hideSaveButton
                                    />
                                )}

                                {/* Penalty tally - only when the result-only score
                                    is level (a knockout can't end drawn). Simple
                                    number inputs, not a kick-by-kick shootout. */}
                                {!shootout && resultOnly && directScore.s1 === directScore.s2 && (
                                    <Box borderWidth="1px" borderColor="border" rounded="lg" p="3" bg="bg.surfaceTint">
                                        <Text
                                            fontSize="2xs"
                                            fontWeight="semibold"
                                            letterSpacing="wider"
                                            textTransform="uppercase"
                                            color="fg.muted"
                                            textAlign="center"
                                            mb="2"
                                        >
                                            Penali (neriješeno)
                                        </Text>
                                        <HStack align="flex-start" gap="2">
                                            <VStack gap="1.5" flex="1" minW="0">
                                                <Text fontSize="12px" fontWeight={700} color="fg.ink" truncate maxW="full" title={match.team1Name ?? "-"}>
                                                    {match.team1Name ?? "-"}
                                                </Text>
                                                <Input
                                                    size="sm"
                                                    w="64px"
                                                    inputMode="numeric"
                                                    textAlign="center"
                                                    fontWeight={800}
                                                    value={directPens.p1}
                                                    onChange={(e) => setDirectPens((p) => ({ ...p, p1: e.target.value.replace(/[^\d]/g, "") }))}
                                                />
                                            </VStack>
                                            <Text fontFamily="mono" fontSize="lg" fontWeight={800} color="fg.muted" pt="6">
                                                :
                                            </Text>
                                            <VStack gap="1.5" flex="1" minW="0">
                                                <Text fontSize="12px" fontWeight={700} color="fg.ink" truncate maxW="full" title={match.team2Name ?? "-"}>
                                                    {match.team2Name ?? "-"}
                                                </Text>
                                                <Input
                                                    size="sm"
                                                    w="64px"
                                                    inputMode="numeric"
                                                    textAlign="center"
                                                    fontWeight={800}
                                                    value={directPens.p2}
                                                    onChange={(e) => setDirectPens((p) => ({ ...p, p2: e.target.value.replace(/[^\d]/g, "") }))}
                                                />
                                            </VStack>
                                        </HStack>
                                    </Box>
                                )}

                                {/* Add-event - fast one-tap entry. Shown for a
                                    finished match too so "Uredi rezultat" can fix
                                    a wrong scorer. Locked when the match was
                                    decided on penalties (the regulation flow is
                                    fixed) unless "penali se nisu igrali"; hidden
                                    entirely for a result-only match. */}
                                {!shootout && !lockGoals && !resultOnly && (
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
                                                    canDelete={!lockGoals}
                                                    deleting={false}
                                                    onDelete={() => deleteEvent(ev)}
                                                />
                                            ))}
                                        </VStack>
                                    )}
                                    {(!online || pendingCount > 0 || syncing) && (
                                        <Flex justify="center" mt="2">
                                            <LiveSyncIndicator online={online} pending={pendingCount} syncing={syncing} />
                                        </Flex>
                                    )}
                                </Box>
                            </VStack>
                        </Dialog.Body>
                        <Dialog.Footer justifyContent="center">
                            {/* Zatvori · the one primary phase button · Poništi
                                utakmicu. */}
                            <HStack gap="2" justify="center" w="full" maxW="md" wrap="wrap">
                                <Button variant="ghost" onClick={onClose} flexShrink={0}>
                                    Zatvori
                                </Button>
                                {/* Result-only: save the direct score from the footer. */}
                                {!shootout && resultOnly && (
                                    <Button
                                        colorPalette="pitch"
                                        flex="1"
                                        loading={savingScore}
                                        onClick={() => handleSaveDirectScore(directScore.s1, directScore.s2)}
                                    >
                                        <FiEdit2 /> Spremi rezultat
                                    </Button>
                                )}
                                {!isFinished && !shootout && (
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
                                {!shootout && (
                                    <Button
                                        colorPalette="red"
                                        variant="outline"
                                        flex="1"
                                        loading={resetting}
                                        onClick={confirmReset}
                                    >
                                        Poništi utakmicu
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
            title="Poništiti utakmicu?"
            description="Rezultat i svi događaji se brišu, a utakmica se vraća na 'neodigrano'. Termin ostaje - možeš zatim ponovno unijeti rezultat."
            confirmLabel="Da, poništi"
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

