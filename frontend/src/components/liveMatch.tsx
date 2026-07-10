import { useCallback, useEffect, useRef, useState } from "react"
import { Box, Button, Dialog, Flex, Grid, HStack, IconButton, Input, Menu, NativeSelect, Popover, Portal, Spinner, Text, VStack } from "@chakra-ui/react"
import { FiClock, FiEdit2, FiMinus, FiPause, FiPlay, FiPlus, FiRotateCcw, FiTrash2 } from "react-icons/fi"
import { GiSoccerBall } from "react-icons/gi"
import { addMatchEvent, deleteMatchEvent, fetchMatchEvents } from "../api/matchEvents"
import { useOfflineMatchFouls } from "../hooks/useOfflineMatchFouls"
import { ConfirmDialog } from "../ui/primitives"
import type { CreateMatchEventRequest, MatchEventDto, MatchEventType, MatchLiveMode } from "../types/matchEvents"
import type { OptimisticDisplay } from "../hooks/useOfflineMatchEvents"
import { fetchPlayers } from "../api/players"
import type { PlayerDto } from "../types/players"

/* ──────────────────────────────────────────────────────────────────────────
   Live-match shared helpers.
   ────────────────────────────────────────────────────────────────────────── */

/** "Now" for clock math - the pause instant while the clock is paused, the
 *  actual wall clock otherwise. Passing the pause instant freezes every
 *  elapsed computation at the moment the organizer paused. */
function clockNow(pausedAt?: string | null): number {
    if (pausedAt) {
        const p = new Date(pausedAt).getTime()
        if (Number.isFinite(p)) return p
    }
    return Date.now()
}

/** Whole minutes elapsed since an ISO liveStartedAt (clamped at >= 0). */
export function elapsedMinutes(
    liveStartedAt: string | null | undefined,
    pausedAt?: string | null,
): number {
    if (!liveStartedAt) return 0
    const started = new Date(liveStartedAt).getTime()
    if (!Number.isFinite(started)) return 0
    const diff = clockNow(pausedAt) - started
    return diff > 0 ? Math.floor(diff / 60000) : 0
}

