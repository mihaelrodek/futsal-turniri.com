import { useEffect, useMemo, useState } from "react"
import { Box, Button, Flex, HStack, Text, VStack } from "@chakra-ui/react"

import {
    deleteMatchEvent,
    endFirstHalf,
    fetchMatchEvents,
    finishMatch,
    resetMatch,
    startMatch,
    startSecondHalf,
} from "../api/matchEvents"
import { recordKnockoutResult } from "../api/bracket"
import { recordGroupResult } from "../api/groups"
import { fetchSchedule } from "../api/schedule"
import type { MatchEventDto, MatchLiveMode } from "../types/matchEvents"
import { ConfirmDialog } from "../ui/primitives"
import {
    DirectScoreEditor,
    FoulControls,
    LiveClock,
    LiveEventRow,
    LiveGoalEntry,
    PenaltyShootout,
    matchPhase,
} from "./liveMatch"

/* ──────────────────────────────────────────────────────────────────────────
   LiveMatchPanel - the same live-control surface as the Grupe / Eliminacija
   match dialogs, but rendered INLINE (no modal). Drives one match through
   SCHEDULED → LIVE → FINISHED: start, goals, fouls, halves, finish (penalties
   for a level knockout) and reset. Reuses the shared live primitives so the
   behaviour matches the dialogs exactly.
   ────────────────────────────────────────────────────────────────────────── */

