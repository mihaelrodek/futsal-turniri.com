import { useEffect, useMemo, useState } from "react"
import { Box, Button, chakra, Flex, HStack, IconButton, Input, Text, VStack } from "@chakra-ui/react"
import { FiEdit2, FiMinus, FiMoreHorizontal, FiPause, FiPlay, FiPlus, FiX } from "react-icons/fi"
import { GiSoccerBall } from "react-icons/gi"

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
import {
    DirectScoreEditor,
    PenaltyShootout,
    clockState,
    liveMatchMinute,
    matchPhase,
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

/** Team-identity colours from the handoff: home maroon, away green. Fixed hex
 *  (not theme tokens) - they read on both the light and dark card surface. */
const HOME = "#7a1d2b"
const AWAY = "#14512f"
const GOAL_GREEN = "#1a6a43"
const CARD_YELLOW = "#e8a01f"
const CARD_RED = "#c0392b"
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
}: {
    uuid: string
    kind: "group" | "knockout"
    match: PanelMatch
    onChanged: () => Promise<void> | void
    /** The styled match-selector node (built by the host, which owns the list). */
    selector?: React.ReactNode
}) {
    const matchId = match.matchId
    const isKnockout = kind === "knockout"
    const isLive = match.status === "LIVE"
    const isFinished = match.status === "FINISHED"
    const isScheduled = !isLive && !isFinished
    const isTimer = match.liveMode === "TIMER"

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
        ? { label: "Završi utakmicu", run: requestFinish, busy: finishing }
        : canEndFirstHalf
            ? { label: "Završi 1. poluvrijeme", run: handleEndFirstHalf, busy: phaseBusy }
            : canStartSecondHalf
                ? { label: "Započni 2. poluvrijeme", run: handleStartSecondHalf, busy: phaseBusy }
                : { label: "Završi utakmicu", run: requestFinish, busy: finishing }

    // Current half for the fouls counters (2nd once it has started).
    const currentHalf: 1 | 2 = secondHalfStartedAt ? 2 : 1

    return (
        <VStack align="stretch" gap="0">
            {/* Main card. */}
            <Box bg="bg.panel" borderWidth="1px" borderColor="border" rounded="3xl" shadow="sm" p={{ base: "4", md: "6" }}>
                {/* Match selector (built by the host). */}
                <Text
                    textAlign="center"
                    fontSize="2xs"
                    fontWeight={800}
                    letterSpacing="wider"
                    textTransform="uppercase"
                    color="fg.muted"
                    mb="2.5"
                >
                    Utakmica za vođenje
                </Text>
                <Flex justify="center">{selector}</Flex>

                {/* ===== PRE-MATCH / FINISHED scoreboard ===== */}
                {!isLive && (
                    <VStack align="stretch" gap="0" mt="5">
                        {/* Scoreboard */}
                        <Flex align="center" justify="center" gap={{ base: "3", md: "4" }} wrap="wrap" mb="2">
                            <Text fontSize={{ base: "2xl", md: "3xl" }} fontWeight={800} color={HOME} truncate maxW="40%">
                                {match.team1Name ?? "-"}
                            </Text>
                            <ScoreBadge value={score.s1} color={HOME} />
                            <Text fontSize="2xl" fontWeight={800} color="fg.subtle">:</Text>
                            <ScoreBadge value={score.s2} color={AWAY} />
                            <Text fontSize={{ base: "2xl", md: "3xl" }} fontWeight={800} color={AWAY} truncate maxW="40%">
                                {match.team2Name ?? "-"}
                            </Text>
                        </Flex>
                        <Text textAlign="center" color="fg.muted" fontSize="sm" fontWeight={500} mb="4">
                            {isScheduled ? "Utakmica još nije pokrenuta." : "Utakmica je završena."}
                        </Text>

                        {/* SCHEDULED - how to record + result-only sub-mode. */}
                        {isScheduled && (
                            <>
                                {/* How to record - hidden while the result-only form is open. */}
                                {!showDirectScore && (
                                    <HStack gap="3" justify="center" wrap="wrap" mb="3">
                                        <Button
                                            bg={HOME}
                                            color="white"
                                            _hover={{ bg: HOME, opacity: 0.9 }}
                                            fontWeight={800}
                                            size="lg"
                                            loading={starting}
                                            onClick={() => handleStart("TIMER")}
                                        >
                                            Uživo – s mjeračem vremena
                                        </Button>
                                        <Button
                                            variant="outline"
                                            fontWeight={700}
                                            size="lg"
                                            loading={starting}
                                            onClick={() => handleStart("SIMPLE")}
                                        >
                                            Uživo – bez mjerača (vlastiti sat)
                                        </Button>
                                    </HStack>
                                )}

                                {/* Result-only toggle. */}
                                <Flex justify="center">
                                    <Button
                                        variant="plain"
                                        size="sm"
                                        fontWeight={700}
                                        color="fg.ink"
                                        onClick={() => setShowDirectScore((v) => !v)}
                                    >
                                        <FiEdit2 /> {showDirectScore ? "Odustani od unosa rezultata" : "Unesi samo rezultat"}
                                    </Button>
                                </Flex>

                                {/* Result-only panel. */}
                                {showDirectScore && (
                                    <Box mt="3">
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
                    <VStack align="stretch" gap="0" mt="5">
                        {/* Timer block. The timer + half label are truly centred;
                            the pause/play button is absolutely positioned to the
                            RIGHT of the timer so it never shifts it off-centre. */}
                        <VStack gap="1.5" align="center" mb="5">
                            {isTimer && clk ? (
                                <Box position="relative" display="inline-flex" alignItems="center" justifyContent="center">
                                    <Text
                                        fontFamily="mono"
                                        fontSize={{ base: "44px", md: "52px" }}
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
                            ) : (
                                <Text fontSize="md" fontWeight={800} color={HOME}>
                                    Bez mjerača — minuta se upisuje ručno
                                </Text>
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
                                />

                                {/* Flow controls: the primary phase button + ⋯ menu. */}
                                <HStack gap="2.5" mt="4" align="stretch" justify="center">
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

                {/* ===== TIMELINE (shared) ===== */}
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
                    />
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
}) {
    const [rosters, setRosters] = useState<Record<number, PlayerDto[]>>({})
    const [pendingPlayer, setPendingPlayer] = useState<PendingPlayer | null>(null)
    const [pendingAction, setPendingAction] = useState<MatchEventType | null>(null)
    const [minute, setMinute] = useState<string>("0")
    // While true (TIMER) the "Min" field auto-follows the running clock; a
    // manual edit turns it off, "Sada" turns it back on.
    const [autoMinute, setAutoMinute] = useState(true)

    // Fouls - offline-first, one hook instance for the whole match.
    const { fouls, bump } = useOfflineMatchFouls(uuid, matchId, serverFouls)
    const foulsHome = half === 1 ? fouls.fouls1First : fouls.fouls1Second
    const foulsAway = half === 1 ? fouls.fouls2First : fouls.fouls2Second

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
    // manual value; "Sada" resumes it.
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

    /** Beneficiary side for an event committed by `committingTeam`: that team,
     *  except an own goal counts for (shows on) the OTHER side. */
    function sideFor(committingTeam: number, type: MatchEventType): number {
        if (type !== "OWN_GOAL") return committingTeam
        if (team1Id == null || team2Id == null) return committingTeam
        return committingTeam === team1Id ? team2Id : team1Id
    }

    function commit(pp: PendingPlayer, type: MatchEventType) {
        if (!minuteValid) return
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
                : "Odaberi igrača, zatim radnju (ili obrnuto)."

    return (
        <Box borderWidth="1px" borderColor="border" rounded="2xl" p={{ base: "3", md: "4" }}>
            <Eyebrow>1 · Odaberi igrača</Eyebrow>
            <Box display="grid" gridTemplateColumns={{ base: "1fr", sm: "1fr 1fr" }} gap={{ base: "4", sm: "3.5" }} mb="4">
                <RosterColumn
                    teamName={team1Name}
                    teamId={team1Id}
                    color={HOME}
                    players={team1Id != null ? rosters[team1Id] ?? [] : []}
                    foulsCount={foulsHome}
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
                    players={team2Id != null ? rosters[team2Id] ?? [] : []}
                    foulsCount={foulsAway}
                    onFoul={(d) => bump(2, half, d)}
                    pendingPlayer={pendingPlayer}
                    onSelect={selectPlayer}
                    sentOffPlayerIds={sentOffPlayerIds}
                    yellowCardedPlayerIds={yellowCardedPlayerIds}
                />
            </Box>

            <Eyebrow>2 · Odaberi radnju</Eyebrow>
            <Box display="grid" gridTemplateColumns="repeat(4, 1fr)" gap="2" mb="3.5">
                {ACTIONS.map((a) => (
                    <ActionButton
                        key={a.type}
                        type={a.type}
                        label={a.label}
                        selected={pendingAction === a.type}
                        onClick={() => selectAction(a.type)}
                    />
                ))}
            </Box>

            <Flex align="center" justify="space-between" gap="3" wrap="wrap">
                <Text fontSize="xs" fontWeight={700} color="fg.muted" flex="1" minW="180px">
                    {hint}
                </Text>
                <HStack gap="2">
                    <Text fontSize="2xs" fontWeight={700} color="fg.muted">Min.</Text>
                    <Input
                        type="number"
                        min={0}
                        w="56px"
                        size="sm"
                        textAlign="center"
                        fontWeight={700}
                        value={minute}
                        onChange={(e) => { setMinute(e.target.value); setAutoMinute(false) }}
                    />
                    {isTimer && (
                        <Button
                            size="sm"
                            variant={autoMinute ? "solid" : "outline"}
                            colorPalette="brand"
                            onClick={() => setAutoMinute(true)}
                            title="Vrati minutu na automatsko praćenje mjerača"
                        >
                            Sada
                        </Button>
                    )}
                    <Button size="sm" variant="outline" colorPalette="gray" onClick={clearPending} disabled={!pendingPlayer && !pendingAction}>
                        Odustani
                    </Button>
                </HStack>
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
    players,
    foulsCount,
    onFoul,
    pendingPlayer,
    onSelect,
    sentOffPlayerIds,
    yellowCardedPlayerIds,
}: {
    teamName: string | null
    teamId: number | null
    color: string
    players: PlayerDto[]
    foulsCount: number
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
        <VStack align="stretch" gap="2.5" minW="0">
            <HStack gap="2.5">
                <Box w="15px" h="15px" rounded="sm" bg={color} flexShrink={0} />
                <Text fontSize="xl" fontWeight={800} color="fg.ink" truncate>{teamName ?? "-"}</Text>
            </HStack>

            {/* Fouls block (amber). */}
            <Flex
                align="center"
                justify="space-between"
                rounded="lg"
                px="3"
                py="1.5"
                css={{ background: tint(CARD_YELLOW, 12) }}
            >
                <Text fontSize="2xs" fontWeight={800} letterSpacing="wide" color="accent.amber">PREKRŠAJI</Text>
                <HStack gap="2.5">
                    <IconButton aria-label="Manje prekršaja" size="2xs" variant="outline" disabled={foulsCount === 0} onClick={() => onFoul(-1)}>
                        <FiMinus />
                    </IconButton>
                    <Box textAlign="center" minW="18px" lineHeight="1">
                        <Text fontFamily="mono" fontSize="md" fontWeight={800} color={foulsCount >= 5 ? "accent.red" : "accent.amber"} lineHeight="1">
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
    onClick,
}: {
    type: MatchEventType
    label: string
    selected: boolean
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
                <Box as="span" w="20px" h="20px" rounded="full" css={{ background: "radial-gradient(circle at 35% 30%, #e8635a, #b7301f)", boxShadow: "inset 0 0 0 1.5px rgba(0,0,0,.10)" }} />
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
            cursor="pointer"
            _hover={{ borderColor: accent }}
            transition="border-color 0.12s, background 0.12s"
            onClick={onClick}
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
    | { kind: "half"; label: string }
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
}: {
    events: MatchEventDto[]
    team1Id: number | null
    halfLengthMin: number | null
    canDelete: boolean
    onUndo: (ev: MatchEventDto) => void
}) {
    const rows: TimelineRow[] = useMemo(() => {
        const sorted = [...events].sort((a, b) => a.minute - b.minute || a.id - b.id)
        const out: TimelineRow[] = [{ kind: "half", label: "1. poluvrijeme" }]
        let h = 0
        let a = 0
        let sep2 = false
        const secondHalfMin = halfLengthMin != null && halfLengthMin > 0 ? halfLengthMin : null
        for (const e of sorted) {
            if (secondHalfMin != null && !sep2 && e.minute > secondHalfMin) {
                out.push({ kind: "half", label: "2. poluvrijeme" })
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

    return (
        <Box position="relative" py="2" w="full">
            {/* Continuous central line behind the rows. */}
            <Box position="absolute" left="50%" top="2" bottom="2" borderLeftWidth="2px" borderStyle="dashed" borderColor="border.emphasized" />
            <VStack position="relative" align="stretch" gap="1">
                {rows.map((r, i) =>
                    r.kind === "half" ? (
                        <Flex key={`h-${i}`} justify="center" py="1">
                            <Text
                                as="span"
                                bg="bg.panel"
                                borderWidth="1px"
                                borderColor="border"
                                rounded="full"
                                px="3"
                                py="0.5"
                                fontSize="xs"
                                fontWeight={800}
                                color="fg.muted"
                            >
                                {r.label}
                            </Text>
                        </Flex>
                    ) : (
                        <TimelineEventRow key={r.clientEventId ?? r.id} row={r} canDelete={canDelete} onUndo={() => onUndo(r.ev)} />
                    ),
                )}
            </VStack>
        </Box>
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
        : <Box boxSize="10px" rounded="full" bg="fg.ink" boxShadow="0 0 0 5px var(--chakra-colors-bg-panel)" />
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
