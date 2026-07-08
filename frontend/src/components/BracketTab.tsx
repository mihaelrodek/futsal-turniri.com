import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type MouseEvent as ReactMouseEvent } from "react"
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
import {
    SingleEliminationBracket,
    createTheme,
    type MatchComponentProps,
    type MatchType,
} from "@g-loot/react-tournament-brackets"
import {
    fetchBracket,
    fetchBracketQualifiers,
    generateBracket,
    generateBracketManual,
    resetBracket,
    setBracketSeeds,
    recordKnockoutResult,
    type BracketCandidate,
    type ManualBracketPairing,
} from "../api/bracket"
import type { Bracket, BracketMatch, BracketRound } from "../types/bracket"
import { showError, toaster } from "../toaster"
import {
    deleteMatchEvent,
    endFirstHalf,
    fetchMatchEvents,
    resetMatch,
    startMatch,
    startSecondHalf,
} from "../api/matchEvents"
import type { MatchEventDto, MatchLiveMode } from "../types/matchEvents"
import { fetchSchedule } from "../api/schedule"
import { ConfirmDialog, EmptyState, Loader, Panel } from "../ui/primitives"
import { GhostButton } from "../ui/pitch"
import { DirectScoreEditor, FoulControls, LiveClock, LiveEventRow, LiveGoalEntry, MatchTimelineModal, PenaltyShootout, StartLivePopover, matchPhase } from "./liveMatch"
import { FiArrowDown, FiArrowUp, FiClock, FiCrosshair, FiRefreshCw, FiShare2, FiTrash2 } from "react-icons/fi"
import { toPng } from "html-to-image"

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
    connectorColor: "#cbd5e1",       // muted slate so connectors don't shout
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

/** First opaque background colour walking up from a node - used as the
 *  backdrop for the shared bracket image so card gaps aren't transparent
 *  (and it matches the current light/dark theme). */
function resolveBackdrop(el: HTMLElement | null): string {
    let node = el
    while (node) {
        const c = getComputedStyle(node).backgroundColor
        if (c && c !== "transparent" && !c.startsWith("rgba(0, 0, 0, 0")) return c
        node = node.parentElement
    }
    return "#ffffff"
}

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
 *  true, "Ponovno generiraj" is removed from the toolbar (regenerating a
 *  bracket mid-tournament would wipe live scores). canEdit controls
 *  visibility of result entry on individual matches; tournamentStarted
 *  controls the destructive whole-bracket regenerate action. */