export type PanelMatch = {
    matchId: number
    status: string
    liveMode?: MatchLiveMode | null
    liveStartedAt?: string | null
    firstHalfEndedAt?: string | null
    secondHalfStartedAt?: string | null
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

function LivePill() {
    return (
        <Box
            as="span"
            px="2"
            py="0.5"
            rounded="full"
            bg="red.solid"
            color="white"
            fontSize="2xs"
            fontWeight={800}
            letterSpacing="wider"
            textTransform="uppercase"
        >
            Uživo
        </Box>
    )
}

function scoreFromEvents(list: MatchEventDto[], t1: number | null, t2: number | null) {
    let s1 = 0
    let s2 = 0
    for (const e of list) {
        if (e.type !== "GOAL") continue
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
}: {
    uuid: string
    kind: "group" | "knockout"
    match: PanelMatch
    onChanged: () => Promise<void> | void
}) {
    const matchId = match.matchId
    const isKnockout = kind === "knockout"
    const isLive = match.status === "LIVE"
    const isFinished = match.status === "FINISHED"
    const isScheduled = !isLive && !isFinished
    const isTimer = match.liveMode === "TIMER"

    const [events, setEvents] = useState<MatchEventDto[] | null>(null)
    const [halfLengthMin, setHalfLengthMin] = useState<number | null>(null)
    const [halfCount, setHalfCount] = useState<number | null>(null)
    const [firstHalfEndedAt, setFirstHalfEndedAt] = useState<string | null>(
        match.firstHalfEndedAt ?? null,
    )
    const [secondHalfStartedAt, setSecondHalfStartedAt] = useState<string | null>(
        match.secondHalfStartedAt ?? null,
    )
    const [starting, setStarting] = useState(false)
    const [endingHalf, setEndingHalf] = useState(false)
    const [startingHalf, setStartingHalf] = useState(false)
    const [finishing, setFinishing] = useState(false)
    const [resetting, setResetting] = useState(false)
    const [shootout, setShootout] = useState(false)
    const [deletingId, setDeletingId] = useState<number | null>(null)
    // Direct final-score entry (no scorers). `pendingScore` carries an entered
    // score into the penalty shootout for a level knockout result.
    const [savingScore, setSavingScore] = useState(false)
    const [pendingScore, setPendingScore] = useState<{ s1: number; s2: number } | null>(null)

    const sentOffIds = useMemo(
        () =>
            new Set(
                (events ?? [])
                    .filter((e) => e.type === "RED_CARD" && e.playerId != null)
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

    // Load events for this match.
    useEffect(() => {
        let cancelled = false
        fetchMatchEvents(uuid, matchId)
            .then((ev) => { if (!cancelled) setEvents(ev) })
            .catch(() => { if (!cancelled) setEvents([]) })
        return () => { cancelled = true }
    }, [uuid, matchId])

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

    const phase =
        isTimer && isLive
            ? matchPhase({
                  liveStartedAt: match.liveStartedAt,
                  firstHalfEndedAt,
                  secondHalfStartedAt,
                  halfLengthMin,
                  halfCount,
              })
            : null
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
    const halfLabel =
        phase === "FIRST_HALF" ? "1. POLUVRIJEME"
            : phase === "HALFTIME" ? "POLUVRIJEME"
                : phase === "SECOND_HALF" ? "2. POLUVRIJEME"
                    : phase === "FULL_TIME" ? "KRAJ"
                        : null

    async function refreshAfterMutation() {
        try {
            setEvents(await fetchMatchEvents(uuid, matchId))
        } catch {
            /* error toast surfaced by the http interceptor */
        }
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
        setEndingHalf(true)
        try {
            await endFirstHalf(uuid, matchId)
            setFirstHalfEndedAt(new Date().toISOString())
            await onChanged()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setEndingHalf(false)
        }
    }

    async function handleStartSecondHalf() {
        setStartingHalf(true)
        try {
            await startSecondHalf(uuid, matchId)
            setSecondHalfStartedAt(new Date().toISOString())
            await onChanged()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setStartingHalf(false)
        }
    }

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
        <Box borderWidth="1px" borderColor="border.emphasized" rounded="xl" p={{ base: "4", md: "5" }}>
            {/* Scoreboard header */}
            <VStack gap="2" align="stretch" mb="3">
                {isLive && (
                    <Box display="grid" gridTemplateColumns="1fr auto 1fr" alignItems="center" gap="2">
                        <Box justifySelf="start"><LivePill /></Box>
                        <Box justifySelf="center">
                            {halfLabel && (
                                <Text fontFamily="mono" fontSize="2xs" fontWeight={800} letterSpacing="0.12em" color="fg.muted">
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
                <HStack justify="center" gap="3" align="center">
                    <Text fontSize="md" fontWeight={700} color="fg.ink" flex="1" minW="0" textAlign="right" truncate>
                        {match.team1Name ?? "-"}
                    </Text>
                    <Text fontFamily="mono" fontSize="2xl" fontWeight={800} fontVariantNumeric="tabular-nums" color={isLive ? "red.fg" : "fg.ink"} flexShrink={0}>
                        {score.s1} : {score.s2}
                    </Text>
                    <Text fontSize="md" fontWeight={700} color="fg.ink" flex="1" minW="0" textAlign="left" truncate>
                        {match.team2Name ?? "-"}
                    </Text>
                </HStack>
            </VStack>

            {/* SCHEDULED - start the match */}
            {isScheduled && (
                <VStack gap="2" py="2">
                    <Text fontSize="sm" color="fg.muted">Utakmica još nije pokrenuta.</Text>
                    <HStack gap="2" wrap="wrap" justify="center">
                        <Button colorPalette="red" loading={starting} onClick={() => handleStart("TIMER")}>
                            Pokreni s mjeračem
                        </Button>
                        <Button variant="outline" colorPalette="red" loading={starting} onClick={() => handleStart("SIMPLE")}>
                            Pokreni bez mjerača
                        </Button>
                    </HStack>
                </VStack>
            )}

            {/* Direct final-score entry - available whenever the match isn't
                being scored live and has no goal events yet, so the organizer
                can just type the result (0:0 default) instead of going live. */}
            {!isLive && events != null && events.length === 0 && !shootout && (
                <Box mb="3">
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

            {/* LIVE controls (or penalty shootout) */}
            {isLive && (
                <VStack align="stretch" gap="2.5">
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

                    {!shootout && (
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

                    {!shootout && (
                        <HStack gap="2" justify="center" wrap="wrap" pt="1">
                            <Button variant="outline" colorPalette="red" loading={resetting} onClick={confirmReset}>
                                Resetiraj
                            </Button>
                            {canEndFirstHalf && (
                                <Button colorPalette="red" loading={endingHalf} onClick={handleEndFirstHalf}>
                                    Završi 1. poluvrijeme
                                </Button>
                            )}
                            {canStartSecondHalf && (
                                <Button colorPalette="red" loading={startingHalf} onClick={handleStartSecondHalf}>
                                    Započni 2. poluvrijeme
                                </Button>
                            )}
                            <Button
                                colorPalette="red"
                                loading={finishing}
                                onClick={requestFinish}
                            >
                                Završi
                            </Button>
                        </HStack>
                    )}
                </VStack>
            )}

            {/* Timeline - always shown (read-only when finished). */}
            <Box textAlign="center" mt="3">
                <Text fontSize="2xs" fontWeight="semibold" letterSpacing="wider" textTransform="uppercase" color="fg.muted" mb="1.5">
                    Tijek utakmice
                </Text>
                {events == null ? (
                    <Text fontSize="sm" color="fg.muted">Učitavanje…</Text>
                ) : events.length === 0 ? (
                    <Text fontSize="sm" color="fg.muted">
                        {isFinished ? "Prikazan samo krajnji rezultat bez strijelca." : "Još nema zabilježenih događaja."}
                    </Text>
                ) : (
                    <VStack align="stretch" gap="1" mx="auto" w="full" maxW="md">
                        {events.map((ev) => (
                            <LiveEventRow
                                key={ev.id}
                                ev={ev}
                                team1Id={match.team1Id}
                                canDelete={!isFinished}
                                deleting={deletingId === ev.id}
                                onDelete={() => handleDelete(ev.id)}
                            />
                        ))}
                    </VStack>
                )}
            </Box>

            {isFinished && (
                <Flex justify="center" mt="3">
                    <Button variant="outline" colorPalette="red" loading={resetting} onClick={confirmReset}>
                        Resetiraj
                    </Button>
                </Flex>
            )}

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
        </Box>
    )
}
