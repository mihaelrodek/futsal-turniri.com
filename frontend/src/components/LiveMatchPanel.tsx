import { useEffect, useMemo, useState } from "react"
import { Box, Button, chakra, Flex, HStack, IconButton, Input, Text, VStack } from "@chakra-ui/react"
import { FiEdit2, FiMinus, FiMoreHorizontal, FiPause, FiPlay, FiPlus, FiX } from "react-icons/fi"
import { GiSoccerBall } from "react-icons/gi"
import { LuTimer, LuTimerOff } from "react-icons/lu"

import {
    endFirstHalf,
    finishMatch,
    pauseMatch,
    resetMatch,
    resumeMatch,
    startMatch,
    startSecondHalf,
} from "../api/matchEvents"
import { recordKnockoutResult } from "../api/bracket"
import { recordGroupResult } from "../api/groups"
import { fetchSchedule } from "../api/schedule"
import { fetchPlayers } from "../api/players"
import type { CreateMatchEventRequest, MatchEventDto, MatchEventType, MatchLiveMode } from "../types/matchEvents"
import type { PlayerDto } from "../types/players"
import { useOfflineMatchEvents, type OptimisticDisplay } from "../hooks/useOfflineMatchEvents"
import { useOfflineMatchFouls } from "../hooks/useOfflineMatchFouls"
import { LiveSyncIndicator } from "./LiveSyncIndicator"
import { ConfirmDialog } from "../ui/primitives"
import { useTeamColors, teamColor, teamShorts, KitSwatch } from "./jersey"
import {
    DirectScoreEditor,
    FoulChip,
    PenaltyShootout,
    clockState,
    liveMatchMinute,
    matchPhase,
    type TimelineFouls,
} from "./liveMatch"

/* ──────────────────────────────────────────────────────────────────────────
   LiveMatchPanel - the organizer's live match-recording console ("Zapisnik").

   Redesigned per the Zapisnik handoff: a single card driven by one state
   machine with two phases (pre-match → live) plus a result-only sub-mode.
     • Pre-match: scoreboard + how-to-record buttons + "unesi samo rezultat".
     • Live: big timer with pause/play, a player+action PAIRING entry (pick a
       player and an action in either order → commits on both), per-team fouls,
       and the primary phase button (end half / start 2nd half / finish).
     • Shared below: a vertical centre-line timeline with running-score pills.

   Every behaviour contract is preserved: offline-first events/fouls
   (useOfflineMatchEvents / useOfflineMatchFouls, idempotent, queued offline),
   the instant-driven clock (matchPhase/clockState + four ISO instants +
   livePausedAt freezing), own-goal semantics (teamId = beneficiary), event-
   derived score with stored fallback, and the group-vs-knockout branch on
   finish / save-result / penalty shootout.
   ────────────────────────────────────────────────────────────────────────── */

/** Team-identity colours: home navy-slate, away Specto teal. Fixed hex
 *  (not theme tokens) - they read on both the light and dark card surface. */
const HOME = "#3A5A7A"
const AWAY = "#0E8A81"
const GOAL_GREEN = "#16A34A"
const CARD_YELLOW = "#e8a01f"
const CARD_RED = "#c0392b"
/** SPECTO brand cyan - drives the active-half foul tint. */
const PITCH = "#2AD4C8"
/** A translucent tint of a colour - works on any (light/dark) surface. */
const tint = (hex: string, pct: number) => `color-mix(in srgb, ${hex} ${pct}%, transparent)`

export type PanelMatch = {
    matchId: number
    status: string
    liveMode?: MatchLiveMode | null
    liveStartedAt?: string | null
    firstHalfEndedAt?: string | null
    secondHalfStartedAt?: string | null
    livePausedAt?: string | null
    team1Id: number | null
    team1Name: string | null
    team2Id: number | null
    team2Name: string | null
    score1: number | null
    score2: number | null
    kickoffAt?: string | null
    fouls1First?: number | null
    fouls1Second?: number | null
    fouls2First?: number | null
    fouls2Second?: number | null
    penalties1?: number | null
    penalties2?: number | null
}

function scoreFromEvents(list: MatchEventDto[], t1: number | null, t2: number | null) {
    let s1 = 0
    let s2 = 0
    for (const e of list) {
        // OWN_GOAL's teamId is the beneficiary, so both goal kinds count the same.
        if (e.type !== "GOAL" && e.type !== "OWN_GOAL") continue
        if (e.teamId === t1) s1 += 1
        else if (e.teamId === t2) s2 += 1
    }
    return { s1, s2 }
}

