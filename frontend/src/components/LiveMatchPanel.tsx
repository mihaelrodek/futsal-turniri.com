import { useEffect, useMemo, useRef, useState } from "react"
import { Box, Button, Flex, HStack, IconButton, Input, Text, VStack } from "@chakra-ui/react"
import { FiEdit2, FiEye, FiEyeOff, FiMinus, FiMoreHorizontal, FiPause, FiPlay, FiPlus, FiX } from "react-icons/fi"
import { GiSoccerBall, GiSoccerKick } from "react-icons/gi"
import { LuTimer, LuTimerOff } from "react-icons/lu"

import {
    endFirstHalf,
    finishMatch,
    pauseMatch,
    resetMatch,
    resumeMatch,
    setClockVisibility,
    setMatchBib,
    startMatch,
    startSecondHalf,
} from "../api/matchEvents"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { qk } from "../queryClient"
import { fetchTournamentDetails, setShowFoulsInTimeline } from "../api/tournaments"
import { recordKnockoutResult } from "../api/bracket"
import { recordGroupResult } from "../api/groups"
import { fetchSchedule } from "../api/schedule"
import { fetchPlayers } from "../api/players"
import { useTranslation } from "../i18n"
import type { Dictionary } from "../i18n/hr"
import type { CreateMatchEventRequest, MatchEventDto, MatchEventType, MatchLiveMode } from "../types/matchEvents"
import type { PlayerDto } from "../types/players"
import { useOfflineMatchEvents, type OptimisticDisplay } from "../hooks/useOfflineMatchEvents"
import { useOfflineMatchFouls } from "../hooks/useOfflineMatchFouls"
import { LiveSyncIndicator } from "./LiveSyncIndicator"
import { ConfirmDialog } from "../ui/primitives"
import { useTeamColors, teamColor, teamShorts, KitSwatch } from "./jersey"
import {
    ActionButton,
    DirectScoreEditor,
    PenaltyShootout,
    PlayerButton,
    clockState,
    HalfFoulSide,
    HalfPillDivider,
    eventHalf,
    secondYellowPairs,
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
const CARD_YELLOW = "#e8a01f"
const CARD_RED = "#c0392b"
/** SPECTO brand cyan - drives the active-half foul tint. */
const PITCH = "#2AD4C8"
/** Fluorescent training-bib ("markirka") yellow. A real-world kit colour, not a
 *  theme token - same hex as the backend so app, stream overlay and exports all
 *  show the identical shade. */
const BIB_YELLOW = "#D9F225"

/** The colour a side's kit reads as while it wears the markirka: the bib
 *  yellow replaces the jersey colour entirely, on every surface that shows one
 *  colour per team. */
function effectiveJersey(
    jersey: string | null | undefined,
    side: 1 | 2,
    bibTeam: 1 | 2 | null,
): string | null {
    return bibTeam === side ? BIB_YELLOW : jersey ?? null
}
/** Readable ink on the bib yellow (it's far too bright for white text). */
const BIB_INK = "#25300A"
/** A translucent tint of a colour - works on any (light/dark) surface. */
const tint = (hex: string, pct: number) => `color-mix(in srgb, ${hex} ${pct}%, transparent)`

/** THE one place the bib override is applied: for the side wearing the bibs the
 *  effective dres colour is bib yellow for this match only (shorts unchanged);
 *  every other side keeps its own kit colour. */

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
    /** Which side wears the fluorescent training bibs ("markirka") in THIS
     *  match; null = neither. Backend stores one column, so it is structurally
     *  impossible for both sides to have them. */
    bibTeam?: 1 | 2 | null
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
    footerAction,
    streamActive = false,
    onClockArgs,
    onScore,
}: {
    uuid: string
    kind: "group" | "knockout"
    match: PanelMatch
    onChanged: () => Promise<void> | void
    /** The styled match-selector node (built by the host, which owns the list). */
    selector?: React.ReactNode
    /** Optional host action (e.g. "Puni zaslon") rendered with the lower
     *  stream/clock controls so the match selector can stay perfectly centred. */
    footerAction?: React.ReactNode
    /** True while THIS tournament is actually streaming right now (the home
     *  banner is STREAMING and linked to this tournament). Starting a match
     *  then only offers "Uživo - s mjeračem vremena" - a SIMPLE or result-
     *  only match would leave the stream overlay's clock unusable. */
    streamActive?: boolean
    /** Lifts THIS console's own clock truth up to a host (e.g. the fullscreen
     *  zapisnik header) so its clock ticks from the exact same instants and
     *  freezes together on pause. Called with the current local clockArgs while
     *  the match is LIVE + TIMER, and with null when it isn't (or on unmount). */
    /** Reports the LIVE (event-derived) score to a host header, so it moves the
     *  instant a goal is entered instead of on the next fixtures reload. */
    onScore?: (score1: number, score2: number) => void
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
    const t = useTranslation()
    const matchId = match.matchId
    const isKnockout = kind === "knockout"
    const isLive = match.status === "LIVE"
    const isFinished = match.status === "FINISHED"
    const isScheduled = !isLive && !isFinished
    const isTimer = match.liveMode === "TIMER"

    // Kit (dres + hlače) colours → a two-tone chip next to each team name.
    const teamColors = useTeamColors(uuid)

    // "Show fouls on the timeline" - stored on the TOURNAMENT, so the choice
    // holds for every match of it and survives being switched off and on (the
    // FOUL events are never deleted, only hidden).
    const foulsQueryClient = useQueryClient()
    const { data: tournamentForFouls } = useQuery({
        queryKey: qk.tournamentDetails(uuid),
        queryFn: () => fetchTournamentDetails(uuid),
        enabled: !!uuid,
        staleTime: 5 * 60_000,
    })
    const showFoulsOnTimeline = !!tournamentForFouls?.showFoulsInTimeline
    const [togglingFouls, setTogglingFouls] = useState(false)

    async function toggleFoulsOnTimeline() {
        if (togglingFouls) return
        try {
            setTogglingFouls(true)
            const updated = await setShowFoulsInTimeline(uuid, !showFoulsOnTimeline)
            // Patch then invalidate: every timeline in the app reads this same
            // query, so they all follow at once.
            foulsQueryClient.setQueryData(qk.tournamentDetails(uuid), updated)
            foulsQueryClient.invalidateQueries({ queryKey: qk.tournamentDetails(uuid) })
        } finally {
            setTogglingFouls(false)
        }
    }
    const jerseyC1 = teamColor(teamColors, match.team1Id)
    const jerseyC2 = teamColor(teamColors, match.team2Id)
    const shortsC1 = teamShorts(teamColors, match.team1Id)
    const shortsC2 = teamShorts(teamColors, match.team2Id)

    // Markirka (training bibs) - which side wears them in THIS match. Kept in
    // local state so the toggle flips instantly (same optimistic pattern as the
    // live instants below); the parent refetch then confirms it.
    const [bibTeam, setBibTeam] = useState<1 | 2 | null>(match.bibTeam ?? null)
    const [bibBusy, setBibBusy] = useState(false)
    useEffect(() => setBibTeam(match.bibTeam ?? null), [match.bibTeam])



    const effJerseyC1 = effectiveJersey(jerseyC1, 1, bibTeam)
    const effJerseyC2 = effectiveJersey(jerseyC2, 2, bibTeam)
    // Effective dres colours - derived ONCE here, used by every kit swatch.

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
    const [clockVisibilityBusy, setClockVisibilityBusy] = useState(false)
    const [clockVisibleOnStream, setClockVisibleOnStream] = useState(true)
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
    // A page refresh remounts this component with `shootout` back at its
    // default `false` - but `penaltyInProgress` (server data) can already be
    // true, e.g. the organizer reloaded mid-shootout. Without this, normal
    // goal entry stays correctly blocked (penaltyInProgress) but the
    // shootout recorder never reopens, stranding the organizer with no way
    // to record the next kick. Re-derive `shootout` the moment we know.
    useEffect(() => {
        if (isLive && penaltyInProgress) setShootout(true)
    }, [isLive, penaltyInProgress])
    // Show the event-derived score once events are loaded; otherwise the stored
    // score (avoids a result-only match flashing 0:0).
    const score =
        events && events.length > 0
            ? liveScore
            : { s1: match.score1 ?? 0, s2: match.score2 ?? 0 }

    // Lift the LIVE score to a host header. This score is derived from the
    // events (optimistically, before the server even answers), while the score
    // a host gets from the fixtures list only moves on the next reload - which
    // is why the zapisnik header sat on the old result until a page refresh.
    useEffect(() => {
        onScore?.(score.s1, score.s2)
    }, [onScore, score.s1, score.s2])

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
                ? t.components.liveMatch.phaseLabels.pause
                : phase === "FIRST_HALF" ? t.components.liveMatch.phaseLabels.firstHalf
                    : phase === "HALFTIME" ? t.components.liveMatch.phaseLabels.halftime
                        : phase === "SECOND_HALF" ? t.components.liveMatch.phaseLabels.secondHalf
                            : t.components.liveMatch.phaseLabels.fullTime

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
        const occurredAt = new Date().toISOString()
        try {
            await pauseMatch(uuid, matchId, occurredAt)
            setLivePausedAt(occurredAt)
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

    /** Move / clear the markirka. Exactly one side can wear it, so tapping the
     *  other side just sends that side (the backend's single column does the
     *  mutual exclusion); tapping the side that already has it clears to null.
     *  Deliberately NOT queued offline - it's cosmetic, not a scoring event. */
    async function handleBib(side: 1 | 2) {
        const prev = bibTeam
        const next = prev === side ? null : side
        setBibBusy(true)
        setBibTeam(next)
        try {
            await setMatchBib(uuid, matchId, next)
            await onChanged()
        } catch {
            setBibTeam(prev)
            /* error toast surfaced by the http interceptor */
        } finally {
            setBibBusy(false)
        }
    }

    async function toggleStreamClockVisibility() {
        const next = !clockVisibleOnStream
        setClockVisibilityBusy(true)
        setClockVisibleOnStream(next)
        try {
            await setClockVisibility(uuid, matchId, next)
        } catch {
            setClockVisibleOnStream(!next)
            /* error toast surfaced by the http interceptor */
        } finally {
            setClockVisibilityBusy(false)
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
        ? { label: t.components.liveMatchPanel.primaryAction.finishMatch, run: requestFinish, busy: finishing, phase: false }
        : canEndFirstHalf
            ? { label: t.components.liveMatchPanel.primaryAction.endFirstHalf, run: handleEndFirstHalf, busy: phaseBusy, phase: true }
            : canStartSecondHalf
                ? { label: t.components.liveMatchPanel.primaryAction.startSecondHalf, run: handleStartSecondHalf, busy: phaseBusy, phase: true }
                : { label: t.components.liveMatchPanel.primaryAction.finishMatch, run: requestFinish, busy: finishing, phase: false }

    // Current half for the fouls counters (2nd once it has started).
    const currentHalf: 1 | 2 = secondHalfStartedAt ? 2 : 1

    // Result-only editing is IN PLACE on the big pre-match scoreboard: the score
    // badges become +/- steppers and a "Spremi rezultat" button appears. Only in
    // the scheduled branch, and never while the penalty shootout handoff is up.
    const editingScore = isScheduled && showDirectScore && !shootout

    /**
     * The two "what everyone else sees" switches, with a line each saying what
     * they do. They sit ABOVE the match-ending action rather than up by the
     * clock: both are settings, not in-play controls, and an unlabelled eye
     * icon next to a running clock told nobody what it would change.
     *
     * The stream-clock one only appears where a stream clock exists (a live
     * TIMER match); the fouls one is a tournament-wide setting and always does.
     */
    const settingsRow = (showClockButton: boolean) => (
        // One row per switch: the button, then the sentence that says what it
        // changes. A shared min-width on the buttons keeps the two sentences
        // starting at the same x, so the pair reads as a list rather than as
        // two unrelated lines. The block is centred but its rows are not - a
        // centred sentence under a centred button gave no clue which one it
        // belonged to.
        <VStack align="stretch" gap="1.5">
            {showClockButton && (
                <HStack gap="2.5" align="center" w="full">
                    <Button
                        size="xs"
                        variant="outline"
                        minW="10.5rem"
                        justifyContent="flex-start"
                        flexShrink={0}
                        // Teal = the thing is currently ON. This used to be
                        // inverted (teal while the clock was HIDDEN), so the two
                        // switches in this block contradicted each other: one
                        // was teal for "visible", the other for "hidden".
                        colorPalette={clockVisibleOnStream ? "pitch" : "gray"}
                        loading={clockVisibilityBusy}
                        onClick={toggleStreamClockVisibility}
                    >
                        {clockVisibleOnStream ? <FiEyeOff /> : <FiEye />}
                        {clockVisibleOnStream ? t.components.liveMatchPanel.streamClock.hideAction : t.components.liveMatchPanel.streamClock.showAction}
                    </Button>
                    <Text fontSize="2xs" color="fg.muted" lineHeight="1.35">
                        {t.components.liveMatchPanel.streamClock.explainer}
                    </Text>
                </HStack>
            )}
            <HStack gap="2.5" align="center" w="full">
                <Button
                    size="xs"
                    variant="outline"
                    minW="10.5rem"
                    justifyContent="flex-start"
                    flexShrink={0}
                    colorPalette={showFoulsOnTimeline ? "pitch" : "gray"}
                    loading={togglingFouls}
                    onClick={toggleFoulsOnTimeline}
                >
                    {showFoulsOnTimeline ? <FiEyeOff /> : <FiEye />}
                    {showFoulsOnTimeline
                        ? t.components.liveMatchPanel.timelineFouls.hideAction
                        : t.components.liveMatchPanel.timelineFouls.showAction}
                </Button>
                <Text fontSize="2xs" color="fg.muted" lineHeight="1.35">
                    {t.components.liveMatchPanel.timelineFouls.explainer}
                </Text>
            </HStack>
        </VStack>
    )

    const actionRow = () => (
        <Flex justify="center" align="center" gap="2" wrap="wrap" mt="2">
            {footerAction}
        </Flex>
    )

    const eventEntry = (
        <PairingEntry
            uuid={uuid}
            matchId={matchId}
            team1Id={match.team1Id ?? null}
            team1Name={match.team1Name ?? null}
            team2Id={match.team2Id ?? null}
            team2Name={match.team2Name ?? null}
            bibTeam={bibTeam}
            onBib={handleBib}
            bibBusy={bibBusy}
            isTimer={isLive && isTimer}
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
            onFoulsSynced={refetchEvents}
        />
    )

    return (
        <VStack align="stretch" gap="0">
            {/* Main card. A stable minimum height (desktop) so switching matches
                or going pre-match↔live - both remount this panel by design - no
                longer makes the console box jump between the shorter pre-match
                layout and the taller live one. */}
            <Box bg="bg.panel" borderWidth="1px" borderColor="border" rounded="3xl" shadow="sm" px={{ base: "4", md: "6" }} pb={{ base: "4", md: "6" }} pt="3" minH={{ base: "auto", md: "440px" }} display="flex" flexDirection="column">
                {/* Match selector (built by the host). It stays centred on its
                    own row; auxiliary actions live lower in the console so they
                    cannot pull the dropdown off centre. */}
                <Flex justify="center" align="center">
                    {selector}
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
                                {!isFinished && (
                                    <BibToggle
                                        compact
                                        teamName={match.team1Name}
                                        active={bibTeam === 1}
                                        disabled={bibBusy || match.team1Id == null}
                                        onClick={() => handleBib(1)}
                                    />
                                )}
                                <KitSwatch jersey={effJerseyC1 ?? shortsC1 ?? HOME} shorts={shortsC1} size={13} />
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
                                <KitSwatch jersey={effJerseyC2 ?? shortsC2 ?? AWAY} shorts={shortsC2} size={13} />
                                {!isFinished && (
                                    <BibToggle
                                        compact
                                        teamName={match.team2Name}
                                        active={bibTeam === 2}
                                        disabled={bibBusy || match.team2Id == null}
                                        onClick={() => handleBib(2)}
                                    />
                                )}
                            </HStack>
                        </Box>

                        {/* Status line only for a FINISHED match - the scheduled
                            "još nije pokrenuta" note was redundant next to the
                            start buttons right below. */}
                        {isFinished && (
                            <Text textAlign="center" color="fg.muted" fontSize="sm" fontWeight={500} mb="4">
                                {t.components.liveMatchPanel.finishedNotice}
                            </Text>
                        )}

                        {/* SCHEDULED - how to record + result-only sub-mode. All
                            three start options sit on ONE row (wraps on narrow)
                            and share the same outlined shape, each with its own
                            icon: mjerač (⏱), bez mjerača (⏱✕), samo rezultat (✎).
                            The two "Uživo" starters hide while the result-only
                            form is open, leaving just its toggle. While THIS
                            tournament is actually streaming, only "s mjeračem
                            vremena" is offered at all - a SIMPLE or result-only
                            match never drives the stream overlay's clock. */}
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
                                                <LuTimer /> {t.components.liveMatch.start.timerOption}
                                            </Button>
                                            {!streamActive && (
                                                <Button
                                                    variant="outline"
                                                    fontWeight={700}
                                                    size="lg"
                                                    loading={starting}
                                                    onClick={() => handleStart("SIMPLE")}
                                                >
                                                    <LuTimerOff /> {t.components.liveMatch.start.simpleOption}
                                                </Button>
                                            )}
                                        </>
                                    )}
                                    {/* Result-only toggle - also cancels a pending
                                        shootout so closing the form never leaves the
                                        shootout panel orphaned. Not offered at all
                                        while streaming (see note above). */}
                                    {!streamActive && (
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
                                            <FiEdit2 /> {showDirectScore ? t.components.liveMatchPanel.cancelResultEntry : t.components.liveMatch.start.resultOnlyOption}
                                        </Button>
                                    )}
                                    {/* Save sits in the SAME row as Odustani while
                                        editing. Same contract (handleSaveDirectScore):
                                        a level knockout score hands off to penalties. */}
                                    {editingScore && !streamActive && (
                                        <Button
                                            size="lg"
                                            colorPalette="pitch"
                                            fontWeight={800}
                                            loading={savingScore}
                                            onClick={() => handleSaveDirectScore(directS1, directS2)}
                                        >
                                            <FiEdit2 /> {t.components.liveMatch.directScore.saveButton}
                                        </Button>
                                    )}
                                </HStack>

                                {streamActive && (
                                    <Text fontSize="xs" color="fg.muted" textAlign="center" mb="3">
                                        {t.components.liveMatchPanel.streamActiveNote}
                                    </Text>
                                )}

                                {/* Result-only panel. A level knockout score hands
                                    off to the penalty shootout RIGHT HERE - the
                                    live-branch shootout render is unreachable for
                                    a scheduled match, so without this the Spremi
                                    click would silently do nothing. */}
                                {!streamActive && showDirectScore && shootout && (
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

                        {footerAction && actionRow()}

                        {isFinished && (
                            <Box mt="4">
                                {eventEntry}
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
                                                    aria-label={paused ? t.components.liveMatch.resumeAction : t.components.liveMatch.pauseAction}
                                                    title={paused ? t.components.liveMatch.resumeAction : t.components.liveMatch.pauseAction}
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
                                {footerAction && actionRow()}
                            </VStack>
                        )}

                        {!isTimer && footerAction && actionRow()}

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
                                {eventEntry}

                                {/* Settings, between the entry card and the
                                    flow controls: they belong with "Završi
                                    utakmicu", not with the clock. Up by the
                                    clock they were the first thing on the
                                    screen, ahead of the scoreboard - and they
                                    are touched once a tournament, not once a
                                    goal. */}
                                {/* Settings LEFT, match-flow actions RIGHT, one
                                    row. Two things of different weight: the
                                    left column is set once a tournament, the
                                    right one ends the match. They wrap onto
                                    separate lines on a narrow screen. */}
                                <Flex
                                    mt="4"
                                    gap="4"
                                    align="center"
                                    justify="space-between"
                                    wrap="wrap"
                                >
                                <Box flex="1 1 20rem" minW="0">
                                    {settingsRow(isLive && isTimer)}
                                </Box>

                                {/* Flow controls: the primary phase button + ⋯ menu.
                                    A half transition (end 1st / start 2nd) is a
                                    brand-cyan action; "Završi utakmicu" keeps its
                                    distinct amber treatment. */}
                                <HStack gap="2.5" align="stretch" justify="flex-end" flexShrink={0}>
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
                                        aria-label={t.components.liveMatchPanel.moreOptionsAria}
                                        variant="outline"
                                        colorPalette="gray"
                                        size="md"
                                        onClick={() => setOverflow((v) => !v)}
                                    >
                                        <FiMoreHorizontal size={18} />
                                    </IconButton>
                                </HStack>
                                </Flex>
                                {overflow && (
                                    // Sized to its label and tucked under the ⋯
                                    // it belongs to. Full-width it read as the
                                    // screen's primary action, which is the one
                                    // thing a "wipe this match" button must not.
                                    <Flex justify="flex-end" mt="2">
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            colorPalette="red"
                                            loading={resetting}
                                            onClick={() => setConfirmResetOpen(true)}
                                        >
                                            {t.components.liveMatchPanel.revertToPrep}
                                        </Button>
                                    </Flex>
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
                            {t.components.liveMatch.timeline.heading}
                        </Text>
                        {!eventsLoaded && events.length === 0 ? (
                            <Text textAlign="center" fontSize="sm" color="fg.muted">{t.common.loading}</Text>
                        ) : events.length === 0 ? (
                            <Text textAlign="center" fontSize="sm" color="fg.muted" fontWeight={500}>
                                {isFinished ? t.components.liveMatchPanel.resultOnlyDoneNotice : t.components.liveMatchPanel.noEventsNotice}
                            </Text>
                        ) : (
                            <CenterTimeline
                                events={events}
                                team1Id={match.team1Id}
                                halfLengthMin={halfLengthMin}
                                showFouls={showFoulsOnTimeline}
                                canDelete
                                onUndo={async (ev) => {
                                    await deleteEvent(ev)
                                    // Deleting a FOUL also takes the accumulated
                                    // counter down on the server, and those
                                    // counters live on the `match` prop this
                                    // panel does not own - so ask the owner to
                                    // reload rather than doing the arithmetic
                                    // here, which is what produced a counter
                                    // that briefly showed the wrong number.
                                    if (ev.type === "FOUL") await onChanged()
                                }}
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
                            {t.components.liveMatchPanel.resetButton}
                        </Button>
                    </Flex>
                )}
            </Box>

            <ConfirmDialog
                open={confirmResetOpen}
                busy={resetting}
                danger
                title={t.components.liveMatchPanel.resetDialog.title}
                description={t.components.liveMatchPanel.resetDialog.description}
                confirmLabel={t.components.liveMatchPanel.resetDialog.confirm}
                onClose={() => setConfirmResetOpen(false)}
                onConfirm={async () => { await doReset(); setConfirmResetOpen(false) }}
            />

            <ConfirmDialog
                open={confirmFinishOpen}
                busy={finishing}
                title={t.components.liveMatchPanel.finishEarlyDialog.title}
                description={t.components.liveMatchPanel.finishEarlyDialog.description}
                confirmLabel={t.components.liveMatchPanel.finishEarlyDialog.confirm}
                onClose={() => setConfirmFinishOpen(false)}
                onConfirm={async () => { await handleFinish(); setConfirmFinishOpen(false) }}
            />
        </VStack>
    )
}

/* ── One side's markirka toggle. Active = filled with the real bib yellow (a
   kit colour, so a raw hex like the other kit hexes here) with dark ink on it;
   inactive stays a neutral outline built from semantic tokens, so both states
   read correctly in light and dark mode. `minH` keeps a real pitchside touch
   target on a phone even at the compact `xs` size. ─────────────────────────── */
function BibToggle({
    teamName,
    active,
    disabled,
    compact = false,
    onClick,
}: {
    teamName: string | null
    active: boolean
    disabled?: boolean
    /** Inside a team's own header the team name is right next to it, so the
     *  button says „Markirka" instead of repeating the name. */
    compact?: boolean
    onClick: () => void
}) {
    const t = useTranslation()
    const label = compact ? t.components.liveMatchPanel.bib.label : (teamName ?? "-")
    const aria = t.components.liveMatchPanel.bib.aria(teamName ?? "-")
    return (
        <Button
            size="xs"
            minH="32px"
            px="2.5"
            variant={active ? "solid" : "outline"}
            colorPalette="gray"
            fontWeight={700}
            aria-pressed={active}
            aria-label={aria}
            title={aria}
            disabled={disabled}
            bg={active ? BIB_YELLOW : undefined}
            color={active ? BIB_INK : "fg.muted"}
            borderColor={active ? BIB_YELLOW : "border"}
            _hover={active ? { bg: BIB_YELLOW, opacity: 0.9 } : undefined}
            onClick={onClick}
        >
            <Box as="span" maxW="120px" truncate>{label}</Box>
        </Button>
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
    const t = useTranslation()
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
                    aria-label={t.components.liveMatch.directScore.decreaseAria(t.components.liveMatchPanel.scoreNoun)}
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
                    aria-label={t.components.liveMatch.directScore.increaseAria(t.components.liveMatchPanel.scoreNoun)}
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

/** One tappable action of the pairing entry. `penalty: true` on a GOAL marks
 *  an in-game penalty goal - the event stays a regular GOAL (score + scorer
 *  stats) but carries the penalty flag for display and the stream overlay. */
type EntryAction = {
    type: MatchEventType
    penalty?: boolean
    label: string
    /** Shown INSTEAD of `label` below `md`. Only "Isključenje 2'" needs one -
     *  it is the one label that will not fit a fifth of a phone's width, and
     *  the clock icon above it already says what it is. */
    shortLabel?: string
}

function actionsFor(t: Dictionary): EntryAction[] {
    const a = t.components.liveMatchPanel.actions
    // In-game penalty (Gol/Promašaj as its own tile) was removed from this
    // grid - a penalty attempt during regular play is recorded as a plain
    // Gol; the shootout after a knockout draw is where PENALTY_GOAL/
    // PENALTY_MISSED actually live (see PenaltyShootout in liveMatch.tsx,
    // which reuses this same ActionButton tile style).
    return [
        { type: "GOAL", label: a.goal },
        { type: "OWN_GOAL", label: a.ownGoal },
        { type: "YELLOW_CARD", label: a.yellow },
        { type: "RED_CARD", label: a.red },
        { type: "EXCLUSION", label: a.exclusion, shortLabel: a.exclusionShort },
    ]
}

/** Identity of an action within `actionsFor` (type + penalty flag). */
function sameAction(a: EntryAction | null, b: EntryAction): boolean {
    return a != null && a.type === b.type && !!a.penalty === !!b.penalty
}

function PairingEntry({
    uuid,
    matchId,
    team1Id,
    team1Name,
    team2Id,
    team2Name,
    bibTeam,
    onBib,
    bibBusy,
    isTimer,
    clockArgs,
    half,
    serverFouls,
    onAddEvent,
    sentOffPlayerIds,
    yellowCardedPlayerIds,
    penaltyInProgress,
    onFoulsSynced,
}: {
    uuid: string
    matchId: number
    team1Id: number | null
    team1Name: string | null
    team2Id: number | null
    team2Name: string | null
    /** Which side wears the markirka (see `effectiveJersey`); null = neither. */
    bibTeam: 1 | 2 | null
    /** Flips the markirka to `side`, or clears it when it's already there. */
    onBib: (side: 1 | 2) => void
    bibBusy: boolean
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
    /** Reload the timeline after a foul reaches the server - a foul now also
     *  writes a FOUL row there, and the two are loaded separately. */
    onFoulsSynced?: () => void
}) {
    const t = useTranslation()
    const [rosters, setRosters] = useState<Record<number, PlayerDto[]>>({})
    const [pendingPlayer, setPendingPlayer] = useState<PendingPlayer | null>(null)
    const [pendingAction, setPendingAction] = useState<EntryAction | null>(null)
    const [minute, setMinute] = useState<string>("0")
    // While true (TIMER) the "Min" field auto-follows the running clock; a
    // manual edit turns it off, "Sada" / "Prati mjerač" turn it back on.
    const [autoMinute, setAutoMinute] = useState(true)

    // Keep the ref the fouls hook reads in step with the field above. A ref,
    // not a value, because the hook's flush runs from timers and would
    // otherwise close over a stale minute.
    useEffect(() => {
        const parsed = parseInt(minute, 10)
        minuteRef.current = Number.isFinite(parsed) ? Math.max(0, parsed) : null
    }, [minute])

    // Fouls - offline-first, one hook instance for the whole match.
    // The zapisnik's own minute field, read at flush time so each foul is
    // stamped with the minute shown on screen. The server can only derive a
    // minute from raw elapsed time, which keeps counting after a half's clock
    // has expired - that is how a foul entered at 20' ended up written as 93'.
    const minuteRef = useRef<number | null>(null)
    const { fouls, bump } = useOfflineMatchFouls(
        uuid, matchId, serverFouls, minuteRef, onFoulsSynced)
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

    // Goal-ish actions (Gol / Auto-gol / in-game penalties) are locked while a
    // penalty SHOOTOUT is being recorded (see penaltyInProgress) so they can't
    // leak into the scorer stats or be confused with shootout kicks.
    const isGoalAction = (a: EntryAction) =>
        a.type === "GOAL" || a.type === "OWN_GOAL" || a.type === "PENALTY_MISSED_LIVE"

    function commit(pp: PendingPlayer, action: EntryAction) {
        if (!minuteValid) return
        // Penali su u tijeku - regulation goals can't be entered here.
        if (penaltyInProgress && isGoalAction(action)) return
        // A sent-off player can't affect play (named goals/cards).
        if (pp.playerId != null && sentOffPlayerIds.has(pp.playerId)) return
        const side = sideFor(pp.team, action.type)
        const penalty = action.penalty || undefined
        const payload: CreateMatchEventRequest =
            pp.playerId != null
                ? { type: action.type, playerId: pp.playerId, minute: minuteNum, assistPlayerId: null, penalty }
                : { type: action.type, playerId: null, teamId: pp.team, minute: minuteNum, assistPlayerId: null, penalty }
        onAddEvent(payload, {
            type: action.type,
            playerId: pp.playerId,
            playerName: pp.playerName,
            teamId: side,
            minute: minuteNum,
            penalty: !!action.penalty,
        })
        setPendingPlayer(null)
        setPendingAction(null)
    }

    function selectPlayer(pp: PendingPlayer) {
        if (pp.playerId != null && sentOffPlayerIds.has(pp.playerId)) return
        if (pendingAction) commit(pp, pendingAction)
        else setPendingPlayer(pp)
    }

    function selectAction(action: EntryAction) {
        // Regulation goals are locked during a penalty shootout.
        if (penaltyInProgress && isGoalAction(action)) return
        if (pendingPlayer) commit(pendingPlayer, action)
        else setPendingAction(action)
    }

    function clearPending() {
        setPendingPlayer(null)
        setPendingAction(null)
    }

    const hint = !minuteValid
        ? t.components.liveMatch.goalEntry.minuteRequiredNote
        : pendingPlayer
            ? t.components.liveMatchPanel.pairingHint.playerSelected(
                pendingPlayer.playerName ?? t.components.liveMatch.eventRow.unknownPlayerFallback,
            )
            : pendingAction
                ? t.components.liveMatchPanel.pairingHint.actionSelected(pendingAction.label)
                : ""

    return (
        <Box borderWidth="1px" borderColor="border" rounded="2xl" p={{ base: "3", md: "4" }}>
            <Eyebrow>{t.components.liveMatchPanel.eyebrow.pickPlayer}</Eyebrow>
            <Box display="grid" gridTemplateColumns={{ base: "1fr", sm: "1fr 1fr" }} gap={{ base: "3", md: "5" }} mb="4">
                <RosterColumn
                    teamName={team1Name}
                    teamId={team1Id}
                    color={HOME}
                    jerseyColor={effectiveJersey(teamColor(rosterColors, team1Id), 1, bibTeam)}
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
                    bibControl={
                        <BibToggle
                            compact
                            teamName={team1Name}
                            active={bibTeam === 1}
                            disabled={bibBusy || team1Id == null}
                            onClick={() => onBib(1)}
                        />
                    }
                />
                <RosterColumn
                    teamName={team2Name}
                    teamId={team2Id}
                    color={AWAY}
                    jerseyColor={effectiveJersey(teamColor(rosterColors, team2Id), 2, bibTeam)}
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
                    bibControl={
                        <BibToggle
                            compact
                            teamName={team2Name}
                            active={bibTeam === 2}
                            disabled={bibBusy || team2Id == null}
                            onClick={() => onBib(2)}
                        />
                    }
                />
            </Box>

            {/* Minute sits BETWEEN the player and the action pick on purpose:
                the event commits the instant both are chosen, so a wrong
                auto-minute has to be correctable BEFORE the action tap. */}
            <Eyebrow>{t.components.liveMatchPanel.eyebrow.minute}</Eyebrow>
            {/* Everything in ONE row on phones too: tight gap, a narrow input
                and xs text buttons keep the full set (− n + Sada Prati) around
                250px, so it fits even a 320px-wide phone. The steppers stay at
                40px (md) - they're tapped constantly during a match, so they
                keep a proper touch target while the rest shrinks. */}
            <Flex align="center" gap={{ base: "1", md: "2.5" }} mb="4" wrap="wrap">
                <IconButton
                    aria-label={t.components.liveMatchPanel.minuteAdjust.decreaseAria}
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
                    aria-label={t.components.liveMatchPanel.minuteAdjust.increaseAria}
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
                        title={t.components.liveMatchPanel.nowButtonTitle}
                    >
                        {t.components.liveMatch.goalEntry.nowButton}
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
                        title={t.components.liveMatchPanel.followClock.title}
                    >
                        <LuTimer />
                        <Box as="span" display={{ base: "none", sm: "inline" }}>{t.components.liveMatchPanel.followClock.full}</Box>
                        <Box as="span" display={{ base: "inline", sm: "none" }}>{t.components.liveMatchPanel.followClock.short}</Box>
                    </Button>
                )}
            </Flex>

            <Eyebrow>{t.components.liveMatchPanel.eyebrow.pickAction}</Eyebrow>
            {penaltyInProgress && (
                <Box
                    rounded="lg"
                    px="3"
                    py="2"
                    mb="2.5"
                    css={{ background: tint(CARD_YELLOW, 12) }}
                >
                    <Text fontSize="xs" fontWeight={700} color="accent.amber" lineHeight="1.35">
                        {t.components.liveMatch.goalEntry.penaltiesInProgressNote}
                    </Text>
                </Box>
            )}
            {/* All 5 tiles on ONE row at every width. They used to be 4-across
                on mobile, which dropped "Isključenje 2'" onto a row of its own
                and made the block twice as tall as the thing it sits under. The
                tile itself goes compact below that breakpoint to pay for it. */}
            <Box display="grid" gridTemplateColumns="repeat(5, minmax(0, 1fr))" gap={{ base: "1", md: "2" }} mb="3.5">
                {actionsFor(t).map((a) => (
                    <ActionButton
                        key={`${a.type}${a.penalty ? "-pen" : ""}`}
                        type={a.type}
                        penalty={a.penalty}
                        label={a.label}
                        shortLabel={a.shortLabel}
                        selected={sameAction(pendingAction, a)}
                        disabled={penaltyInProgress && isGoalAction(a)}
                        onClick={() => selectAction(a)}
                    />
                ))}
            </Box>

            <Flex align="center" justify="space-between" gap="3" wrap="wrap">
                <Text fontSize="xs" fontWeight={700} color="fg.muted" flex="1" minW="180px">
                    {hint}
                </Text>
                <Button size="sm" variant="outline" colorPalette="gray" onClick={clearPending} disabled={!pendingPlayer && !pendingAction}>
                    {t.common.cancel}
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
    bibControl,
}: {
    /** Markirka toggle for THIS team, docked right in the header row next to
     *  the kit + name it actually describes. */
    bibControl?: React.ReactNode
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
    const t = useTranslation()
    const isPending = (playerId: number | null) =>
        pendingPlayer != null && pendingPlayer.team === teamId && pendingPlayer.playerId === playerId
    const deveterci = Math.max(0, foulsCount - 4)
    // Rows of the two-column roster grid: the "?" entry plus the roster, split
    // in half with the remainder in the FIRST column (11 → 6 + 5). Never 0 -
    // `repeat(0, auto)` is invalid and would collapse the grid.
    const rosterRows = Math.max(1, Math.ceil(((teamId != null ? 1 : 0) + players.length) / 2))

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
            {/* Header: kit + name on the left, markirka hard right.
                The name WRAPS to two lines instead of truncating - a club name
                is what the organizer identifies the column by, and half of one
                is worse than a second line. `minH` of two lines is reserved on
                BOTH columns so a short name next to a long one doesn't leave
                the two panels' fouls blocks sitting at different heights. */}
            <HStack gap="2.5" minW="0" align="flex-start" minH={{ base: "3.5rem", md: "4rem" }}>
                {/* Always the kit silhouette: the team's own colours when set,
                    otherwise filled with the fixed home/away identity colour -
                    a colour-less team used to get a plain square/dot here,
                    which read as a different kind of marker next to a real
                    jersey on the other column. */}
                <Box pt="0.5" flexShrink={0}>
                    <KitSwatch jersey={jerseyColor ?? shortsColor ?? color} shorts={shortsColor} size={15} />
                </Box>
                <Text
                    fontSize={{ base: "xl", md: "2xl" }}
                    fontWeight={800}
                    color="fg.ink"
                    lineHeight="1.15"
                    lineClamp={2}
                    flex="1"
                    minW="0"
                    css={{ overflowWrap: "anywhere" }}
                >
                    {teamName ?? "-"}
                </Text>
                {bibControl && <Box flexShrink={0}>{bibControl}</Box>}
            </HStack>

            {/* Fouls block (cyan). While a TIMER match is live the accumulated
                fouls split by half: the current half is editable (+/-), the other
                is read-only/muted. Otherwise one combined counter that writes to
                the current half. The ≥5 warning colour is preserved either way.

                The markirka toggle used to ride in this row; it now sits in the
                team header, where it labels the team rather than the fouls. */}
            <Flex gap="2" align="stretch" wrap="wrap">
            <Box flex="1 1 180px" minW="0">
            {splitByHalf ? (
                <VStack align="stretch" gap="1.5" rounded="lg" px="3" py="2" bg="pitch.subtle">
                    <Text fontSize="2xs" fontWeight={800} letterSpacing="wide" color="pitch.fg" textAlign="center">{t.components.liveMatch.foulControls.accumulatedLabel.toUpperCase()}</Text>
                    {/* The two halves are separate tallies (fouls reset at the
                        break), so they get a real divider instead of the middle
                        dot that read as "1 · 6" - one number with a separator. */}
                    <HStack gap="0" justify="center" align="stretch">
                        <Box flex="1" display="flex" justifyContent="center" pr="3">
                            <HalfFoulCounter label={t.components.liveMatch.clockLabels.firstHalf} count={foulsFirst} active={currentHalf === 1} onFoul={onFoul} />
                        </Box>
                        <Box w="1px" bg="pitch.fg" opacity={0.25} flexShrink={0} />
                        <Box flex="1" display="flex" justifyContent="center" pl="3">
                            <HalfFoulCounter label={t.components.liveMatch.clockLabels.secondHalf} count={foulsSecond} active={currentHalf === 2} onFoul={onFoul} />
                        </Box>
                    </HStack>
                </VStack>
            ) : (
                <Flex align="center" justify="space-between" rounded="lg" px="3" py="1.5" bg="pitch.subtle">
                    <Text fontSize="2xs" fontWeight={800} letterSpacing="wide" color="pitch.fg">{t.components.liveMatch.foulControls.accumulatedLabel.toUpperCase()}</Text>
                    <HStack gap="2.5">
                        <IconButton aria-label={t.components.liveMatchPanel.foulAdjust.decreaseAria} size="2xs" variant="outline" disabled={foulsCount === 0} onClick={() => onFoul(-1)}>
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
                        <IconButton aria-label={t.components.liveMatchPanel.foulAdjust.increaseAria} size="2xs" variant="outline" onClick={() => onFoul(1)}>
                            <FiPlus />
                        </IconButton>
                    </HStack>
                </Flex>
            )}
            </Box>
            </Flex>

            {/* Player list - "Nepoznati igrač" first, then the roster.
                ONE per row on a phone: two columns there left each name about
                40% of the screen, so anything longer than a first name was cut
                to an ellipsis - and the roster is the one place the organizer
                has to read a full name to tap the right player.

                From `md` up it goes back to TWO columns filled top-down (11
                entries land 6 + 5). Column-first flow (`grid-auto-flow: column`
                over a fixed row count) does that split in CSS, so the roster
                array is never sliced and the reading order stays "down the
                first column, then the second". */}
            <Box
                display="grid"
                gridTemplateColumns={{ base: "1fr", md: "1fr 1fr" }}
                gridAutoFlow={{ base: "row", md: "column" }}
                gridTemplateRows={{ base: "auto", md: `repeat(${rosterRows}, auto)` }}
                gap="1.5"
                alignContent="start"
            >
                {teamId != null && (
                    <PlayerButton
                        selected={isPending(null)}
                        color={color}
                        badge="?"
                        name={t.components.liveMatch.eventRow.unknownPlayerFallback}
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
            </Box>
            {teamId != null && players.length === 0 && (
                <Text fontSize="xs" color="fg.subtle">{t.components.liveMatch.playerPick.noPlayers}</Text>
            )}
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
    const t = useTranslation()
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
                <IconButton aria-label={t.components.liveMatchPanel.foulAdjust.decreaseAria} size="2xs" variant="outline" disabled={count === 0} onClick={() => onFoul(-1)}>
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
                <IconButton aria-label={t.components.liveMatchPanel.foulAdjust.increaseAria} size="2xs" variant="outline" onClick={() => onFoul(1)}>
                    <FiPlus />
                </IconButton>
            )}
        </HStack>
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
    /** A plain section header with no fouls tally - used for "PENALI" below
     *  the halves, since a shootout kick isn't part of either half. */
    | { kind: "section"; label: string }
    | {
          kind: "event"
          /** This RED came from a second yellow - the row draws both cards. */
          secondYellow?: boolean
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
    showFouls = false,
}: {
    events: MatchEventDto[]
    team1Id: number | null
    halfLengthMin: number | null
    canDelete: boolean
    onUndo: (ev: MatchEventDto) => void | Promise<void>
    /** Accumulated per-half team fouls - a tally on each half separator. */
    fouls?: TimelineFouls | null
    /** Also put each foul on the timeline as its own row. Opt-in per
     *  tournament (Tournaments#showFoulsInTimeline) - off, the fouls stay a
     *  tally on the half separator and nothing else. */
    showFouls?: boolean
}) {
    const t = useTranslation()
    const hasHalves = halfLengthMin != null && halfLengthMin > 0

    // Which accumulated foul each FOUL row was, per team and per half - the
    // running number is the point of putting fouls on a timeline at all.
    // Counted by id (entry order), not by minute: a foul typed in late still
    // happened after the ones before it.
    const foulOrdinals = useMemo(() => {
        const out = new Map<number, number>()
        if (!showFouls) return out
        const running = new Map<string, number>()
        for (const e of events.filter((x) => x.type === "FOUL").sort((a, b) => a.id - b.id)) {
            const half = eventHalf(e, halfLengthMin)
            const key = `${e.teamId}:${half}`
            const next = (running.get(key) ?? 0) + 1
            running.set(key, next)
            out.set(e.id, next)
        }
        return out
    }, [events, halfLengthMin, showFouls])

    const rows: TimelineRow[] = useMemo(() => {
        // Shootout kicks aren't part of either half - split them into their
        // own "PENALI" section at the end, same as the public match ticker
        // (StreamHero.tsx's REGULATION/pens split).
        // A second yellow is stored as yellow + auto-red; on the timeline it is
        // ONE incident, so the yellow is dropped and the red carries both cards.
        const { hiddenYellowIds, secondYellowRedIds } = secondYellowPairs(events)
        const regulation = events.filter((e) =>
            e.type !== "PENALTY_GOAL" && e.type !== "PENALTY_MISSED"
            && !hiddenYellowIds.has(e.id)
            && (showFouls || e.type !== "FOUL"))
        const pens = events.filter((e) => e.type === "PENALTY_GOAL" || e.type === "PENALTY_MISSED")

        // Ordered by HALF first: a foul recorded in the 1st half must not sort
        // into the 2nd just because its minute equals the half length.
        const sorted = [...regulation].sort((a, b) =>
            eventHalf(a, halfLengthMin) - eventHalf(b, halfLengthMin)
            || a.minute - b.minute
            || a.id - b.id)
        const secondHalfMin = halfLengthMin != null && halfLengthMin > 0 ? halfLengthMin : null
        const out: TimelineRow[] = [
            { kind: "half", label: t.components.liveMatch.timeline.firstHalfTitle, half: secondHalfMin != null ? 1 : null },
        ]
        let h = 0
        let a = 0
        let sep2 = false
        for (const e of sorted) {
            if (secondHalfMin != null && !sep2 && eventHalf(e, halfLengthMin) === 2) {
                out.push({ kind: "half", label: t.components.liveMatch.timeline.secondHalfTitle, half: 2 })
                sep2 = true
            }
            const isHome = e.teamId === team1Id
            const isGoal = e.type === "GOAL" || e.type === "OWN_GOAL"
            if (isGoal) { isHome ? (h += 1) : (a += 1) }
            out.push({
                kind: "event",
                secondYellow: secondYellowRedIds.has(e.id),
                id: e.id,
                clientEventId: e.clientEventId,
                isHome,
                type: e.type,
                player: playerLabel(e, t),
                min: e.minute,
                center: isGoal ? { score: [h, a] } : { dot: true },
                ev: e,
            })
        }

        if (pens.length > 0) {
            out.push({ kind: "section", label: t.components.streamHero.penaltiesSection })
            for (const e of [...pens].sort((x, y) => x.id - y.id)) {
                out.push({
                    kind: "event",
                    id: e.id,
                    clientEventId: e.clientEventId,
                    isHome: e.teamId === team1Id,
                    type: e.type,
                    player: playerLabel(e, t),
                    min: e.minute,
                    center: { dot: true },
                    ev: e,
                })
            }
        }
        return out
    }, [events, team1Id, halfLengthMin, showFouls, t])

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
                    ) : r.kind === "section" ? (
                        <HalfPill key={`s-${i}`} label={r.label} fouls={null} />
                    ) : (
                        <TimelineEventRow key={r.clientEventId ?? r.id} row={r} canDelete={canDelete} foulOrdinal={foulOrdinals.get(r.ev.id)} onUndo={() => onUndo(r.ev)} />
                    ),
                )}
                {trailingFouls && <HalfPill label={t.components.liveMatch.timeline.secondHalfTitle} fouls={trailingFouls} />}
            </VStack>
        </Box>
    )
}

/** A half separator on the console timeline: the rounded pill masking the
 *  dashed centre line, with the half's accumulated foul tally beside the
 *  label when there is one. */
function HalfPill({ label, fouls }: { label: string; fouls: [number, number] | null }) {
    // Label dead-centre on the timeline's spine, each team's foul count on ITS
    // OWN side. The old single "PREKRŠAJI 3 : 0" chip sat inside the pill and
    // pushed the label off centre, and left the reader to work out which side
    // of the colon belonged to which team.
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
                {fouls && <><HalfFoulSide count={fouls[0]} align="right" /><HalfPillDivider /></>}
                <Text as="span" fontSize="xs" fontWeight={800} color="fg.muted" whiteSpace="nowrap">
                    {label}
                </Text>
                {fouls && <><HalfPillDivider /><HalfFoulSide count={fouls[1]} align="left" /></>}
            </HStack>
        </Flex>
    )
}

function TimelineEventRow({ row, canDelete, foulOrdinal, onUndo }: { row: Extract<TimelineRow, { kind: "event" }>; canDelete: boolean; foulOrdinal?: number; onUndo: () => void }) {
    const t = useTranslation()
    const undoBtn = canDelete ? (
        <IconButton aria-label={t.components.liveMatch.eventRow.removeAria} size="2xs" variant="ghost" rounded="full" color="fg.subtle" onClick={onUndo} flexShrink={0}>
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
            color={
                row.player === t.components.liveMatchPanel.scorerFallback.unknownScorer
                    || row.player === t.components.liveMatch.eventRow.unknownPlayerFallback
                    || row.player === t.components.liveMatchPanel.scorerFallback.ownGoal
                    ? "fg.muted" : "fg.ink"
            }
            fontStyle="italic"
            lineHeight="1.3"
            lineClamp={3}
            css={{ overflowWrap: "anywhere" }}
            textAlign={row.isHome ? "right" : "left"}
            flex="1"
            minW="0"
        >
            {/* A foul belongs to the TEAM, so the row says which accumulated
                foul it was ("3. prekršaj") instead of naming a player - nobody
                enters who committed one. */}
            {row.type === "FOUL"
                ? t.components.liveMatch.eventRow.foulLabel(foulOrdinal ?? 0)
                : row.player}
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
                        {row.secondYellow ? <SecondYellowIcon /> : <EventIcon type={row.type} />}
                    </Flex>
                    <Flex justify="center" px="1">{center}</Flex>
                    <Box />
                </>
            ) : (
                <>
                    <Box />
                    <Flex justify="center" px="1">{center}</Flex>
                    <Flex align="center" gap="1.5" minW="0" pl="1">
                        {row.secondYellow ? <SecondYellowIcon /> : <EventIcon type={row.type} />}
                        {minEl}
                        {nameEl}
                        {undoBtn}
                    </Flex>
                </>
            )}
        </Box>
    )
}

