import { useCallback, useEffect, useState } from "react"
import { Box, Button, Flex, HStack, Menu, Portal, Spinner, Text, VStack } from "@chakra-ui/react"
import { FiClock, FiPlay } from "react-icons/fi"
import { fetchMatchEvents } from "../api/matchEvents"
import type { MatchEventDto, MatchLiveMode } from "../types/matchEvents"

/* ──────────────────────────────────────────────────────────────────────────
   Live-match shared helpers.
   ────────────────────────────────────────────────────────────────────────── */

/** Whole minutes elapsed since an ISO liveStartedAt (clamped at >= 0). */
export function elapsedMinutes(liveStartedAt: string | null | undefined): number {
    if (!liveStartedAt) return 0
    const started = new Date(liveStartedAt).getTime()
    if (!Number.isFinite(started)) return 0
    const diff = Date.now() - started
    return diff > 0 ? Math.floor(diff / 60000) : 0
}

/** Elapsed time since liveStartedAt formatted as m:ss. */
function elapsedClock(liveStartedAt: string | null | undefined): string {
    if (!liveStartedAt) return "0:00"
    const started = new Date(liveStartedAt).getTime()
    if (!Number.isFinite(started)) return "0:00"
    const secs = Math.max(0, Math.floor((Date.now() - started) / 1000))
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`
}

/** Whole seconds elapsed since an ISO timestamp (clamped at >= 0). */
function elapsedSeconds(at: string | null | undefined): number {
    if (!at) return 0
    const started = new Date(at).getTime()
    if (!Number.isFinite(started)) return 0
    const diff = Date.now() - started
    return diff > 0 ? Math.floor(diff / 1000) : 0
}

/** Format a number of seconds as m:ss. */
function formatClock(totalSecs: number): string {
    const s = Math.max(0, Math.floor(totalSecs))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/**
 * Which phase a TIMER-mode match is in.
 *  - "FIRST_HALF"  — 1st half running.
 *  - "HALFTIME"    — 1st half over, 2nd half not yet started (only when halfCount >= 2).
 *  - "SECOND_HALF" — 2nd half running.
 *  - "FULL_TIME"   — match clock has run out (full time / "Kraj").
 */
export type MatchPhase = "FIRST_HALF" | "HALFTIME" | "SECOND_HALF" | "FULL_TIME"

/**
 * Compute the current phase of a TIMER-mode match.
 *
 * When {@code halfLengthMin} is absent the match is treated as a single
 * free-running period — it is always "FIRST_HALF" (no halftime / full time).
 */
export function matchPhase({
    liveStartedAt,
    secondHalfStartedAt,
    halfLengthMin,
    halfCount,
}: {
    liveStartedAt: string | null | undefined
    secondHalfStartedAt?: string | null
    halfLengthMin?: number | null
    halfCount?: number | null
}): MatchPhase {
    // No half config — free-running, never ends on its own.
    if (halfLengthMin == null || halfLengthMin <= 0) return "FIRST_HALF"

    const halfSecs = halfLengthMin * 60
    const halves = halfCount != null && halfCount >= 2 ? 2 : 1

    // 2nd half already started.
    if (secondHalfStartedAt) {
        const sh = elapsedSeconds(secondHalfStartedAt)
        return sh >= halfSecs ? "FULL_TIME" : "SECOND_HALF"
    }

    // Still in (or just past) the 1st half.
    const fh = elapsedSeconds(liveStartedAt)
    if (fh < halfSecs) return "FIRST_HALF"

    // 1st half is over. Single-period matches end here; otherwise it's halftime.
    return halves === 1 ? "FULL_TIME" : "HALFTIME"
}

type LiveClockProps = {
    liveStartedAt: string | null | undefined
    /** ISO timestamp the 2nd half started; enables 2nd-half timing. */
    secondHalfStartedAt?: string | null
    /** Length of one half in minutes; when absent the clock just free-runs. */
    halfLengthMin?: number | null
    /** Number of halves (periods); 1 = single period, >= 2 = two halves. */
    halfCount?: number | null
    /** When true, render the phase label ("Poluvrijeme" / "2. pol." / "Kraj"). */
    showLabel?: boolean
}

/**
 * A live, ticking match clock. Re-renders once a second.
 *
 * With no {@code halfLengthMin} it behaves as a plain free-running elapsed
 * clock. With a half config it becomes half-aware:
 *  - 1st half: counts up; stops at the half length and shows "Poluvrijeme"
 *    (when halfCount >= 2) or "Kraj" (single period).
 *  - 2nd half (once {@code secondHalfStartedAt} is set): the displayed match
 *    minute continues from the half length; stops at 2x the half length and
 *    shows "Kraj".
 */
export function LiveClock({
    liveStartedAt,
    secondHalfStartedAt,
    halfLengthMin,
    halfCount,
    showLabel,
}: LiveClockProps) {
    const [, setTick] = useState(0)
    useEffect(() => {
        const id = setInterval(() => setTick((t) => t + 1), 1000)
        return () => clearInterval(id)
    }, [])

    // Free-running clock — no half config supplied.
    if (halfLengthMin == null || halfLengthMin <= 0) {
        return (
            <Text
                as="span"
                fontSize="xs"
                fontWeight="bold"
                fontVariantNumeric="tabular-nums"
                color="red.fg"
                display="inline-flex"
                alignItems="center"
                gap="1"
                whiteSpace="nowrap"
            >
                <FiClock size={11} />
                {elapsedClock(liveStartedAt)}
            </Text>
        )
    }

    const halfSecs = halfLengthMin * 60
    const phase = matchPhase({ liveStartedAt, secondHalfStartedAt, halfLengthMin, halfCount })

    // Scoreboard semaphore behaviour: the clock COUNTS DOWN the remaining
    // time in the running half — from the configured half length to 0:00 —
    // exactly like a venue match clock. At 0:00 it waits for the organizer
    // (start 2nd half / finish), it never advances on its own.
    let display: string
    let label: string
    switch (phase) {
        case "FIRST_HALF": {
            const remaining = halfSecs - elapsedSeconds(liveStartedAt)
            display = formatClock(remaining)
            label = "1. pol."
            break
        }
        case "HALFTIME": {
            display = "0:00"
            label = "Poluvrijeme"
            break
        }
        case "SECOND_HALF": {
            const remaining = halfSecs - elapsedSeconds(secondHalfStartedAt)
            display = formatClock(remaining)
            label = "2. pol."
            break
        }
        case "FULL_TIME":
        default: {
            display = "0:00"
            label = "Kraj"
            break
        }
    }

    // Flash to amber in the last 60s of a running half so the organizer can
    // see the half is about to end; red otherwise (and at full time).
    const running = phase === "FIRST_HALF" || phase === "SECOND_HALF"
    const remainingSecs = running
        ? (phase === "FIRST_HALF"
            ? halfSecs - elapsedSeconds(liveStartedAt)
            : halfSecs - elapsedSeconds(secondHalfStartedAt))
        : 0
    const clockColor = running && remainingSecs <= 60 ? "accent.amber" : "red.fg"

    return (
        <Text
            as="span"
            fontSize="xs"
            fontWeight="bold"
            fontVariantNumeric="tabular-nums"
            color={clockColor}
            display="inline-flex"
            alignItems="center"
            gap="1"
            whiteSpace="nowrap"
        >
            <FiClock size={11} />
            {display}
            {showLabel && (
                <Text as="span" color="fg.muted" fontWeight="medium">
                    {label}
                </Text>
            )}
        </Text>
    )
}

/**
 * The "start match live" control.
 */
export function StartLivePopover({
    onStart,
    loading,
}: {
    onStart: (mode: MatchLiveMode) => void
    loading?: boolean
}) {
    return (
        <Menu.Root>
            <Menu.Trigger asChild>
                <Button size="sm" variant="outline" colorPalette="red" loading={loading}>
                    <FiPlay /> Pocni uzivo
                </Button>
            </Menu.Trigger>
            <Portal>
                <Menu.Positioner>
                    <Menu.Content minW="56">
                        <Menu.Item value="timer" onClick={() => onStart("TIMER")}>
                            <FiClock />
                            <Text ml="2">S mjeracem vremena</Text>
                        </Menu.Item>
                        <Menu.Item value="simple" onClick={() => onStart("SIMPLE")}>
                            <FiPlay />
                            <Text ml="2">Bez mjeraca (vlastiti sat)</Text>
                        </Menu.Item>
                    </Menu.Content>
                </Menu.Positioner>
            </Portal>
        </Menu.Root>
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   GoalscorersPanel — shared between LiveMatchRow and ScheduleTab.

   Lazy-loads ALL match events (goals + cards) and renders them as a
   SofaScore-style vertical timeline:
     - Events for team1 sit on the LEFT half of each row.
     - Events for team2 sit on the RIGHT half.
     - LEFT  row layout (left to right): minute (bold) | icon | player name
     - RIGHT row layout (left to right): player name | icon | minute (bold)
       So the minute is always at the outer edge, player name toward the centre.
     - GOAL events with an assist show the assisting player smaller/muted below.
     - Rows are sorted by minute ascending.

   If team1Id and team2Id are both null the panel auto-detects the two
   distinct teamIds from the loaded events (sorted ascending) and assigns
   the smaller id to team1 (left) and the larger to team2 (right).
   ────────────────────────────────────────────────────────────────────────── */

const EVENT_ICON: Record<string, string> = {
    GOAL: "26BD",
    YELLOW_CARD: "1F7E8",
    RED_CARD: "1F7E5",
}

type EventTimelineState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "done"; events: MatchEventDto[]; t1Id: number | null; t2Id: number | null }
    | { status: "error" }

export function GoalscorersPanel({
    tournamentUuid,
    matchId,
    team1Id,
    team2Id,
    pollMs,
}: {
    tournamentUuid: string
    matchId: number
    team1Id: number | null
    team2Id: number | null
    /** When set, refetches events on this interval so live cards on the
     *  /uzivo page stay in sync as goals are scored. Leave undefined for
     *  the static "finished match" timeline. */
    pollMs?: number
}) {
    const [state, setState] = useState<EventTimelineState>({ status: "idle" })

    const load = useCallback(
        (silent = false) => {
            if (!silent) setState({ status: "loading" })
            fetchMatchEvents(tournamentUuid, matchId)
                .then((evts) => {
                    const sorted = [...evts].sort((a, b) => a.minute - b.minute)

                    let t1Id = team1Id
                    let t2Id = team2Id

                    if (t1Id == null || t2Id == null) {
                        const distinct = Array.from(new Set(sorted.map((e) => e.teamId))).sort(
                            (a, b) => a - b,
                        )
                        t1Id = distinct[0] ?? null
                        t2Id = distinct[1] ?? null
                    }

                    setState({ status: "done", events: sorted, t1Id, t2Id })
                })
                .catch(() => {
                    // On poll, keep previous data on screen instead of
                    // flashing the error state — transient 5xx shouldn't
                    // wipe a live timeline.
                    if (!silent) setState({ status: "error" })
                })
        },
        [tournamentUuid, matchId, team1Id, team2Id],
    )

    // First load + optional polling. The poll uses `silent=true` so a
    // failed poll doesn't replace the on-screen timeline with an error
    // panel; only the initial fetch can surface "error".
    useEffect(() => {
        load(false)
        if (!pollMs || pollMs <= 0) return
        const id = setInterval(() => load(true), pollMs)
        return () => clearInterval(id)
    }, [load, pollMs])

    if (state.status === "loading") {
        return (
            <HStack gap="2" py="1">
                <Spinner size="xs" color="brand.solid" />
                <Text fontSize="xs" color="fg.muted">
                    Učitavanje...
                </Text>
            </HStack>
        )
    }

    if (state.status === "error") {
        return (
            <Text fontSize="xs" color="fg.muted">
                Nije moguće učitati događaje.
            </Text>
        )
    }

    if (state.status === "done") {
        const { events, t1Id } = state

        if (events.length === 0) {
            return (
                <Text fontSize="xs" color="fg.muted">
                    Još nema događaja.
                </Text>
            )
        }

        return (
            <VStack align="stretch" gap="0" w="full">
                {events.map((evt) => {
                    const isLeft = evt.teamId === t1Id
                    const iconCode = EVENT_ICON[evt.type] ?? "2022"
                    const icon = String.fromCodePoint(parseInt(iconCode, 16))

                    if (isLeft) {
                        return (
                            <Box
                                key={evt.id}
                                display="grid"
                                gridTemplateColumns="1fr 1fr"
                                w="full"
                                py="0.5"
                            >
                                <Flex align="flex-start" gap="1" pr="2">
                                    <Text
                                        fontSize="xs"
                                        fontWeight="bold"
                                        color="fg"
                                        whiteSpace="nowrap"
                                        flexShrink={0}
                                    >
                                        {evt.minute}&apos;
                                    </Text>
                                    <Text fontSize="xs" flexShrink={0} lineHeight="1.4">
                                        {icon}
                                    </Text>
                                    <VStack align="flex-start" gap="0" minW="0">
                                        <Text fontSize="xs" color="fg" lineHeight="1.4" truncate>
                                            {evt.playerName}
                                        </Text>
                                        {evt.type === "GOAL" && evt.assistPlayerName && (
                                            <Text
                                                fontSize="2xs"
                                                color="fg.muted"
                                                lineHeight="1.3"
                                                truncate
                                            >
                                                asist. {evt.assistPlayerName}
                                            </Text>
                                        )}
                                    </VStack>
                                </Flex>
                                <Box />
                            </Box>
                        )
                    }

                    return (
                        <Box
                            key={evt.id}
                            display="grid"
                            gridTemplateColumns="1fr 1fr"
                            w="full"
                            py="0.5"
                        >
                            <Box />
                            <Flex align="flex-start" gap="1" pl="2" justify="flex-end">
                                <VStack align="flex-end" gap="0" minW="0">
                                    <Text
                                        fontSize="xs"
                                        color="fg"
                                        lineHeight="1.4"
                                        truncate
                                        textAlign="right"
                                    >
                                        {evt.playerName}
                                    </Text>
                                    {evt.type === "GOAL" && evt.assistPlayerName && (
                                        <Text
                                            fontSize="2xs"
                                            color="fg.muted"
                                            lineHeight="1.3"
                                            truncate
                                            textAlign="right"
                                        >
                                            asist. {evt.assistPlayerName}
                                        </Text>
                                    )}
                                </VStack>
                                <Text fontSize="xs" flexShrink={0} lineHeight="1.4">
                                    {icon}
                                </Text>
                                <Text
                                    fontSize="xs"
                                    fontWeight="bold"
                                    color="fg"
                                    whiteSpace="nowrap"
                                    flexShrink={0}
                                >
                                    {evt.minute}&apos;
                                </Text>
                            </Flex>
                        </Box>
                    )
                })}
            </VStack>
        )
    }

    return null
}