/** Elapsed time since liveStartedAt formatted as m:ss. */
function elapsedClock(
    liveStartedAt: string | null | undefined,
    pausedAt?: string | null,
): string {
    if (!liveStartedAt) return "0:00"
    const started = new Date(liveStartedAt).getTime()
    if (!Number.isFinite(started)) return "0:00"
    const secs = Math.max(0, Math.floor((clockNow(pausedAt) - started) / 1000))
    return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`
}

/** Whole seconds elapsed since an ISO timestamp (clamped at >= 0). */
function elapsedSeconds(
    at: string | null | undefined,
    pausedAt?: string | null,
): number {
    if (!at) return 0
    const started = new Date(at).getTime()
    if (!Number.isFinite(started)) return 0
    const diff = clockNow(pausedAt) - started
    return diff > 0 ? Math.floor(diff / 1000) : 0
}

/** Format a number of seconds as m:ss. */
function formatClock(totalSecs: number): string {
    const s = Math.max(0, Math.floor(totalSecs))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/**
 * Which phase a TIMER-mode match is in.
 *  - "FIRST_HALF"  - 1st half running.
 *  - "HALFTIME"    - 1st half ended ("pauza"), 2nd half not yet started.
 *  - "SECOND_HALF" - 2nd half running.
 *  - "FULL_TIME"   - the running half's clock has run out (finish-ready / "Kraj").
 */
export type MatchPhase = "FIRST_HALF" | "HALFTIME" | "SECOND_HALF" | "FULL_TIME"

/**
 * Compute the current phase of a TIMER-mode match.
 *
 * The phase is an EXPLICIT state machine driven by which instants are set, not
 * inferred from the running clock:
 *  - 1st half running        → "FIRST_HALF"
 *  - {@code firstHalfEndedAt} → "HALFTIME"  (organizer ended the 1st half)
 *  - {@code secondHalfStartedAt} → "SECOND_HALF"
 *
 * The half length only decides when a *running* half's clock has expired
 * (→ "FULL_TIME", a finish-ready signal); it never advances the phase on its
 * own, so the clock freezes at the end of a half and waits for the organizer.
 * With no half length the clock free-runs and only the explicit instants move
 * the phase along.
 */
export function matchPhase({
    liveStartedAt,
    firstHalfEndedAt,
    secondHalfStartedAt,
    livePausedAt,
    halfLengthMin,
    halfCount,
}: {
    liveStartedAt: string | null | undefined
    firstHalfEndedAt?: string | null
    secondHalfStartedAt?: string | null
    /** While set, elapsed time is measured up to this instant (clock paused). */
    livePausedAt?: string | null
    halfLengthMin?: number | null
    halfCount?: number | null
}): MatchPhase {
    const halfSecs = halfLengthMin != null && halfLengthMin > 0 ? halfLengthMin * 60 : null
    // Single period only when the config explicitly says so; a missing/null
    // halfCount must NOT collapse the match to one half (futsal default = 2).
    const halves = halfCount === 1 ? 1 : 2

    // 2nd half running - full time once its clock expires (still manual finish).
    if (secondHalfStartedAt) {
        if (halfSecs != null && elapsedSeconds(secondHalfStartedAt, livePausedAt) >= halfSecs) return "FULL_TIME"
        return "SECOND_HALF"
    }

    // 1st half explicitly ended → half-time "pauza" (2nd half not yet started).
    if (firstHalfEndedAt) return "HALFTIME"

    // 1st half running. A single-period match reaches full time when its clock
    // expires; a two-half match freezes at 0:00 and waits for "Završi 1. pol.".
    if (halves === 1 && halfSecs != null && elapsedSeconds(liveStartedAt, livePausedAt) >= halfSecs) {
        return "FULL_TIME"
    }
    return "FIRST_HALF"
}

type LiveClockProps = {
    liveStartedAt: string | null | undefined
    /** ISO timestamp the 1st half ended ("pauza"); freezes the clock at half-time. */
    firstHalfEndedAt?: string | null
    /** ISO timestamp the 2nd half started; enables 2nd-half timing. */
    secondHalfStartedAt?: string | null
    /** ISO timestamp the clock was PAUSED by the organizer; freezes the display. */
    livePausedAt?: string | null
    /** Length of one half in minutes; when absent the clock just free-runs. */
    halfLengthMin?: number | null
    /** Number of halves (periods); 1 = single period, >= 2 = two halves. */
    halfCount?: number | null
    /** When true, render the phase label ("Poluvrijeme" / "2. pol." / "Kraj"). */
    showLabel?: boolean
    /** Display size: "xs" (inline rows, default) or "md" (live cards). */
    size?: "xs" | "md"
}

/** Everything a clock display needs, derived from the match's live instants.
 *  Shared by the small inline LiveClock and the big console clock. */
export function clockState({
    liveStartedAt,
    firstHalfEndedAt,
    secondHalfStartedAt,
    livePausedAt,
    halfLengthMin,
    halfCount,
}: Omit<LiveClockProps, "showLabel">): {
    display: string
    label: string
    /** True while a half's clock is actually ticking (not paused / boundary). */
    running: boolean
    paused: boolean
    /** True in the last 60s of a running half (amber warning). */
    endingSoon: boolean
} {
    const paused = !!livePausedAt

    // Free-running clock - no half config supplied.
    if (halfLengthMin == null || halfLengthMin <= 0) {
        return {
            display: elapsedClock(liveStartedAt, livePausedAt),
            label: paused ? "Pauza" : "",
            running: !paused,
            paused,
            endingSoon: false,
        }
    }

    const halfSecs = halfLengthMin * 60
    const halves = halfCount === 1 ? 1 : 2
    const phase = matchPhase({ liveStartedAt, firstHalfEndedAt, secondHalfStartedAt, livePausedAt, halfLengthMin, halfCount })

    // Match-clock behaviour: the clock COUNTS UP the cumulative match minute and
    // freezes at each half boundary. 1st half runs 0:00 → the half length; at
    // half-time it holds on the half length; the 2nd half continues from there
    // → 2× the half length. It never advances past a boundary on its own - it
    // waits for the organizer (end 1st half / start 2nd half / finish).
    let elapsedInHalf = 0 // seconds into the currently running half (amber warning)
    let shownSecs: number
    let label: string
    switch (phase) {
        case "FIRST_HALF": {
            elapsedInHalf = elapsedSeconds(liveStartedAt, livePausedAt)
            shownSecs = Math.min(elapsedInHalf, halfSecs)
            label = "1. pol."
            break
        }
        case "HALFTIME": {
            shownSecs = halfSecs
            label = "Poluvrijeme"
            break
        }
        case "SECOND_HALF": {
            elapsedInHalf = elapsedSeconds(secondHalfStartedAt, livePausedAt)
            shownSecs = Math.min(halfSecs + elapsedInHalf, 2 * halfSecs)
            label = "2. pol."
            break
        }
        case "FULL_TIME":
        default: {
            shownSecs = halves * halfSecs
            label = "Kraj"
            break
        }
    }

    const inRunningPhase = phase === "FIRST_HALF" || phase === "SECOND_HALF"
    return {
        display: formatClock(shownSecs),
        label: paused && inRunningPhase ? "Pauza" : label,
        running: inRunningPhase && !paused,
        paused,
        endingSoon: inRunningPhase && !paused && halfSecs - elapsedInHalf <= 60,
    }
}

/**
 * A live, ticking match clock. Re-renders once a second.
 *
 * With no {@code halfLengthMin} it behaves as a plain free-running elapsed
 * clock. With a half config it counts UP the cumulative match minute and is
 * half-aware:
 *  - 1st half: counts up 0:00 → the half length, then holds there until the
 *    organizer ends the half (→ "Poluvrijeme" at the same frozen value).
 *  - 2nd half (once {@code secondHalfStartedAt} is set): continues from the
 *    half length → 2x the half length, then holds there ("Kraj").
 * While {@code livePausedAt} is set the display freezes at the pause instant.
 */
export function LiveClock({
    liveStartedAt,
    firstHalfEndedAt,
    secondHalfStartedAt,
    livePausedAt,
    halfLengthMin,
    halfCount,
    showLabel,
    size = "xs",
}: LiveClockProps) {
    const [, setTick] = useState(0)
    useEffect(() => {
        const id = setInterval(() => setTick((t) => t + 1), 1000)
        return () => clearInterval(id)
    }, [])

    const st = clockState({ liveStartedAt, firstHalfEndedAt, secondHalfStartedAt, livePausedAt, halfLengthMin, halfCount })
    const clockColor = st.paused ? "fg.muted" : st.endingSoon ? "accent.amber" : "red.fg"
    const iconSize = size === "md" ? 14 : 11

    return (
        <Text
            as="span"
            fontSize={size === "md" ? "md" : "xs"}
            fontWeight="bold"
            fontVariantNumeric="tabular-nums"
            color={clockColor}
            display="inline-flex"
            alignItems="center"
            gap="1"
            whiteSpace="nowrap"
        >
            {(showLabel || st.paused) && st.label && (
                <Text as="span" color="fg.muted" fontWeight="medium">
                    {st.label}
                </Text>
            )}
            {st.paused ? <FiPause size={iconSize} /> : <FiClock size={iconSize} />}
            {st.display}
        </Text>
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   LiveConsoleHeader - the big scoreboard head of the organizer's match
   console (dialogs + /uzivo panel). Layout, top to bottom:
     1. UŽIVO pill (left) · ⋯ actions menu slot (right)
     2. BIG central timer (TIMER matches) with a pause/play button beside it
        and the phase label underneath ("1. POLUVRIJEME" / "PAUZA" / ...)
     3. Team names (wrap to 2 lines) around the big score
     4. `belowTeams` slot - fouls sit here, right under the names.
   ────────────────────────────────────────────────────────────────────────── */
export function LiveConsoleHeader({
    team1Name,
    team2Name,
    score1,
    score2,
    isLive,
    isFinished,
    isTimer,
    liveStartedAt,
    firstHalfEndedAt,
    secondHalfStartedAt,
    livePausedAt,
    halfLengthMin,
    halfCount,
    onPause,
    onResume,
    pauseBusy = false,
    menu,
    belowTeams,
}: {
    team1Name: string | null
    team2Name: string | null
    score1: number
    score2: number
    isLive: boolean
    isFinished: boolean
    isTimer: boolean
    liveStartedAt?: string | null
    firstHalfEndedAt?: string | null
    secondHalfStartedAt?: string | null
    livePausedAt?: string | null
    halfLengthMin?: number | null
    halfCount?: number | null
    /** Pause/resume the live clock. Button rendered only when both provided. */
    onPause?: () => void
    onResume?: () => void
    pauseBusy?: boolean
    /** Slot for the top-right ⋯ actions menu. */
    menu?: React.ReactNode
    /** Slot rendered directly under the team names (the fouls row lives here
     *  so the per-team counters sit right beneath each team). */
    belowTeams?: React.ReactNode
}) {
    // Tick every second so the big clock + phase label stay live.
    const [, setTick] = useState(0)
    useEffect(() => {
        if (!isLive || !isTimer) return
        const id = setInterval(() => setTick((t) => t + 1), 1000)
        return () => clearInterval(id)
    }, [isLive, isTimer])

    const st = isLive && isTimer
        ? clockState({ liveStartedAt, firstHalfEndedAt, secondHalfStartedAt, livePausedAt, halfLengthMin, halfCount })
        : null
    const phase = isLive && isTimer
        ? matchPhase({ liveStartedAt, firstHalfEndedAt, secondHalfStartedAt, livePausedAt, halfLengthMin, halfCount })
        : null
    // Pause makes sense only while a half's clock is running (or paused).
    const canPauseResume =
        !!onPause && !!onResume && (phase === "FIRST_HALF" || phase === "SECOND_HALF")
    const paused = !!livePausedAt

    const phaseLabel =
        phase == null
            ? null
            : paused && (phase === "FIRST_HALF" || phase === "SECOND_HALF")
                ? "PAUZA"
                : phase === "FIRST_HALF" ? "1. POLUVRIJEME"
                    : phase === "HALFTIME" ? "POLUVRIJEME"
                        : phase === "SECOND_HALF" ? "2. POLUVRIJEME"
                            : "KRAJ"

    return (
        <VStack gap="1" align="stretch" w="full">
            {/* Top strip: UŽIVO left · ⋯ menu right. */}
            {(isLive || menu) && (
                <Flex align="center" justify="space-between" gap="2" minH="8">
                    <Box>
                        {isLive && (
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
                        )}
                    </Box>
                    <Box>{menu}</Box>
                </Flex>
            )}

            {/* BIG central timer + pause/play + phase label. The timer itself is
                truly centred; the pause/play button is absolutely positioned to
                its RIGHT so it never shifts the timer off-centre. */}
            {isLive && isTimer && st && (
                <VStack gap="0.5" align="center">
                    <Box position="relative" display="inline-flex" alignItems="center" justifyContent="center">
                        <Text
                            fontFamily="mono"
                            fontSize={{ base: "38px", md: "44px" }}
                            fontWeight={800}
                            lineHeight="1"
                            fontVariantNumeric="tabular-nums"
                            color={st.paused ? "fg.muted" : st.endingSoon ? "accent.amber" : "red.fg"}
                        >
                            {st.display}
                        </Text>
                        {canPauseResume && (
                            <Box position="absolute" left="100%" ml="3" top="50%" transform="translateY(-50%)">
                                <IconButton
                                    aria-label={paused ? "Nastavi mjerač" : "Pauziraj mjerač"}
                                    title={paused ? "Nastavi mjerač" : "Pauziraj mjerač"}
                                    size="lg"
                                    variant={paused ? "solid" : "outline"}
                                    colorPalette={paused ? "brand" : "gray"}
                                    rounded="full"
                                    loading={pauseBusy}
                                    onClick={paused ? onResume : onPause}
                                >
                                    {paused ? <FiPlay size={24} /> : <FiPause size={24} />}
                                </IconButton>
                            </Box>
                        )}
                    </Box>
                    {phaseLabel && (
                        <Text
                            fontFamily="mono"
                            fontSize="2xs"
                            fontWeight={800}
                            letterSpacing="0.12em"
                            color={paused ? "accent.amber" : "fg.muted"}
                        >
                            {phaseLabel}
                        </Text>
                    )}
                </VStack>
            )}

            {/* Teams + big score. Names are bigger (next to the result) and wrap
                to 2 lines so long club names fit. */}
            <Box
                display="grid"
                gridTemplateColumns="1fr auto 1fr"
                alignItems="center"
                gap="3"
                w="full"
            >
                <Text fontSize={{ base: "lg", md: "xl" }} fontWeight={800} color="fg.ink" minW="0" textAlign="right" lineClamp="2">
                    {team1Name ?? "-"}
                </Text>
                <Text
                    fontFamily="mono"
                    fontSize="2xl"
                    fontWeight={800}
                    fontVariantNumeric="tabular-nums"
                    color={isFinished ? "fg.ink" : "red.fg"}
                    flexShrink={0}
                >
                    {score1} : {score2}
                </Text>
                <Text fontSize={{ base: "lg", md: "xl" }} fontWeight={800} color="fg.ink" minW="0" textAlign="left" lineClamp="2">
                    {team2Name ?? "-"}
                </Text>
            </Box>

            {/* Fouls (or any per-team row) sit right under the team names. */}
            {belowTeams}
        </VStack>
    )
}

/**
 * The "Start" control - a menu offering the two live-tracking modes plus an
 * "enter result only" shortcut (folds in the old separate "Rezultat" button).
 */
export function StartLivePopover({
    onStart,
    onEnterResult,
    loading,
}: {
    onStart: (mode: MatchLiveMode) => void
    /** Optional - adds an "Unesi samo rezultat" item that opens the score
     *  editor directly, without going live. */
    onEnterResult?: () => void
    loading?: boolean
}) {
    return (
        <Menu.Root>
            <Menu.Trigger asChild>
                <Button size="sm" variant="solid" colorPalette="red" loading={loading}>
                    <FiPlay /> Start
                </Button>
            </Menu.Trigger>
            <Portal>
                <Menu.Positioner>
                    <Menu.Content minW="60">
                        <Menu.Item value="timer" onClick={() => onStart("TIMER")}>
                            <FiClock />
                            <Text ml="2">Uživo - s mjeračem vremena</Text>
                        </Menu.Item>
                        <Menu.Item value="simple" onClick={() => onStart("SIMPLE")}>
                            <FiPlay />
                            <Text ml="2">Uživo - bez mjerača (vlastiti sat)</Text>
                        </Menu.Item>
                        {onEnterResult && (
                            <Menu.Item value="result" onClick={onEnterResult}>
                                <FiEdit2 />
                                <Text ml="2">Unesi samo rezultat</Text>
                            </Menu.Item>
                        )}
                    </Menu.Content>
                </Menu.Positioner>
            </Portal>
        </Menu.Root>
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   DirectScoreEditor - set/fix a match's FINAL SCORE directly, without
   attributing goals to individual scorers. Shown in the live/zapisnik dialogs
   for a match that has no goal events yet (a "result-only" match), so the
   organizer can just type the score instead of tapping in every goal. API is
   passed in via `onSave` so this component stays backend-agnostic (group ->
   recordGroupResult, knockout -> recordKnockoutResult). Defaults to 0 : 0.
   ────────────────────────────────────────────────────────────────────────── */
export function DirectScoreEditor({
    team1Name,
    team2Name,
    initialS1,
    initialS2,
    saving,
    onSave,
    onChange,
    hideSaveButton = false,
}: {
    team1Name: string | null
    team2Name: string | null
    initialS1: number
    initialS2: number
    saving?: boolean
    onSave: (s1: number, s2: number) => void
    /** Reported on every stepper change, so a caller that renders its own save
     *  button (e.g. in a dialog footer) can read the current score. */
    onChange?: (s1: number, s2: number) => void
    /** Hide the built-in "Spremi rezultat" button (the caller renders one). */
    hideSaveButton?: boolean
}) {
    const [s1, setS1] = useState<number>(Math.max(0, initialS1 ?? 0))
    const [s2, setS2] = useState<number>(Math.max(0, initialS2 ?? 0))
    const update1 = (n: number) => { setS1(n); onChange?.(n, s2) }
    const update2 = (n: number) => { setS2(n); onChange?.(s1, n) }

    const Stepper = ({
        name,
        value,
        set,
    }: {
        name: string | null
        value: number
        set: (n: number) => void
    }) => (
        <VStack gap="1.5" flex="1" minW="0">
            <Text fontSize="12px" fontWeight={700} color="fg.ink" truncate maxW="full" title={name ?? "-"}>
                {name ?? "-"}
            </Text>
            <HStack gap="1.5">
                <IconButton
                    aria-label={`Smanji ${name ?? ""}`}
                    size="xs"
                    variant="outline"
                    disabled={value <= 0 || saving}
                    onClick={() => set(Math.max(0, value - 1))}
                >
                    <FiMinus />
                </IconButton>
                <Text
                    fontFamily="mono"
                    fontSize="xl"
                    fontWeight={800}
                    fontVariantNumeric="tabular-nums"
                    minW="24px"
                    textAlign="center"
                >
                    {value}
                </Text>
                <IconButton
                    aria-label={`Povećaj ${name ?? ""}`}
                    size="xs"
                    variant="outline"
                    disabled={saving}
                    onClick={() => set(value + 1)}
                >
                    <FiPlus />
                </IconButton>
            </HStack>
        </VStack>
    )

    return (
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
                Unesi rezultat (bez strijelaca)
            </Text>
            <HStack align="center" gap="2">
                <Stepper name={team1Name} value={s1} set={update1} />
                <Text fontFamily="mono" fontSize="lg" fontWeight={800} color="fg.muted" pt="4">
                    :
                </Text>
                <Stepper name={team2Name} value={s2} set={update2} />
            </HStack>
            {!hideSaveButton && (
                <Flex justify="center" mt="3">
                    <Button size="sm" colorPalette="pitch" loading={saving} onClick={() => onSave(s1, s2)}>
                        <FiEdit2 /> Spremi rezultat
                    </Button>
                </Flex>
            )}
        </Box>
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   LiveEventRow - one row of the organizer's live-entry "tijek utakmice".

   Laid out left/right by team (team1 on the LEFT half, team2 on the RIGHT) to
   mirror the public GoalscorersPanel timeline, with an organizer-only delete
   button on the inner (centre) side. Handles goals/cards and penalty-shootout
   kicks (✓/✗, labelled "pen").
   ────────────────────────────────────────────────────────────────────────── */
export function LiveEventRow({
    ev,
    team1Id,
    canDelete,
    deleting,
    onDelete,
}: {
    ev: MatchEventDto
    team1Id: number | null
    canDelete: boolean
    deleting: boolean
    onDelete: () => void
}) {
    const isPenalty = ev.type === "PENALTY_GOAL" || ev.type === "PENALTY_MISSED"
    const isOwnGoal = ev.type === "OWN_GOAL"
    // OWN_GOAL's teamId is the BENEFICIARY, so the event naturally renders on
    // the side whose score went up (name carries the "(ag)" marker).
    const isLeft = ev.teamId === team1Id
    // Own goal gets its OWN icon (a red ball) so it's instantly distinct from a
    // regular goal; other types keep their emoji.
    const icon =
        ev.type === "GOAL" ? "⚽"
            : ev.type === "YELLOW_CARD" ? "🟨"
                : ev.type === "RED_CARD" ? "🟥"
                    : ev.type === "PENALTY_GOAL" ? "✓"
                        : "✗"
    const iconColor =
        ev.type === "PENALTY_GOAL" ? "pitch.500"
            : ev.type === "PENALTY_MISSED" ? "accent.red"
                : undefined
    const label = isPenalty ? "pen" : `${ev.minute}'`
    // No-name events: a goal without a named scorer shows "Nepoznati strijelac",
    // a card "Nepoznati igrač", an unattributed penalty kick "(gol)"/"(promašaj)".
    const noName = ev.playerName == null
    const displayName =
        ev.type === "OWN_GOAL"
            ? ev.playerName != null
                ? `${ev.playerName} (ag)`
                : "Autogol"
            : ev.playerName ??
              (ev.type === "GOAL"
                  ? "Nepoznati strijelac"
                  : ev.type === "YELLOW_CARD" || ev.type === "RED_CARD"
                      ? "Nepoznati igrač"
                      : ev.type === "PENALTY_MISSED"
                          ? "(promašaj)"
                          : "(gol)")

    const minuteEl = (
        <Text
            fontSize="2xs"
            fontWeight="bold"
            color="fg.muted"
            fontVariantNumeric="tabular-nums"
            whiteSpace="nowrap"
            flexShrink={0}
        >
            {label}
        </Text>
    )
    const iconEl = isOwnGoal ? (
        <Box as="span" display="inline-flex" lineHeight="1" flexShrink={0} color="accent.red">
            <GiSoccerBall size={14} />
        </Box>
    ) : (
        <Box
            as="span"
            fontSize="xs"
            lineHeight="1"
            flexShrink={0}
            color={iconColor}
            fontWeight={iconColor ? 800 : undefined}
        >
            {icon}
        </Box>
    )
    // Name hugs the centre (next to the delete column); minute + icon sit at
    // the outer edge. So left events right-align, right events left-align.
    const nameEl = (
        <VStack align={isLeft ? "flex-end" : "flex-start"} gap="0" minW="0" flex="1">
            <Text
                fontSize="xs"
                color={noName ? "fg.muted" : "fg.ink"}
                fontStyle={noName ? "italic" : undefined}
                lineHeight="1.3"
                truncate
                w="full"
                textAlign={isLeft ? "right" : "left"}
            >
                {displayName}
            </Text>
            {ev.assistPlayerName && (
                <Text
                    fontSize="2xs"
                    color="fg.muted"
                    lineHeight="1.2"
                    truncate
                    w="full"
                    textAlign={isLeft ? "right" : "left"}
                >
                    asist. {ev.assistPlayerName}
                </Text>
            )}
        </VStack>
    )
    const delEl = canDelete ? (
        <IconButton
            aria-label="Ukloni događaj"
            size="2xs"
            variant="ghost"
            colorPalette="red"
            loading={deleting}
            onClick={onDelete}
            flexShrink={0}
        >
            <FiTrash2 size={12} />
        </IconButton>
    ) : null

    // 3-column grid: the delete button always sits in the centre column so the
    // trash icons line up in one vertical column regardless of name lengths.
    // The event content fills the left (team1) or right (team2) outer column.
    return (
        <Box
            display="grid"
            gridTemplateColumns="1fr auto 1fr"
            columnGap="2"
            w="full"
            py="0.5"
            alignItems="center"
        >
            {isLeft ? (
                <>
                    <Flex align="center" gap="1.5" minW="0">
                        {minuteEl}
                        {iconEl}
                        {nameEl}
                    </Flex>
                    {delEl ?? <Box />}
                    <Box />
                </>
            ) : (
                <>
                    <Box />
                    {delEl ?? <Box />}
                    <Flex align="center" gap="1.5" minW="0">
                        {nameEl}
                        {iconEl}
                        {minuteEl}
                    </Flex>
                </>
            )}
        </Box>
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   GoalscorersPanel - shared between LiveMatchRow and ScheduleTab.

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
    halfLengthMin,
    pollMs,
    hideEmpty = false,
    emptyNote,
    refreshSignal,
}: {
    tournamentUuid: string
    matchId: number
    team1Id: number | null
    team2Id: number | null
    /** Half length (min) - splits the regulation timeline into "1./2.
     *  poluvrijeme" sections (an event's half = minute < / >= this). When
     *  absent the regulation events render as a single section. */
    halfLengthMin?: number | null
    /** When set, refetches events on this interval so live cards on the
     *  /uzivo page stay in sync as goals are scored. Leave undefined for
     *  the static "finished match" timeline. */
    pollMs?: number
    /** Render nothing (instead of "Još nema događaja.") when there are no
     *  events - used for finished matches (e.g. a 0:0) where the hint reads
     *  as a mistake rather than "events still to come". */
    hideEmpty?: boolean
    /** Optional message shown when there are no events at all - overrides both
     *  `hideEmpty` and the default "Još nema događaja." Used for a finished
     *  match where the organizer entered only the final score, no scorers. */
    emptyNote?: string
    /** Bump this (from a WebSocket live-update) to refetch immediately - the
     *  instant path; polling above is the fallback. */
    refreshSignal?: number
}) {
    const [state, setState] = useState<EventTimelineState>({ status: "idle" })

    const load = useCallback(
        (silent = false) => {
            if (!silent) setState({ status: "loading" })
            fetchMatchEvents(tournamentUuid, matchId)
                .then((all) => {
                    // Keep ALL events - goals/cards and penalty-shootout kicks;
                    // the render splits them into the regulation timeline and a
                    // separate "Penali" section.
                    let t1Id = team1Id
                    let t2Id = team2Id

                    if (t1Id == null || t2Id == null) {
                        const distinct = Array.from(new Set(all.map((e) => e.teamId))).sort(
                            (a, b) => a - b,
                        )
                        t1Id = distinct[0] ?? null
                        t2Id = distinct[1] ?? null
                    }

                    setState({ status: "done", events: all, t1Id, t2Id })
                })
                .catch(() => {
                    // On poll, keep previous data on screen instead of
                    // flashing the error state - transient 5xx shouldn't
                    // wipe a live timeline.
                    if (!silent) setState({ status: "error" })
                })
        },
        [tournamentUuid, matchId, team1Id, team2Id],
    )

    // Instant refetch when a WebSocket live-update bumps refreshSignal. A ref
    // holds the latest `load` so this fires ONLY on the signal change (not on
    // mount, and not when `load`'s deps shift - the poll effect covers those).
    const loadRef = useRef(load)
    loadRef.current = load
    const signalReady = useRef(false)
    useEffect(() => {
        if (refreshSignal === undefined) return
        if (!signalReady.current) {
            signalReady.current = true
            return
        }
        loadRef.current(true)
    }, [refreshSignal])

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

        // Regulation events (goals/cards) sit on the minute-sorted timeline;
        // penalty-shootout kicks get their own marked "Penali" section below.
        const regulation = events
            .filter((e) => e.type === "GOAL" || e.type === "OWN_GOAL" || e.type === "YELLOW_CARD" || e.type === "RED_CARD")
            .sort((a, b) => a.minute - b.minute)
        const penalties = events.filter(
            (e) => e.type === "PENALTY_GOAL" || e.type === "PENALTY_MISSED",
        )

        if (events.length === 0) {
            if (emptyNote) {
                return (
                    <Text fontSize="xs" color="fg.muted" textAlign="center">
                        {emptyNote}
                    </Text>
                )
            }
            if (hideEmpty) return null
            return (
                <Text fontSize="xs" color="fg.muted" textAlign="center">
                    Još nema događaja.
                </Text>
            )
        }

        // Group events into vertical-timeline sections. Regulation goals/cards
        // split into 1./2. poluvrijeme when the half length is known (an event's
        // half = its minute below / at-or-above the boundary); penalty-shootout
        // kicks always get their own "Penali" section.
        const sections: { key: string; title: string; events: MatchEventDto[] }[] = []
        const hl = halfLengthMin != null && halfLengthMin > 0 ? halfLengthMin : null
        if (regulation.length > 0) {
            if (hl != null) {
                const first = regulation.filter((e) => e.minute < hl)
                const second = regulation.filter((e) => e.minute >= hl)
                if (first.length) sections.push({ key: "h1", title: "1. poluvrijeme", events: first })
                if (second.length) sections.push({ key: "h2", title: "2. poluvrijeme", events: second })
            } else {
                // No half boundary known - one headerless timeline section (the
                // parent already labels the whole thing "Tijek utakmice").
                sections.push({ key: "reg", title: "", events: regulation })
            }
        }
        if (penalties.length > 0) {
            sections.push({ key: "pen", title: "Penali", events: penalties })
        }

        // Running score for the goal pills (SofaScore-style, shown centred on
        // the line). Cumulative over the minute-sorted regulation goals - only
        // GOAL/OWN_GOAL move the score; cards don't.
        const scoreLabels = new Map<number, string>()
        let rs1 = 0
        let rs2 = 0
        for (const e of regulation) {
            if (e.type === "GOAL" || e.type === "OWN_GOAL") {
                if (e.teamId === t1Id) rs1++
                else rs2++
                scoreLabels.set(e.id, `${rs1} - ${rs2}`)
            }
        }

        return (
            <Box position="relative" w="full">
                {/* Continuous dashed central line behind everything; the dots
                    sit on it and the section-header chips mask it behind their
                    text. The left/right labels never cross the centre, so the
                    line only ever shows in the empty middle column. */}
                <Box
                    position="absolute"
                    top="3"
                    bottom="3"
                    left="50%"
                    transform="translateX(-50%)"
                    borderLeftWidth="2px"
                    borderColor="border"
                    borderStyle="dashed"
                    zIndex={0}
                />
                <VStack align="stretch" gap="0" w="full" position="relative" zIndex={1}>
                {sections.map((sec) => (
                    <Box key={sec.key} w="full">
                        {/* Section header ("1./2. poluvrijeme" / "Penali") -
                            centred, masks the dashed line behind it. */}
                        {sec.title && (
                            <Flex justify="center" py="2">
                                <Text
                                    px="3"
                                    bg="bg.panel"
                                    fontSize="xs"
                                    fontWeight={700}
                                    letterSpacing="0.04em"
                                    color="fg.muted"
                                    textAlign="center"
                                    whiteSpace="nowrap"
                                >
                                    {sec.title}
                                </Text>
                            </Flex>
                        )}
                        {sec.events.map((evt) => (
                            <TimelineEventLine
                                key={evt.id}
                                evt={evt}
                                isLeft={evt.teamId === t1Id}
                                scoreLabel={scoreLabels.get(evt.id) ?? null}
                            />
                        ))}
                    </Box>
                ))}
                </VStack>
            </Box>
        )
    }

    return null
}

