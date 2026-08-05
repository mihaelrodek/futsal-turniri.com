import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router-dom"
import { Box, type BoxProps, Button, Flex, HStack, Menu, Portal, Text, VStack } from "@chakra-ui/react"
import { FiCheckCircle, FiChevronDown, FiEyeOff, FiInfo, FiList, FiMaximize2, FiPlay } from "react-icons/fi"
import { LuRadioTower } from "react-icons/lu"

import { fetchGroups } from "../api/groups"
import { fetchBracket } from "../api/bracket"
import { fetchStreamBanner, type StreamBanner } from "../api/streamBanner"
import type { Group } from "../types/groups"
import type { BracketMatch } from "../types/bracket"
import { usePolling } from "../hooks/usePolling"
import { useStreamPresence } from "../hooks/useStreamPresence"
import { EmptyState, Loader, Panel } from "../ui/primitives"
import { PulseDot } from "../ui/pitch"
import { useTranslation, type Dictionary } from "../i18n"
import { LiveClock } from "./liveMatch"
import { TeamKitChip, useTeamColors } from "./jersey"
import type { TeamKit } from "../api/tournaments"
import LiveMatchPanel, { type PanelMatch } from "./LiveMatchPanel"
import StreamPlayer from "./StreamPlayer"

type LiveControlLabels = Dictionary["components"]["liveControlTab"]

/* ──────────────────────────────────────────────────────────────────────────
   "Zapisnik" - organizer-only match-recording control centre, fully inline.

   Pulls every group + knockout fixture that already has a kickoff (i.e. the
   schedule is generated), surfaces the current LIVE (or next on-deck) match
   with the inline live-control panel, and a dropdown to jump to any other
   scheduled/live match. Nothing shows before the schedule exists.
   ────────────────────────────────────────────────────────────────────────── */

type Entry = { kind: "group" | "knockout"; match: PanelMatch }

/** The live-clock instants the panel lifts out of itself, so a header clock -
 *  the fullscreen page's, or this console's own sticky bar - ticks from the
 *  SAME truth and freezes together with it on pause. */
type ClockArgs = {
    liveStartedAt: string | null | undefined
    firstHalfEndedAt: string | null
    secondHalfStartedAt: string | null
    livePausedAt: string | null
    halfLengthMin: number | null
    halfCount: number | null
}

const STATUS_RANK: Record<string, number> = { LIVE: 0, SCHEDULED: 1 }

const kickoffMs = (k?: string | null) =>
    k ? new Date(k).getTime() : Number.POSITIVE_INFINITY

