import { useEffect, useMemo, useRef, useState } from "react"
import {
    Box,
    Button,
    chakra,
    Dialog,
    Flex,
    HStack,
    Input,
    Popover,
    Portal,
    Spinner,
    Text,
    VStack,
} from "@chakra-ui/react"
import { FiCalendar, FiCheck, FiChevronLeft, FiClock, FiPlus, FiX } from "react-icons/fi"
import { LuCalendarClock, LuGripVertical } from "react-icons/lu"
import { fetchPlanInfo, generateMultiDaySchedule, previewSchedule } from "../api/schedule"
import type { Schedule, ScheduleConfig, SchedulePlanInfo, SchedulePlanRequest, SchedulePreview } from "../types/schedule"
import { MonoLabel } from "../ui/pitch"

/* ──────────────────────────────────────────────────────────────────────────
   MultiDaySchedulePlanner - the "Generiraj raspored" flow for tournaments
   played over one or more days.

   1. Pick a date range (od - do) → one row per day.
   2. Per day: how many matches + when the first match kicks off.
   3. A live counter shows how many matches remain to schedule (of the whole
      tournament's predicted total: group fixtures + reserved knockout).
   4. "Skiciraj" computes the schedule WITHOUT persisting and shows a short
      day-by-day list (knockout matches appear as placeholders - teams decided
      only after the group stage).
   5. "Potvrdi i generiraj" actually generates it.

   koOnly mode ("Raspored završnice"): the exact same UX, but the plan covers
   ONLY the knockout matches (group kickoffs are left untouched) - the counter
   uses SchedulePlanInfo.knockoutMatches and the request carries koOnly: true.

   "Dodaj pauzu": the sketch's draggable row list also accepts PAUSE rows -
   breaks that shift every match after them later. They drag & drop like match
   rows and translate to the request's `breaks` on generate.
   ────────────────────────────────────────────────────────────────────────── */

type DayRow = { date: string; matches: string; firstStart: string }

/** One MATCH row the organizer can drag into a new play order. The time slots
 *  stay fixed per position - dragging moves the MATCH between slots.
 *  `planIndex` is the backend's 0-based single-court plan index (the sketch
 *  lists rows in exactly that order), sent back as the custom order. */
type MatchRow = {
    kind: "match"
    planIndex: number
    stage: string
    groupName?: string | null
    team1Name?: string | null
    team2Name?: string | null
    slot1Label?: string | null
    slot2Label?: string | null
    slot1PredictedName?: string | null
    slot2PredictedName?: string | null
    teamsKnown: boolean
}
/** One inserted PAUSE row: a break of `minutes` that delays every match after
 *  it. Draggable like a match row; `id` is a stable local key. */
type PauseRow = { kind: "pause"; id: number; minutes: number }
type SketchRow = MatchRow | PauseRow

/** Nearest scrollable ancestor - the dialog body (scrollBehavior="inside"),
 *  wherever Chakra puts the overflow. Fallback: the page itself. */
function findScrollParent(el: HTMLElement | null): HTMLElement | null {
    for (let n = el?.parentElement ?? null; n; n = n.parentElement) {
        const st = getComputedStyle(n)
        if (/(auto|scroll)/.test(st.overflowY) && n.scrollHeight > n.clientHeight + 2) return n
    }
    return document.scrollingElement as HTMLElement | null
}

/** "YYYY-MM-DD" + "HH:mm" → ISO with the browser's local offset. Keeps the
 *  kickoff on the intended local day regardless of the backend's zone. */
function toOffsetIso(date: string, time: string): string {
    const d = new Date(`${date}T${time || "09:00"}:00`)
    const off = -d.getTimezoneOffset()
    const sign = off >= 0 ? "+" : "-"
    const abs = Math.abs(off)
    const oh = String(Math.floor(abs / 60)).padStart(2, "0")
    const om = String(abs % 60).padStart(2, "0")
    return `${date}T${time || "09:00"}:00${sign}${oh}:${om}`
}