/** Both cards, for a red that came from a second yellow. */
function SecondYellowIcon() {
    return (
        <Box as="span" display="inline-flex" gap="0.5" flexShrink={0}>
            <Box as="span" w="12px" h="16px" borderRadius="2px" borderWidth="1px" borderColor="blackAlpha.400" bg={CARD_YELLOW} />
            <Box as="span" w="12px" h="16px" borderRadius="2px" borderWidth="1px" borderColor="blackAlpha.400" bg={CARD_RED} />
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
    if (type === "PENALTY_MISSED" || type === "PENALTY_MISSED_LIVE")
        return <Text as="span" fontSize="xs" fontWeight={800} color="accent.red" flexShrink={0}>✗</Text>
    if (type === "EXCLUSION") return <Text as="span" fontSize="sm" lineHeight="1.4" flexShrink={0}>🕑</Text>
    // The same sliding-tackle mark the fullscreen board uses for accumulated
    // fouls. Without it a foul fell through to the card block below and drew a
    // RED CARD - the one icon on this timeline that must never be wrong.
    if (type === "FOUL") return <Box as="span" color="fg.muted" flexShrink={0} lineHeight="1"><GiSoccerKick size={15} /></Box>
    // Explicit 2px radius: `rounded="sm"` is 8px in this theme, which turns a
    // 13x16 card into a lozenge.
    return (
        <Box
            as="span"
            w="12px"
            h="16px"
            borderRadius="2px"
            borderWidth="1px"
            borderColor="blackAlpha.400"
            flexShrink={0}
            bg={type === "YELLOW_CARD" ? CARD_YELLOW : CARD_RED}
        />
    )
}

function playerLabel(e: MatchEventDto, t: Dictionary): string {
    const sf = t.components.liveMatchPanel.scorerFallback
    const er = t.components.liveMatch.eventRow
    if (e.type === "OWN_GOAL") return e.playerName != null ? sf.ownGoalSuffix(e.playerName) : sf.ownGoal
    if (e.type === "GOAL" && e.penalty) return er.penSuffix(e.playerName ?? sf.unknownScorer)
    if (e.type === "PENALTY_MISSED_LIVE")
        return e.playerName != null ? er.penSuffix(e.playerName) : er.missedPenaltyLive
    if (e.type === "EXCLUSION")
        return e.playerName != null ? er.exclusionSuffix(e.playerName) : er.exclusionLabel
    if (e.playerName != null) return e.playerName
    if (e.type === "GOAL" || e.type === "PENALTY_GOAL") return sf.unknownScorer
    if (e.type === "PENALTY_MISSED") return sf.missed
    return t.components.liveMatch.eventRow.unknownPlayerFallback
}