/**
 * One event on the centred match timeline: a coloured dot sitting on the
 * central vertical line, with the event label branching to its team's side
 * (team1 → left, team2 → right). The icon always sits nearest the line.
 */
export function TimelineEventLine({
    evt,
    isLeft,
    scoreLabel,
}: {
    evt: MatchEventDto
    isLeft: boolean
    /** SofaScore-style running score at this goal (e.g. "1 - 2"); a small pill
     *  sits nearest the centre line on the scoring side. Null for cards. */
    scoreLabel?: string | null
}) {
    const isPenGoal = evt.type === "PENALTY_GOAL"
    const isPenMiss = evt.type === "PENALTY_MISSED"
    const isPenalty = isPenGoal || isPenMiss
    const isOwnGoal = evt.type === "OWN_GOAL"

    // Icon nearest the line: ⚽ for a (penalty) goal, ❌ for a missed penalty,
    // 🟨 / 🟥 for cards. An own goal gets its OWN red-ball icon (rendered
    // below), so it's not part of this emoji map.
    const icon = isPenMiss
        ? "❌"
        : isPenGoal
            ? "⚽"
            : EVENT_ICON[evt.type]
                ? String.fromCodePoint(parseInt(EVENT_ICON[evt.type], 16))
                : "•"

    // Central markers on the timeline line are a uniform ink (black) dot; the
    // event's colour comes from its icon instead (⚽ goal / red-ball own goal /
    // 🟨 yellow / 🟥 red), so the line reads as one clean spine.
    const dotColor = "fg.ink"

    // Penalty kicks carry no meaningful match minute; regulation events do.
    const showMinute = !isPenalty
    const noName = evt.playerName == null
    const name = isOwnGoal
        ? evt.playerName != null
            ? `${evt.playerName} (ag)`
            : "Autogol"
        : evt.playerName ??
          (evt.type === "GOAL" || isPenGoal
              ? "Nepoznati strijelac"
              : evt.type === "YELLOW_CARD" || evt.type === "RED_CARD"
                  ? "Nepoznati igrač"
                  : isPenMiss
                      ? "(promašaj)"
                      : "")

    const minuteEl = showMinute ? (
        <Text fontSize="xs" fontWeight="bold" color="fg" whiteSpace="nowrap" flexShrink={0}>
            {evt.minute}&apos;
        </Text>
    ) : null
    const iconEl = isOwnGoal ? (
        <Box as="span" display="inline-flex" flexShrink={0} lineHeight="1.4" color="red.solid">
            <GiSoccerBall size={13} />
        </Box>
    ) : (
        <Text fontSize="xs" flexShrink={0} lineHeight="1.4">
            {icon}
        </Text>
    )
    // SofaScore-style running-score pill (goals only). Rendered in the CENTRE
    // of the row in place of the dot, so the scorer name keeps the full side
    // width (and can wrap to two lines instead of truncating).
    const pillEl = scoreLabel ? (
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
            flexShrink={0}
        >
            {scoreLabel}
        </Box>
    ) : null
    const nameEl = (
        <VStack align={isLeft ? "flex-end" : "flex-start"} gap="0" minW="0">
            <Text
                fontSize="xs"
                color={noName ? "fg.muted" : "fg"}
                fontStyle={noName ? "italic" : undefined}
                lineHeight="1.3"
                lineClamp="3"
                css={{ overflowWrap: "anywhere" }}
                textAlign={isLeft ? "right" : "left"}
            >
                {name}
            </Text>
            {evt.type === "GOAL" && evt.assistPlayerName && (
                <Text
                    fontSize="2xs"
                    color="fg.muted"
                    lineHeight="1.3"
                    lineClamp="3"
                    css={{ overflowWrap: "anywhere" }}
                    textAlign={isLeft ? "right" : "left"}
                >
                    asist. {evt.assistPlayerName}
                </Text>
            )}
        </VStack>
    )

    return (
        // The centre column is a FIXED width (not `auto`) so the icons on each
        // side line up in one vertical column regardless of what sits in the
        // centre - a wide running-score pill (goal) or a small dot (card). With
        // `auto`, the pill widened the centre and pushed goal icons outward while
        // card icons hugged the line; a fixed width keeps every row's icon at the
        // same distance from the centre.
        <Box display="grid" gridTemplateColumns="minmax(0,1fr) 3.5rem minmax(0,1fr)" w="full" alignItems="stretch">
            {/* Left cell (team1) - pushed toward the centre line. */}
            <Flex align="center" justify="flex-end" gap="1" pr="1" py="1.5" minW="0" overflow="hidden">
                {isLeft && (
                    <>
                        {nameEl}
                        {minuteEl}
                        {iconEl}
                    </>
                )}
            </Flex>
            {/* Centre: the running-score pill for goals (e.g. "0 - 1"), else a
                coloured (ink) dot; both sit centred on the continuous central
                line drawn by the panel behind this row. */}
            <Flex align="center" justify="center" px="1">
                {pillEl ?? <Box boxSize="10px" rounded="full" bg={dotColor} />}
            </Flex>
            {/* Right cell (team2) - pushed toward the centre line. */}
            <Flex align="center" justify="flex-start" gap="1" pl="1" py="1.5" minW="0" overflow="hidden">
                {!isLeft && (
                    <>
                        {iconEl}
                        {minuteEl}
                        {nameEl}
                    </>
                )}
            </Flex>
        </Box>
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   LiveGoalEntry - fast goal/card entry for the organizer's live dialog.

   Layout: a type toggle (⚽ Gol · 🟨 · 🟥) + a minute field on top, then the
   two teams' rosters side by side. One tap on a player records the selected
   event for that player at the shown minute - so a goal is a single tap.

   Minute: for TIMER matches it auto-tracks the live match minute (still
   editable; "Sada" re-syncs after a manual change). For SIMPLE / no-clock
   matches the organizer types the minute. Assists were intentionally dropped
   to keep entry quick.
   ────────────────────────────────────────────────────────────────────────── */

/**
 * Current cumulative football minute of a TIMER match - matches the count-up
 * clock, capped at each half boundary (1st half ≤ half length, 2nd half ≤ 2×).
 */
export function liveMatchMinute(args: {
    liveStartedAt: string | null | undefined
    firstHalfEndedAt?: string | null
    secondHalfStartedAt: string | null | undefined
    livePausedAt?: string | null
    halfLengthMin: number | null
    halfCount: number | null
}): number {
    const hl = args.halfLengthMin ?? 0
    const halves = args.halfCount === 1 ? 1 : 2
    const paused = args.livePausedAt
    const phase = matchPhase(args)
    switch (phase) {
        case "FIRST_HALF":
            return hl > 0
                ? Math.min(elapsedMinutes(args.liveStartedAt, paused), hl)
                : elapsedMinutes(args.liveStartedAt, paused)
        case "HALFTIME":
            return hl
        case "SECOND_HALF":
            return hl > 0
                ? Math.min(hl + elapsedMinutes(args.secondHalfStartedAt, paused), halves * hl)
                : hl + elapsedMinutes(args.secondHalfStartedAt, paused)
        case "FULL_TIME":
            return halves * hl
        default:
            return elapsedMinutes(args.liveStartedAt, paused)
    }
}

/**
 * Feature flag for the "Nepoznati strijelac" (unknown scorer) button - records
 * a goal for the team with no named scorer. Flip to false to hide it.
 */
const ANON_GOAL_ENABLED = true

export function LiveGoalEntry({
    uuid,
    matchId,
    team1Id,
    team1Name,
    team2Id,
    team2Name,
    liveMode,
    liveStartedAt,
    firstHalfEndedAt,
    secondHalfStartedAt,
    livePausedAt,
    halfLengthMin,
    halfCount,
    onAdded,
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
    liveMode: MatchLiveMode | null | undefined
    liveStartedAt: string | null | undefined
    firstHalfEndedAt?: string | null
    secondHalfStartedAt: string | null | undefined
    /** ISO instant the clock was paused; freezes the auto-minute too. */
    livePausedAt?: string | null
    halfLengthMin: number | null
    halfCount: number | null
    onAdded: () => Promise<void> | void
    /** Offline-aware add. When provided, events are recorded through the
     *  optimistic/offline queue instead of a direct online POST + refetch. */
    onAddEvent?: (payload: CreateMatchEventRequest, display: OptimisticDisplay) => void
    /** Players sent off (red card) in this match - greyed out and not
     *  selectable, since they can't score or otherwise affect play. */
    sentOffPlayerIds?: Set<number>
    /** Players with a yellow card in this match - shown with a 🟨 marker
     *  next to their name (still selectable). */
    yellowCardedPlayerIds?: Set<number>
}) {
    const isTimer = liveMode === "TIMER"
    const [rosters, setRosters] = useState<Record<number, PlayerDto[]>>({})
    const [kind, setKind] = useState<MatchEventType>("GOAL")
    const [minute, setMinute] = useState<string>("0")
    /** While true (TIMER) the "Min" field auto-follows the running clock; a
     *  manual edit turns it off, "Sada" turns it back on. */
    const [autoMinute, setAutoMinute] = useState(true)
    /** playerId whose add call is in flight (for the per-button spinner). */
    const [addingId, setAddingId] = useState<number | null>(null)
    /** teamId whose anonymous add is in flight. */
    const [addingAnon, setAddingAnon] = useState<number | null>(null)

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

    // Auto-follow the live match minute (TIMER): the "Min" field tracks the
    // running clock every second so a goal is stamped with the current minute
    // without any extra tap - until the organizer types a manual value, when
    // following stops; "Sada" resumes it.
    useEffect(() => {
        if (!isTimer || !autoMinute) return
        const sync = () =>
            setMinute(String(liveMatchMinute({
                liveStartedAt,
                firstHalfEndedAt,
                secondHalfStartedAt,
                livePausedAt,
                halfLengthMin,
                halfCount,
            })))
        sync()
        const id = setInterval(sync, 1000)
        return () => clearInterval(id)
    }, [isTimer, autoMinute, liveStartedAt, firstHalfEndedAt, secondHalfStartedAt, livePausedAt, halfLengthMin, halfCount])

    const minuteNum = parseInt(minute, 10)
    const minuteValid = Number.isFinite(minuteNum) && minuteNum >= 0

    // Timeline side for an event committed by `committingTeamId`: normally that
    // team, but an own goal shows on (counts for) the OTHER side.
    function sideFor(committingTeamId: number | null): number | null {
        if (kind !== "OWN_GOAL") return committingTeamId
        if (team1Id == null || team2Id == null || committingTeamId == null) return committingTeamId
        return committingTeamId === team1Id ? team2Id : team1Id
    }
    /** Which roster (team) a picked player belongs to. */
    function teamOfPlayer(p: PlayerDto): number | null {
        if (team1Id != null && (rosters[team1Id] ?? []).some((x) => x.id === p.id)) return team1Id
        if (team2Id != null && (rosters[team2Id] ?? []).some((x) => x.id === p.id)) return team2Id
        return team1Id ?? team2Id
    }

    async function pick(p: PlayerDto) {
        if (!minuteValid || addingId != null) return
        if (sentOffPlayerIds?.has(p.id)) return // sent off - can't affect play
        const payload: CreateMatchEventRequest = {
            type: kind,
            playerId: p.id,
            minute: minuteNum,
            assistPlayerId: null,
        }
        // Offline-aware path: record optimistically, queue if disconnected.
        if (onAddEvent) {
            const side = sideFor(teamOfPlayer(p))
            if (side == null) return
            onAddEvent(payload, {
                type: kind,
                playerId: p.id,
                playerName: p.name,
                teamId: side,
                minute: minuteNum,
            })
            return
        }
        setAddingId(p.id)
        try {
            await addMatchEvent(uuid, matchId, payload)
            await onAdded()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setAddingId(null)
        }
    }

    // Anonymous event - counts for the team, no named player. Works for every
    // event kind: unknown scorer, unknown own-goal, and an unknown carded
    // player (who obviously can't be locked out of play - it's a timeline
    // record only). Recorded with teamId instead of playerId.
    async function pickAnon(teamId: number) {
        if (!minuteValid || addingId != null || addingAnon != null) return
        const payload: CreateMatchEventRequest = {
            type: kind,
            playerId: null,
            teamId,
            minute: minuteNum,
            assistPlayerId: null,
        }
        if (onAddEvent) {
            const side = sideFor(teamId)
            if (side == null) return
            onAddEvent(payload, {
                type: kind,
                playerId: null,
                playerName: null,
                teamId: side,
                minute: minuteNum,
            })
            return
        }
        setAddingAnon(teamId)
        try {
            await addMatchEvent(uuid, matchId, payload)
            await onAdded()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setAddingAnon(null)
        }
    }

    const TYPES: { value: MatchEventType; label: React.ReactNode; title: string }[] = [
        { value: "GOAL", label: "⚽ Gol", title: "Gol" },
        {
            value: "OWN_GOAL",
            // Own goal gets a red ball (matches the timeline / fullscreen).
            label: (
                <>
                    <Box as="span" display="inline-flex" alignItems="center" color="accent.red" mr="1">
                        <GiSoccerBall size={15} />
                    </Box>
                    AG
                </>
            ),
            title: "Autogol - gol u vlastitu mrežu (bod ide protivniku)",
        },
        { value: "YELLOW_CARD", label: "🟨", title: "Žuti karton" },
        { value: "RED_CARD", label: "🟥", title: "Crveni karton" },
    ]

    // The label of the per-team "unknown player" button follows the kind.
    const anonLabel =
        kind === "GOAL" ? "⚽ Nepoznati strijelac"
            : kind === "OWN_GOAL" ? "⚽ Autogol (nepoznati)"
                : kind === "YELLOW_CARD" ? "🟨 Nepoznati igrač"
                    : "🟥 Nepoznati igrač"

    return (
        <Box>
            {/* Type toggle - all four in ONE compact row (equal width); the
                minute field sits on its own row below so nothing wraps on
                mobile and the four card types always stay on a single line. */}
            <VStack gap="2" align="stretch" mb="2">
                <HStack gap="1" w="full">
                    {TYPES.map((t) => (
                        <Button
                            key={t.value}
                            flex="1"
                            minW="0"
                            px="1"
                            size={{ base: "xs", md: "sm" }}
                            variant={kind === t.value ? "solid" : "outline"}
                            colorPalette={kind === t.value ? "brand" : "gray"}
                            onClick={() => setKind(t.value)}
                            title={t.title}
                        >
                            {t.label}
                        </Button>
                    ))}
                </HStack>
                <HStack gap="2">
                    <Text fontSize="xs" color="fg.muted" fontWeight="medium">
                        Min
                    </Text>
                    <Input
                        size="sm"
                        type="number"
                        min={0}
                        maxW="20"
                        value={minute}
                        onChange={(e) => {
                            setMinute(e.target.value)
                            setAutoMinute(false) // manual override - stop auto-follow
                        }}
                    />
                    {isTimer && (
                        <Button
                            size="sm"
                            variant={autoMinute ? "solid" : "outline"}
                            colorPalette="brand"
                            onClick={() => setAutoMinute(true)}
                            title={autoMinute ? "Minuta automatski prati mjerač" : "Vrati na automatsko praćenje mjerača"}
                        >
                            Sada
                        </Button>
                    )}
                </HStack>
            </VStack>
            
            {!minuteValid && (
                <Text fontSize="xs" color="red.fg" mb="2">
                    Unesi minutu.
                </Text>
            )}

            {/* Two rosters side by side - tap a player to record the event. */}
            <Grid templateColumns="1fr 1fr" gap="2">
                <PlayerPickColumn
                    teamName={team1Name}
                    teamId={team1Id}
                    players={team1Id != null ? rosters[team1Id] ?? [] : []}
                    addingId={addingId}
                    disabled={!minuteValid}
                    sentOffPlayerIds={sentOffPlayerIds}
                    yellowCardedPlayerIds={yellowCardedPlayerIds}
                    onPick={pick}
                    showAnon={ANON_GOAL_ENABLED}
                    anonLabel={anonLabel}
                    addingAnon={addingAnon}
                    onAnon={pickAnon}
                />
                <PlayerPickColumn
                    teamName={team2Name}
                    teamId={team2Id}
                    players={team2Id != null ? rosters[team2Id] ?? [] : []}
                    addingId={addingId}
                    disabled={!minuteValid}
                    sentOffPlayerIds={sentOffPlayerIds}
                    yellowCardedPlayerIds={yellowCardedPlayerIds}
                    onPick={pick}
                    showAnon={ANON_GOAL_ENABLED}
                    anonLabel={anonLabel}
                    addingAnon={addingAnon}
                    onAnon={pickAnon}
                    align="right"
                />
            </Grid>
        </Box>
    )
}

function PlayerPickColumn({
    teamName,
    teamId,
    players,
    addingId,
    disabled,
    sentOffPlayerIds,
    yellowCardedPlayerIds,
    onPick,
    showAnon = false,
    anonLabel = "Nepoznati igrač",
    addingAnon = null,
    onAnon,
    align = "left",
}: {
    teamName: string | null
    teamId?: number | null
    players: PlayerDto[]
    addingId: number | null
    disabled: boolean
    sentOffPlayerIds?: Set<number>
    /** Players with a yellow card - 🟨 marker beside the name (still selectable). */
    yellowCardedPlayerIds?: Set<number>
    onPick: (p: PlayerDto) => void
    /** Show the "unknown player" button first, above the roster - records the
     *  current event kind for the team with no named player. */
    showAnon?: boolean
    anonLabel?: string
    addingAnon?: number | null
    onAnon?: (teamId: number) => void
    align?: "left" | "right"
}) {
    return (
        <VStack align="stretch" gap="1" minW="0">
            <Text
                fontSize="sm"
                fontWeight={800}
                color="fg.ink"
                textAlign={align}
                lineClamp="2"
                lineHeight="1.2"
            >
                {teamName ?? "-"}
            </Text>
            {/* Unknown player - the event counts for the team, no named player.
                ALWAYS first in the list so it's the quickest tap. */}
            {showAnon && teamId != null && (
                <Button
                    size="sm"
                    h="10"
                    variant="outline"
                    colorPalette="gray"
                    justifyContent={align === "right" ? "flex-end" : "flex-start"}
                    loading={addingAnon === teamId}
                    disabled={disabled || addingId != null || (addingAnon != null && addingAnon !== teamId)}
                    onClick={() => onAnon?.(teamId)}
                    title="Događaj za ekipu bez imena igrača"
                    aria-label={anonLabel}
                >
                    <Text truncate fontStyle="italic" color="fg.muted">{anonLabel}</Text>
                </Button>
            )}
            {players.length === 0 ? (
                <Text fontSize="xs" color="fg.subtle" textAlign={align}>
                    Nema igrača
                </Text>
            ) : (
                players.map((p) => {
                    // Sent off (red card): greyed out and not selectable.
                    const sentOff = sentOffPlayerIds?.has(p.id) ?? false
                    // Yellow-carded: still selectable, marked with 🟨 in the
                    // roster so the organizer sees who's on a booking.
                    const hasYellow = !sentOff && (yellowCardedPlayerIds?.has(p.id) ?? false)
                    const marker = sentOff ? "🟥" : hasYellow ? "🟨" : ""
                    return (
                        <Button
                            key={p.id}
                            size="sm"
                            h="10"
                            variant="outline"
                            justifyContent={align === "right" ? "flex-end" : "flex-start"}
                            loading={addingId === p.id}
                            disabled={sentOff || disabled || (addingId != null && addingId !== p.id)}
                            opacity={sentOff ? 0.5 : undefined}
                            color={sentOff ? "fg.subtle" : undefined}
                            title={sentOff ? "Isključen (crveni karton)" : hasYellow ? "Ima žuti karton" : undefined}
                            onClick={() => onPick(p)}
                        >
                            <Text truncate>
                                {align === "right" && marker ? `${marker} ` : ""}
                                {p.number != null ? `${p.number}. ` : ""}
                                {p.name}
                                {align !== "right" && marker ? ` ${marker}` : ""}
                            </Text>
                        </Button>
                    )
                })
            )}
        </VStack>
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   PenaltyShootout - guided knockout penalty shootout.

   Rules: best-of-3, teams alternate with team1 first each round. The shootout
   ends as soon as it's mathematically decided (e.g. 2-0 after two rounds -
   the trailing team can't catch up). Level after 3 each → sudden death: one
   pair of kicks at a time until a complete round ends with a different score.
   Calls onConfirm(pen1, pen2) with the made-counts once decided.

   Only used for knockout matches that finished level after regulation.
   ────────────────────────────────────────────────────────────────────────── */
type PenaltyKick = {
    team: 1 | 2
    scored: boolean
    playerId?: number
    playerName?: string
}

function shootoutState(kicks: PenaltyKick[]) {
    let s1 = 0
    let s2 = 0
    let a = 0
    let b = 0
    for (const k of kicks) {
        if (k.team === 1) { a++; if (k.scored) s1++ }
        else { b++; if (k.scored) s2++ }
    }
    const inSudden = a >= 3 && b >= 3
    let decided = false
    let winner: 1 | 2 | null = null
    if (!inSudden) {
        // Best-of-3: a team is through once its score exceeds what the other
        // can still reach with its remaining (≤3) kicks.
        if (s1 > s2 + (3 - b)) { decided = true; winner = 1 }
        else if (s2 > s1 + (3 - a)) { decided = true; winner = 2 }
    } else if (a === b && s1 !== s2) {
        // Sudden death: decided only after a complete (equal) pair of kicks.
        decided = true
        winner = s1 > s2 ? 1 : 2
    }
    // team1 leads each round: their turn when both have taken the same count.
    const nextTeam: 1 | 2 = a === b ? 1 : 2
    const round = Math.min(a, b) + 1
    return { s1, s2, a, b, decided, winner, nextTeam, inSudden, round }
}

export function PenaltyShootout({
    uuid,
    matchId,
    team1Id,
    team1Name,
    team2Id,
    team2Name,
    saving = false,
    onConfirm,
    onCancel,
}: {
    uuid: string
    matchId: number
    team1Id: number | null
    team1Name: string | null
    team2Id: number | null
    team2Name: string | null
    saving?: boolean
    onConfirm: (pen1: number, pen2: number) => void
    onCancel?: () => void
}) {
    const [rosters, setRosters] = useState<Record<number, PlayerDto[]>>({})
    const [kicks, setKicks] = useState<PenaltyKick[]>([])
    /** Ids of penalty events that already existed when this shootout was opened
     *  (re-editing a finished match). Cleared and re-recorded on confirm so the
     *  prior history is preserved/edited rather than duplicated. */
    const [loadedEventIds, setLoadedEventIds] = useState<number[]>([])
    /** Player selected for the upcoming kick (optional - "tko je pucao"). */
    const [shooterId, setShooterId] = useState<string>("")
    const [persisting, setPersisting] = useState(false)

    const st = shootoutState(kicks)
    const t1 = team1Name ?? "Ekipa 1"
    const t2 = team2Name ?? "Ekipa 2"
    const busy = saving || persisting

    // Load both rosters so the shooter can be picked per kick.
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

    // Re-editing a finished match: preload the previously recorded penalty
    // kicks (PENALTY_GOAL / PENALTY_MISSED) so the existing shootout shows up
    // for editing instead of starting blank. teamId on each event tells us the
    // side; the events are stored in kick order.
    useEffect(() => {
        let cancelled = false
        async function loadKicks() {
            try {
                const events = await fetchMatchEvents(uuid, matchId)
                if (cancelled) return
                const pens = events.filter(
                    (e) => e.type === "PENALTY_GOAL" || e.type === "PENALTY_MISSED",
                )
                if (pens.length === 0) return
                setKicks(
                    pens.map((e) => ({
                        team: e.teamId === team1Id ? 1 : 2,
                        scored: e.type === "PENALTY_GOAL",
                        playerId: e.playerId ?? undefined,
                        playerName: e.playerName ?? undefined,
                    })),
                )
                setLoadedEventIds(pens.map((e) => e.id))
            } catch {
                /* error toast surfaced by the http interceptor */
            }
        }
        void loadKicks()
        return () => { cancelled = true }
    }, [uuid, matchId, team1Id])

    const currentTeamId = st.nextTeam === 1 ? team1Id : team2Id
    const currentRoster = currentTeamId != null ? rosters[currentTeamId] ?? [] : []

    function shoot(scored: boolean) {
        if (st.decided) return
        const p = currentRoster.find((x) => String(x.id) === shooterId)
        setKicks((prev) => [
            ...prev,
            { team: st.nextTeam, scored, playerId: p?.id, playerName: p?.name },
        ])
        setShooterId("")
    }

    // Edit a recorded kick in place (scored ✓/✗ and/or its shooter) by tapping
    // it - no need to undo back to it.
    function editKick(idx: number, patch: Partial<PenaltyKick>) {
        if (busy) return
        setKicks((prev) => prev.map((k, i) => (i === idx ? { ...k, ...patch } : k)))
    }

    // Per-team kicks carrying their global index so a tap can flip the right one.
    const team1Kicks = kicks.map((k, i) => ({ k, i })).filter((x) => x.k.team === 1)
    const team2Kicks = kicks.map((k, i) => ({ k, i })).filter((x) => x.k.team === 2)

    async function handleConfirm() {
        // Persist every kick as a penalty event (silent so we don't stack a
        // toast per kick), then hand the made-count totals to the parent which
        // records the result. A kick with no named taker is still recorded -
        // its side comes from teamId and the timeline shows "(gol)"/"(promašaj)".
        setPersisting(true)
        try {
            // Clear the previously recorded kicks first so re-editing replaces
            // the old history rather than stacking duplicates.
            for (const id of loadedEventIds) {
                try {
                    await deleteMatchEvent(uuid, matchId, id, { silent: true })
                } catch {
                    /* best-effort - the totals below remain authoritative */
                }
            }
            for (const k of kicks) {
                try {
                    await addMatchEvent(
                        uuid,
                        matchId,
                        {
                            type: k.scored ? "PENALTY_GOAL" : "PENALTY_MISSED",
                            playerId: k.playerId ?? null,
                            teamId: k.team === 1 ? team1Id : team2Id,
                            minute: 0,
                            assistPlayerId: null,
                        },
                        { silent: true },
                    )
                } catch {
                    /* attribution is best-effort; the totals below are authoritative */
                }
            }
            onConfirm(st.s1, st.s2)
        } finally {
            setPersisting(false)
        }
    }

    return (
        <Box borderWidth="1px" borderColor="border" rounded="xl" p="3">
            {/* Running penalty tally (team names already show in the header). */}
            <Flex align="center" justify="center" mb="3">
                <Text fontFamily="mono" fontSize="xl" fontWeight={800} fontVariantNumeric="tabular-nums">
                    {st.s1} : {st.s2}
                </Text>
            </Flex>

            {/* Per-team kick lists (team1 top, team2 bottom - same order as the
                header). Tap a kick to edit its result and shooter. */}
            <Box borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden" mb="3">
                <TeamKickRow
                    kicks={team1Kicks}
                    roster={team1Id != null ? rosters[team1Id] ?? [] : []}
                    active={!st.decided && st.nextTeam === 1}
                    onEdit={editKick}
                    disabled={busy}
                />
                <Box borderTopWidth="1px" borderColor="border" />
                <TeamKickRow
                    kicks={team2Kicks}
                    roster={team2Id != null ? rosters[team2Id] ?? [] : []}
                    active={!st.decided && st.nextTeam === 2}
                    onEdit={editKick}
                    disabled={busy}
                />
            </Box>

            {st.decided ? (
                <VStack gap="2">
                    <Text fontSize="sm" fontWeight={600} color="pitch.500" textAlign="center">
                        Pobjednik: {st.winner === 1 ? t1 : t2} (penali {st.s1}-{st.s2})
                    </Text>
                    <HStack gap="2" justify="center">
                        {onCancel && (
                            <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
                                Odustani
                            </Button>
                        )}
                        <Button size="sm" colorPalette="brand" loading={busy} onClick={handleConfirm}>
                            Potvrdi i završi
                        </Button>
                    </HStack>
                </VStack>
            ) : (
                <VStack gap="2">
                    <Text fontSize="xs" color="fg.muted" textAlign="center">
                        {st.inSudden ? "Sudden death" : `Serija ${Math.min(st.round, 3)} / 3`} - puca:{" "}
                        <Box as="span" fontWeight={700} color="fg.ink">
                            {st.nextTeam === 1 ? t1 : t2}
                        </Box>
                    </Text>

                    {/* Optional shooter for this kick. */}
                    {currentRoster.length > 0 && (
                        <NativeSelect.Root size="sm">
                            <NativeSelect.Field
                                value={shooterId}
                                onChange={(e) => setShooterId(e.target.value)}
                            >
                                <option value="">- tko je pucao (neobavezno) -</option>
                                {currentRoster.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.number != null ? `${p.number}. ` : ""}
                                        {p.name}
                                    </option>
                                ))}
                            </NativeSelect.Field>
                            <NativeSelect.Indicator />
                        </NativeSelect.Root>
                    )}

                    <HStack gap="2" justify="center" wrap="wrap">
                        <Button size="sm" colorPalette="brand" onClick={() => shoot(true)} disabled={busy}>
                            ⚽ Gol
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => shoot(false)} disabled={busy}>
                            ✗ Promašaj
                        </Button>
                    </HStack>
                    {onCancel && (
                        <Button size="xs" variant="ghost" color="fg.muted" onClick={onCancel} disabled={busy}>
                            Odustani od raspucavanja
                        </Button>
                    )}
                </VStack>
            )}
        </Box>
    )
}