/** Inclusive list of "YYYY-MM-DD" dates from `from` to `to` (capped at 60). */
function dayList(from: string, to: string): string[] {
    if (!from) return []
    const out: string[] = []
    const d = new Date(`${from}T00:00:00`)
    const end = new Date(`${(to || from)}T00:00:00`)
    if (end < d) return [from]
    const p = (n: number) => String(n).padStart(2, "0")
    for (let i = 0; i < 60 && d <= end; i++) {
        out.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`)
        d.setDate(d.getDate() + 1)
    }
    return out
}

function fmtDay(date: string): string {
    const [y, m, dd] = date.split("-").map(Number)
    return new Date(y, m - 1, dd).toLocaleDateString("hr-HR", {
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    })
}

/** Human pause label, e.g. 90 → "1h 30min", 30 → "30min", 60 → "1h". */
function fmtPause(min: number): string {
    const h = Math.floor(min / 60)
    const m = min % 60
    if (h > 0 && m > 0) return `${h}h ${m}min`
    if (h > 0) return `${h}h`
    return `${m}min`
}

const STAGE_LABEL: Record<string, string> = {
    GROUP: "Grupa",
    ROUND_OF_32: "Šesnaestina",
    ROUND_OF_16: "Osmina",
    QUARTERFINAL: "Četvrtfinale",
    SEMIFINAL: "Polufinale",
    THIRD_PLACE: "Za 3. mjesto",
    FINAL: "Finale",
}

/** Play-order rank of a stage. A drag may NOT cross a stage boundary - a
 *  quarterfinal can't play after a semifinal or before the group matches -
 *  so match rows are only movable within their own stage's block. */
const STAGE_RANK: Record<string, number> = {
    GROUP: 0,
    ROUND_OF_32: 1,
    ROUND_OF_16: 2,
    QUARTERFINAL: 3,
    SEMIFINAL: 4,
    THIRD_PLACE: 5,
    FINAL: 6,
}
const stageRank = (s: string) => STAGE_RANK[s] ?? 0

/** The allowed drop range for the MATCH row at `idx`: the contiguous run of
 *  rows around it that are pauses OR same-stage matches (a match may not cross
 *  a stage boundary; pauses are transparent to the block). */
function matchStageBlock(rows: SketchRow[], idx: number): [number, number] {
    const row0 = rows[idx]
    if (row0.kind !== "match") return [0, rows.length - 1]
    const r = stageRank(row0.stage)
    const sameOrPause = (i: number) => {
        const row = rows[i]
        return row.kind === "pause" || stageRank(row.stage) === r
    }
    let lo = idx
    let hi = idx
    while (lo > 0 && sameOrPause(lo - 1)) lo--
    while (hi < rows.length - 1 && sameOrPause(hi + 1)) hi++
    return [lo, hi]
}

/** Translate the sketch's pause rows into backend `breaks`: each pause maps to
 *  the 0-based index (among MATCH rows in play order) of the first match after
 *  it. Pauses resolving to the same position are summed; a pause with no match
 *  after it (at the very end) is dropped. */
function computeBreaks(rows: SketchRow[] | null): { beforeOrderPos: number; minutes: number }[] {
    if (!rows) return []
    const total = rows.reduce((n, r) => n + (r.kind === "match" ? 1 : 0), 0)
    const byPos = new Map<number, number>()
    let matchCount = 0
    for (const row of rows) {
        if (row.kind === "match") {
            matchCount++
            continue
        }
        // Pause: beforeOrderPos = matches seen so far = index of the next match.
        if (matchCount >= total) continue // pause at the very end - no effect.
        byPos.set(matchCount, (byPos.get(matchCount) ?? 0) + row.minutes)
    }
    return [...byPos.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([beforeOrderPos, minutes]) => ({ beforeOrderPos, minutes }))
}

/** One clickable value in the time picker's hour / minute columns. */
function PickCell({
    active,
    onClick,
    children,
}: {
    active: boolean
    onClick: () => void
    children: string
}) {
    return (
        <chakra.button
            type="button"
            onClick={onClick}
            w="42px"
            py="1"
            rounded="md"
            textAlign="center"
            fontFamily="mono"
            fontSize="sm"
            fontWeight={active ? 800 : 500}
            flexShrink={0}
            cursor="pointer"
            bg={active ? "pitch.500" : "transparent"}
            color={active ? "white" : "fg.ink"}
            _hover={{ bg: active ? "pitch.500" : "bg.surfaceTint" }}
        >
            {children}
        </chakra.button>
    )
}

/** 24-hour time picker. A button showing "HH:mm" opens a popover with hour and
 *  minute columns - always European 24-hour, never the native locale's AM/PM. */
function Time24Picker({
    value,
    onChange,
    w = "full",
}: {
    value: string
    onChange: (v: string) => void
    w?: string
}) {
    const [open, setOpen] = useState(false)
    const p = (n: number) => String(n).padStart(2, "0")
    const match = /^(\d{1,2}):(\d{2})$/.exec(value || "")
    const hh = match ? p(Math.min(23, Math.max(0, parseInt(match[1], 10)))) : "09"
    const mm = match ? p(Math.min(59, Math.max(0, parseInt(match[2], 10)))) : "00"
    const hours = Array.from({ length: 24 }, (_, i) => p(i))
    const minutes = Array.from({ length: 60 }, (_, i) => p(i))

    return (
        <Popover.Root
            open={open}
            onOpenChange={(e) => setOpen(e.open)}
            positioning={{ placement: "bottom", gutter: 4 }}
        >
            <Popover.Trigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    w={w}
                    px="2"
                    gap="1.5"
                    justifyContent="center"
                    fontFamily="mono"
                    fontWeight={700}
                >
                    <FiClock size={13} />
                    {value || "--:--"}
                </Button>
            </Popover.Trigger>
            <Portal>
                <Popover.Positioner>
                    <Popover.Content w="auto" minW="0">
                        <Popover.Body p="2">
                            <HStack align="start" gap="3">
                                <VStack gap="1" minW="0">
                                    <Text fontFamily="mono" fontSize="2xs" fontWeight={800} color="fg.muted" letterSpacing="0.1em">
                                        SAT
                                    </Text>
                                    <VStack gap="0.5" maxH="168px" overflowY="auto" pr="1">
                                        {hours.map((h) => (
                                            <PickCell key={h} active={h === hh} onClick={() => onChange(`${h}:${mm}`)}>
                                                {h}
                                            </PickCell>
                                        ))}
                                    </VStack>
                                </VStack>
                                <VStack gap="1" minW="0">
                                    <Text fontFamily="mono" fontSize="2xs" fontWeight={800} color="fg.muted" letterSpacing="0.1em">
                                        MIN
                                    </Text>
                                    <VStack gap="0.5" maxH="168px" overflowY="auto" pr="1">
                                        {minutes.map((mi) => (
                                            <PickCell
                                                key={mi}
                                                active={mi === mm}
                                                onClick={() => {
                                                    onChange(`${hh}:${mi}`)
                                                    setOpen(false)
                                                }}
                                            >
                                                {mi}
                                            </PickCell>
                                        ))}
                                    </VStack>
                                </VStack>
                            </HStack>
                        </Popover.Body>
                    </Popover.Content>
                </Popover.Positioner>
            </Portal>
        </Popover.Root>
    )
}

export default function MultiDaySchedulePlanner({
    uuid,
    cfg,
    startAt,
    koOnly = false,
    onClose,
    onGenerated,
}: {
    uuid: string
    /** Format config (half length, breaks, buffer) from the Format card. */
    cfg: ScheduleConfig
    /** Tournament start ISO - seeds the default date + first-kickoff time. */
    startAt?: string | null
    /** Knockout-only mode ("Raspored završnice"): plan only the knockout
     *  matches; the group kickoffs are left untouched. */
    koOnly?: boolean
    onClose: () => void
    onGenerated: (s: Schedule) => void
}) {
    const seed = startAt ? new Date(startAt) : new Date()
    const p = (n: number) => String(n).padStart(2, "0")
    const defaultDate = `${seed.getFullYear()}-${p(seed.getMonth() + 1)}-${p(seed.getDate())}`
    const defaultTime = `${p(seed.getHours())}:${p(seed.getMinutes())}`

    const [info, setInfo] = useState<SchedulePlanInfo | null>(null)
    const [from, setFrom] = useState(defaultDate)
    const [to, setTo] = useState(defaultDate)
    const [rows, setRows] = useState<DayRow[]>([])
    const [preview, setPreview] = useState<SchedulePreview | null>(null)
    const [sketching, setSketching] = useState(false)
    const [generating, setGenerating] = useState(false)
    /** Sketch rows in the organizer's (possibly re-dragged) play order, mixing
     *  MATCH rows and inserted PAUSE rows. The time slots stay put - position i
     *  always shows the preview's i-th match slot time; dragging changes WHICH
     *  match occupies the slot (and where the pauses sit). */
    const [sketchRows, setSketchRows] = useState<SketchRow[] | null>(null)
    /** Drag state: index (into `sketchRows`) being dragged + the row hovered. */
    const [dragIdx, setDragIdx] = useState<number | null>(null)
    const [overIdx, setOverIdx] = useState<number | null>(null)
    /** Inline "Dodaj pauzu" form. */
    const [pauseFormOpen, setPauseFormOpen] = useState(false)
    const [pauseH, setPauseH] = useState("0")
    const [pauseM, setPauseM] = useState("30")
    const pauseIdRef = useRef(1)
    /** Latest values read by the global pointer listeners / rAF loop. */
    const overIdxRef = useRef<number | null>(null)
    const pointerXRef = useRef(0)
    const pointerYRef = useRef(0)
    /** The dialog's scroll container, resolved at drag start - edge-scrolled
     *  while dragging (touch-action:none blocks native scroll on iPad). */
    const scrollElRef = useRef<HTMLElement | null>(null)
    /** Allowed drop range for the dragged row - a match's stage block, or the
     *  whole list for a pause. Hovering outside clamps to the nearest edge. */
    const blockLoRef = useRef(0)
    const blockHiRef = useRef(0)
    /** Latest-wins guard for the silent "re-price" preview re-runs. */
    const previewSeqRef = useRef(0)

    // Predicted total (group + knockout).
    useEffect(() => {
        fetchPlanInfo(uuid).then(setInfo).catch(() => setInfo(null))
    }, [uuid])

    // Rebuild the day rows when the range changes, keeping edits per date.
    useEffect(() => {
        const dates = dayList(from, to)
        setRows((prev) => {
            const byDate = new Map(prev.map((r) => [r.date, r] as const))
            return dates.map((date) => byDate.get(date) ?? { date, matches: "0", firstStart: defaultTime })
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [from, to])

    // In koOnly mode the counter + seeding cover only the knockout matches.
    const total = koOnly ? (info?.knockoutMatches ?? 0) : (info?.totalMatches ?? 0)

    // Once the total is known, seed the first day with everything (single-day
    // default) if nothing has been allocated yet.
    useEffect(() => {
        if (total <= 0) return
        setRows((prev) => {
            if (prev.length === 0) return prev
            if (prev.some((r) => (parseInt(r.matches || "0", 10) || 0) > 0)) return prev
            return prev.map((r, i) => (i === 0 ? { ...r, matches: String(total) } : r))
        })
    }, [total, rows.length])

    const allocated = useMemo(
        () => rows.reduce((s, r) => s + (parseInt(r.matches || "0", 10) || 0), 0),
        [rows],
    )
    const remaining = total - allocated

    /** Flattened preview slots (day index + fixed kickoff time) in play order -
     *  the k-th slot backs the k-th MATCH row in `sketchRows`. */
    const flatSlots = useMemo(() => {
        const out: { di: number; kickoff: string }[] = []
        ;(preview?.days ?? []).forEach((d, di) => d.matches.forEach((m) => out.push({ di, kickoff: m.kickoff })))
        return out
    }, [preview])

    /** Backend plan index of the fixed time SLOT at each match position (the
     *  slot identity never moves - only the match occupying it does). */
    const slotPlanIdx = useMemo(
        () => (preview?.days ?? []).flatMap((d) => d.matches.map((m) => m.planIndex)),
        [preview],
    )

    /** Match-row count per stage - a match is draggable only when its stage
     *  block has at least one other match to swap with. */
    const stageCounts = useMemo(() => {
        const m = new Map<number, number>()
        for (const r of sketchRows ?? []) {
            if (r.kind !== "match") continue
            const k = stageRank(r.stage)
            m.set(k, (m.get(k) ?? 0) + 1)
        }
        return m
    }, [sketchRows])
    const hasPause = useMemo(() => (sketchRows ?? []).some((r) => r.kind === "pause"), [sketchRows])
    const anyRowDraggable = useMemo(
        () => hasPause || [...stageCounts.values()].some((c) => c > 1),
        [hasPause, stageCounts],
    )

    /** The first (earliest) knockout stage in the sketch - its teams come
     *  straight from the group phase; later rounds depend on earlier knockout
     *  results, so their unknown teams read "TBD" instead. */
    const firstKoRank = useMemo(() => {
        let min = Infinity
        for (const r of sketchRows ?? []) {
            if (r.kind !== "match") continue
            const k = stageRank(r.stage)
            if (k > 0 && k < min) min = k
        }
        return min
    }, [sketchRows])

    /** Bucket every sketch row (match + pause) into the day its slot belongs to.
     *  A match takes its flattened preview slot's day + time; a pause takes the
     *  day of the match that follows it (or the last day at the very end). */
    const dayBuckets = useMemo(() => {
        const days = preview?.days ?? []
        const buckets: { row: SketchRow; sketchIdx: number; kickoff?: string }[][] = days.map(() => [])
        if (!sketchRows || days.length === 0) return buckets
        const lastDi = days.length - 1
        let slotPtr = 0
        sketchRows.forEach((row, sketchIdx) => {
            if (row.kind === "match") {
                const slot = flatSlots[slotPtr]
                const di = slot?.di ?? lastDi
                buckets[di]?.push({ row, sketchIdx, kickoff: slot?.kickoff })
                slotPtr++
            } else {
                const di = flatSlots[slotPtr]?.di ?? lastDi
                buckets[di]?.push({ row, sketchIdx })
            }
        })
        return buckets
    }, [sketchRows, flatSlots, preview])

    function setRow(i: number, patch: Partial<DayRow>) {
        setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
    }

    /** Spread the whole total across the days as evenly as possible. */
    function distributeEvenly() {
        setRows((prev) => {
            if (prev.length === 0) return prev
            const base = Math.floor(total / prev.length)
            const rem = total % prev.length
            return prev.map((r, i) => ({ ...r, matches: String(base + (i < rem ? 1 : 0)) }))
        })
    }

    function buildRequest(): SchedulePlanRequest {
        return {
            ...cfg,
            ...(koOnly ? { koOnly: true } : {}),
            days: rows
                .filter((r) => (parseInt(r.matches || "0", 10) || 0) > 0)
                .map((r) => ({
                    firstKickoff: toOffsetIso(r.date, r.firstStart),
                    matches: parseInt(r.matches, 10) || 0,
                })),
        }
    }

    // Pointer-based drag reorder of the sketch rows - mouse AND touch (same
    // pattern as the Raspored tab). While a row is dragged we track the row
    // under the pointer (elementFromPoint) and commit the move on release.
    useEffect(() => {
        if (dragIdx == null) return
        const hitTest = () => {
            const el = document.elementFromPoint(pointerXRef.current, pointerYRef.current) as HTMLElement | null
            const row = el?.closest("[data-plan-row]") as HTMLElement | null
            const attr = row?.getAttribute("data-plan-idx")
            let idx = attr != null ? Number(attr) : null
            // Clamp to the dragged row's block - a match can't leave its stage
            // block; a pause may go anywhere (its block is the whole list).
            if (idx != null) {
                idx = Math.min(Math.max(idx, blockLoRef.current), blockHiRef.current)
            }
            overIdxRef.current = idx
            setOverIdx(idx)
        }
        const onMove = (e: PointerEvent) => {
            pointerXRef.current = e.clientX
            pointerYRef.current = e.clientY
            hitTest()
        }
        const finish = () => {
            const from = dragIdx
            const to = overIdxRef.current
            overIdxRef.current = null
            setOverIdx(null)
            setDragIdx(null)
            if (from == null || to == null || from === to) return
            setSketchRows((prev) => {
                if (!prev || from >= prev.length || to >= prev.length) return prev
                const next = [...prev]
                const [moved] = next.splice(from, 1)
                next.splice(to, 0, moved)
                return next
            })
        }
        // Edge auto-scroll: touch-action:none on the handle kills native
        // scrolling, so an iPad drag couldn't otherwise reach off-screen rows.
        const EDGE = 56
        let raf = requestAnimationFrame(function tick() {
            const sc = scrollElRef.current
            if (sc) {
                const r = sc.getBoundingClientRect()
                const top = Math.max(r.top, 0)
                const bottom = Math.min(r.bottom, window.innerHeight)
                const y = pointerYRef.current
                let dy = 0
                if (y < top + EDGE) dy = -Math.max(2, Math.round((top + EDGE - y) / 4))
                else if (y > bottom - EDGE) dy = Math.max(2, Math.round((y - (bottom - EDGE)) / 4))
                if (dy !== 0) {
                    const before = sc.scrollTop
                    sc.scrollTop = before + dy
                    if (sc.scrollTop !== before) hitTest()
                }
            }
            raf = requestAnimationFrame(tick)
        })
        window.addEventListener("pointermove", onMove)
        window.addEventListener("pointerup", finish)
        window.addEventListener("pointercancel", finish)
        return () => {
            cancelAnimationFrame(raf)
            window.removeEventListener("pointermove", onMove)
            window.removeEventListener("pointerup", finish)
            window.removeEventListener("pointercancel", finish)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dragIdx])

    /** Store a fresh sketch + its rows in plan order (the flattened day list
     *  IS the backend's single-court plan order - unscheduled rows are the
     *  tail and never appear in the days). Resets any pauses / reorder. */
    function applyPreview(pv: SchedulePreview) {
        setPreview(pv)
        const flat: SketchRow[] = []
        for (const day of pv.days) {
            for (const m of day.matches) {
                flat.push({
                    kind: "match",
                    // Backend-assigned plan identity (NOT the flat position -
                    // date bucketing may deviate from plan order in edge cases).
                    planIndex: m.planIndex,
                    stage: m.stage,
                    groupName: m.groupName,
                    team1Name: m.team1Name,
                    team2Name: m.team2Name,
                    slot1Label: m.slot1Label,
                    slot2Label: m.slot2Label,
                    slot1PredictedName: m.slot1PredictedName,
                    slot2PredictedName: m.slot2PredictedName,
                    teamsKnown: m.teamsKnown,
                })
            }
        }
        setSketchRows(flat)
    }

    async function doSketch() {
        setSketching(true)
        try {
            applyPreview(await previewSchedule(uuid, buildRequest()))
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setSketching(false)
        }
    }

    /** Re-price the sketch after a pause is added / moved / removed (or a match
     *  crosses a pause): the backend recomputes the shifted kickoff times. Only
     *  the preview's slot TIMES are refreshed - the current sketch rows (reorder
     *  + pauses) are kept. Silent (the api marks preview requests silent). */
    async function refreshPreviewTimes(brk: { beforeOrderPos: number; minutes: number }[]) {
        const seq = ++previewSeqRef.current
        try {
            const req = buildRequest()
            if (brk.length > 0) req.breaks = brk
            const pv = await previewSchedule(uuid, req)
            if (seq === previewSeqRef.current) setPreview(pv)
        } catch {
            /* silent - the times just won't refresh */
        }
    }

    // Whenever the pauses (or the matches around them) change, re-run the
    // preview so the displayed times reflect the shift. When there are no
    // pauses the key stays "[]" and the fast local reorder keeps its fixed slot
    // times (no round-trip on a plain match drag).
    const breaks = useMemo(() => computeBreaks(sketchRows), [sketchRows])
    const breaksKey = useMemo(() => JSON.stringify(breaks), [breaks])
    const lastBreaksKeyRef = useRef<string>("[]")
    useEffect(() => {
        if (!preview) {
            lastBreaksKeyRef.current = breaksKey
            return
        }
        if (breaksKey === lastBreaksKeyRef.current) return
        lastBreaksKeyRef.current = breaksKey
        void refreshPreviewTimes(breaks)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [breaksKey, preview])

    /** Append a pause to the end of the sketch list (the organizer then drags it
     *  into place). A pause left at the very end has no effect on generate. */
    function addPause() {
        const h = Math.min(23, Math.max(0, parseInt(pauseH || "0", 10) || 0))
        const m = Math.min(59, Math.max(0, parseInt(pauseM || "0", 10) || 0))
        const minutes = h * 60 + m
        if (minutes <= 0) return
        setSketchRows((prev) => (prev ? [...prev, { kind: "pause", id: pauseIdRef.current++, minutes }] : prev))
        setPauseFormOpen(false)
        setPauseH("0")
        setPauseM("30")
    }
    function removePause(id: number) {
        setSketchRows((prev) => (prev ? prev.filter((r) => !(r.kind === "pause" && r.id === id)) : prev))
    }

    async function doGenerate() {
        setGenerating(true)
        try {
            const req = buildRequest()
            const matchRows = (sketchRows ?? []).filter((r): r is MatchRow => r.kind === "match")
            // Send a custom order ONLY when the organizer actually dragged a
            // match - slot j (a fixed time) gets the match order[j].
            if (matchRows.length > 0) {
                const dirty = matchRows.some((r, i) => r.planIndex !== slotPlanIdx[i])
                if (dirty) {
                    const order: number[] = new Array(matchRows.length)
                    matchRows.forEach((r, i) => {
                        order[slotPlanIdx[i]] = r.planIndex
                    })
                    req.order = order
                    req.planHash = preview?.planHash ?? null
                }
            }
            const brk = computeBreaks(sketchRows)
            if (brk.length > 0) req.breaks = brk
            const s = await generateMultiDaySchedule(uuid, req)
            onGenerated(s)
            onClose()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setGenerating(false)
        }
    }

    return (
        <Dialog.Root open onOpenChange={(e) => { if (!e.open) onClose() }} placement="center" scrollBehavior="inside">
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW={{ base: "96%", md: "640px" }}>
                        <Dialog.Header>
                            <Dialog.Title>
                                <HStack gap="2">
                                    <LuCalendarClock size={18} />
                                    <Text fontWeight={800}>{koOnly ? "Raspored završnice" : "Generiranje rasporeda"}</Text>
                                </HStack>
                            </Dialog.Title>
                        </Dialog.Header>
                        <Dialog.Body>
                            {preview ? (
                                /* ── Preview / sketch result ─────────────── */
                                <VStack align="stretch" gap="3">
                                    <Text fontSize="sm" color="fg.muted">
                                        Ovako bi izgledao raspored. Provjeri pa potvrdi da se generira.
                                        {preview.knockoutMatches > 0 &&
                                            " Eliminacijske utakmice su rezervirane (ekipe se određuju nakon grupne faze)."}
                                    </Text>
                                    {anyRowDraggable && (
                                        <Text fontSize="xs" color="fg.muted">
                                            Povuci utakmicu ili pauzu klikom na{" "}
                                            <Box as="span" display="inline-flex" verticalAlign="middle" mx="0.5">
                                                <LuGripVertical size={13} />
                                            </Box>{" "}
                                            za promjenu redoslijeda - satnica ostaje ista, mijenja se
                                            koja se utakmica kada igra. Redoslijed faza se ne može
                                            mijenjati (npr. četvrtfinale uvijek ostaje prije polufinala).
                                        </Text>
                                    )}
                                    {preview.unscheduled > 0 && (
                                        <Box bg="accent.red" color="white" rounded="md" px="3" py="2" fontSize="sm">
                                            {preview.unscheduled} utakmica ne stane u zadane dane - dodaj još
                                            termina ili produži raspon.
                                        </Box>
                                    )}
                                    {preview.days.map((day, di) => (
                                        <Box key={day.date} borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden">
                                            <HStack justify="space-between" px="3" py="2" bg="bg.surfaceTint" borderBottomWidth="1px" borderColor="border">
                                                <HStack gap="2">
                                                    <FiCalendar size={13} />
                                                    <Text fontSize="sm" fontWeight={700}>{fmtDay(day.date)}</Text>
                                                </HStack>
                                                <MonoLabel>{day.matches.length} UTAKMICA</MonoLabel>
                                            </HStack>
                                            <VStack align="stretch" gap="0">
                                                {(dayBuckets[di] ?? []).map(({ row: r, sketchIdx, kickoff }, i) => {
                                                    const canDragRow =
                                                        sketchRows != null &&
                                                        (r.kind === "pause"
                                                            ? sketchRows.length > 1
                                                            : (stageCounts.get(stageRank(r.stage)) ?? 0) > 1)
                                                    const grip = canDragRow ? (
                                                        <Box
                                                            onPointerDown={(e) => {
                                                                e.preventDefault()
                                                                // Keep tracking even when the finger leaves the
                                                                // small handle - makes touch drag work on iPad.
                                                                try {
                                                                    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                                                                } catch { /* not supported - window listeners still work */ }
                                                                pointerXRef.current = e.clientX
                                                                pointerYRef.current = e.clientY
                                                                scrollElRef.current = findScrollParent(e.currentTarget as HTMLElement)
                                                                const [lo, hi] =
                                                                    r.kind === "pause"
                                                                        ? [0, sketchRows.length - 1]
                                                                        : matchStageBlock(sketchRows, sketchIdx)
                                                                blockLoRef.current = lo
                                                                blockHiRef.current = hi
                                                                overIdxRef.current = sketchIdx
                                                                setOverIdx(sketchIdx)
                                                                setDragIdx(sketchIdx)
                                                            }}
                                                            cursor="grab"
                                                            color={dragIdx === sketchIdx ? "brand.solid" : "fg.subtle"}
                                                            _hover={{ color: "fg.muted" }}
                                                            display="flex"
                                                            alignItems="center"
                                                            justifyContent="center"
                                                            w="24px"
                                                            py="1.5"
                                                            flexShrink={0}
                                                            style={{ touchAction: "none", userSelect: "none" }}
                                                            title="Povuci za promjenu redoslijeda"
                                                            aria-label="Povuci za promjenu redoslijeda"
                                                        >
                                                            {/* pointer-events none so the touch lands on the
                                                                handle Box (touch-action:none), not the SVG. */}
                                                            <LuGripVertical size={16} style={{ pointerEvents: "none" }} />
                                                        </Box>
                                                    ) : anyRowDraggable ? (
                                                        // Spacer keeps columns aligned with draggable rows.
                                                        <Box w="24px" flexShrink={0} />
                                                    ) : null

                                                    if (r.kind === "pause") {
                                                        return (
                                                            <HStack
                                                                key={`pause-${r.id}`}
                                                                gap="2"
                                                                px={anyRowDraggable ? "1.5" : "3"}
                                                                py="2"
                                                                borderTopWidth={i === 0 ? "0" : "1px"}
                                                                borderColor="border"
                                                                data-plan-row=""
                                                                data-plan-idx={sketchIdx}
                                                                opacity={dragIdx === sketchIdx ? 0.35 : 1}
                                                                transition="opacity 0.12s"
                                                                css={
                                                                    overIdx === sketchIdx && dragIdx != null && dragIdx !== sketchIdx
                                                                        ? { boxShadow: "inset 0 3px 0 0 var(--chakra-colors-brand-solid)" }
                                                                        : undefined
                                                                }
                                                            >
                                                                {grip}
                                                                <Flex
                                                                    flex="1"
                                                                    align="center"
                                                                    gap="2"
                                                                    minW="0"
                                                                    borderWidth="1px"
                                                                    borderStyle="dashed"
                                                                    borderColor="border.emphasized"
                                                                    rounded="md"
                                                                    px="2.5"
                                                                    py="1"
                                                                    color="fg.muted"
                                                                    bg="bg.surfaceTint"
                                                                >
                                                                    <FiClock size={12} />
                                                                    <Text fontFamily="mono" fontSize="12px" fontWeight={700} truncate>
                                                                        Pauza · {fmtPause(r.minutes)}
                                                                    </Text>
                                                                    <Box flex="1" />
                                                                    <chakra.button
                                                                        type="button"
                                                                        onClick={() => removePause(r.id)}
                                                                        display="inline-flex"
                                                                        alignItems="center"
                                                                        justifyContent="center"
                                                                        color="fg.subtle"
                                                                        _hover={{ color: "accent.red" }}
                                                                        flexShrink={0}
                                                                        aria-label="Ukloni pauzu"
                                                                        title="Ukloni pauzu"
                                                                    >
                                                                        <FiX size={14} />
                                                                    </chakra.button>
                                                                </Flex>
                                                            </HStack>
                                                        )
                                                    }

                                                    // Per-side pairing text: real name → predicted name →
                                                    // slot label. Both sides resolved → "X - Y" (muted
                                                    // unless both are real team names); neither → fallback.
                                                    const t1 = r.team1Name ?? r.slot1PredictedName ?? r.slot1Label
                                                    const t2 = r.team2Name ?? r.slot2PredictedName ?? r.slot2Label
                                                    const pairingResolved = t1 != null && t2 != null
                                                    const pairingMuted = r.team1Name == null || r.team2Name == null
                                                    return (
                                                        <HStack
                                                            key={`match-${sketchIdx}`}
                                                            gap="2"
                                                            px={anyRowDraggable ? "1.5" : "3"}
                                                            py="2"
                                                            borderTopWidth={i === 0 ? "0" : "1px"}
                                                            borderColor="border"
                                                            data-plan-row=""
                                                            data-plan-idx={sketchIdx}
                                                            opacity={dragIdx === sketchIdx ? 0.35 : 1}
                                                            transition="opacity 0.12s"
                                                            css={
                                                                overIdx === sketchIdx && dragIdx != null && dragIdx !== sketchIdx
                                                                    ? { boxShadow: "inset 0 3px 0 0 var(--chakra-colors-brand-solid)" }
                                                                    : undefined
                                                            }
                                                        >
                                                            {grip}
                                                            <Text fontFamily="mono" fontSize="13px" color="pitch.500" fontWeight={700} flexShrink={0}>
                                                                {kickoff
                                                                    ? new Date(kickoff).toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit" })
                                                                    : "--:--"}
                                                            </Text>
                                                            <Text fontFamily="mono" fontSize="10px" color="fg.muted" flexShrink={0} minW="86px" textTransform="uppercase">
                                                                {STAGE_LABEL[r.stage] ?? r.stage}{r.groupName ? ` ${r.groupName}` : ""}
                                                            </Text>
                                                            <Text
                                                                fontSize="13.5px"
                                                                fontWeight={600}
                                                                truncate
                                                                color={pairingMuted ? "fg.muted" : undefined}
                                                            >
                                                                {pairingResolved
                                                                    ? `${t1} - ${t2}`
                                                                    : preview.groupMatches > 0 && stageRank(r.stage) === firstKoRank
                                                                        ? "Odlučuje se nakon grupne faze"
                                                                        : "TBD"}
                                                            </Text>
                                                        </HStack>
                                                    )
                                                })}
                                            </VStack>
                                        </Box>
                                    ))}
                                </VStack>
                            ) : (
                                /* ── Plan setup ──────────────────────────── */
                                <VStack align="stretch" gap="4">
                                    <Box>
                                        <MonoLabel mb="2" display="block">RASPON DATUMA</MonoLabel>
                                        <HStack gap="3" wrap="wrap" align="flex-end">
                                            <Box>
                                                <Text fontSize="2xs" color="fg.muted" mb="1">Od</Text>
                                                <Input type="date" size="sm" value={from} onChange={(e) => setFrom(e.target.value)} />
                                            </Box>
                                            <Box>
                                                <Text fontSize="2xs" color="fg.muted" mb="1">Do</Text>
                                                <Input type="date" size="sm" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
                                            </Box>
                                            <Button size="sm" variant="outline" onClick={distributeEvenly} disabled={total <= 0}>
                                                Ravnomjerno rasporedi
                                            </Button>
                                        </HStack>
                                    </Box>

                                    <Box>

                                        {/* Table header - what each column means. */}
                                        <Box
                                            display="grid"
                                            gridTemplateColumns={{ base: "minmax(0,1fr) 84px 96px", sm: "minmax(0,1fr) 150px 140px" }}
                                            gap="3"
                                            px="3"
                                            mb="1.5"
                                            alignItems="end"
                                        >
                                            <Text fontSize="2xs" fontWeight={700} letterSpacing="0.06em" textTransform="uppercase" color="fg.muted">
                                                Dan
                                            </Text>
                                            <Text fontSize="2xs" fontWeight={700} letterSpacing="0.06em" textTransform="uppercase" color="fg.muted" textAlign="center" lineHeight="1.15">
                                                Broj utakmica u danu
                                            </Text>
                                            <Text fontSize="2xs" fontWeight={700} letterSpacing="0.06em" textTransform="uppercase" color="fg.muted" textAlign="center" lineHeight="1.15">
                                                Prva utakmica
                                            </Text>
                                        </Box>

                                        <VStack align="stretch" gap="2">
                                            {rows.map((r, i) => (
                                                <Box
                                                    key={r.date}
                                                    display="grid"
                                                    gridTemplateColumns={{ base: "minmax(0,1fr) 84px 96px", sm: "minmax(0,1fr) 150px 140px" }}
                                                    gap="3"
                                                    alignItems="center"
                                                    borderWidth="1px"
                                                    borderColor="border"
                                                    rounded="lg"
                                                    px="3"
                                                    py="2"
                                                >
                                                    <Text fontSize="13px" fontWeight={700} truncate>
                                                        {fmtDay(r.date)}
                                                    </Text>
                                                    <Input
                                                        size="sm"
                                                        w="full"
                                                        textAlign="center"
                                                        inputMode="numeric"
                                                        value={r.matches}
                                                        onChange={(e) => setRow(i, { matches: e.target.value.replace(/[^\d]/g, "") })}
                                                    />
                                                    <Time24Picker
                                                        value={r.firstStart}
                                                        onChange={(v) => setRow(i, { firstStart: v })}
                                                    />
                                                </Box>
                                            ))}
                                        </VStack>
                                    </Box>

                                    {/* Remaining-to-schedule counter. */}
                                    <Flex
                                        align="center"
                                        justify="space-between"
                                        bg={remaining === 0 ? "brand.subtle" : "bg.surfaceTint"}
                                        borderWidth="1px"
                                        borderColor={remaining === 0 ? "brand.emphasized" : "border"}
                                        rounded="md"
                                        px="4"
                                        py="3"
                                        gap="3"
                                        wrap="wrap"
                                    >
                                        <MonoLabel>PREOSTALO ZA RASPOREDITI</MonoLabel>
                                        <HStack gap="2" fontFamily="mono">
                                            <Text fontSize="15px" fontWeight={800} color={remaining < 0 ? "accent.red" : remaining === 0 ? "pitch.500" : "fg.ink"}>
                                                {remaining}
                                            </Text>
                                            <Text fontSize="12px" color="fg.muted">/ {total} ukupno</Text>
                                        </HStack>
                                    </Flex>
                                    {remaining < 0 && (
                                        <Text fontSize="xs" color="accent.red">
                                            Rasporedio si više utakmica ({allocated}) nego što turnir ima ({total}).
                                        </Text>
                                    )}
                                </VStack>
                            )}
                        </Dialog.Body>
                        <Dialog.Footer>
                            {preview ? (
                                <VStack align="stretch" gap="2.5" w="full">
                                    {/* Inline "Dodaj pauzu" form - sati (0-23) + minute (0-59). */}
                                    {pauseFormOpen && (
                                        <Flex
                                            align="flex-end"
                                            gap="2"
                                            wrap="wrap"
                                            borderWidth="1px"
                                            borderStyle="dashed"
                                            borderColor="border.emphasized"
                                            rounded="lg"
                                            px="3"
                                            py="2.5"
                                            bg="bg.surfaceTint"
                                        >
                                            <Box>
                                                <Text fontSize="2xs" color="fg.muted" mb="1">Sati</Text>
                                                <Input
                                                    size="sm"
                                                    w="64px"
                                                    textAlign="center"
                                                    inputMode="numeric"
                                                    value={pauseH}
                                                    onChange={(e) => {
                                                        const v = e.target.value.replace(/[^\d]/g, "")
                                                        setPauseH(v === "" ? "" : String(Math.min(23, parseInt(v, 10) || 0)))
                                                    }}
                                                />
                                            </Box>
                                            <Box>
                                                <Text fontSize="2xs" color="fg.muted" mb="1">Minute</Text>
                                                <Input
                                                    size="sm"
                                                    w="64px"
                                                    textAlign="center"
                                                    inputMode="numeric"
                                                    value={pauseM}
                                                    onChange={(e) => {
                                                        const v = e.target.value.replace(/[^\d]/g, "")
                                                        setPauseM(v === "" ? "" : String(Math.min(59, parseInt(v, 10) || 0)))
                                                    }}
                                                />
                                            </Box>
                                            <Button size="sm" colorPalette="pitch" onClick={addPause}>
                                                <FiPlus /> Dodaj
                                            </Button>
                                            <Button size="sm" variant="ghost" onClick={() => setPauseFormOpen(false)}>
                                                Odustani
                                            </Button>
                                        </Flex>
                                    )}
                                    <HStack gap="2" justify="space-between" w="full" wrap="wrap">
                                        <HStack gap="2">
                                            <Button variant="ghost" onClick={() => { setPreview(null); setSketchRows(null); setPauseFormOpen(false) }}>
                                                <FiChevronLeft /> Natrag
                                            </Button>
                                            <Button variant="ghost" onClick={() => setPauseFormOpen((v) => !v)}>
                                                <FiPlus /> <FiClock /> Dodaj pauzu
                                            </Button>
                                        </HStack>
                                        <Button colorPalette="pitch" loading={generating} onClick={doGenerate} disabled={preview.scheduled === 0}>
                                            <FiCheck /> Potvrdi i generiraj
                                        </Button>
                                    </HStack>
                                </VStack>
                            ) : (
                                <HStack gap="2" justify="flex-end" w="full">
                                    <Button variant="ghost" onClick={onClose}>Odustani</Button>
                                    <Button
                                        colorPalette="pitch"
                                        loading={sketching}
                                        onClick={doSketch}
                                        disabled={allocated <= 0 || (total > 0 && allocated > total)}
                                        title={
                                            total > 0 && allocated > total
                                                ? "Smanji broj utakmica - rasporedio si više nego što turnir ima"
                                                : undefined
                                        }
                                    >
                                        {sketching ? <Spinner size="sm" /> : <LuCalendarClock />} Skiciraj
                                    </Button>
                                </HStack>
                            )}
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}