function fmtKickoff(k?: string | null): string {
    if (!k) return "-"
    return new Date(k).toLocaleString("hr-HR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    })
}

/** Round name for a knockout stage enum (mirrors the bracket UI) so a
 *  not-yet-drawn fixture reads "Polufinale" / "Finale", not a bare
 *  "Eliminacija". */
function stageLabel(stage: string | null | undefined, labels: LiveControlLabels["stageLabels"]): string {
    switch (stage) {
        case "ROUND_OF_32": return labels.ROUND_OF_32
        case "ROUND_OF_16": return labels.ROUND_OF_16
        case "QUARTERFINAL": return labels.QUARTERFINAL
        case "SEMIFINAL": return labels.SEMIFINAL
        case "FINAL": return labels.FINAL
        case "THIRD_PLACE": return labels.THIRD_PLACE
        default: return labels.default
    }
}

/** One side of the teams line: the real team once it's known, otherwise what
 *  the bracket can already say about the slot.
 *
 *  Same fallback chain as the Raspored (`matchDisplay` in ScheduleTab), and for
 *  the same reason: a knockout fixture spends most of its scheduled life with
 *  no teams attached, and eight rows reading "TBD – TBD" tell the organizer
 *  nothing about which fixture is which. The predicted name is a real team the
 *  standings have already decided ("Željezarija Dalis" for A1); the slot label
 *  is the pairing code ("A1", "Pobj. ČF1") when even that is open.
 *
 *  `predicted` marks the value as a placeholder so it can render muted - the
 *  distinction between "this team plays" and "this team will probably play"
 *  matters when the row sits next to decided fixtures. */
type SlotName = { name: string; predicted: boolean }

function slotName(
    teamName: string | null | undefined,
    predictedName: string | null | undefined,
    label: string | null | undefined,
): SlotName {
    if (teamName) return { name: teamName, predicted: false }
    const fallback = predictedName ?? label
    return fallback ? { name: fallback, predicted: true } : { name: "TBD", predicted: true }
}

/** Structured match-picker data: a status (drives the chip), both teams, and a
 *  muted meta line (stage · time) - e.g. { LIVE, "Roma", "Đurđ",
 *  "Grupa · 10. 07. 20:00" }. */
type MatchMeta = {
    status: "LIVE" | "ONDECK" | "SCHEDULED" | "FINISHED"
    team1: SlotName
    team2: SlotName
    meta: string
}

/** Bracket-only fields the picker reads off a knockout PanelMatch. Group
 *  matches never carry them, hence the optional shape. */
type SlotFields = {
    stage?: string | null
    knockoutCode?: string | null
    slot1Label?: string | null
    slot2Label?: string | null
    slot1PredictedName?: string | null
    slot2PredictedName?: string | null
}

function matchMeta(e: Entry, onDeck: boolean, labels: LiveControlLabels): MatchMeta {
    const m = e.match
    const s = m as SlotFields
    const team1 = slotName(m.team1Name, s.slot1PredictedName, s.slot1Label)
    const team2 = slotName(m.team2Name, s.slot2PredictedName, s.slot2Label)
    // "Četvrtfinale ČF1" rather than a bare "Četvrtfinale": four quarter-finals
    // labelled identically are indistinguishable in a list, and the code is
    // what the Raspored and the bracket already call them.
    const stage =
        e.kind === "group"
            ? labels.groupLabel
            : [stageLabel(s.stage, labels.stageLabels), s.knockoutCode].filter(Boolean).join(" ")
    const when = m.kickoffAt ? fmtKickoff(m.kickoffAt) : ""
    const meta = [stage, when].filter(Boolean).join(" · ")
    const status =
        m.status === "LIVE" ? "LIVE" :
            m.status === "FINISHED" ? "FINISHED" :
                onDeck ? "ONDECK" : "SCHEDULED"
    return { status, team1, team2, meta }
}

/** Left-hand status chip: a red pulsing "UŽIVO" pill for a live match, else a
 *  muted "NA REDU" (the on-deck match) / "ZAKAZANO" tag. */
function StatusChip({ status }: { status: MatchMeta["status"] }) {
    const t = useTranslation()
    const tc = t.components.liveControlTab
    if (status === "LIVE") {
        return (
            <HStack gap="1.5" bg="red.solid" color="white" rounded="full" px="2.5" py="1" flexShrink={0}>
                <PulseDot color="white" size={6} glow />
                <Text fontSize="2xs" fontWeight={800} letterSpacing="wide">{tc.statusLive}</Text>
            </HStack>
        )
    }
    const label = status === "ONDECK" ? tc.statusOnDeck : status === "FINISHED" ? tc.statusFinished : tc.statusScheduled
    return (
        <Box bg="bg.muted" color="fg.muted" rounded="full" px="2.5" py="1" flexShrink={0}>
            <Text fontSize="2xs" fontWeight={800} letterSpacing="wide">{label}</Text>
        </Box>
    )
}

/** One picker row/trigger body: status chip · two-line teams(bold)/meta(muted).
 *  Truncation-safe so long team names never push the layout wide. `active`
 *  marks the currently-selected match with a trailing check. */
function MatchCardContent({ meta, active }: { meta: MatchMeta; active?: boolean }) {
    return (
        <>
            <StatusChip status={meta.status} />
            <VStack align="stretch" gap="0.5" minW="0" flex="1">
                <Text fontSize="sm" fontWeight={800} color="fg.ink" truncate>
                    <Box as="span" color={meta.team1.predicted ? "fg.muted" : undefined}>{meta.team1.name}</Box>
                    <Box as="span" color="fg.muted" px="1">–</Box>
                    <Box as="span" color={meta.team2.predicted ? "fg.muted" : undefined}>{meta.team2.name}</Box>
                </Text>
                {meta.meta && (
                    <Text fontSize="2xs" fontWeight={600} color="fg.muted" truncate>{meta.meta}</Text>
                )}
            </VStack>
            {active && (
                <Text as="span" color="green.solid" fontWeight={800} flexShrink={0}>✓</Text>
            )}
        </>
    )
}

/**
 * The console's own sticky scoreboard - the embedded (tournament-tab) twin of
 * the fullscreen zapisnik's header board.
 *
 * The console is a data-entry screen and carries no running result of its own:
 * the score lived only at the bottom of the page inside "tijek utakmice", so
 * anyone at the table who wanted to know the score had to scroll past the whole
 * action grid, or add the goals up by hand. Pinned here it stays on screen
 * through rosters, actions and the timeline.
 *
 * `top` is the caller's problem, not this component's: the offset depends on
 * how much sticky chrome the host already pins above it, and only the host
 * knows that (see TournamentDetailsPage, which measures its own title/tab bar).
 */
function ScoreboardBar({
    match,
    colors,
    score,
    clock,
    picker,
    top,
}: {
    match: PanelMatch
    colors: Record<string, TeamKit>
    /** Event-derived live score from the panel; falls back to the stored one
     *  (a finished match, or before the panel has reported). */
    score: { s1: number; s2: number } | null
    clock: ClockArgs | null
    /** The match picker, mounted on the LEFT of the bar - same place the
     *  fullscreen zapisnik puts it. It belongs with the scoreboard: both answer
     *  "which match am I looking at", and as a wide card below the bar it
     *  scrolled away while the bar stayed. */
    picker?: React.ReactNode
    top?: BoxProps["top"]
}) {
    const s1 = score?.s1 ?? match.score1 ?? 0
    const s2 = score?.s2 ?? match.score2 ?? 0
    const isLive = match.status === "LIVE"
    return (
        <Box
            position="sticky"
            top={top ?? 0}
            // Under the host's own sticky chrome (NavBar / tab bar sit at 100),
            // above the console content that scrolls beneath it.
            zIndex={11}
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border"
            rounded="xl"
            shadow="sm"
            px={{ base: "2.5", md: "4" }}
            py="2"
        >
            {/* Picker LEFT, scoreboard CENTRED, clock RIGHT - the fullscreen
                header's layout. The outer track pair is `minmax(0, 1fr)` on
                both sides so the middle column lands on the true centre no
                matter how wide the picker button or the clock turn out; a bare
                `1fr` is floored at min-content and would drift with them. */}
            <Box
                display="grid"
                gridTemplateColumns="minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr)"
                alignItems="center"
                gap={{ base: "2", md: "3" }}
                minW="0"
            >
                <Box justifySelf="start" minW="0" maxW="full">{picker}</Box>
                {/* Equal halves either side of the score keep the score itself
                    on the centre line whatever the team names do. */}
                <Box
                    display="grid"
                    gridTemplateColumns="minmax(0, 1fr) auto minmax(0, 1fr)"
                    alignItems="center"
                    gap={{ base: "2", md: "3" }}
                    minW="0"
                    w="full"
                >
                    <HStack gap="2" minW="0" justify="flex-end">
                        <Text
                            fontSize={{ base: "xs", md: "sm" }}
                            fontWeight={800}
                            color="fg.ink"
                            textAlign="right"
                            truncate
                            minW="0"
                        >
                            {match.team1Name ?? "-"}
                        </Text>
                        <TeamKitChip colors={colors} teamId={match.team1Id} size={11} />
                    </HStack>

                    <Text
                        fontFamily="mono"
                        fontSize={{ base: "lg", md: "xl" }}
                        fontWeight={800}
                        color="fg.ink"
                        fontVariantNumeric="tabular-nums"
                        whiteSpace="nowrap"
                        px="1"
                    >
                        {s1} : {s2}
                    </Text>

                    <HStack gap="2" minW="0">
                        <TeamKitChip colors={colors} teamId={match.team2Id} size={11} />
                        <Text
                            fontSize={{ base: "xs", md: "sm" }}
                            fontWeight={800}
                            color="fg.ink"
                            truncate
                            minW="0"
                        >
                            {match.team2Name ?? "-"}
                        </Text>
                    </HStack>
                </Box>

                {/* Right rail: the same clock the panel runs (identical instants,
                    so it freezes with it), or a pulsing UŽIVO dot for a
                    score-only live match. Absent otherwise - a scheduled match
                    has no time to show. */}
                <Box justifySelf="end" minW="0">
                    {clock ? (
                        <LiveClock {...clock} size="xs" showLabel labelOutside />
                    ) : isLive ? (
                        <PulseDot color="accent.red" size={6} />
                    ) : null}
                </Box>
            </Box>
        </Box>
    )
}

export default function LiveControlTab({
    uuid,
    finishedLocked = false,
    standaloneHref,
    onClockArgs,
    onFixturesSettled,
    selectorSlot,
    onSelectedMatch,
    onScore,
    stickyTop,
}: {
    uuid: string
    /** Sticky offset for the console's OWN scoreboard bar (embedded usage) -
     *  the height of whatever sticky chrome the host already pins above it
     *  (NavBar + the tournament page's title/tab bar). Ignored when a host takes
     *  the scoreboard over via `selectorSlot`. */
    stickyTop?: BoxProps["top"]
    /** Forwarded to the panel: the live, event-derived score for a host header. */
    onScore?: (score1: number, score2: number) => void
    /** Reports which match the console is CURRENTLY on, so a host header can
     *  follow the picker instead of showing whatever happens to be live. Called
     *  with null while nothing is selected. */
    onSelectedMatch?: (m: {
        team1Id: number | null
        team1Name: string | null
        team2Id: number | null
        team2Name: string | null
        score1: number | null
        score2: number | null
        status: string | null
    } | null) => void
    /** DOM node to render the match picker into instead of inline - the
     *  zapisnik's sticky header. A portal rather than a lifted React node:
     *  the picker owns open/selected state, and handing a rendered node up
     *  through a callback would re-create it on every parent render. */
    selectorSlot?: HTMLElement | null
    /** Tournament FINISHED + non-admin viewer: render the "locked" notice
     *  instead of the live-control console (the simplest robust lock). */
    finishedLocked?: boolean
    /** When set (embedded-in-tab usage), render a small "Puni zapisnik" link
     *  above the console that opens the standalone scorekeeper view at this
     *  href. Omitted on the standalone page itself, so it shows no self-link. */
    standaloneHref?: string
    /** Passed straight through to the live panel: lifts the console's own clock
     *  instants up to a host (fullscreen zapisnik header) so its clock ticks
     *  from the same instants and freezes together on pause. */
    onClockArgs?: (args: ClockArgs | null) => void
    /** Fired once the fixtures have loaded, and again whenever a result is
     *  entered or corrected - NOT on every goal/card. `finalDecided` says the
     *  tournament has been played out; the standalone zapisnik uses it to offer
     *  the awards + "Završi turnir" card right there. `initial` marks the first
     *  (load) call, which reports state rather than a change. */
    onFixturesSettled?: (info: { finalDecided: boolean; initial: boolean }) => void
}) {
    const navigate = useNavigate()
    const t = useTranslation()
    const tc = t.components.liveControlTab
    const [groups, setGroups] = useState<Group[] | null>(null)
    const [knockout, setKnockout] = useState<BracketMatch[] | null>(null)
    const [loading, setLoading] = useState(true)
    const [selectedId, setSelectedId] = useState<number | null>(null)
    const [showFinished, setShowFinished] = useState(false)
    const [pickerOpen, setPickerOpen] = useState(false)

    // Lifted here (rather than fetched only inside StreamSection below) so
    // LiveMatchPanel can also see it: while THIS tournament is actually
    // streaming, the mode picker only offers "s mjeračem vremena" - a
    // SIMPLE/result-only match would leave the overlay clock unusable.
    const [banner, setBanner] = useState<StreamBanner | null>(null)
    useEffect(() => {
        let cancelled = false
        fetchStreamBanner().then((b) => { if (!cancelled) setBanner(b) }).catch(() => { /* silent - next poll retries */ })
        return () => { cancelled = true }
    }, [])
    usePolling(() => {
        fetchStreamBanner().then(setBanner).catch(() => { /* silent */ })
    }, 30_000)
    const streamActive = !!banner?.live && banner.tournamentUuid === uuid

    const reload = useCallback(async () => {
        const [g, b] = await Promise.all([
            fetchGroups(uuid).catch(() => [] as Group[]),
            fetchBracket(uuid).catch(() => null),
        ])
        setGroups(g)
        const ko: BracketMatch[] = []
        if (b) {
            for (const r of b.rounds) for (const m of r.matches) ko.push(m)
            if (b.thirdPlace) ko.push(b.thirdPlace)
        }
        setKnockout(ko)
    }, [uuid])

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        reload().finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [reload])

    // A recordable fixture has both teams decided and a kickoff (→ the schedule
    // is generated). Finished matches stay hidden until the user asks for them,
    // but they remain selectable so results can be corrected through Zapisnik.
    const recordable = useMemo<Entry[]>(() => {
        const out: Entry[] = []
        for (const g of groups ?? [])
            for (const m of g.matches)
                out.push({ kind: "group", match: m as PanelMatch })
        for (const m of knockout ?? [])
            out.push({ kind: "knockout", match: m as PanelMatch })
        return out
            .filter(
                (e) =>
                    e.match.team1Id != null &&
                    e.match.team2Id != null &&
                    e.match.kickoffAt != null &&
                    (e.match.status === "LIVE" || e.match.status === "SCHEDULED" || e.match.status === "FINISHED"),
            )
            .sort((a, b) => {
                const sr = (STATUS_RANK[a.match.status] ?? 9) - (STATUS_RANK[b.match.status] ?? 9)
                if (sr !== 0) return sr
                return kickoffMs(a.match.kickoffAt) - kickoffMs(b.match.kickoffAt)
            })
    }, [groups, knockout])

    const manageable = useMemo(
        () => recordable.filter((e) => e.match.status === "LIVE" || e.match.status === "SCHEDULED"),
        [recordable],
    )
    const finished = useMemo(
        () => recordable
            .filter((e) => e.match.status === "FINISHED")
            .sort((a, b) => kickoffMs(b.match.kickoffAt) - kickoffMs(a.match.kickoffAt)),
        [recordable],
    )
    const selectable = useMemo(
        () => showFinished ? [...manageable, ...finished] : manageable,
        [manageable, finished, showFinished],
    )

    /** The tournament has been played out. Primary signal is the FINAL match
     *  being FINISHED - both formats have one, and it is what decides the
     *  champion regardless of how the result was entered (timer or score-only).
     *  A bracket without a FINAL entry is a legacy/odd shape: fall back to
     *  "nothing left to record". */
    const finalDecided = useMemo(() => {
        const ko = knockout ?? []
        const fin = ko.find((m) => m.stage === "FINAL")
        if (fin) return fin.status === "FINISHED"
        return recordable.length > 0 && manageable.length === 0
    }, [knockout, recordable.length, manageable.length])

    // Report the fixture state to the host: once on load, then on every change
    // to the finished count or to `finalDecided`. Deliberately not on every
    // mutation - goals and cards don't move either value.
    const settledRef = useRef<string | null>(null)
    useEffect(() => {
        if (loading) return
        const stamp = `${finished.length}|${finalDecided}`
        const first = settledRef.current === null
        if (settledRef.current === stamp) return
        settledRef.current = stamp
        onFixturesSettled?.({ finalDecided, initial: first })
    }, [finished.length, finalDecided, loading, onFixturesSettled])

    // Generated knockout fixtures whose participants aren't decided yet - e.g. a
    // semifinal/final drawn with a reserved kickoff while the group stage is
    // still running. They can't be recorded (no teams), but the organizer should
    // still see them on the schedule as upcoming "TBD" games. Byes are
    // auto-FINISHED, so the SCHEDULED filter already leaves them out.
    const pending = useMemo<Entry[]>(() => {
        const out: Entry[] = []
        for (const m of knockout ?? []) {
            const pm = m as PanelMatch
            if (
                pm.kickoffAt != null &&
                pm.status === "SCHEDULED" &&
                (pm.team1Id == null || pm.team2Id == null)
            ) {
                out.push({ kind: "knockout", match: pm })
            }
        }
        return out.sort(
            (a, b) => kickoffMs(a.match.kickoffAt) - kickoffMs(b.match.kickoffAt),
        )
    }, [knockout])

    // Default selection = the match the schedule says is up now: the current
    // LIVE one, else the next-to-play (earliest kickoff SCHEDULED). Finished
    // matches become fallbacks only after the explicit "Pokaži završene" click.
    const fallback =
        manageable.find((e) => e.match.status === "LIVE") ??
        manageable[0] ??
        (showFinished ? finished[0] ?? null : null)
    const selected = selectable.find((e) => e.match.matchId === selectedId) ?? fallback

    // Keep the host header in step with the picker. Depends on the score and
    // status too, so a goal entered on the selected match updates the header
    // without waiting for the live-matches poll.
    const sm = selected?.match

    /* -- Own scoreboard bar (embedded usage) -----------------------------
       The panel's live score and clock are TAPPED here, not merely forwarded:
       when no host takes them (the tournament page's Zapisnik tab), this
       console renders its own sticky scoreboard from them. Without it the
       running result lives only at the bottom of the page, inside "tijek
       utakmice" - which is why teams standing at the table were adding goals up
       by hand. Same reason the fullscreen page grew a header scoreboard.
       The host case still gets every call, unchanged. */
    const [panelScore, setPanelScore] = useState<{ s1: number; s2: number } | null>(null)
    const [panelClock, setPanelClock] = useState<ClockArgs | null>(null)
    const handleScore = useCallback((s1: number, s2: number) => {
        setPanelScore({ s1, s2 })
        onScore?.(s1, s2)
    }, [onScore])
    const handleClockArgs = useCallback((args: ClockArgs | null) => {
        setPanelClock(args)
        onClockArgs?.(args)
    }, [onClockArgs])
    // Drop the previous match's score/clock the moment the selection moves, or
    // they flash on the newly picked match before its panel reports.
    const selectedMatchId = sm?.matchId ?? null
    useEffect(() => {
        setPanelScore(null)
        setPanelClock(null)
    }, [selectedMatchId])

    const kitColors = useTeamColors(uuid)
    const ownScoreboard = !selectorSlot

    useEffect(() => {
        if (!onSelectedMatch) return
        onSelectedMatch(sm
            ? {
                team1Id: sm.team1Id ?? null,
                team1Name: sm.team1Name ?? null,
                team2Id: sm.team2Id ?? null,
                team2Name: sm.team2Name ?? null,
                score1: sm.score1 ?? null,
                score2: sm.score2 ?? null,
                status: sm.status ?? null,
            }
            : null)
        return () => onSelectedMatch(null)
    }, [
        onSelectedMatch, sm, sm?.team1Id, sm?.team1Name, sm?.team2Id, sm?.team2Name,
        sm?.score1, sm?.score2, sm?.status,
    ])

    // Finished + locked: the console is off entirely - show the notice instead.
    if (finishedLocked) {
        return (
            <Panel>
                <Flex align="center" gap="2" color="fg.muted">
                    <FiInfo size={14} />
                    <Text fontFamily="mono" fontSize="xs" fontWeight={600}>
                        {tc.lockedNotice}
                    </Text>
                </Flex>
            </Panel>
        )
    }

    if (loading) return <Loader />

    if (recordable.length === 0 && pending.length === 0) {
        return (
            <Panel>
                <EmptyState
                    icon={LuRadioTower}
                    title={tc.emptyNoMatchTitle}
                    description={tc.emptyNoMatchDesc}
                />
            </Panel>
        )
    }

    // Every match already recorded, nothing pending - the tournament is done.
    // A centred "završen" notice reads far better than the sparse card the
    // "pending" branch below renders (which floats top-left, no context).
    if (selectable.length === 0 && pending.length === 0) {
        return (
            <Panel>
                <EmptyState
                    icon={FiCheckCircle}
                    title={tc.tournamentFinishedTitle}
                    description={tc.tournamentFinishedDesc(finished.length)}
                    action={
                        !showFinished ? (
                            <Button size="sm" variant="outline" colorPalette="pitch" onClick={() => setShowFinished(true)}>
                                {tc.showFinished(finished.length)}
                            </Button>
                        ) : undefined
                    }
                />
            </Panel>
        )
    }

    // Nothing to record yet, but the schedule already holds knockout fixtures
    // waiting on the draw: list them as upcoming "TBD" games instead of the
    // empty state, so it's clear the final/semifinal is scheduled.
    if (selectable.length === 0) {
        return (
            <Panel>
                <VStack align="stretch" gap="3">
                    <Flex align="center" gap="2">
                        <Box color="fg.muted" display="inline-flex"><LuRadioTower size={16} /></Box>
                        <Text fontSize="sm" fontWeight={800} color="fg.ink">
                            {tc.upcomingHeading}
                        </Text>
                    </Flex>
                    <Text fontSize="xs" color="fg.muted" lineHeight="1.45">
                        {tc.upcomingHint}
                    </Text>
                    {/* One bordered list with divided rows - NOT a card per
                        fixture. Eight full-width bordered cards is the shape a
                        LIST of eight scheduled knockout games had, and it read
                        as eight separate things demanding attention when it is
                        one waiting-room. This is the same row body the picker
                        menu uses, at the same density, so the two views of the
                        same fixture look identical. */}
                    <Box borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden">
                        {pending.map((e, i) => (
                            <Flex
                                key={`pending-${e.match.matchId}`}
                                align="center"
                                gap="3"
                                px="3"
                                py="2"
                                minW="0"
                                borderTopWidth={i === 0 ? "0" : "1px"}
                                borderColor="border"
                            >
                                <MatchCardContent meta={matchMeta(e, false, tc)} />
                            </Flex>
                        ))}
                    </Box>
                    {finished.length > 0 && !showFinished && (
                        <Button size="sm" variant="outline" colorPalette="pitch" onClick={() => setShowFinished(true)} alignSelf="flex-start">
                            {tc.showFinished(finished.length)}
                        </Button>
                    )}
                </VStack>
            </Panel>
        )
    }

    // The styled match-selector: a structured card-like trigger (status chip +
    // two-line teams/meta + chevron); a Menu lists the other matches as rows of
    // the same shape. Single-match case renders the same card without the Menu.
    const selectedMeta = selected
        ? matchMeta(selected, selected.match.matchId === fallback?.match.matchId, tc)
        : null
    const cardBox = {
        align: "center" as const,
        gap: "3",
        w: "auto",
        maxW: { base: "100%", md: "xl" },
        minW: "0",
        borderWidth: "1px",
        borderColor: "border",
        rounded: "2xl",
        px: "3.5",
        py: "2.5",
        bg: "bg.panel",
    }
    /** True when there is anything to pick BETWEEN - one match needs no menu. */
    const hasPicker =
        selectable.length + pending.length > 1 || (finished.length > 0 && !showFinished)

    /**
     * The picker, around whatever trigger the caller wants.
     *
     * Two triggers exist: the wide match card the console shows inline, and a
     * compact "Izaberi utakmicu" button for the zapisnik's sticky header. The
     * MENU is shared - one list, one selection state, one "Pokaži završene"
     * toggle - so the two can never drift apart.
     */
    const pickerMenu = (trigger: React.ReactNode) => (
            <Menu.Root open={pickerOpen} onOpenChange={(e) => setPickerOpen(e.open)}>
                <Menu.Trigger asChild>
                    {trigger}
                </Menu.Trigger>
                <Portal>
                    <Menu.Positioner>
                        <Menu.Content maxW="min(92vw, 640px)" maxH="60vh" overflowY="auto">
                            {selectable.map((e) => (
                                <Menu.Item
                                    key={`${e.kind}-${e.match.matchId}`}
                                    value={String(e.match.matchId)}
                                    onClick={() => setSelectedId(e.match.matchId)}
                                >
                                    <Flex align="center" gap="3" w="full" minW="0">
                                        <MatchCardContent
                                            meta={matchMeta(e, e.match.matchId === fallback?.match.matchId, tc)}
                                            active={e.match.matchId === selected?.match.matchId}
                                        />
                                    </Flex>
                                </Menu.Item>
                            ))}
                            {finished.length > 0 && !showFinished && (
                                <>
                                    <Menu.Separator />
                                    <Box px="2" py="1.5">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            colorPalette="pitch"
                                            w="full"
                                            justifyContent="flex-start"
                                            fontWeight={800}
                                            onClick={(event) => {
                                                event.preventDefault()
                                                event.stopPropagation()
                                                setShowFinished(true)
                                                window.setTimeout(() => setPickerOpen(true), 0)
                                            }}
                                        >
                                            {tc.showFinished(finished.length)}
                                        </Button>
                                    </Box>
                                </>
                            )}
                            {pending.length > 0 && (
                                <>
                                    <Menu.Separator />
                                    {pending.map((e) => (
                                        <Menu.Item
                                            key={`pending-${e.match.matchId}`}
                                            value={`pending-${e.match.matchId}`}
                                            disabled
                                        >
                                            <Flex align="center" gap="3" w="full" minW="0">
                                                <MatchCardContent meta={matchMeta(e, false, tc)} />
                                            </Flex>
                                        </Menu.Item>
                                    ))}
                                </>
                            )}
                        </Menu.Content>
                    </Menu.Positioner>
                </Portal>
            </Menu.Root>
    )

    const wideTrigger = (
        <Flex
            {...cardBox}
            as="button"
            cursor="pointer"
            _hover={{ borderColor: "border.emphasized" }}
            textAlign="left"
        >
            {selectedMeta && <MatchCardContent meta={selectedMeta} />}
            <Box color="fg.muted" flexShrink={0}><FiChevronDown size={16} /></Box>
        </Flex>
    )

    /** The compact trigger both bars use: the fullscreen header's, and this
     *  console's own scoreboard bar. */
    const compactTrigger = (
        <Button
            size="xs"
            variant="outline"
            colorPalette="gray"
            maxW={{ base: "9.5rem", md: "13rem" }}
        >
            <FiList />
            <Box as="span" truncate>{tc.pickMatch}</Box>
            <FiChevronDown size={14} />
        </Button>
    )

    // The picker lives in whichever bar is on screen - the host's header, or
    // the console's own scoreboard - and NOT inline in the panel: two of the
    // same control on one screen is one too many, and the wide card scrolled
    // away while the bar stayed pinned. The wide card survives only where
    // there is no bar at all, and the no-picker case still renders the plain
    // card so the current match is named somewhere.
    const selector = selectorSlot || ownScoreboard
        ? null
        : hasPicker
            ? pickerMenu(wideTrigger)
            : (
                <Flex {...cardBox}>
                    {selectedMeta && <MatchCardContent meta={selectedMeta} />}
                </Flex>
            )

    /** The header-mounted picker, portalled into the host's slot. */
    const headerPicker = selectorSlot && hasPicker
        ? createPortal(pickerMenu(compactTrigger), selectorSlot)
        : null

    /** The same picker, for the console's own scoreboard bar. */
    const barPicker = ownScoreboard && hasPicker ? pickerMenu(compactTrigger) : null

    // Keyed by id+status so a status change (SCHEDULED→LIVE→…) remounts the
    // panel with fresh state.
    return selected ? (
        <VStack align="stretch" gap="4">
            {headerPicker}
            {ownScoreboard && (
                <ScoreboardBar
                    match={selected.match}
                    colors={kitColors}
                    score={panelScore}
                    clock={panelClock}
                    picker={barPicker}
                    top={stickyTop}
                />
            )}
            <LiveMatchPanel
                key={`${selected.match.matchId}-${selected.match.status}`}
                uuid={uuid}
                kind={selected.kind}
                match={selected.match}
                onChanged={reload}
                selector={selector}
                streamActive={streamActive}
                onClockArgs={handleClockArgs}
                onScore={handleScore}
                footerAction={
                    standaloneHref ? (
                        <Button
                            size="xs"
                            variant="outline"
                            colorPalette="pitch"
                            onClick={() => navigate(standaloneHref)}
                        >
                            <FiMaximize2 /> {tc.fullscreenButton}
                        </Button>
                    ) : undefined
                }
            />
            {/* Optional live stream of the match being recorded (organizer aid):
                only when the admin has linked a stream to THIS tournament. Kept
                below the console and low-key when collapsed - it's a nice-to-have,
                not the main event. */}
            <StreamSection uuid={uuid} banner={banner} />
        </VStack>
    ) : null
}

