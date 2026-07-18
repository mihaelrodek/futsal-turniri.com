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
import { FiCalendar, FiCheck, FiChevronLeft, FiClock } from "react-icons/fi"
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
   ────────────────────────────────────────────────────────────────────────── */

type DayRow = { date: string; matches: string; firstStart: string }

/** One sketch row the organizer can drag into a new play order. The time
 *  slots stay fixed per position - dragging moves the MATCH between slots.
 *  `planIndex` is the backend's 0-based single-court plan index (the sketch
 *  lists rows in exactly that order), sent back as the custom order. */
type PreviewRow = {
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
 *  so rows are only movable within their own stage's block. */
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

/** The contiguous run of same-stage rows around `idx` - the allowed drop
 *  range for that row (rows are always stage-monotonic). */
function stageBlock(rows: PreviewRow[], idx: number): [number, number] {
    const r = stageRank(rows[idx].stage)
    let lo = idx
    let hi = idx
    while (lo > 0 && stageRank(rows[lo - 1].stage) === r) lo--
    while (hi < rows.length - 1 && stageRank(rows[hi + 1].stage) === r) hi++
    return [lo, hi]
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
    onClose,
    onGenerated,
}: {
    uuid: string
    /** Format config (half length, breaks, buffer) from the Format card. */
    cfg: ScheduleConfig
    /** Tournament start ISO - seeds the default date + first-kickoff time. */
    startAt?: string | null
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
    /** Sketch rows in the organizer's (possibly re-dragged) play order. The
     *  time slots stay put - position i always shows the preview's i-th slot
     *  time; dragging changes WHICH match occupies the slot. */
    const [sketchRows, setSketchRows] = useState<PreviewRow[] | null>(null)
    /** Drag state: index (into `rows`) being dragged + the row hovered. */
    const [dragIdx, setDragIdx] = useState<number | null>(null)
    const [overIdx, setOverIdx] = useState<number | null>(null)
    /** Latest values read by the global pointer listeners / rAF loop. */
    const overIdxRef = useRef<number | null>(null)
    const pointerXRef = useRef(0)
    const pointerYRef = useRef(0)
    /** The dialog's scroll container, resolved at drag start - edge-scrolled
     *  while dragging (touch-action:none blocks native scroll on iPad). */
    const scrollElRef = useRef<HTMLElement | null>(null)
    /** Allowed drop range for the dragged row - its stage's block. Hovering
     *  outside clamps to the nearest block edge. */
    const blockLoRef = useRef(0)
    const blockHiRef = useRef(0)

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

    const total = info?.totalMatches ?? 0

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

    /** Global (flattened) index of each preview day's first row, so a day's
     *  i-th slot knows which `rows` entry currently occupies it. */
    const dayOffsets = useMemo(() => {
        let acc = 0
        return (preview?.days ?? []).map((d) => {
            const o = acc
            acc += d.matches.length
            return o
        })
    }, [preview])

    /** Backend plan index of the fixed time SLOT at each display position
     *  (the slot identity never moves - only the match occupying it does). */
    const slotPlanIdx = useMemo(
        () => (preview?.days ?? []).flatMap((d) => d.matches.map((m) => m.planIndex)),
        [preview],
    )

    /** Row count per stage - a row is draggable only when its stage block has
     *  at least one other row to swap with. */
    const stageCounts = useMemo(() => {
        const m = new Map<number, number>()
        for (const r of sketchRows ?? []) {
            const k = stageRank(r.stage)
            m.set(k, (m.get(k) ?? 0) + 1)
        }
        return m
    }, [sketchRows])
    const anyRowDraggable = useMemo(
        () => [...stageCounts.values()].some((c) => c > 1),
        [stageCounts],
    )

    /** The first (earliest) knockout stage in the sketch - its teams come
     *  straight from the group phase; later rounds depend on earlier knockout
     *  results, so their unknown teams read "TBD" instead. */
    const firstKoRank = useMemo(() => {
        let min = Infinity
        for (const r of sketchRows ?? []) {
            const k = stageRank(r.stage)
            if (k > 0 && k < min) min = k
        }
        return min
    }, [sketchRows])

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
            // Clamp to the dragged row's stage block - a quarterfinal can't be
            // dropped after a semifinal or in front of the group matches.
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
     *  tail and never appear in the days). */
    function applyPreview(p: SchedulePreview) {
        setPreview(p)
        const flat: PreviewRow[] = []
        for (const day of p.days) {
            for (const m of day.matches) {
                flat.push({
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

    async function doGenerate() {
        setGenerating(true)
        try {
            let req = buildRequest()
            // Send a custom order ONLY when the organizer actually dragged
            // something - slot j (a fixed time) gets the match order[j].
            if (sketchRows && sketchRows.length > 0) {
                const dirty = sketchRows.some((r, p) => r.planIndex !== slotPlanIdx[p])
                if (dirty) {
                    const order: number[] = new Array(sketchRows.length)
                    sketchRows.forEach((r, p) => {
                        order[slotPlanIdx[p]] = r.planIndex
                    })
                    req = { ...req, order, planHash: preview?.planHash ?? null }
                }
            }
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
                                    <Text fontWeight={800}>Generiranje rasporeda</Text>
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
                                            Povuci utakmicu klikom na{" "}
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
                                                {day.matches.map((m, i) => {
                                                    // Position = fixed time slot; content = whichever
                                                    // match the organizer dragged into it.
                                                    const gi = (dayOffsets[di] ?? 0) + i
                                                    const r = sketchRows?.[gi] ?? m
                                                    // Movable only within its own stage block - and only
                                                    // when that block has another row to swap with.
                                                    const canDragRow =
                                                        sketchRows != null &&
                                                        (stageCounts.get(stageRank(r.stage)) ?? 0) > 1
                                                    // Per-side pairing text: real name → predicted name →
                                                    // slot label. Both sides resolved → "X - Y" (muted
                                                    // unless both are real team names, mirroring the
                                                    // Raspored tab's t1Muted approach); neither → the
                                                    // existing stage fallback string.
                                                    const t1 = r.team1Name ?? r.slot1PredictedName ?? r.slot1Label
                                                    const t2 = r.team2Name ?? r.slot2PredictedName ?? r.slot2Label
                                                    const pairingResolved = t1 != null && t2 != null
                                                    const pairingMuted = r.team1Name == null || r.team2Name == null
                                                    return (
                                                    <HStack
                                                        key={gi}
                                                        gap="2"
                                                        px={anyRowDraggable ? "1.5" : "3"}
                                                        py="2"
                                                        borderTopWidth={i === 0 ? "0" : "1px"}
                                                        borderColor="border"
                                                        data-plan-row=""
                                                        data-plan-idx={gi}
                                                        opacity={dragIdx === gi ? 0.35 : 1}
                                                        transition="opacity 0.12s"
                                                        css={
                                                            overIdx === gi && dragIdx != null && dragIdx !== gi
                                                                ? { boxShadow: "inset 0 3px 0 0 var(--chakra-colors-brand-solid)" }
                                                                : undefined
                                                        }
                                                    >
                                                        {canDragRow ? (
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
                                                                    const [lo, hi] = stageBlock(sketchRows, gi)
                                                                    blockLoRef.current = lo
                                                                    blockHiRef.current = hi
                                                                    overIdxRef.current = gi
                                                                    setOverIdx(gi)
                                                                    setDragIdx(gi)
                                                                }}
                                                                cursor="grab"
                                                                color={dragIdx === gi ? "brand.solid" : "fg.subtle"}
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
                                                            // Spacer keeps the time column aligned with
                                                            // draggable rows in the same card.
                                                            <Box w="24px" flexShrink={0} />
                                                        ) : null}
                                                        <Text fontFamily="mono" fontSize="13px" color="pitch.500" fontWeight={700} flexShrink={0}>
                                                            {new Date(m.kickoff).toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit" })}
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
                                <HStack gap="2" justify="space-between" w="full" wrap="wrap">
                                    <Button variant="ghost" onClick={() => { setPreview(null); setSketchRows(null) }}>
                                        <FiChevronLeft /> Natrag
                                    </Button>
                                    <Button colorPalette="pitch" loading={generating} onClick={doGenerate} disabled={preview.scheduled === 0}>
                                        <FiCheck /> Potvrdi i generiraj
                                    </Button>
                                </HStack>
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