/** One team's row of kicks (✓/✗ + optional shooter). Tinted while it's this
 *  team's turn. Tap a kick to edit its result (✓/✗) and shooter in a popover. */
function TeamKickRow({
    kicks,
    roster,
    active,
    onEdit,
    disabled,
}: {
    kicks: { k: PenaltyKick; i: number }[]
    roster: PlayerDto[]
    active: boolean
    onEdit: (i: number, patch: Partial<PenaltyKick>) => void
    disabled: boolean
}) {
    return (
        <Flex
            align="center"
            gap="2"
            px="3"
            py="2"
            minH="9"
            bg={active ? "bg.surfaceTint" : undefined}
        >
            <HStack gap="1.5" flex="1" minW="0" wrap="wrap" justify="center">
                {kicks.length === 0 ? (
                    <Text fontSize="2xs" color="fg.subtle">
                        -
                    </Text>
                ) : (
                    kicks.map(({ k, i }) => (
                        <KickChip
                            key={i}
                            kick={k}
                            roster={roster}
                            onEdit={(patch) => onEdit(i, patch)}
                            disabled={disabled}
                        />
                    ))
                )}
            </HStack>
        </Flex>
    )
}

/** A single penalty kick chip. Tapping it opens a popover to fix the result
 *  (gol / promašaj) and the shooter if either was entered wrong. */