export default function BracketTab({
    uuid,
    canEdit = false,
    tournamentName,
    format,
}: {
    uuid: string
    canEdit?: boolean
    /** Accepted for API compatibility; the bracket's "started" lock is derived
     *  from the elimination matches, not the tournament status. */
    tournamentStarted?: boolean
    /** Used for the shared bracket image's filename + share title. */
    tournamentName?: string
    /** Tournament format - the manual-seed (nositelji) ordering UI is only
     *  shown for KNOCKOUT_ONLY, where the bracket is seeded directly from the
     *  team list instead of group standings. */
    format?: string | null
}) {
    const [bracket, setBracket] = useState<Bracket | null>(null)
    const [loading, setLoading] = useState(true)
    const [generating, setGenerating] = useState(false)
    const [editingId, setEditingId] = useState<number | null>(null)
    const [form, setForm] = useState<EditForm>({ s1: "", s2: "", p1: "", p2: "" })
    const [saving, setSaving] = useState(false)
    /** matchId of the card whose "start live" call is in flight. */
    const [startingId, setStartingId] = useState<number | null>(null)
    /** The match currently open in the live dialog, or null. */
    const [liveMatch, setLiveMatch] = useState<BracketMatch | null>(null)
    /** Match whose read-only timeline modal is open (any viewer can open it). */
    const [timelineMatch, setTimelineMatch] = useState<BracketMatch | null>(null)
    // Half config (schedule) so inline row clocks count UP + freeze at each
    // half boundary, like the dialog clock - not a free-running timer.
    const [halfLengthMin, setHalfLengthMin] = useState<number | null>(null)
    const [halfCount, setHalfCount] = useState<number | null>(null)
    // Manual draw - organizer arranges teams into the bracket's first-round slots.
    const [manualOpen, setManualOpen] = useState(false)
    const [slots, setSlots] = useState<(number | null)[]>([])
    const [generatingManual, setGeneratingManual] = useState(false)
    const [resetting, setResetting] = useState(false)
    // Manual seeds (nositelji) - KNOCKOUT_ONLY only. The organizer orders the
    // teams; the auto draw then produces the same bracket every time.
    const [seedsOpen, setSeedsOpen] = useState(false)
    const [seedOrder, setSeedOrder] = useState<BracketCandidate[]>([])
    const [savingSeeds, setSavingSeeds] = useState(false)
    // Bye picker - when the qualifier count isn't a power of two, the organizer
    // chooses which teams advance directly (round-one bye) before generating.
    const [byeOpen, setByeOpen] = useState(false)
    const [byeIds, setByeIds] = useState<Set<number>>(new Set())
    /** Which destructive bracket action awaits confirmation in the popup. */
    const [confirmAction, setConfirmAction] = useState<null | "reset" | "regenerate">(null)
    // Eligible teams for the bracket (group qualifiers / all teams) + whether
    // the group stage is finished - both come from the qualifiers endpoint.
    const [qualifiers, setQualifiers] = useState<BracketCandidate[]>([])
    const [groupStageComplete, setGroupStageComplete] = useState(true)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        fetchBracket(uuid)
            .then((b) => { if (!cancelled) setBracket(b) })
            .catch(() => { if (!cancelled) setBracket(null) })
            .finally(() => { if (!cancelled) setLoading(false) })
        fetchSchedule(uuid)
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
        return () => { cancelled = true }
    }, [uuid])

    /** Re-fetch the bracket (after a live action changed the score / status). */
    async function reloadBracket() {
        try {
            setBracket(await fetchBracket(uuid))
        } catch {
            /* error toast surfaced by the http interceptor */
        }
    }

    async function runGenerate(byeIds?: number[], shuffleRest?: boolean) {
        setGenerating(true)
        try {
            setBracket(await generateBracket(uuid, byeIds, shuffleRest))
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

    /** Re-drawing wipes the existing bracket, so "Ponovno (auto)" asks for an
     *  explicit confirmation in a popup modal before running. */
    function confirmRegenerate() {
        setConfirmAction("regenerate")
    }

    async function runResetBracket() {
        setResetting(true)
        try {
            setBracket(await resetBracket(uuid))
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
    async function handleStartLive(m: BracketMatch, mode: MatchLiveMode) {
        setStartingId(m.matchId)
        try {
            await startMatch(uuid, m.matchId, mode)
            await reloadBracket()
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

    // Share the bracket as a PNG image (native share sheet → WhatsApp etc. on
    // mobile; download fallback on desktop browsers without file sharing).
    const [sharing, setSharing] = useState(false)
    async function shareBracket() {
        const node = contentRef.current
        if (!node || sharing) return
        setSharing(true)
        try {
            // Theme-aware backdrop so the gaps between cards aren't transparent.
            const bg = resolveBackdrop(node.parentElement)
            const dataUrl = await toPng(node, {
                backgroundColor: bg,
                pixelRatio: 2,
                cacheBust: true,
                // Drop interactive buttons (Start / edit) from the snapshot.
                filter: (el) =>
                    !(el instanceof HTMLElement && el.tagName === "BUTTON"),
            })
            const fileName = `bracket-${tournamentName ? tournamentName.replace(/\s+/g, "-").toLowerCase() : uuid}.png`
            const blob = await (await fetch(dataUrl)).blob()
            const file = new File([blob], fileName, { type: "image/png" })
            const nav = navigator as any
            if (nav.canShare && nav.canShare({ files: [file] })) {
                try {
                    await nav.share({
                        files: [file],
                        title: tournamentName ?? "Eliminacijska ljestvica",
                    })
                } catch {
                    /* user cancelled the share sheet - no-op */
                }
            } else {
                // No file-share support (most desktops) → download the image.
                const a = document.createElement("a")
                a.href = dataUrl
                a.download = fileName
                a.click()
                toaster.create({
                    type: "success",
                    title: "Slika spremljena",
                    description: "Bracket je spremljen kao slika koju možeš podijeliti.",
                    duration: 4000,
                })
            }
        } catch {
            showError("Nije moguće izraditi sliku ljestvice.")
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
    }, [bracket, editingId, startingId, liveMatch])

    // ─── Manual draw - organizer arranges teams into first-round slots ───
    const nextPow2 = (x: number) => {
        let p = 2
        while (p < x) p <<= 1
        return p
    }
    // Pool = group qualifiers (or all teams for KNOCKOUT_ONLY) from the backend.
    const pool = qualifiers
    const bracketN = pool.length >= 2 ? nextPow2(pool.length) : 2
    const matchCount = bracketN / 2
    // How many teams get a round-one bye (direct advance) - only when the
    // qualifier count isn't already a power of two.
    const byesNeeded = pool.length >= 2 ? bracketN - pool.length : 0

    function openManualBracket() {
        // Put the teams that advance directly (byes) FIRST, at the top - each in
        // its own match with an empty opponent - then pair up the rest below.
        const seed: (number | null)[] = new Array(bracketN).fill(null)
        for (let i = 0; i < byesNeeded; i++) seed[2 * i] = pool[i]?.id ?? null
        let slot = byesNeeded * 2
        for (let i = byesNeeded; i < pool.length; i++) seed[slot++] = pool[i]?.id ?? null
        setSlots(seed)
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
            showError("Greška", "Ista ekipa je odabrana u više utakmica.")
            return
        }
        if (chosen.length < 2) {
            showError("Greška", "Potrebne su barem 2 ekipe za ljestvicu.")
            return
        }
        const pairs: ManualBracketPairing[] = []
        for (let i = 0; i < matchCount; i++) {
            pairs.push({ team1Id: slots[2 * i] ?? null, team2Id: slots[2 * i + 1] ?? null })
        }
        try {
            setGeneratingManual(true)
            setBracket(await generateBracketManual(uuid, pairs))
            setManualOpen(false)
            setEditingId(null)
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setGeneratingManual(false)
        }
    }

    const slotSelect = (idx: number) => (
        <NativeSelect.Root size="sm" flex="1" minW="0">
            <NativeSelect.Field
                value={slots[idx] != null ? String(slots[idx]) : ""}
                onChange={(e) =>
                    setSlot(idx, e.target.value === "" ? null : Number(e.target.value))
                }
            >
                <option value="">- prazno (prolaz) -</option>
                {pool.map((tm) => (
                    <option key={tm.id} value={tm.id}>
                        {tm.name?.trim() || "Bez imena"}
                    </option>
                ))}
            </NativeSelect.Field>
        </NativeSelect.Root>
    )

    const manualBracketPanel = (
        <Panel p={{ base: "4", md: "5" }}>
            <VStack align="stretch" gap="3">
                <HStack justify="space-between" align="center">
                    <Text fontWeight="bold" fontSize="sm">
                        Ručni ždrijeb - složi parove
                    </Text>
                    <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setManualOpen(false)}
                        disabled={generatingManual}
                    >
                        Odustani
                    </Button>
                </HStack>
                <Text fontSize="xs" color="fg.muted">
                    Ljestvica za {bracketN} ({matchCount} {matchCount === 1 ? "utakmica" : "utakmica"} 1.
                    kola). Prazno mjesto = slobodan prolaz u sljedeće kolo.
                </Text>
                <VStack align="stretch" gap="2">
                    {Array.from({ length: matchCount }, (_, i) => (
                        <HStack
                            key={i}
                            gap="2"
                            align="center"
                            borderWidth="1px"
                            borderColor="border"
                            rounded="lg"
                            px="3"
                            py="2"
                        >
                            <Text fontSize="xs" color="fg.muted" w="22px" flexShrink={0}>
                                {i + 1}.
                            </Text>
                            {slotSelect(2 * i)}
                            <Text fontSize="xs" color="fg.muted" flexShrink={0}>
                                vs
                            </Text>
                            {slotSelect(2 * i + 1)}
                        </HStack>
                    ))}
                </VStack>
                <Button
                    colorPalette="brand"
                    onClick={submitManualBracket}
                    loading={generatingManual}
                >
                    Generiraj ljestvicu (ručno)
                </Button>
            </VStack>
        </Panel>
    )

    // ─── Manual seeds (nositelji) - KNOCKOUT_ONLY deterministic ordering ───
    const isKnockoutOnly = format === "KNOCKOUT_ONLY"

    function openSeeds() {
        setSeedOrder([...qualifiers])
        setSeedsOpen(true)
    }

    function moveSeed(idx: number, dir: -1 | 1) {
        setSeedOrder((s) => {
            const j = idx + dir
            if (j < 0 || j >= s.length) return s
            const c = [...s]
            ;[c[idx], c[j]] = [c[j], c[idx]]
            return c
        })
    }

    async function saveSeeds() {
        try {
            setSavingSeeds(true)
            const q = await setBracketSeeds(uuid, seedOrder.map((t) => t.id))
            setQualifiers(q.teams)
            setGroupStageComplete(q.groupStageComplete)
            setSeedsOpen(false)
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setSavingSeeds(false)
        }
    }

    const seedsPanel = (
        <Panel p={{ base: "4", md: "5" }}>
            <VStack align="stretch" gap="3">
                <HStack justify="space-between" align="center">
                    <Text fontWeight="bold" fontSize="sm">
                        Nosioci - posloži redoslijed
                    </Text>
                    <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => setSeedsOpen(false)}
                        disabled={savingSeeds}
                    >
                        Odustani
                    </Button>
                </HStack>
                <Text fontSize="xs" color="fg.muted">
                    Redoslijed određuje parove (1. protiv zadnjeg, itd.). Isti redoslijed
                    uvijek daje istu ljestvicu - kao na Challongeu.
                </Text>
                <VStack align="stretch" gap="1.5">
                    {seedOrder.map((tm, idx) => (
                        <HStack
                            key={tm.id}
                            gap="2"
                            align="center"
                            borderWidth="1px"
                            borderColor="border"
                            rounded="lg"
                            px="3"
                            py="2"
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
                                {tm.name?.trim() || "Bez imena"}
                            </Text>
                            <HStack gap="0.5" flexShrink={0}>
                                <IconButton
                                    aria-label="Pomakni gore"
                                    size="xs"
                                    variant="ghost"
                                    disabled={idx === 0 || savingSeeds}
                                    onClick={() => moveSeed(idx, -1)}
                                >
                                    <FiArrowUp />
                                </IconButton>
                                <IconButton
                                    aria-label="Pomakni dolje"
                                    size="xs"
                                    variant="ghost"
                                    disabled={idx === seedOrder.length - 1 || savingSeeds}
                                    onClick={() => moveSeed(idx, 1)}
                                >
                                    <FiArrowDown />
                                </IconButton>
                            </HStack>
                        </HStack>
                    ))}
                </VStack>
                <Button colorPalette="brand" onClick={saveSeeds} loading={savingSeeds}>
                    Spremi nosioce
                </Button>
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

    const hasBracket = bracket != null && bracket.rounds.length > 0

    if (!hasBracket) {
        if (canEdit && byeOpen) return byePanel
        if (canEdit && seedsOpen) return seedsPanel
        if (canEdit && manualOpen) return manualBracketPanel
        return (
            <Panel p="0">
                <EmptyState
                    title="Eliminacijska ljestvica još nije generirana"
                    description={
                        !canEdit
                            ? "Organizator još nije generirao eliminacijsku ljestvicu."
                            : !groupStageComplete
                                ? "Završi sve utakmice grupne faze (upiši rezultate) da bi mogao generirati eliminaciju."
                                : isKnockoutOnly
                                    ? "Ručno složi parove sam, ili posloži nosioce pa generiraj (ista ljestvica svaki put)."
                                    : "Ručno složi parove sam ili generiraj automatski iz kvalifikanata."
                    }
                    action={
                        canEdit ? (
                            <HStack gap="2" wrap="wrap" justify="center">
                                {/* Ručni ždrijeb is the default (primary); the
                                    automatic draw is the opt-in beside it. */}
                                <Button
                                    colorPalette="brand"
                                    size="sm"
                                    onClick={openManualBracket}
                                    disabled={!groupStageComplete || pool.length < 2}
                                >
                                    Ručni ždrijeb
                                </Button>
                                {isKnockoutOnly && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={openSeeds}
                                        disabled={pool.length < 2}
                                    >
                                        Nosioci
                                    </Button>
                                )}
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

    // Podium - derived from the decided final and third-place matches.
    const finalMatch = bracket.rounds.find((r) => r.stage === "FINAL")?.matches[0]
    const champion =
        finalMatch && finalMatch.winnerTeamId != null
            ? finalMatch.winnerTeamId === finalMatch.team1Id
                ? finalMatch.team1Name
                : finalMatch.team2Name
            : null
    const runnerUp =
        finalMatch && finalMatch.winnerTeamId != null
            ? finalMatch.winnerTeamId === finalMatch.team1Id
                ? finalMatch.team2Name
                : finalMatch.team1Name
            : null
    const tp = bracket.thirdPlace
    const thirdPlaceName =
        tp && tp.winnerTeamId != null
            ? tp.winnerTeamId === tp.team1Id
                ? tp.team1Name
                : tp.team2Name
            : null

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
                        editing={editingId === original.matchId}
                        form={form}
                        showPenaltyRow={showPenaltyRow}
                        saving={saving}
                        starting={startingId === original.matchId}
                        halfLengthMin={halfLengthMin}
                        halfCount={halfCount}
                        onEdit={startEdit}
                        uuid={uuid}
                        onSave={saveResult}
                        onSavePenalties={saveResultWithPenalties}
                        onCancel={() => setEditingId(null)}
                        onFormChange={setForm}
                        onStartLive={handleStartLive}
                        onOpenLive={setLiveMatch}
                        onOpenTimeline={setTimelineMatch}
                    />
                </Box>
            </Box>
        )
    }

    return (
        <VStack align="stretch" gap="5" py="2">
            {/* Owner draw controls - right-aligned. "Ponovno (auto)" wipes the
                bracket so it asks for confirmation first. Both hidden once any
                match is LIVE/FINISHED (re-drawing would destroy real results).
                The "Podijeli bracket" button now floats at the bottom (below). */}
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
                        icon={<FiRefreshCw size={14} />}
                        onClick={confirmRegenerate}
                        disabled={generating}
                    >
                        {generating ? "Ždrijeb…" : "Ponovno (auto)"}
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

            {/* Confirm popup for the destructive draw actions (reset / regenerate). */}
            <ConfirmDialog
                open={confirmAction !== null}
                busy={confirmAction === "reset" ? resetting : generating}
                danger
                title={confirmAction === "reset" ? "Resetirati eliminaciju?" : "Ponoviti ždrijeb?"}
                description={
                    confirmAction === "reset"
                        ? "Sve utakmice eliminacijske faze bit će obrisane."
                        : "Postojeća eliminacijska ljestvica bit će obrisana i izvučena ponovno."
                }
                confirmLabel={confirmAction === "reset" ? "Da, resetiraj" : "Da, ponovi ždrijeb"}
                onClose={() => setConfirmAction(null)}
                onConfirm={async () => {
                    if (confirmAction === "reset") await runResetBracket()
                    else await runGenerate()
                    setConfirmAction(null)
                }}
            />

            {/* Manual draw editor - shown above the bracket when opened. */}
            {canEdit && !started && manualOpen && manualBracketPanel}

            {/* ── Podium banner ──────────────────────────────────────────── */}
            {champion && (
                <Panel>
                    <Box
                        px="5"
                        py="4"
                        rounded="2xl"
                        bgGradient="to-r"
                        gradientFrom="yellow.subtle"
                        gradientTo="brand.subtle"
                    >
                        <Text
                            fontSize="xs"
                            fontWeight="semibold"
                            letterSpacing="wider"
                            textTransform="uppercase"
                            color="yellow.fg"
                            mb="2"
                        >
                            Rezultati turnira
                        </Text>
                        <Flex gap="5" wrap="wrap" align="center">
                            <HStack gap="2">
                                <Text fontSize="lg" lineHeight="1">🥇</Text>
                                <Text fontWeight="bold" color="fg">
                                    {champion}
                                </Text>
                            </HStack>
                            {runnerUp && (
                                <HStack gap="2">
                                    <Text fontSize="lg" lineHeight="1">🥈</Text>
                                    <Text color="fg.muted">{runnerUp}</Text>
                                </HStack>
                            )}
                            {thirdPlaceName && (
                                <HStack gap="2">
                                    <Text fontSize="lg" lineHeight="1">🥉</Text>
                                    <Text color="fg.muted">{thirdPlaceName}</Text>
                                </HStack>
                            )}
                        </Flex>
                    </Box>
                </Panel>
            )}

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
                                <Text
                                    fontFamily="'JetBrains Mono', ui-monospace, monospace"
                                    fontSize="11px"
                                    fontWeight="bold"
                                    letterSpacing="wide"
                                    color="fg.muted"
                                    h="32px"
                                    mb="16px"
                                    display="flex"
                                    alignItems="center"
                                >
                                    Za 3. mjesto
                                </Text>
                                <MatchCard
                                    match={bracket.thirdPlace}
                                    canEdit={canEdit}
                                    isThirdPlace
                                    editing={editingId === bracket.thirdPlace.matchId}
                                    form={form}
                                    showPenaltyRow={showPenaltyRow}
                                    saving={saving}
                                    starting={startingId === bracket.thirdPlace.matchId}
                                    halfLengthMin={halfLengthMin}
                                    halfCount={halfCount}
                                    onEdit={startEdit}
                                    uuid={uuid}
                                    onSave={saveResult}
                                    onSavePenalties={saveResultWithPenalties}
                                    onCancel={() => setEditingId(null)}
                                    onFormChange={setForm}
                                    onStartLive={handleStartLive}
                                    onOpenLive={setLiveMatch}
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
                    match; "Podijeli" shares the bracket image. */}
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
                        title="Podijeli sliku ljestvice"
                    >
                        <FiShare2 size={15} />
                        {sharing ? "Pripremam…" : "Podijeli"}
                    </Button>
                </Flex>
            </Panel>

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

        </VStack>
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
    starting: boolean
    isFinal?: boolean
    isThirdPlace?: boolean
    /** Tournament half config - drives the inline TIMER clock countdown. */
    halfLengthMin?: number | null
    halfCount?: number | null
    /** Tournament uuid - needed to persist the optional penalty shooter. */
    uuid: string
    onEdit: (m: BracketMatch) => void
    onSave: (m: BracketMatch) => void
    onSavePenalties: (m: BracketMatch, pen1: number, pen2: number) => void
    onCancel: () => void
    onFormChange: (updater: (prev: EditForm) => EditForm) => void
    onStartLive: (m: BracketMatch, mode: MatchLiveMode) => void
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
    starting,
    isFinal = false,
    isThirdPlace = false,
    halfLengthMin = null,
    halfCount = null,
    uuid,
    onEdit,
    onSave,
    onSavePenalties,
    onCancel,
    onFormChange,
    onStartLive,
    onOpenLive,
    onOpenTimeline,
}: MatchCardProps) {
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

    return (
        <Box
            bg="bg.panel"
            borderWidth={isFinal || isLive ? "1.5px" : "1px"}
            borderColor={accentBorder}
            rounded="xl"
            shadow={isFinal ? "md" : "xs"}
            overflow="hidden"
            cursor={editing ? "default" : "pointer"}
            // Click anywhere on the card → read-only match timeline (tijek).
            // Clicks on the action controls (start menu, edit/score inputs,
            // live/result buttons) are ignored so they keep their own behaviour.
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
                onOpenTimeline(m)
            }}
        >
            {/* Card top strip - final badge / live indicator */}
            {(isFinal || isThirdPlace || isLive) && (
                <Flex
                    align="center"
                    justify="space-between"
                    px="3"
                    py="1.5"
                    bg={
                        isLive
                            ? "red.subtle"
                            : isFinal
                                ? "yellow.subtle"
                                : "gray.subtle"
                    }
                    borderBottomWidth="1px"
                    borderColor="border"
                >
                    <HStack gap="1.5">
                        {isFinal && (
                            <Text fontSize="sm" lineHeight="1">🏆</Text>
                        )}
                        <Text
                            fontSize="2xs"
                            fontWeight="bold"
                            letterSpacing="wider"
                            textTransform="uppercase"
                            color={
                                isLive
                                    ? "red.fg"
                                    : isFinal
                                        ? "yellow.fg"
                                        : "fg.muted"
                            }
                        >
                            {isFinal ? "Finale" : isThirdPlace ? "Za 3. mjesto" : "Utakmica"}
                        </Text>
                    </HStack>
                    {isLive && (
                        <HStack gap="2">
                            <LivePill />
                            {m.liveMode === "TIMER" && (
                                <LiveClock
                                    liveStartedAt={m.liveStartedAt}
                                    firstHalfEndedAt={m.firstHalfEndedAt}
                                    secondHalfStartedAt={m.secondHalfStartedAt}
                                    halfLengthMin={halfLengthMin}
                                    halfCount={halfCount}
                                    showLabel
                                />
                            )}
                        </HStack>
                    )}
                </Flex>
            )}

            {/* Two team rows. The whole card opens the timeline (see the card
                onClick above); while entering a result the score inputs sit in
                each team row and the card's interactive-target guard ignores
                their clicks. */}
            <Box px="3" py="2.5">
                <Box>
                    <TeamRow
                        name={m.team1Name}
                        score={m.score1}
                        pen={m.penalties1}
                        winner={w1}
                        loser={w2}
                        edit={editing
                            ? { value: form.s1, onChange: (v) => onFormChange((f) => ({ ...f, s1: v })) }
                            : undefined}
                    />
                    <Box h="1px" bg="border" my="2" />
                    <TeamRow
                        name={m.team2Name}
                        score={m.score2}
                        pen={m.penalties2}
                        winner={w2}
                        loser={w1}
                        edit={editing
                            ? { value: form.s2, onChange: (v) => onFormChange((f) => ({ ...f, s2: v })) }
                            : undefined}
                    />
                </Box>

                {/* Scheduled kickoff - when this match is set to be played. */}
                {m.kickoffAt && !editing && (
                    <HStack
                        gap="1.5"
                        mt="2"
                        justify="center"
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
                canEdit && editable && (
                    <VStack align="stretch" gap="1.5" mt="2">
                        {isScheduled &&
                            (m.kickoffAt ? (
                                <StartLivePopover
                                    loading={starting}
                                    onStart={(mode) => onStartLive(m, mode)}
                                    onEnterResult={() => onEdit(m)}
                                />
                            ) : (
                                // No kickoff yet → can't start. Nudge the
                                // organizer to (re)confirm the schedule first.
                                <Box
                                    rounded="lg"
                                    borderWidth="1px"
                                    borderColor="border"
                                    bg="bg.subtle"
                                    px="2"
                                    py="1.5"
                                    textAlign="center"
                                >
                                    <Text fontSize="2xs" color="fg.muted" fontWeight={600} lineHeight="1.2">
                                        Potvrdi raspored za pokretanje
                                    </Text>
                                </Box>
                            ))}
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
   One team line inside a match card. The winner's row is emphasised (bold,
   brand colour, subtle highlighted background); the loser's row is muted.
   ────────────────────────────────────────────────────────────────────────── */
function TeamRow({
    name,
    score,
    pen,
    winner,
    loser,
    edit,
}: {
    name: string | null
    score: number | null
    pen: number | null
    winner: boolean
    loser: boolean
    /** When set, the score slot becomes an input (entering a result) - so the
     *  score is typed right where the "–" sits, not in a separate row. */
    edit?: { value: string; onChange: (v: string) => void }
}) {
    const nameColor = !name
        ? "fg.subtle"
        : winner
            ? "brand.fg"
            : loser
                ? "fg.muted"
                : "fg"
    return (
        <HStack
            justify="space-between"
            gap="2"
            mx="-1.5"
            px="1.5"
            py="0.5"
            rounded="md"
            bg={winner ? "brand.subtle" : "transparent"}
        >
            <Text
                fontSize="sm"
                fontWeight={winner ? "bold" : "medium"}
                color={nameColor}
                truncate
                flex="1"
                minW="0"
            >
                {name ?? "-"}
            </Text>
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
                        fontSize="sm"
                        fontWeight={winner ? "bold" : "semibold"}
                        color={winner ? "brand.fg" : loser ? "fg.muted" : "fg"}
                        fontVariantNumeric="tabular-nums"
                        minW="5"
                        textAlign="right"
                    >
                        {score != null ? score : "–"}
                    </Text>
                    {pen != null && (
                        <Text
                            fontSize="2xs"
                            fontWeight={winner ? "bold" : "medium"}
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
    // Show the stored score until the organizer edits an event in this dialog
    // (then recompute from the event log) - keeps a result-only match from
    // flashing 0:0 when opened via "Uredi rezultat".
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
    /** True once the organizer hits "Završi" on a level knockout match -
     *  shows the guided penalty shootout instead of finishing as a draw. */
    const [shootout, setShootout] = useState(false)
    /** eventId currently being deleted. */
    const [deletingId, setDeletingId] = useState<number | null>(null)
    // Direct final-score entry (no scorers). `pendingScore` carries an entered
    // score into the penalty shootout for a level knockout result.
    const [savingScore, setSavingScore] = useState(false)
    const [pendingScore, setPendingScore] = useState<{ s1: number; s2: number } | null>(null)

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

    // Keep the score in sync with the event log once events have been edited.
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

    /** Save a final knockout score directly (no scorers). A level score hands
     *  off to the penalty shootout (a knockout can't end drawn). */
    async function handleSaveDirectScore(s1: number, s2: number) {
        if (s1 === s2) {
            setPendingScore({ s1, s2 })
            setShootout(true)
            return
        }
        setSavingScore(true)
        try {
            await recordKnockoutResult(uuid, matchId, { score1: s1, score2: s2 })
            await onChanged()
            onClose()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setSavingScore(false)
        }
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
                                {!shootout && (
                                    <FoulControls
                                        uuid={uuid}
                                        matchId={matchId}
                                        half={secondHalfStartedAt ? 2 : 1}
                                        fouls1First={match.fouls1First}
                                        fouls1Second={match.fouls1Second}
                                        fouls2First={match.fouls2First}
                                        fouls2Second={match.fouls2Second}
                                    />
                                )}

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

                                {/* Direct final-score entry (no scorers) - for a
                                    knockout match with no goal events yet. A
                                    level score routes to the penalty shootout. */}
                                {!shootout && !decidedOnPenalties && events != null && events.length === 0 && (
                                    <DirectScoreEditor
                                        team1Name={match.team1Name ?? null}
                                        team2Name={match.team2Name ?? null}
                                        initialS1={match.score1 ?? 0}
                                        initialS2={match.score2 ?? 0}
                                        saving={savingScore}
                                        onSave={handleSaveDirectScore}
                                    />
                                )}

                                {/* Add-event - fast one-tap entry. Shown for a
                                    finished match too so "Uredi rezultat" can fix
                                    a wrong scorer. Locked when the match was
                                    decided on penalties (the regulation flow is
                                    fixed) unless "penali se nisu igrali". */}
                                {!shootout && !lockGoals && (
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
                                                    canDelete={!lockGoals}
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
                                {!isFinished && !shootout && (
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
                                {!isFinished && !shootout && canEndFirstHalf && (
                                    <Button
                                        colorPalette="red"
                                        loading={endingHalf}
                                        onClick={handleEndFirstHalf}
                                    >
                                        Završi 1. poluvrijeme
                                    </Button>
                                )}
                                {!isFinished && !shootout && canStartSecondHalf && (
                                    <Button
                                        colorPalette="red"
                                        loading={startingHalf}
                                        onClick={handleStartSecondHalf}
                                    >
                                        Započni 2. poluvrijeme
                                    </Button>
                                )}
                                {!isFinished && !shootout && (
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