/* ──────────────────────────────────────────────────────────────────────────
   StreamSection - lets the scorekeeper watch the tournament's live stream right
   inside the Zapisnik, so goals can be entered the moment they happen. Uses
   ONLY the stream the admin linked to this tournament (the home-page banner);
   there's no URL to paste. Off by default; the show/hide choice is remembered
   per tournament. Renders nothing when no stream is linked here.
   ────────────────────────────────────────────────────────────────────────── */
function StreamSection({ uuid, banner }: { uuid: string; banner: StreamBanner | null }) {
    const t = useTranslation()
    const tc = t.components.liveControlTab
    const [shown, setShown] = useState<boolean>(() => {
        try {
            return localStorage.getItem(`zapisnik-stream-${uuid}`) === "1"
        } catch {
            return false
        }
    })

    // A stream is available here only when the admin linked one to THIS
    // tournament (t.uuid is canonical, same as banner.tournamentUuid).
    const url = banner?.url && banner.tournamentUuid === uuid ? banner.url : null
    // Zapisnik watchers join the global viewer count too: heartbeat only while
    // the player is actually shown. Called before the early return below so the
    // hook order stays stable across renders.
    const viewers = useStreamPresence(shown && !!url)
    if (!url) return null

    function toggle() {
        setShown((prev) => {
            const next = !prev
            try { localStorage.setItem(`zapisnik-stream-${uuid}`, next ? "1" : "0") } catch { /* ignore */ }
            return next
        })
    }

    return (
        <Box
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border"
            rounded={shown ? "2xl" : "xl"}
            shadow={shown ? "sm" : "none"}
            p="3"
            // Expanded: the panel HUGS the (now bigger) player and centres, so
            // there's no dead white frame to its left/right - the video is the
            // star. Collapsed stays a slim full-width row so the show/hide
            // toggle is always easy to find.
            w={shown ? { base: "full", md: "fit-content" } : "full"}
            minW={shown ? { md: "480px" } : undefined}
            mx={shown ? "auto" : undefined}
        >
            <Flex align="center" justify="space-between" gap="2" mb={shown ? "3" : "0"}>
                <HStack gap="2" minW="0">
                    <Box color="accent.red" display="inline-flex"><LuRadioTower size={16} /></Box>
                    <Text fontSize="sm" fontWeight={800} color="fg.ink" truncate>{tc.streamSectionHeading}</Text>
                </HStack>
                <Button size="sm" variant="outline" colorPalette="pitch" onClick={toggle} flexShrink={0}>
                    {shown ? <><FiEyeOff /> {tc.streamHide}</> : <><FiPlay /> {tc.streamShow}</>}
                </Button>
            </Flex>
            {shown && (
                // A real width (not just maxW) drives the fit-content panel to
                // hug the player at up to 760px; maxW="full" keeps it from
                // overflowing a narrow content column (e.g. tablet width).
                <Box w={{ base: "full", md: "760px" }} maxW="full" mx="auto">
                    <StreamPlayer url={url} viewers={viewers} tournamentUuid={uuid} />
                </Box>
            )}
        </Box>
    )
}