function KickChip({
    kick,
    roster,
    onEdit,
    disabled,
}: {
    kick: PenaltyKick
    roster: PlayerDto[]
    onEdit: (patch: Partial<PenaltyKick>) => void
    disabled: boolean
}) {
    const chip = (
        <HStack
            role="button"
            gap="1"
            px="1.5"
            py="0.5"
            rounded="full"
            borderWidth="1px"
            borderColor={kick.scored ? "pitch.500" : "border.emphasized"}
            bg={kick.scored ? "rgba(58,165,107,0.12)" : "transparent"}
            cursor={disabled ? "default" : "pointer"}
            _hover={disabled ? undefined : { borderColor: "accent.amber" }}
        >
            <Box
                as="span"
                color={kick.scored ? "pitch.500" : "fg.muted"}
                fontWeight={800}
                fontSize="10px"
            >
                {kick.scored ? "✓" : "✗"}
            </Box>
            {kick.playerName && (
                <Text fontSize="2xs" color="fg.muted" maxW="80px" truncate>
                    {kick.playerName}
                </Text>
            )}
        </HStack>
    )

    if (disabled) return chip

    return (
        <Popover.Root positioning={{ placement: "top" }}>
            <Popover.Trigger asChild>{chip}</Popover.Trigger>
            <Portal>
                <Popover.Positioner>
                    <Popover.Content width="56">
                        <Popover.Arrow>
                            <Popover.ArrowTip />
                        </Popover.Arrow>
                        <Popover.Body p="3">
                            <VStack gap="2.5" align="stretch">
                                <HStack gap="2" justify="center">
                                    <Button
                                        size="xs"
                                        flex="1"
                                        colorPalette="brand"
                                        variant={kick.scored ? "solid" : "outline"}
                                        onClick={() => onEdit({ scored: true })}
                                    >
                                        ⚽ Gol
                                    </Button>
                                    <Button
                                        size="xs"
                                        flex="1"
                                        colorPalette="red"
                                        variant={!kick.scored ? "solid" : "outline"}
                                        onClick={() => onEdit({ scored: false })}
                                    >
                                        ✗ Promašaj
                                    </Button>
                                </HStack>
                                <Box>
                                    <Text
                                        fontSize="2xs"
                                        fontWeight="semibold"
                                        letterSpacing="wider"
                                        textTransform="uppercase"
                                        color="fg.muted"
                                        mb="1"
                                    >
                                        Strijelac
                                    </Text>
                                    <NativeSelect.Root size="sm">
                                        <NativeSelect.Field
                                            value={kick.playerId != null ? String(kick.playerId) : ""}
                                            onChange={(e) => {
                                                const p = roster.find((x) => String(x.id) === e.target.value)
                                                onEdit({ playerId: p?.id, playerName: p?.name })
                                            }}
                                        >
                                            <option value="">- bez igrača -</option>
                                            {roster.map((p) => (
                                                <option key={p.id} value={p.id}>
                                                    {p.number != null ? `${p.number}. ` : ""}
                                                    {p.name}
                                                </option>
                                            ))}
                                        </NativeSelect.Field>
                                        <NativeSelect.Indicator />
                                    </NativeSelect.Root>
                                </Box>
                            </VStack>
                        </Popover.Body>
                    </Popover.Content>
                </Popover.Positioner>
            </Portal>
        </Popover.Root>
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   MatchTimelineModal - small read-only modal showing one match's timeline
   (goals / cards). Opened by clicking a match (group OR knockout); available
   to every visitor, including logged-out ones. Centred vertical scoreboard
   (team1 / score1 / score2 / team2) above the event timeline.
   ────────────────────────────────────────────────────────────────────────── */
type TimelineMatch = {
    matchId: number
    team1Id?: number | null
    team1Name?: string | null
    team2Id?: number | null
    team2Name?: string | null
    score1?: number | null
    score2?: number | null
    status?: string | null
}

export function MatchTimelineModal({
    uuid,
    match,
    halfLengthMin,
    onClose,
}: {
    uuid: string
    match: TimelineMatch
    /** Half length (min) - splits the timeline into 1./2. poluvrijeme. */
    halfLengthMin?: number | null
    onClose: () => void
}) {
    const isLive = match.status === "LIVE"
    const hasScore = match.score1 != null && match.score2 != null
    return (
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
                    <Dialog.Content maxW={{ base: "92%", md: "420px" }}>
                        <Dialog.Header>
                            <Dialog.Title flex="1" textAlign="center">
                                <VStack align="center" gap="1" w="full">
                                    {isLive && (
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
                                    )}
                                    <Text fontSize="md" fontWeight="bold" color="fg.ink" textAlign="center">
                                        {match.team1Name ?? "-"}
                                    </Text>
                                    {hasScore ? (
                                        <>
                                            <Text
                                                fontSize="2xl"
                                                fontWeight={800}
                                                fontFamily="mono"
                                                lineHeight="1"
                                                color={isLive ? "red.fg" : "fg.ink"}
                                            >
                                                {match.score1}
                                            </Text>
                                            <Text
                                                fontSize="2xl"
                                                fontWeight={800}
                                                fontFamily="mono"
                                                lineHeight="1"
                                                color={isLive ? "red.fg" : "fg.ink"}
                                            >
                                                {match.score2}
                                            </Text>
                                        </>
                                    ) : (
                                        <Text fontSize="sm" color="fg.muted">
                                            vs
                                        </Text>
                                    )}
                                    <Text fontSize="md" fontWeight="bold" color="fg.ink" textAlign="center">
                                        {match.team2Name ?? "-"}
                                    </Text>
                                </VStack>
                            </Dialog.Title>
                        </Dialog.Header>
                        <Dialog.Body pb="4">
                            <Text
                                fontFamily="mono"
                                fontSize="10px"
                                fontWeight={800}
                                letterSpacing="0.12em"
                                color="fg.muted"
                                mb="2"
                                textAlign="center"
                            >
                                TIJEK UTAKMICE
                            </Text>
                            <GoalscorersPanel
                                tournamentUuid={uuid}
                                matchId={match.matchId}
                                team1Id={match.team1Id ?? null}
                                team2Id={match.team2Id ?? null}
                                halfLengthMin={halfLengthMin}
                                pollMs={isLive ? 6000 : undefined}
                                hideEmpty={!isLive}
                                emptyNote={
                                    match.status === "FINISHED"
                                        ? "Prikazan samo krajnji rezultat bez strijelca."
                                        : undefined
                                }
                            />
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button variant="ghost" onClick={onClose}>
                                Zatvori
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   FoulControls - accumulated team fouls for the live-entry dialog.

   Futsal rule: from a team's 5th accumulated foul in a half the opponent gets
   a "deveterac" (10 m direct free kick); each further foul is another one.
   Fouls don't record who committed them (just the team count) and reset every
   half - the half is derived from secondHalfStartedAt by the parent dialog.
   ────────────────────────────────────────────────────────────────────────── */
export function FoulControls({
    uuid,
    matchId,
    half,
    fouls1First,
    fouls1Second,
    fouls2First,
    fouls2Second,
}: {
    uuid: string
    matchId: number
    /** Accepted for API compatibility; not shown in the compact row. */
    team1Name?: string | null
    team2Name?: string | null
    /** Which half the counts are recorded to (derived from secondHalfStartedAt
     *  by the parent). Not shown - the organizer resets manually. */
    half: 1 | 2
    fouls1First?: number | null
    fouls1Second?: number | null
    fouls2First?: number | null
    fouls2Second?: number | null
}) {
    // Offline-first: taps update the counter instantly and, with no signal,
    // queue in localStorage; the final value flushes (idempotently) on
    // reconnect. Same store is shared by all three live consoles.
    const { fouls, bump, reset } = useOfflineMatchFouls(uuid, matchId, {
        fouls1First: fouls1First ?? 0,
        fouls1Second: fouls1Second ?? 0,
        fouls2First: fouls2First ?? 0,
        fouls2Second: fouls2Second ?? 0,
    })
    const cur1 = half === 1 ? fouls.fouls1First : fouls.fouls1Second
    const cur2 = half === 1 ? fouls.fouls2First : fouls.fouls2Second

    // Reset is destructive → confirm before zeroing.
    const [confirmResetOpen, setConfirmResetOpen] = useState(false)
    function confirmReset() {
        setConfirmResetOpen(true)
    }

    // 3-column grid mirroring the scoreboard header (1fr auto 1fr): each team's
    // counter hugs the centre so it sits right under that team's name, with the
    // PREKRŠAJI label + reset in the middle (under the score). Compact + close
    // to the names instead of pushed out to the far edges.
    return (
        <>
        <Box display="grid" gridTemplateColumns="1fr auto 1fr" alignItems="center" gap="2">
            <Box justifySelf="end">
                <FoulCounter count={cur1} busy={false} onMinus={() => bump(1, half, -1)} onPlus={() => bump(1, half, 1)} />
            </Box>
            <HStack gap="1" align="center" minW="0" justifySelf="center">
                <Text
                    fontSize="2xs"
                    fontWeight={700}
                    letterSpacing="wider"
                    textTransform="uppercase"
                    color="fg.muted"
                    lineHeight="1"
                    whiteSpace="nowrap"
                >
                    Prekršaji
                </Text>
                <IconButton
                    aria-label="Resetiraj prekršaje"
                    size="2xs"
                    variant="ghost"
                    color="fg.muted"
                    onClick={confirmReset}
                >
                    <FiRotateCcw />
                </IconButton>
            </HStack>
            <Box justifySelf="start">
                <FoulCounter count={cur2} busy={false} onMinus={() => bump(2, half, -1)} onPlus={() => bump(2, half, 1)} />
            </Box>
        </Box>
        <ConfirmDialog
            open={confirmResetOpen}
            danger
            title="Resetirati prekršaje?"
            description="Akumulirani prekršaji oba tima vraćaju se na 0."
            confirmLabel="Da, resetiraj"
            onClose={() => setConfirmResetOpen(false)}
            onConfirm={() => { reset(half); setConfirmResetOpen(false) }}
        />
        </>
    )
}

function FoulCounter({
    count,
    busy,
    onMinus,
    onPlus,
}: {
    count: number
    busy: boolean
    onMinus: () => void
    onPlus: () => void
}) {
    // From the 5th foul each further foul is a "deveterac" (9 m kick).
    const deveterci = Math.max(0, count - 4)
    return (
        <HStack gap="1.5" align="center" flexShrink={0}>
            <Button
                size="2xs"
                variant="outline"
                minW="6"
                px="0"
                onClick={onMinus}
                disabled={busy || count === 0}
            >
                −
            </Button>
            <Box textAlign="center" minW="7" lineHeight="1">
                <Text
                    fontFamily="mono"
                    fontSize="lg"
                    fontWeight={800}
                    lineHeight="1"
                    color={count >= 5 ? "red.fg" : "fg.ink"}
                >
                    {count}
                </Text>
                {deveterci > 0 && (
                    <Text fontSize="9px" fontWeight={800} color="red.fg" lineHeight="1.1">
                        9m{deveterci > 1 ? `×${deveterci}` : ""}
                    </Text>
                )}
            </Box>
            <Button size="2xs" variant="outline" minW="6" px="0" onClick={onPlus} disabled={busy}>
                +
            </Button>
        </HStack>
    )
}