export default function LiveMatchPanel({
    uuid,
    kind,
    match,
    onChanged,
    selector,
    headerAction,
    onClockArgs,
}: {
    uuid: string
    kind: "group" | "knockout"
    match: PanelMatch
    onChanged: () => Promise<void> | void
    /** The styled match-selector node (built by the host, which owns the list). */
    selector?: React.ReactNode
    /** Optional right-aligned action (e.g. "Puni zapisnik") rendered at the top
     *  of the console header, above the match selector. */
    headerAction?: React.ReactNode
    /** Lifts THIS console's own clock truth up to a host (e.g. the fullscreen
     *  zapisnik header) so its clock ticks from the exact same instants and
     *  freezes together on pause. Called with the current local clockArgs while
     *  the match is LIVE + TIMER, and with null when it isn't (or on unmount). */
    onClockArgs?: (
        args: {
            liveStartedAt: string | null | undefined
            firstHalfEndedAt: string | null
            secondHalfStartedAt: string | null
            livePausedAt: string | null
            halfLengthMin: number | null
            halfCount: number | null
        } | null,
    ) => void
}) {
    const matchId = match.matchId
    const isKnockout = kind === "knockout"
    const isLive = match.status === "LIVE"
    const isFinished = match.status === "FINISHED"
    const isScheduled = !isLive && !isFinished
    const isTimer = match.liveMode === "TIMER"

    // Kit (dres + hlače) colours → a two-tone chip next to each team name.
    const teamColors = useTeamColors(uuid)
    const jerseyC1 = teamColor(teamColors, match.team1Id)
    const jerseyC2 = teamColor(teamColors, match.team2Id)
    const shortsC1 = teamShorts(teamColors, match.team1Id)
    const shortsC2 = teamShorts(teamColors, match.team2Id)

    // Offline-first live events: optimistic add/delete, queued while offline,
    // replayed on reconnect (idempotent via a client key). Score derives from
    // these locally, so a queued goal shows instantly.
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
    const [halfLengthMin, setHalfLengthMin] = useState<number | null>(null)
    const [halfCount, setHalfCount] = useState<number | null>(null)
    const [firstHalfEndedAt, setFirstHalfEndedAt] = useState<string | null>(
        match.firstHalfEndedAt ?? null,
    )
    const [secondHalfStartedAt, setSecondHalfStartedAt] = useState<string | null>(
        match.secondHalfStartedAt ?? null,
    )
    const [livePausedAt, setLivePausedAt] = useState<string | null>(
        match.livePausedAt ?? null,
    )
    const [starting, setStarting] = useState(false)
    const [phaseBusy, setPhaseBusy] = useState(false)
    const [pauseBusy, setPauseBusy] = useState(false)
    const [finishing, setFinishing] = useState(false)
    const [resetting, setResetting] = useState(false)
    const [shootout, setShootout] = useState(false)
    // Direct final-score entry (no scorers). Hidden during LIVE unless toggled
    // from the ⋯ menu; `pendingScore` carries an entered score into the penalty
    // shootout for a level knockout result.
    const [savingScore, setSavingScore] = useState(false)
    const [showDirectScore, setShowDirectScore] = useState(false)
    const [pendingScore, setPendingScore] = useState<{ s1: number; s2: number } | null>(null)
    // Result-only entry done IN PLACE on the big pre-match scoreboard (scheduled
    // branch): the two entered scores live here, seeded from the stored score.
    const [directS1, setDirectS1] = useState<number>(match.score1 ?? 0)
    const [directS2, setDirectS2] = useState<number>(match.score2 ?? 0)
    const [overflow, setOverflow] = useState(false)

    // Keep the local live instants in sync when the parent refetches the match.
    useEffect(() => setFirstHalfEndedAt(match.firstHalfEndedAt ?? null), [match.firstHalfEndedAt])
    useEffect(() => setSecondHalfStartedAt(match.secondHalfStartedAt ?? null), [match.secondHalfStartedAt])
    useEffect(() => setLivePausedAt(match.livePausedAt ?? null), [match.livePausedAt])

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

    const liveScore = useMemo(
        () => scoreFromEvents(events ?? [], match.team1Id, match.team2Id),
        [events, match.team1Id, match.team2Id],
    )
    // Any recorded penalty-shootout kick (PENALTY_GOAL / PENALTY_MISSED) means
    // the završnica shootout is underway (or already recorded). While that's the
    // case regulation goal entry must be blocked: a mis-tap on the normal "Gol"
    // button would create a plain GOAL event that wrongly counts as a scorer's
    // goal AND bumps the match score. Penalties are entered ONLY through the
    // guided shootout recorder (which stores PENALTY_* events that never count
    // as goals). Cards/fouls stay available.
    const penaltyInProgress = useMemo(
        () => (events ?? []).some((e) => e.type === "PENALTY_GOAL" || e.type === "PENALTY_MISSED"),
        [events],
    )
    // Show the event-derived score once events are loaded; otherwise the stored
    // score (avoids a result-only match flashing 0:0).
    const score =
        events && events.length > 0
            ? liveScore
            : { s1: match.score1 ?? 0, s2: match.score2 ?? 0 }

    // Half config (length + count) for TIMER matches.
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

    // Re-tick every second so the phase (halftime / full-time prompts) flips
    // the instant the clock reaches the end of a half.
    const [, setTick] = useState(0)
    useEffect(() => {
        if (!isTimer || !isLive) return
        const id = setInterval(() => setTick((n) => n + 1), 1000)
        return () => clearInterval(id)
    }, [isTimer, isLive])

    const clockArgs = {
        liveStartedAt: match.liveStartedAt,
        firstHalfEndedAt,
        secondHalfStartedAt,
        livePausedAt,
        halfLengthMin,
        halfCount,
    }
    // Lift the console's OWN clock instants up to a host (fullscreen zapisnik
    // header) whenever the match is LIVE + TIMER, so the header ticks from the
    // exact same instants (incl. the optimistic livePausedAt) and freezes the
    // instant this console pauses - no drift from a separate live-matches poll.
    // Depends on each field so pause/resume/half transitions re-fire at once.
    useEffect(() => {
        if (!onClockArgs) return
        if (isLive && isTimer) {
            onClockArgs({
                liveStartedAt: match.liveStartedAt,
                firstHalfEndedAt,
                secondHalfStartedAt,
                livePausedAt,
                halfLengthMin,
                halfCount,
            })
        } else {
            onClockArgs(null)
        }
        return () => onClockArgs(null)
    }, [
        onClockArgs, isLive, isTimer, match.liveStartedAt,
        firstHalfEndedAt, secondHalfStartedAt, livePausedAt, halfLengthMin, halfCount,
    ])

    const phase = isTimer && isLive ? matchPhase(clockArgs) : null
    const clk = isTimer && isLive ? clockState(clockArgs) : null
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
    // Pause/resume only makes sense while a half's clock is actually running.
    const canPauseResume = phase === "FIRST_HALF" || phase === "SECOND_HALF"
    const paused = !!livePausedAt
    const halfLabel =
        phase == null
            ? ""
            : paused && canPauseResume
                ? "PAUZA"
                : phase === "FIRST_HALF" ? "1. POLUVRIJEME"
                    : phase === "HALFTIME" ? "POLUVRIJEME"
                        : phase === "SECOND_HALF" ? "2. POLUVRIJEME"
                            : "KRAJ"

    async function refreshAfterMutation() {
        await refetchEvents()
        await onChanged()
    }

    async function handleStart(mode: MatchLiveMode) {
        setStarting(true)
        try {
            await startMatch(uuid, matchId, mode)
            await onChanged()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setStarting(false)
        }
    }

    async function handleEndFirstHalf() {
        setPhaseBusy(true)
        try {
            await endFirstHalf(uuid, matchId)
            setFirstHalfEndedAt(new Date().toISOString())
            setLivePausedAt(null)
            await onChanged()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setPhaseBusy(false)
        }
    }

    async function handleStartSecondHalf() {
        setPhaseBusy(true)
        try {
            await startSecondHalf(uuid, matchId)
            setSecondHalfStartedAt(new Date().toISOString())
            setLivePausedAt(null)
            await onChanged()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setPhaseBusy(false)
        }
    }

    /** Pause / resume the live clock. Optimistic local flip; the parent
     *  refetch then confirms it (backend shifts the half start on resume,
     *  so the clock continues exactly where it froze). */
    async function handlePause() {
        setPauseBusy(true)
        try {
            await pauseMatch(uuid, matchId)
            setLivePausedAt(new Date().toISOString())
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
            await onChanged()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setPauseBusy(false)
        }
    }

    // SPACEBAR toggles pause/resume of the running timer - a scorekeeper
    // shortcut for the Zapisnik tab and the fullscreen zapisnik mode alike
    // (both render this panel). Deliberately inert while typing in an
    // input/textarea/select/contenteditable, while focus sits on any
    // button/link (Space "clicks" those - we'd double-fire), on key
    // auto-repeat, and whenever pause/resume isn't actually available
    // (no half running, or a pause call already in flight). No dependency
    // array: the listener re-binds each render so it always closes over
    // the CURRENT phase/paused/busy state - one cheap window listener.
    useEffect(() => {
        if (!isLive || !isTimer) return
        const onKey = (e: KeyboardEvent) => {
            if (e.code !== "Space") return
            if (e.repeat) return
            const el = e.target as HTMLElement | null
            if (el) {
                const tag = el.tagName
                if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) return
                if (el.closest?.("button, a, [role='button'], [role='menuitem']")) return
            }
            if (!canPauseResume || pauseBusy) return
            e.preventDefault()
            void (paused ? handleResume() : handlePause())
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    })

    async function handleFinish() {
        // A level knockout match can't end as a draw - go to penalties.
        if (isKnockout && score.s1 === score.s2) {
            setShootout(true)
            return
        }
        setFinishing(true)
        try {
            if (isKnockout) {
                await recordKnockoutResult(uuid, matchId, {
                    score1: score.s1,
                    score2: score.s2,
                })
            } else {
                await finishMatch(uuid, matchId)
            }
            await onChanged()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setFinishing(false)
        }
    }

    async function confirmShootout(pen1: number, pen2: number) {
        setFinishing(true)
        try {
            // Use the directly-entered score when the shootout was reached from
            // the direct-score editor; otherwise the event-derived score.
            const base = pendingScore ?? score
            await recordKnockoutResult(uuid, matchId, {
                score1: base.s1,
                score2: base.s2,
                penalties1: pen1,
                penalties2: pen2,
            })
            setPendingScore(null)
            await onChanged()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setFinishing(false)
        }
    }

    /** Save a final score directly (no scorers). Group -> recordGroupResult;
     *  knockout -> recordKnockoutResult (a level knockout hands off to the
     *  penalty shootout). */
    async function handleSaveDirectScore(s1: number, s2: number) {
        if (isKnockout && s1 === s2) {
            setPendingScore({ s1, s2 })
            setShootout(true)
            return
        }
        setSavingScore(true)
        try {
            if (isKnockout) {
                await recordKnockoutResult(uuid, matchId, { score1: s1, score2: s2 })
            } else {
                await recordGroupResult(uuid, matchId, s1, s2)
            }
            setShowDirectScore(false)
            await refreshAfterMutation()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setSavingScore(false)
        }
    }

    async function doReset() {
        setResetting(true)
        try {
            await resetMatch(uuid, matchId)
            await onChanged()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setResetting(false)
        }
    }
    const [confirmResetOpen, setConfirmResetOpen] = useState(false)
    const [confirmFinishOpen, setConfirmFinishOpen] = useState(false)
    function requestFinish() {
        if (finishIsPremature) {
            setConfirmFinishOpen(true)
            return
        }
        void handleFinish()
    }

    // THE one primary phase action: walk the state machine for a TIMER match;
    // playing without the app timer (SIMPLE) always shows plain "Završi".
    const primary = !isTimer
        ? { label: "Završi utakmicu", run: requestFinish, busy: finishing, phase: false }
        : canEndFirstHalf
            ? { label: "Završi 1. poluvrijeme", run: handleEndFirstHalf, busy: phaseBusy, phase: true }
            : canStartSecondHalf
                ? { label: "Započni 2. poluvrijeme", run: handleStartSecondHalf, busy: phaseBusy, phase: true }
                : { label: "Završi utakmicu", run: requestFinish, busy: finishing, phase: false }

    // Current half for the fouls counters (2nd once it has started).
    const currentHalf: 1 | 2 = secondHalfStartedAt ? 2 : 1

    // Result-only editing is IN PLACE on the big pre-match scoreboard: the score
    // badges become +/- steppers and a "Spremi rezultat" button appears. Only in
    // the scheduled branch, and never while the penalty shootout handoff is up.
    const editingScore = isScheduled && showDirectScore && !shootout

    return (
        <VStack align="stretch" gap="0">
            {/* Main card. A stable minimum height (desktop) so switching matches
                or going pre-match↔live - both remount this panel by design - no
                longer makes the console box jump between the shorter pre-match
                layout and the taller live one. */}
            <Box bg="bg.panel" borderWidth="1px" borderColor="border" rounded="3xl" shadow="sm" px={{ base: "4", md: "6" }} pb={{ base: "4", md: "6" }} pt="3" minH={{ base: "auto", md: "440px" }} display="flex" flexDirection="column">
                {/* Match selector (built by the host) + the optional host action
                    (e.g. "Puni zapisnik") share ONE centred row - the action sits
                    immediately right of the picker and wraps below on narrow
                    screens. No label above: the selector's own "● UŽIVO · A – B ·
                    …" text says it all. */}
                <Flex justify="center" align="center" gap="2" wrap="wrap">
                    {selector}
                    {headerAction}
                </Flex>

                {/* ===== PRE-MATCH / FINISHED scoreboard ===== */}
                {/* Fills the remaining card height and vertically CENTRES the
                    pre-match block (scoreboard + status + start buttons) so the
                    shorter pre-match layout reads as a calm centred panel inside
                    the card's min-height instead of top-stacked over dead space.
                    A finished match stays top-aligned (it also carries a
                    timeline below). */}
                {!isLive && (
                    <VStack align="stretch" gap="0" mt="5" flex="1" justifyContent={isScheduled ? "center" : "flex-start"}>
                        {/* Scoreboard - a 1fr/auto/1fr grid so the score stays
                            truly centred no matter how uneven the two team names
                            are; long names wrap instead of pushing the score off. */}
                        <Box
                            display="grid"
                            gridTemplateColumns="1fr auto 1fr"
                            alignItems="center"
                            gap={{ base: "2.5", md: "4" }}
                            // Extra clearance while editing: the −/+ pairs hang
                            // absolutely BELOW the score badges (so the row
                            // itself never shifts) and need room before the
                            // next block.
                            mb={editingScore ? "12" : "2"}
                            w="full"
                        >
                            <HStack gap="2" justify="flex-end" minW="0">
                                {/* Identity-colour fallback keeps both sides showing a
                                    jersey even when a team has no kit colours. */}
                                <KitSwatch jersey={jerseyC1 ?? shortsC1 ?? HOME} shorts={shortsC1} size={13} />
                                <Text fontSize={{ base: "xl", md: "3xl" }} fontWeight={800} color={HOME} textAlign="right" lineClamp={2} css={{ overflowWrap: "anywhere" }} minW="0">
                                    {match.team1Name ?? "-"}
                                </Text>
                            </HStack>
                            <HStack gap={{ base: "1.5", md: "2.5" }} flexShrink={0}>
                                {editingScore ? (
                                    <ScoreStepper
                                        value={directS1}
                                        color={HOME}
                                        disabled={savingScore}
                                        onDec={() => setDirectS1((n) => Math.max(0, n - 1))}
                                        onInc={() => setDirectS1((n) => n + 1)}
                                    />
                                ) : (
                                    <ScoreBadge value={score.s1} color={HOME} />
                                )}
                                <Text fontSize="2xl" fontWeight={800} color="fg.subtle">:</Text>
                                {editingScore ? (
                                    <ScoreStepper
                                        value={directS2}
                                        color={AWAY}
                                        disabled={savingScore}
                                        onDec={() => setDirectS2((n) => Math.max(0, n - 1))}
                                        onInc={() => setDirectS2((n) => n + 1)}
                                    />
                                ) : (
                                    <ScoreBadge value={score.s2} color={AWAY} />
                                )}
                            </HStack>
                            <HStack gap="2" justify="flex-start" minW="0">
                                <Text fontSize={{ base: "xl", md: "3xl" }} fontWeight={800} color={AWAY} textAlign="left" lineClamp={2} css={{ overflowWrap: "anywhere" }} minW="0">
                                    {match.team2Name ?? "-"}
                                </Text>
                                <KitSwatch jersey={jerseyC2 ?? shortsC2 ?? AWAY} shorts={shortsC2} size={13} />
                            </HStack>
                        </Box>
                        {/* Status line only for a FINISHED match - the scheduled
                            "još nije pokrenuta" note was redundant next to the
                            start buttons right below. */}
                        {isFinished && (
                            <Text textAlign="center" color="fg.muted" fontSize="sm" fontWeight={500} mb="4">
                                Utakmica je završena.
                            </Text>
                        )}

                        {/* SCHEDULED - how to record + result-only sub-mode. All
                            three start options sit on ONE row (wraps on narrow)
                            and share the same outlined shape, each with its own
                            icon: mjerač (⏱), bez mjerača (⏱✕), samo rezultat (✎).
                            The two "Uživo" starters hide while the result-only
                            form is open, leaving just its toggle. */}
                        {isScheduled && (
                            <>
                                <HStack gap="3" justify="center" wrap="wrap" mb="3">
                                    {!showDirectScore && (
                                        <>
                                            <Button
                                                bg={HOME}
                                                color="white"
                                                _hover={{ bg: HOME, opacity: 0.9 }}
                                                fontWeight={800}
                                                size="lg"
                                                loading={starting}
                                                onClick={() => handleStart("TIMER")}
                                            >
                                                <LuTimer /> Uživo – s mjeračem vremena
                                            </Button>
                                            <Button
                                                variant="outline"
                                                fontWeight={700}
                                                size="lg"
                                                loading={starting}
                                                onClick={() => handleStart("SIMPLE")}
                                            >
                                                <LuTimerOff /> Uživo – bez mjerača (vlastiti sat)
                                            </Button>
                                        </>
                                    )}
                                    {/* Result-only toggle - also cancels a pending
                                        shootout so closing the form never leaves the
                                        shootout panel orphaned. */}
                                    <Button
                                        variant="outline"
                                        size="lg"
                                        fontWeight={700}
                                        color="fg.ink"
                                        onClick={() => {
                                            setShowDirectScore((v) => {
                                                const next = !v
                                                // Seed the in-place steppers from the stored score
                                                // each time the editor opens.
                                                if (next) {
                                                    setDirectS1(match.score1 ?? 0)
                                                    setDirectS2(match.score2 ?? 0)
                                                }
                                                return next
                                            })
                                            setShootout(false)
                                            setPendingScore(null)
                                        }}
                                    >
                                        <FiEdit2 /> {showDirectScore ? "Odustani od unosa rezultata" : "Unesi samo rezultat"}
                                    </Button>
                                    {/* Save sits in the SAME row as Odustani while
                                        editing. Same contract (handleSaveDirectScore):
                                        a level knockout score hands off to penalties. */}
                                    {editingScore && (
                                        <Button
                                            size="lg"
                                            colorPalette="pitch"
                                            fontWeight={800}
                                            loading={savingScore}
                                            onClick={() => handleSaveDirectScore(directS1, directS2)}
                                        >
                                            <FiEdit2 /> Spremi rezultat
                                        </Button>
                                    )}
                                </HStack>

                                {/* Result-only panel. A level knockout score hands
                                    off to the penalty shootout RIGHT HERE - the
                                    live-branch shootout render is unreachable for
                                    a scheduled match, so without this the Spremi
                                    click would silently do nothing. */}
                                {showDirectScore && shootout && (
                                    <Box mt="3">
                                        <PenaltyShootout
                                            uuid={uuid}
                                            matchId={matchId}
                                            team1Id={match.team1Id ?? null}
                                            team1Name={match.team1Name ?? null}
                                            team2Id={match.team2Id ?? null}
                                            team2Name={match.team2Name ?? null}
                                            saving={finishing}
                                            onConfirm={confirmShootout}
                                            onCancel={() => {
                                                setShootout(false)
                                                setPendingScore(null)
                                            }}
                                        />
                                    </Box>
                                )}
                            </>
                        )}

                        {/* Finished result-only match (no scorers) - editable score. */}
                        {isFinished && events != null && events.length === 0 && (
                            <Box mt="1">
                                <DirectScoreEditor
                                    team1Name={match.team1Name}
                                    team2Name={match.team2Name}
                                    initialS1={match.score1 ?? 0}
                                    initialS2={match.score2 ?? 0}
                                    saving={savingScore}
                                    onSave={handleSaveDirectScore}
                                />
                            </Box>
                        )}
                    </VStack>
                )}

                {/* ===== LIVE ===== */}
                {isLive && (
                    <VStack align="stretch" gap="0" mt="2">
                        {/* Timer block - only for TIMER matches. The timer + half
                            label are truly centred; the pause/play button is
                            absolutely positioned to the RIGHT of the timer so it
                            never shifts it off-centre. A "bez mjerača" match has
                            no clock UI at all (the minute is typed per event
                            below), so this whole block is skipped for it. */}
                        {isTimer && (
                            <VStack gap="1.5" align="center" mb="3">
                                {clk && (
                                    <Box position="relative" display="inline-flex" alignItems="center" justifyContent="center">
                                        <Text
                                            fontFamily="mono"
                                            fontSize={{ base: "38px", md: "44px" }}
                                            fontWeight={800}
                                            lineHeight="1"
                                            fontVariantNumeric="tabular-nums"
                                            color={clk.paused ? "fg.muted" : clk.endingSoon ? "accent.amber" : HOME}
                                        >
                                            {clk.display}
                                        </Text>
                                        {canPauseResume && (
                                            <Box position="absolute" left="100%" ml="3" top="50%" transform="translateY(-50%)">
                                                <IconButton
                                                    aria-label={paused ? "Nastavi mjerač" : "Pauziraj mjerač"}
                                                    title={paused ? "Nastavi mjerač" : "Pauziraj mjerač"}
                                                    variant={paused ? "solid" : "outline"}
                                                    colorPalette={paused ? "brand" : "gray"}
                                                    rounded="full"
                                                    size="lg"
                                                    loading={pauseBusy}
                                                    onClick={paused ? handleResume : handlePause}
                                                >
                                                    {paused ? <FiPlay size={22} /> : <FiPause size={22} />}
                                                </IconButton>
                                            </Box>
                                        )}
                                    </Box>
                                )}
                                {halfLabel && (
                                    <Text
                                        fontSize="2xs"
                                        fontWeight={800}
                                        letterSpacing="wider"
                                        color={paused && canPauseResume ? "accent.amber" : "fg.muted"}
                                    >
                                        {halfLabel}
                                    </Text>
                                )}
                            </VStack>
                        )}

                        {shootout ? (
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
                        ) : (
                            <>
                                <PairingEntry
                                    uuid={uuid}
                                    matchId={matchId}
                                    team1Id={match.team1Id ?? null}
                                    team1Name={match.team1Name ?? null}
                                    team2Id={match.team2Id ?? null}
                                    team2Name={match.team2Name ?? null}
                                    isTimer={isTimer}
                                    clockArgs={clockArgs}
                                    half={currentHalf}
                                    serverFouls={{
                                        fouls1First: match.fouls1First ?? 0,
                                        fouls1Second: match.fouls1Second ?? 0,
                                        fouls2First: match.fouls2First ?? 0,
                                        fouls2Second: match.fouls2Second ?? 0,
                                    }}
                                    onAddEvent={addEvent}
                                    sentOffPlayerIds={sentOffIds}
                                    yellowCardedPlayerIds={yellowIds}
                                    penaltyInProgress={penaltyInProgress}
                                />

                                {/* Flow controls: the primary phase button + ⋯ menu.
                                    A half transition (end 1st / start 2nd) is a
                                    brand-cyan action; "Završi utakmicu" keeps its
                                    distinct amber treatment. */}
                                <HStack gap="2.5" mt="4" align="stretch" justify="center">
                                    {primary.phase ? (
                                        <Button
                                            colorPalette="pitch"
                                            fontWeight={800}
                                            size="md"
                                            loading={primary.busy}
                                            onClick={primary.run}
                                        >
                                            {primary.label}
                                        </Button>
                                    ) : (
                                        <Button
                                            bg={CARD_YELLOW}
                                            color="#3a2a00"
                                            _hover={{ bg: CARD_YELLOW, opacity: 0.9 }}
                                            fontWeight={800}
                                            size="md"
                                            loading={primary.busy}
                                            onClick={primary.run}
                                        >
                                            {primary.label}
                                        </Button>
                                    )}
                                    <IconButton
                                        aria-label="Više opcija"
                                        variant="outline"
                                        colorPalette="gray"
                                        size="md"
                                        onClick={() => setOverflow((v) => !v)}
                                    >
                                        <FiMoreHorizontal size={18} />
                                    </IconButton>
                                </HStack>
                                {overflow && (
                                    <Button
                                        mt="2"
                                        w="full"
                                        variant="outline"
                                        colorPalette="red"
                                        loading={resetting}
                                        onClick={() => setConfirmResetOpen(true)}
                                    >
                                        Vrati na pripremu / poništi
                                    </Button>
                                )}
                            </>
                        )}
                    </VStack>
                )}

                {/* Offline / sync status for live scoring. */}
                {(!online || pendingCount > 0 || syncing) && (
                    <Flex justify="center" mt="3">
                        <LiveSyncIndicator online={online} pending={pendingCount} syncing={syncing} />
                    </Flex>
                )}

                {/* ===== TIMELINE (shared) ===== The whole block is skipped for a
                    not-yet-started match with no events - an empty "Tijek utakmice
                    · Još nema događaja" on a scheduled match is just noise. It
                    appears once the match is LIVE / FINISHED, or the instant any
                    event exists. */}
                {(!isScheduled || events.length > 0) && (
                    <>
                        <Text
                            textAlign="center"
                            fontSize="2xs"
                            fontWeight={800}
                            letterSpacing="wider"
                            textTransform="uppercase"
                            color="fg.muted"
                            mt="6"
                            mb="2"
                        >
                            Tijek utakmice
                        </Text>
                        {!eventsLoaded && events.length === 0 ? (
                            <Text textAlign="center" fontSize="sm" color="fg.muted">Učitavanje…</Text>
                        ) : events.length === 0 ? (
                            <Text textAlign="center" fontSize="sm" color="fg.muted" fontWeight={500}>
                                {isFinished ? "Prikazan samo krajnji rezultat bez strijelca." : "Još nema zabilježenih događaja."}
                            </Text>
                        ) : (
                            <CenterTimeline
                                events={events}
                                team1Id={match.team1Id}
                                halfLengthMin={halfLengthMin}
                                canDelete={!isFinished}
                                onUndo={(ev) => deleteEvent(ev)}
                                fouls={{
                                    t1First: match.fouls1First ?? 0,
                                    t1Second: match.fouls1Second ?? 0,
                                    t2First: match.fouls2First ?? 0,
                                    t2Second: match.fouls2Second ?? 0,
                                }}
                            />
                        )}
                    </>
                )}

                {isFinished && (
                    <Flex justify="center" mt="4">
                        <Button variant="outline" colorPalette="red" loading={resetting} onClick={() => setConfirmResetOpen(true)}>
                            Poništi utakmicu
                        </Button>
                    </Flex>
                )}
            </Box>

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
        </VStack>
    )
}

/* ── Pre-match score badge (maroon/green tinted). ─────────────────────────── */
function ScoreBadge({ value, color }: { value: number; color: string }) {
    return (
        <Text
            minW="42px"
            textAlign="center"
            fontSize="2xl"
            fontWeight={800}
            color={color}
            fontVariantNumeric="tabular-nums"
            rounded="lg"
            px="2.5"
            py="1"
            css={{ background: tint(color, 10) }}
        >
            {value}
        </Text>
    )
}

/* ── In-place score stepper. The badge keeps EXACTLY the ScoreBadge footprint
   (so toggling edit mode moves nothing on the scoreboard - team names stay
   put); the − / + pair hangs absolutely positioned BELOW the badge, out of
   the layout flow. The caller adds bottom clearance for the hanging pair. */
function ScoreStepper({
    value,
    color,
    disabled,
    onDec,
    onInc,
}: {
    value: number
    color: string
    disabled?: boolean
    onDec: () => void
    onInc: () => void
}) {
    return (
        <Box position="relative" display="inline-flex">
            <ScoreBadge value={value} color={color} />
            <HStack
                gap="1.5"
                position="absolute"
                top="calc(100% + 6px)"
                left="50%"
                transform="translateX(-50%)"
            >
                <IconButton
                    aria-label="Smanji rezultat"
                    variant="outline"
                    rounded="full"
                    size="sm"
                    bg="bg.panel"
                    disabled={value <= 0 || disabled}
                    onClick={onDec}
                >
                    <FiMinus />
                </IconButton>
                <IconButton
                    aria-label="Povećaj rezultat"
                    variant="outline"
                    rounded="full"
                    size="sm"
                    bg="bg.panel"
                    disabled={disabled}
                    onClick={onInc}
                >
                    <FiPlus />
                </IconButton>
            </HStack>
        </Box>
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   PairingEntry - the handoff's "1 · ODABERI IGRAČA" + "2 · ODABERI RADNJU"
   entry model: pick a player and an action in EITHER order; the event commits
   the instant both are set and the selection clears. Records through the
   offline queue (onAddEvent). Per-team fouls sit in each column (offline hook).
   ────────────────────────────────────────────────────────────────────────── */
type ClockArgs = {
    liveStartedAt: string | null | undefined
    firstHalfEndedAt?: string | null
    secondHalfStartedAt: string | null | undefined
    livePausedAt?: string | null
    halfLengthMin: number | null
    halfCount: number | null
}
/** A picked player: a real roster entry, or the leading "Nepoznati igrač". */
type PendingPlayer = { team: number; playerId: number | null; playerName: string | null }

const ACTIONS: { type: MatchEventType; label: string }[] = [
    { type: "GOAL", label: "Gol" },
    { type: "OWN_GOAL", label: "Auto-gol" },
    { type: "YELLOW_CARD", label: "Žuti" },
    { type: "RED_CARD", label: "Crveni" },
]

function actionLabel(type: MatchEventType): string {
    return ACTIONS.find((a) => a.type === type)?.label ?? "Radnja"
}

function PairingEntry({
    uuid,
    matchId,
    team1Id,
    team1Name,
    team2Id,
    team2Name,
    isTimer,
    clockArgs,
    half,
    serverFouls,
    onAddEvent,
    sentOffPlayerIds,
    yellowCardedPlayerIds,
    penaltyInProgress,
}: {
    uuid: string
    matchId: number
    team1Id: number | null
    team1Name: string | null
    team2Id: number | null
    team2Name: string | null
    isTimer: boolean
    clockArgs: ClockArgs
    half: 1 | 2
    serverFouls: { fouls1First: number; fouls1Second: number; fouls2First: number; fouls2Second: number }
    onAddEvent: (payload: CreateMatchEventRequest, display: OptimisticDisplay) => void
    sentOffPlayerIds: Set<number>
    yellowCardedPlayerIds: Set<number>
    /** True once a penalty shootout has kicks recorded on this match. Regulation
     *  goal actions (Gol / Auto-gol) are then blocked so they can't leak into
     *  the scorer stats; cards + fouls stay available. */
    penaltyInProgress: boolean
}) {
    const [rosters, setRosters] = useState<Record<number, PlayerDto[]>>({})
    const [pendingPlayer, setPendingPlayer] = useState<PendingPlayer | null>(null)
    const [pendingAction, setPendingAction] = useState<MatchEventType | null>(null)
    const [minute, setMinute] = useState<string>("0")
    // While true (TIMER) the "Min" field auto-follows the running clock; a
    // manual edit turns it off, "Sada" / "Prati mjerač" turn it back on.
    const [autoMinute, setAutoMinute] = useState(true)

    // Fouls - offline-first, one hook instance for the whole match.
    const { fouls, bump } = useOfflineMatchFouls(uuid, matchId, serverFouls)
    const foulsHome = half === 1 ? fouls.fouls1First : fouls.fouls1Second
    const foulsAway = half === 1 ? fouls.fouls2First : fouls.fouls2Second

    // Kit colours (shared cached fetch) → a chip next to each roster header.
    const rosterColors = useTeamColors(uuid)

    // Load both rosters once.
    useEffect(() => {
        let cancelled = false
        async function load(teamId: number | null) {
            if (teamId == null) return
            try {
                const players = await fetchPlayers(uuid, teamId)
                if (!cancelled) setRosters((prev) => ({ ...prev, [teamId]: players }))
            } catch {
                /* error toast surfaced by the http interceptor */
            }
        }
        void load(team1Id)
        void load(team2Id)
        return () => { cancelled = true }
    }, [uuid, team1Id, team2Id])

    // Auto-follow the live match minute (TIMER) until the organizer types a
    // manual value; "Sada" / "Prati mjerač" resume it (autoMinute is a dep, so
    // flipping it back to true re-runs this and re-syncs on the spot).
    useEffect(() => {
        if (!isTimer || !autoMinute) return
        const sync = () => setMinute(String(liveMatchMinute(clockArgs)))
        sync()
        const id = setInterval(sync, 1000)
        return () => clearInterval(id)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        isTimer, autoMinute,
        clockArgs.liveStartedAt, clockArgs.firstHalfEndedAt, clockArgs.secondHalfStartedAt,
        clockArgs.livePausedAt, clockArgs.halfLengthMin, clockArgs.halfCount,
    ])

    const minuteNum = parseInt(minute, 10)
    const minuteValid = Number.isFinite(minuteNum) && minuteNum >= 0

    // Big −/+ steppers around the minute input. A manual bump turns OFF the
    // auto-follow (same as typing), and stays within the input's own validation
    // (minute >= 0; there's no upper bound in the current logic, so + is open).
    function bumpMinute(delta: number) {
        const cur = Number.isFinite(minuteNum) ? minuteNum : 0
        setMinute(String(Math.max(0, cur + delta)))
        setAutoMinute(false)
    }

    /** Beneficiary side for an event committed by `committingTeam`: that team,
     *  except an own goal counts for (shows on) the OTHER side. */
    function sideFor(committingTeam: number, type: MatchEventType): number {
        if (type !== "OWN_GOAL") return committingTeam
        if (team1Id == null || team2Id == null) return committingTeam
        return committingTeam === team1Id ? team2Id : team1Id
    }

    // Gol / Auto-gol are the only regulation goal actions; they're locked while
    // a penalty shootout is being recorded (see penaltyInProgress).
    const isGoalAction = (type: MatchEventType) => type === "GOAL" || type === "OWN_GOAL"

    function commit(pp: PendingPlayer, type: MatchEventType) {
        if (!minuteValid) return
        // Penali su u tijeku - regulation goals can't be entered here.
        if (penaltyInProgress && isGoalAction(type)) return
        // A sent-off player can't affect play (named goals/cards).
        if (pp.playerId != null && sentOffPlayerIds.has(pp.playerId)) return
        const side = sideFor(pp.team, type)
        const payload: CreateMatchEventRequest =
            pp.playerId != null
                ? { type, playerId: pp.playerId, minute: minuteNum, assistPlayerId: null }
                : { type, playerId: null, teamId: pp.team, minute: minuteNum, assistPlayerId: null }
        onAddEvent(payload, {
            type,
            playerId: pp.playerId,
            playerName: pp.playerName,
            teamId: side,
            minute: minuteNum,
        })
        setPendingPlayer(null)
        setPendingAction(null)
    }

    function selectPlayer(pp: PendingPlayer) {
        if (pp.playerId != null && sentOffPlayerIds.has(pp.playerId)) return
        if (pendingAction) commit(pp, pendingAction)
        else setPendingPlayer(pp)
    }

    function selectAction(type: MatchEventType) {
        // Regulation goals are locked during a penalty shootout.
        if (penaltyInProgress && isGoalAction(type)) return
        if (pendingPlayer) commit(pendingPlayer, type)
        else setPendingAction(type)
    }

    function clearPending() {
        setPendingPlayer(null)
        setPendingAction(null)
    }

    const hint = !minuteValid
        ? "Unesi minutu."
        : pendingPlayer
            ? `Odabran: ${pendingPlayer.playerName ?? "Nepoznati igrač"} — odaberi radnju.`
            : pendingAction
                ? `Radnja: ${actionLabel(pendingAction)} — odaberi igrača.`
                : ""

    return (
        <Box borderWidth="1px" borderColor="border" rounded="2xl" p={{ base: "3", md: "4" }}>
            <Eyebrow>1 · Odaberi igrača</Eyebrow>
            <Box display="grid" gridTemplateColumns={{ base: "1fr", sm: "1fr 1fr" }} gap={{ base: "3", md: "5" }} mb="4">
                <RosterColumn
                    teamName={team1Name}
                    teamId={team1Id}
                    color={HOME}
                    jerseyColor={teamColor(rosterColors, team1Id)}
                    shortsColor={teamShorts(rosterColors, team1Id)}
                    players={team1Id != null ? rosters[team1Id] ?? [] : []}
                    foulsCount={foulsHome}
                    foulsFirst={fouls.fouls1First}
                    foulsSecond={fouls.fouls1Second}
                    currentHalf={half}
                    splitByHalf={isTimer}
                    onFoul={(d) => bump(1, half, d)}
                    pendingPlayer={pendingPlayer}
                    onSelect={selectPlayer}
                    sentOffPlayerIds={sentOffPlayerIds}
                    yellowCardedPlayerIds={yellowCardedPlayerIds}
                />
                <RosterColumn
                    teamName={team2Name}
                    teamId={team2Id}
                    color={AWAY}
                    jerseyColor={teamColor(rosterColors, team2Id)}
                    shortsColor={teamShorts(rosterColors, team2Id)}
                    players={team2Id != null ? rosters[team2Id] ?? [] : []}
                    foulsCount={foulsAway}
                    foulsFirst={fouls.fouls2First}
                    foulsSecond={fouls.fouls2Second}
                    currentHalf={half}
                    splitByHalf={isTimer}
                    onFoul={(d) => bump(2, half, d)}
                    pendingPlayer={pendingPlayer}
                    onSelect={selectPlayer}
                    sentOffPlayerIds={sentOffPlayerIds}
                    yellowCardedPlayerIds={yellowCardedPlayerIds}
                />
            </Box>

            {/* Minute sits BETWEEN the player and the action pick on purpose:
                the event commits the instant both are chosen, so a wrong
                auto-minute has to be correctable BEFORE the action tap. */}
            <Eyebrow>2 · Minuta</Eyebrow>
            {/* Everything in ONE row on phones too: tight gap, a narrow input
                and xs text buttons keep the full set (− n + Sada Prati) around
                250px, so it fits even a 320px-wide phone. The steppers stay at
                40px (md) - they're tapped constantly during a match, so they
                keep a proper touch target while the rest shrinks. */}
            <Flex align="center" gap={{ base: "1", md: "2.5" }} mb="4" wrap="wrap">
                <IconButton
                    aria-label="Manje minuta"
                    size={{ base: "md", md: "lg" }}
                    variant="outline"
                    rounded="full"
                    disabled={minuteNum <= 0}
                    onClick={() => bumpMinute(-1)}
                >
                    <FiMinus />
                </IconButton>
                <Input
                    type="number"
                    min={0}
                    w={{ base: "50px", md: "92px" }}
                    px={{ base: "1", md: "3" }}
                    size={{ base: "md", md: "lg" }}
                    textAlign="center"
                    fontWeight={800}
                    fontSize={{ base: "lg", md: "2xl" }}
                    fontFamily="mono"
                    value={minute}
                    onChange={(e) => { setMinute(e.target.value); setAutoMinute(false) }}
                />
                <IconButton
                    aria-label="Više minuta"
                    size={{ base: "md", md: "lg" }}
                    variant="outline"
                    rounded="full"
                    onClick={() => bumpMinute(1)}
                >
                    <FiPlus />
                </IconButton>
                {/* "Sada" = ONE-SHOT stamp of the current clock minute; the
                    field stays manual afterwards. Resuming continuous
                    auto-follow is the separate "Prati mjerač" button below,
                    so the two controls no longer do the same thing. */}
                {isTimer && (
                    <Button
                        size={{ base: "sm", md: "md" }}
                        px={{ base: "2.5", md: "4" }}
                        variant="outline"
                        colorPalette="brand"
                        onClick={() => {
                            setMinute(String(liveMatchMinute(clockArgs)))
                            setAutoMinute(false)
                        }}
                        title="Upiši trenutnu minutu mjerača (ostaje ručno)"
                    >
                        Sada
                    </Button>
                )}
                {/* While following manually, offer the way BACK to continuous
                    auto-follow; the auto state needs no extra label. */}
                {isTimer && !autoMinute && (
                    <Button
                        size="sm"
                        px={{ base: "2.5", md: "3" }}
                        gap={{ base: "1", md: "2" }}
                        variant="outline"
                        colorPalette="brand"
                        fontWeight={700}
                        onClick={() => { setMinute(String(liveMatchMinute(clockArgs))); setAutoMinute(true) }}
                        title="Nastavi pratiti mjerač - minuta se opet broji sama"
                    >
                        <LuTimer />
                        <Box as="span" display={{ base: "none", sm: "inline" }}>Prati mjerač</Box>
                        <Box as="span" display={{ base: "inline", sm: "none" }}>Prati</Box>
                    </Button>
                )}
            </Flex>

            <Eyebrow>3 · Odaberi radnju</Eyebrow>
            {penaltyInProgress && (
                <Box
                    rounded="lg"
                    px="3"
                    py="2"
                    mb="2.5"
                    css={{ background: tint(CARD_YELLOW, 12) }}
                >
                    <Text fontSize="xs" fontWeight={700} color="accent.amber" lineHeight="1.35">
                        Penali su u tijeku - golovi se unose u penal zapisu.
                    </Text>
                </Box>
            )}
            <Box display="grid" gridTemplateColumns="repeat(4, 1fr)" gap="2" mb="3.5">
                {ACTIONS.map((a) => (
                    <ActionButton
                        key={a.type}
                        type={a.type}
                        label={a.label}
                        selected={pendingAction === a.type}
                        disabled={penaltyInProgress && isGoalAction(a.type)}
                        onClick={() => selectAction(a.type)}
                    />
                ))}
            </Box>

            <Flex align="center" justify="space-between" gap="3" wrap="wrap">
                <Text fontSize="xs" fontWeight={700} color="fg.muted" flex="1" minW="180px">
                    {hint}
                </Text>
                <Button size="sm" variant="outline" colorPalette="gray" onClick={clearPending} disabled={!pendingPlayer && !pendingAction}>
                    Odustani
                </Button>
            </Flex>
        </Box>
    )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
    return (
        <Text fontSize="2xs" fontWeight={800} letterSpacing="wider" textTransform="uppercase" color="fg.muted" mb="2.5">
            {children}
        </Text>
    )
}

function RosterColumn({
    teamName,
    teamId,
    color,
    jerseyColor,
    shortsColor,
    players,
    foulsCount,
    foulsFirst,
    foulsSecond,
    currentHalf,
    splitByHalf,
    onFoul,
    pendingPlayer,
    onSelect,
    sentOffPlayerIds,
    yellowCardedPlayerIds,
}: {
    teamName: string | null
    teamId: number | null
    color: string
    /** The team's own kit colours (if set) - shown before the name. */
    jerseyColor?: string | null
    shortsColor?: string | null
    players: PlayerDto[]
    /** This team's fouls in the CURRENT half (the single-counter value). */
    foulsCount: number
    /** This team's fouls per half - drives the split view. */
    foulsFirst: number
    foulsSecond: number
    /** The current (editable) half. */
    currentHalf: 1 | 2
    /** Show the per-half split (TIMER + live); else the single counter. */
    splitByHalf: boolean
    onFoul: (delta: number) => void
    pendingPlayer: PendingPlayer | null
    onSelect: (pp: PendingPlayer) => void
    sentOffPlayerIds: Set<number>
    yellowCardedPlayerIds: Set<number>
}) {
    const isPending = (playerId: number | null) =>
        pendingPlayer != null && pendingPlayer.team === teamId && pendingPlayer.playerId === playerId
    const deveterci = Math.max(0, foulsCount - 4)

    return (
        <VStack
            align="stretch"
            gap="2.5"
            minW="0"
            borderWidth="1px"
            borderColor="border"
            borderTopWidth="5px"
            borderTopColor={jerseyColor ?? color}
            rounded="xl"
            p={{ base: "3", md: "4" }}
            bg="bg.panel"
        >
            <HStack gap="2.5" minW="0">
                {/* Always the kit silhouette: the team's own colours when set,
                    otherwise filled with the fixed home/away identity colour -
                    a colour-less team used to get a plain square/dot here,
                    which read as a different kind of marker next to a real
                    jersey on the other column. */}
                <KitSwatch jersey={jerseyColor ?? shortsColor ?? color} shorts={shortsColor} size={15} />
                <Text fontSize={{ base: "xl", md: "2xl" }} fontWeight={800} color="fg.ink" truncate minW="0">{teamName ?? "-"}</Text>
            </HStack>

            {/* Fouls block (cyan). While a TIMER match is live the accumulated
                fouls split by half: the current half is editable (+/-), the other
                is read-only/muted. Otherwise one combined counter that writes to
                the current half. The ≥5 warning colour is preserved either way. */}
            {splitByHalf ? (
                <VStack align="stretch" gap="1.5" rounded="lg" px="3" py="2" bg="pitch.subtle">
                    <Text fontSize="2xs" fontWeight={800} letterSpacing="wide" color="pitch.fg" textAlign="center">PREKRŠAJI</Text>
                    <HStack gap="2.5" justify="center">
                        <HalfFoulCounter label="1. pol." count={foulsFirst} active={currentHalf === 1} onFoul={onFoul} />
                        <Text fontSize="sm" fontWeight={800} color="fg.subtle" lineHeight="1">·</Text>
                        <HalfFoulCounter label="2. pol." count={foulsSecond} active={currentHalf === 2} onFoul={onFoul} />
                    </HStack>
                </VStack>
            ) : (
                <Flex align="center" justify="space-between" rounded="lg" px="3" py="1.5" bg="pitch.subtle">
                    <Text fontSize="2xs" fontWeight={800} letterSpacing="wide" color="pitch.fg">PREKRŠAJI</Text>
                    <HStack gap="2.5">
                        <IconButton aria-label="Manje prekršaja" size="2xs" variant="outline" disabled={foulsCount === 0} onClick={() => onFoul(-1)}>
                            <FiMinus />
                        </IconButton>
                        <Box textAlign="center" minW="18px" lineHeight="1">
                            <Text fontFamily="mono" fontSize="md" fontWeight={800} color={foulsCount >= 5 ? "accent.red" : "pitch.fg"} lineHeight="1">
                                {foulsCount}
                            </Text>
                            {deveterci > 0 && (
                                <Text fontSize="9px" fontWeight={800} color="accent.red" lineHeight="1.1">9m{deveterci > 1 ? `×${deveterci}` : ""}</Text>
                            )}
                        </Box>
                        <IconButton aria-label="Više prekršaja" size="2xs" variant="outline" onClick={() => onFoul(1)}>
                            <FiPlus />
                        </IconButton>
                    </HStack>
                </Flex>
            )}

            {/* Player list - "Nepoznati igrač" first, then the roster. */}
            <VStack align="stretch" gap="1.5">
                {teamId != null && (
                    <PlayerButton
                        selected={isPending(null)}
                        color={color}
                        badge="?"
                        name="Nepoznati igrač"
                        muted
                        onClick={() => onSelect({ team: teamId, playerId: null, playerName: null })}
                    />
                )}
                {players.map((p) => {
                    const sentOff = sentOffPlayerIds.has(p.id)
                    const hasYellow = !sentOff && yellowCardedPlayerIds.has(p.id)
                    return (
                        <PlayerButton
                            key={p.id}
                            selected={isPending(p.id)}
                            color={color}
                            badge={p.number != null ? String(p.number) : "–"}
                            name={p.name}
                            marker={sentOff ? "🟥" : hasYellow ? "🟨" : undefined}
                            disabled={sentOff}
                            onClick={() => teamId != null && onSelect({ team: teamId, playerId: p.id, playerName: p.name })}
                        />
                    )
                })}
                {teamId != null && players.length === 0 && (
                    <Text fontSize="xs" color="fg.subtle">Nema igrača</Text>
                )}
            </VStack>
        </VStack>
    )
}

/* One team's per-half foul counter for the split (TIMER-live) view. The active
   (current) half carries the +/- controls and a subtle cyan tint; the other
   half is read-only and muted. The ≥5 (deveterci / 9m) warning is preserved. */
function HalfFoulCounter({
    label,
    count,
    active,
    onFoul,
}: {
    label: string
    count: number
    active: boolean
    onFoul: (delta: number) => void
}) {
    const deveterci = Math.max(0, count - 4)
    return (
        <HStack
            gap="1.5"
            rounded="md"
            px={active ? "2" : "1.5"}
            py="1"
            css={active ? { background: tint(PITCH, 20) } : undefined}
        >
            <Text
                fontSize="2xs"
                fontWeight={800}
                letterSpacing="wide"
                color={active ? "pitch.fg" : "fg.muted"}
                whiteSpace="nowrap"
            >
                {label}
            </Text>
            {active && (
                <IconButton aria-label="Manje prekršaja" size="2xs" variant="outline" disabled={count === 0} onClick={() => onFoul(-1)}>
                    <FiMinus />
                </IconButton>
            )}
            <Box textAlign="center" minW="16px" lineHeight="1">
                <Text
                    fontFamily="mono"
                    fontSize="sm"
                    fontWeight={800}
                    color={count >= 5 ? "accent.red" : active ? "pitch.fg" : "fg.muted"}
                    lineHeight="1"
                >
                    {count}
                </Text>
                {deveterci > 0 && (
                    <Text fontSize="9px" fontWeight={800} color="accent.red" lineHeight="1.1">9m{deveterci > 1 ? `×${deveterci}` : ""}</Text>
                )}
            </Box>
            {active && (
                <IconButton aria-label="Više prekršaja" size="2xs" variant="outline" onClick={() => onFoul(1)}>
                    <FiPlus />
                </IconButton>
            )}
        </HStack>
    )
}

function PlayerButton({
    selected,
    color,
    badge,
    name,
    marker,
    muted,
    disabled,
    onClick,
}: {
    selected: boolean
    color: string
    badge: string
    name: string
    marker?: string
    muted?: boolean
    disabled?: boolean
    onClick: () => void
}) {
    return (
        <chakra.button
            type="button"
            display="flex"
            alignItems="center"
            gap="2.5"
            w="full"
            textAlign="left"
            rounded="lg"
            px="2.5"
            py="2"
            borderWidth={selected ? "2px" : "1px"}
            borderColor={selected ? GOAL_GREEN : "border"}
            bg={selected ? tint(GOAL_GREEN, 12) : "bg.panel"}
            opacity={disabled ? 0.5 : 1}
            cursor={disabled ? "not-allowed" : "pointer"}
            _hover={disabled ? undefined : { borderColor: selected ? GOAL_GREEN : "border.emphasized" }}
            transition="border-color 0.12s, background 0.12s"
            onClick={disabled ? undefined : onClick}
        >
            <Box
                as="span"
                w="24px"
                h="24px"
                rounded="md"
                flexShrink={0}
                display="flex"
                alignItems="center"
                justifyContent="center"
                fontSize="2xs"
                fontWeight={800}
                css={{ background: tint(color, 14), color }}
            >
                {badge}
            </Box>
            <Text fontSize="sm" fontWeight={700} color={muted ? "fg.muted" : "fg.ink"} flex="1" truncate>
                {name}
            </Text>
            {marker && <Text as="span" fontSize="xs">{marker}</Text>}
            {selected && <Text as="span" color={GOAL_GREEN} fontWeight={800}>✓</Text>}
        </chakra.button>
    )
}

function ActionButton({
    type,
    label,
    selected,
    disabled,
    onClick,
}: {
    type: MatchEventType
    label: string
    selected: boolean
    disabled?: boolean
    onClick: () => void
}) {
    const accent =
        type === "GOAL" ? GOAL_GREEN
            : type === "OWN_GOAL" ? HOME
                : type === "YELLOW_CARD" ? CARD_YELLOW
                    : CARD_RED
    const icon =
        type === "GOAL" ? <Text as="span" fontSize="xl" lineHeight="1">⚽</Text>
            : type === "OWN_GOAL" ? (
                // Same ball as the timeline's autogol icon, in red.
                <Box as="span" display="inline-flex" lineHeight="1" color="red.solid"><GiSoccerBall size={22} /></Box>
            ) : (
                <Box as="span" w="15px" h="19px" rounded="sm" bg={type === "YELLOW_CARD" ? CARD_YELLOW : CARD_RED} />
            )
    return (
        <chakra.button
            type="button"
            display="flex"
            flexDirection="column"
            alignItems="center"
            gap="1"
            rounded="xl"
            px="1.5"
            py="3"
            borderWidth={selected ? "2px" : "1px"}
            borderColor={selected ? accent : "border"}
            bg={selected ? tint(accent, 12) : "bg.panel"}
            opacity={disabled ? 0.4 : 1}
            cursor={disabled ? "not-allowed" : "pointer"}
            _hover={disabled ? undefined : { borderColor: accent }}
            transition="border-color 0.12s, background 0.12s"
            disabled={disabled}
            onClick={disabled ? undefined : onClick}
        >
            <Box display="flex" alignItems="center" justifyContent="center" minH="20px">{icon}</Box>
            <Text fontSize="xs" fontWeight={800} color="fg.ink">{label}</Text>
        </chakra.button>
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   CenterTimeline - the shared "TIJEK UTAKMICE": a vertical dashed centre line
   with home events on the left (player · min' · icon), away on the right
   (icon · min' · player), a running-score pill for goals / a dot for cards,
   half separators, and a per-row undo ✕.
   ────────────────────────────────────────────────────────────────────────── */
type TimelineRow =
    /** `half`: which half this separator opens - null when no half boundary is
     *  known, i.e. the single header covers the whole match (combined tally). */
    | { kind: "half"; label: string; half: 1 | 2 | null }
    | {
          kind: "event"
          id: number
          clientEventId?: string | null
          isHome: boolean
          type: MatchEventType
          player: string
          min: number
          center: { score: [number, number] } | { dot: true }
          ev: MatchEventDto
      }

function CenterTimeline({
    events,
    team1Id,
    halfLengthMin,
    canDelete,
    onUndo,
    fouls,
}: {
    events: MatchEventDto[]
    team1Id: number | null
    halfLengthMin: number | null
    canDelete: boolean
    onUndo: (ev: MatchEventDto) => void
    /** Accumulated per-half team fouls - a tally on each half separator. Fouls
     *  are counters, so they never become rows on the timeline. */
    fouls?: TimelineFouls | null
}) {
    const hasHalves = halfLengthMin != null && halfLengthMin > 0
    const rows: TimelineRow[] = useMemo(() => {
        const sorted = [...events].sort((a, b) => a.minute - b.minute || a.id - b.id)
        const secondHalfMin = halfLengthMin != null && halfLengthMin > 0 ? halfLengthMin : null
        const out: TimelineRow[] = [
            { kind: "half", label: "1. poluvrijeme", half: secondHalfMin != null ? 1 : null },
        ]
        let h = 0
        let a = 0
        let sep2 = false
        for (const e of sorted) {
            if (secondHalfMin != null && !sep2 && e.minute > secondHalfMin) {
                out.push({ kind: "half", label: "2. poluvrijeme", half: 2 })
                sep2 = true
            }
            const isHome = e.teamId === team1Id
            const isGoal = e.type === "GOAL" || e.type === "OWN_GOAL"
            if (isGoal) { isHome ? (h += 1) : (a += 1) }
            out.push({
                kind: "event",
                id: e.id,
                clientEventId: e.clientEventId,
                isHome,
                type: e.type,
                player: playerLabel(e),
                min: e.minute,
                center: isGoal ? { score: [h, a] } : { dot: true },
                ev: e,
            })
        }
        return out
    }, [events, team1Id, halfLengthMin])

    // Accumulated foul tally for a half separator. `null` half = no boundary
    // known, so the single header carries both halves combined. A 0:0 half
    // gets no chip.
    const foulTally = (half: 1 | 2 | null): [number, number] | null => {
        if (!fouls) return null
        const a = half === 1 ? fouls.t1First : half === 2 ? fouls.t1Second : fouls.t1First + fouls.t1Second
        const b = half === 1 ? fouls.t2First : half === 2 ? fouls.t2Second : fouls.t2First + fouls.t2Second
        return a > 0 || b > 0 ? [a, b] : null
    }

    // The "2. poluvrijeme" separator only exists once an EVENT crosses the
    // boundary. If the second half has fouls but no goals/cards, append the
    // separator anyway so its tally isn't lost.
    const hasSecondHeader = rows.some((r) => r.kind === "half" && r.half === 2)
    const trailingFouls = hasHalves && !hasSecondHeader ? foulTally(2) : null

    return (
        <Box position="relative" py="2" w="full">
            {/* Continuous central line behind the rows - centred exactly on 50%
                (translateX) and layered under the rows, matching /uzivo → tijek. */}
            <Box position="absolute" top="3" bottom="3" left="50%" transform="translateX(-50%)" borderLeftWidth="2px" borderStyle="dashed" borderColor="border" zIndex={0} />
            <VStack position="relative" zIndex={1} align="stretch" gap="1">
                {rows.map((r, i) =>
                    r.kind === "half" ? (
                        <HalfPill key={`h-${i}`} label={r.label} fouls={foulTally(r.half)} />
                    ) : (
                        <TimelineEventRow key={r.clientEventId ?? r.id} row={r} canDelete={canDelete} onUndo={() => onUndo(r.ev)} />
                    ),
                )}
                {trailingFouls && <HalfPill label="2. poluvrijeme" fouls={trailingFouls} />}
            </VStack>
        </Box>
    )
}

/** A half separator on the console timeline: the rounded pill masking the
 *  dashed centre line, with the half's accumulated foul tally beside the
 *  label when there is one. */
function HalfPill({ label, fouls }: { label: string; fouls: [number, number] | null }) {
    return (
        <Flex justify="center" py="1">
            <HStack
                as="span"
                gap="2.5"
                align="center"
                bg="bg.panel"
                borderWidth="1px"
                borderColor="border"
                rounded="full"
                px="3"
                py="0.5"
            >
                <Text as="span" fontSize="xs" fontWeight={800} color="fg.muted">
                    {label}
                </Text>
                {fouls && <FoulChip a={fouls[0]} b={fouls[1]} />}
            </HStack>
        </Flex>
    )
}

function TimelineEventRow({ row, canDelete, onUndo }: { row: Extract<TimelineRow, { kind: "event" }>; canDelete: boolean; onUndo: () => void }) {
    const undoBtn = canDelete ? (
        <IconButton aria-label="Poništi događaj" size="2xs" variant="ghost" rounded="full" color="fg.subtle" onClick={onUndo} flexShrink={0}>
            <FiX size={12} />
        </IconButton>
    ) : (
        <Box w="5" flexShrink={0} />
    )
    // SofaScore-style centre: a running-score pill for goals, else an ink dot
    // (with a ring that breaks the dashed line). The centre column is a FIXED
    // width so every row's icon lines up the same distance from the line.
    const center = "score" in row.center
        ? (
            <Box
                as="span"
                px="1.5"
                py="0.5"
                rounded="sm"
                bg="blue.subtle"
                color="blue.fg"
                fontFamily="mono"
                fontSize="2xs"
                fontWeight={800}
                lineHeight="1.4"
                whiteSpace="nowrap"
            >
                {row.center.score[0]} - {row.center.score[1]}
            </Box>
        )
        : <Box boxSize="10px" rounded="full" bg="fg.ink" flexShrink={0} />
    const minEl = (
        <Text as="span" fontSize="xs" fontWeight="bold" color="fg.ink" fontVariantNumeric="tabular-nums" whiteSpace="nowrap" flexShrink={0}>
            {row.min}&apos;
        </Text>
    )
    // Name WRAPS (up to 3 lines) instead of truncating, so "Nepoznati
    // strijelac" and long player names are always fully visible.
    const nameEl = (
        <Text
            fontSize="xs"
            fontWeight={600}
            color={row.player === "Nepoznati strijelac" || row.player === "Nepoznati igrač" || row.player === "Autogol" ? "fg.muted" : "fg.ink"}
            fontStyle="italic"
            lineHeight="1.3"
            lineClamp={3}
            css={{ overflowWrap: "anywhere" }}
            textAlign={row.isHome ? "right" : "left"}
            flex="1"
            minW="0"
        >
            {row.player}
        </Text>
    )

    return (
        <Box display="grid" gridTemplateColumns="minmax(0,1fr) 3.5rem minmax(0,1fr)" alignItems="center">
            {row.isHome ? (
                <>
                    <Flex align="center" gap="1.5" minW="0" pr="1">
                        {undoBtn}
                        {nameEl}
                        {minEl}
                        <EventIcon type={row.type} />
                    </Flex>
                    <Flex justify="center" px="1">{center}</Flex>
                    <Box />
                </>
            ) : (
                <>
                    <Box />
                    <Flex justify="center" px="1">{center}</Flex>
                    <Flex align="center" gap="1.5" minW="0" pl="1">
                        <EventIcon type={row.type} />
                        {minEl}
                        {nameEl}
                        {undoBtn}
                    </Flex>
                </>
            )}
        </Box>
    )
}

function EventIcon({ type }: { type: MatchEventType }) {
    if (type === "GOAL") return <Text as="span" fontSize="sm" lineHeight="1.4" flexShrink={0}>⚽</Text>
    if (type === "OWN_GOAL")
        return (
            <Box as="span" display="inline-flex" lineHeight="1.4" flexShrink={0} color="red.solid">
                <GiSoccerBall size={13} />
            </Box>
        )
    if (type === "PENALTY_GOAL") return <Text as="span" fontSize="xs" fontWeight={800} color="accent.goal" flexShrink={0}>✓</Text>
    if (type === "PENALTY_MISSED") return <Text as="span" fontSize="xs" fontWeight={800} color="accent.red" flexShrink={0}>✗</Text>
    return <Box as="span" w="13px" h="16px" rounded="sm" flexShrink={0} bg={type === "YELLOW_CARD" ? CARD_YELLOW : CARD_RED} />
}

function playerLabel(e: MatchEventDto): string {
    if (e.type === "OWN_GOAL") return e.playerName != null ? `${e.playerName} (ag)` : "Autogol"
    if (e.playerName != null) return e.playerName
    if (e.type === "GOAL" || e.type === "PENALTY_GOAL") return "Nepoznati strijelac"
    if (e.type === "PENALTY_MISSED") return "Promašaj"
    return "Nepoznati igrač"
}
