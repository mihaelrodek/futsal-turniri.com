import { useCallback, useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Box, Button, chakra, Dialog, Flex, Grid, HStack, IconButton, Input, Menu, NativeSelect, Popover, Portal, Text, VStack } from "@chakra-ui/react"
import { FiClock, FiEdit2, FiList, FiMinus, FiPause, FiPlay, FiPlus, FiRotateCcw, FiTrash2, FiVideo } from "react-icons/fi"
import { GiSoccerBall, GiSoccerKick } from "react-icons/gi"
import { addMatchEvent, deleteMatchEvent, fetchMatchEvents } from "../api/matchEvents"
import { useOfflineMatchFouls } from "../hooks/useOfflineMatchFouls"
import { useBroadcastDelayMs, useTick, withinBroadcast } from "../hooks/useBroadcastDelay"
import { ConfirmDialog } from "../ui/primitives"
import { useTeamColors, TeamKitChip } from "./jersey"
import type { CreateMatchEventRequest, MatchEventDto, MatchEventType, MatchLiveMode } from "../types/matchEvents"
import type { OptimisticDisplay } from "../hooks/useOfflineMatchEvents"
import { fetchPlayers } from "../api/players"
import { fetchTournamentDetails, setShowFoulsInTimeline } from "../api/tournaments"
import { qk } from "../queryClient"
import type { PlayerDto } from "../types/players"
import { useTranslation, type Dictionary } from "../i18n"

/** Upper-cases the first letter - used to adapt a shared, mid-sentence i18n
 *  label (e.g. `t.matchLive.unknownScorer`) for standalone display. Mirrors
 *  the same helper in FullscreenTournamentPage.tsx. */
function capitalize(s: string): string {
    return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

/* ──────────────────────────────────────────────────────────────────────────
   ActionButton - the rounded icon+label tile used to pick an event kind
   (Gol/Auto-gol/Žuti/Crveni/Isključenje in LiveMatchPanel's normal event
   grid, and PENALTY_GOAL/PENALTY_MISSED in PenaltyShootout below). Lives
   here (not in LiveMatchPanel.tsx) so both can share one component without
   a circular import - LiveMatchPanel already imports several things from
   this module.
   ────────────────────────────────────────────────────────────────────────── */
const ACTION_GOAL_GREEN = "#16A34A"
const ACTION_HOME = "#3A5A7A"
const ACTION_AWAY = "#0E8A81"
const ACTION_CARD_YELLOW = "#e8a01f"
const ACTION_CARD_RED = "#c0392b"
/** A translucent tint of a colour - works on any (light/dark) surface. */
const actionTint = (hex: string, pct: number) => `color-mix(in srgb, ${hex} ${pct}%, transparent)`

/* Card marks. `rounded="sm"` is 8px in this theme (system.ts) - on a 15x19
   box that is almost an oval, which is why these read as blobs. Cards use an
   explicit 2px radius plus a hairline edge so they look like the thing they
   represent. */
export function ActionButton({
    type,
    penalty,
    label,
    shortLabel,
    selected,
    disabled,
    onClick,
    w,
}: {
    type: MatchEventType
    /** True for the in-game "Penal - gol" action (a GOAL with the flag). */
    penalty?: boolean
    label: string
    /** Replaces `label` below `md`, for a label too long to fit a phone. */
    shortLabel?: string
    selected: boolean
    disabled?: boolean
    onClick: () => void
    /** Explicit width - the normal event grid sizes tiles via its own CSS
     *  grid columns, but a plain HStack row (e.g. the shootout's two tiles)
     *  needs this so differently-long labels don't produce mismatched
     *  tile widths. */
    w?: string
}) {
    // PENALTY_GOAL/PENALTY_MISSED (the shootout kinds) read exactly like the
    // in-game penalty tile used to - green ball+P for a make, red ✗ for a miss.
    const isPenaltyGoal = (type === "GOAL" && penalty) || type === "PENALTY_GOAL"
    const isPenaltyMiss = type === "PENALTY_MISSED_LIVE" || type === "PENALTY_MISSED"
    const accent =
        type === "GOAL" || type === "PENALTY_GOAL" ? ACTION_GOAL_GREEN
            : type === "OWN_GOAL" ? ACTION_HOME
                : type === "YELLOW_CARD" ? ACTION_CARD_YELLOW
                    : type === "EXCLUSION" ? ACTION_AWAY
                        : ACTION_CARD_RED
    const icon =
        isPenaltyGoal ? (
            // Penalty goal: the ball plus a small "P" so it reads apart
            // from the plain goal at a glance.
            <Box as="span" display="inline-flex" alignItems="center" gap="0.5" lineHeight="1">
                <Text as="span" fontSize="xl" lineHeight="1">⚽</Text>
                <Text as="span" fontSize="2xs" fontWeight={800} color={ACTION_GOAL_GREEN}>P</Text>
            </Box>
        ) : type === "GOAL" ? (
            <Text as="span" fontSize="xl" lineHeight="1">⚽</Text>
        ) : type === "OWN_GOAL" ? (
            // Same ball as the timeline's autogol icon, in red.
            <Box as="span" display="inline-flex" lineHeight="1" color="red.solid"><GiSoccerBall size={22} /></Box>
        ) : isPenaltyMiss ? (
            <Text as="span" fontSize="lg" fontWeight={800} lineHeight="1" color={ACTION_CARD_RED}>✗</Text>
        ) : type === "EXCLUSION" ? (
            <Text as="span" fontSize="lg" lineHeight="1">🕑</Text>
        ) : (
            <Box
                as="span"
                w="14px"
                h="19px"
                borderRadius="2px"
                borderWidth="1px"
                borderColor="blackAlpha.400"
                bg={type === "YELLOW_CARD" ? ACTION_CARD_YELLOW : ACTION_CARD_RED}
            />
        )
    return (
        <chakra.button
            type="button"
            display="flex"
            flexDirection="column"
            alignItems="center"
            justifyContent="center"
            gap="1"
            rounded="xl"
            px={{ base: "0.5", md: "1.5" }}
            py={{ base: "2", md: "3" }}
            minW="0"
            w={w}
            borderWidth={selected ? "2px" : "1px"}
            borderColor={selected ? accent : "border"}
            bg={selected ? actionTint(accent, 12) : "bg.panel"}
            opacity={disabled ? 0.4 : 1}
            cursor={disabled ? "not-allowed" : "pointer"}
            _hover={disabled ? undefined : { borderColor: accent }}
            transition="border-color 0.12s, background 0.12s"
            disabled={disabled}
            onClick={disabled ? undefined : onClick}
        >
            <Box display="flex" alignItems="center" justifyContent="center" minH={{ base: "18px", md: "20px" }}>{icon}</Box>
            {/* Wraps rather than truncating - "Isključenje 2'" over two short
                lines still reads; an ellipsis would not. */}
            <Text
                fontSize={{ base: "2xs", md: "xs" }}
                fontWeight={800}
                color="fg.ink"
                lineHeight="1.2"
                textAlign="center"
                w="full"
                css={{ overflowWrap: "anywhere" }}
            >
                {/* Two spans rather than a JS breakpoint read: CSS decides, so
                    the label is right on the first paint and there is no hook
                    in a component rendered five times per entry. */}
                {shortLabel ? (
                    <>
                        <Box as="span" hideFrom="md">{shortLabel}</Box>
                        <Box as="span" hideBelow="md">{label}</Box>
                    </>
                ) : label}
            </Text>
        </chakra.button>
    )
}

/** One tappable player row (roster picker) - a badge (shirt number or "?"),
 *  the name, an optional trailing marker (card emoji), and a checkmark when
 *  selected. Used by LiveMatchPanel's pairing-entry roster columns and by
 *  ShootoutTeamColumn below. */


/**
 * Pair a second yellow with the red it produced.
 *
 * The backend records a second yellow as TWO events - the yellow the organizer
 * tapped and an automatic red at the same minute for the same player - because
 * both are real cards and both go to the stream overlay. On a timeline they are
 * one incident, so the yellow is hidden and the red renders as "🟨🟥".
 *
 * Matched on player + minute, the only thing the two share; a red with no
 * yellow beside it stays a straight red.
 */
export function secondYellowPairs(events: MatchEventDto[]): {
    hiddenYellowIds: Set<number>
    secondYellowRedIds: Set<number>
} {
    const hiddenYellowIds = new Set<number>()
    const secondYellowRedIds = new Set<number>()
    for (const red of events) {
        if (red.type !== "RED_CARD" || red.playerId == null) continue
        const yellow = events.find((e) =>
            e.type === "YELLOW_CARD"
            && e.playerId === red.playerId
            && e.minute === red.minute
            && !hiddenYellowIds.has(e.id))
        if (!yellow) continue
        hiddenYellowIds.add(yellow.id)
        secondYellowRedIds.add(red.id)
    }
    return { hiddenYellowIds, secondYellowRedIds }
}

/**
 * Which half an event belongs to.
 *
 * The RECORDED half wins whenever the backend supplied one (fouls do). Falling
 * back to the minute is only for rows that predate that column - and it is
 * exactly the rule that put a foul in the 10th minute of a 2x10 match into the
 * first half on one screen and the second on another, because "minute >= half
 * length" is true for the last minute of the first half.
 */
export function eventHalf(
    e: { half?: number | null; minute: number },
    halfLengthMin?: number | null,
): 1 | 2 {
    if (e.half === 1 || e.half === 2) return e.half
    return halfLengthMin != null && halfLengthMin > 0 && e.minute >= halfLengthMin ? 2 : 1
}

export function PlayerButton({
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
            borderColor={selected ? ACTION_GOAL_GREEN : "border"}
            bg={selected ? actionTint(ACTION_GOAL_GREEN, 12) : "bg.panel"}
            opacity={disabled ? 0.5 : 1}
            cursor={disabled ? "not-allowed" : "pointer"}
            _hover={disabled ? undefined : { borderColor: selected ? ACTION_GOAL_GREEN : "border.emphasized" }}
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
                css={{ background: actionTint(color, 14), color }}
            >
                {badge}
            </Box>
            {/* `minW=0` is what makes `truncate` work: without it a flex item
                refuses to shrink below its content, so a long roster name
                pushed the row past the card edge instead of ellipsising. */}
            <Text
                fontSize={{ base: "xs", md: "sm" }}
                fontWeight={700}
                color={muted ? "fg.muted" : "fg.ink"}
                flex="1"
                minW="0"
                truncate
            >
                {name}
            </Text>
            {marker && <Text as="span" fontSize="xs">{marker}</Text>}
            {selected && <Text as="span" color={ACTION_GOAL_GREEN} fontWeight={800}>✓</Text>}
        </chakra.button>
    )
}

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
    /** Pin the phase label OUTSIDE the clock, to its left, so a centring
     *  container centres the digits rather than label+digits together. */
    labelOutside?: boolean
    /** When true, suppress the "Pauza" word the clock otherwise prints while
     *  paused (the ⏸ icon + frozen time still show). Lets a caller that renders
     *  its OWN "PAUZA" label next to the clock avoid a doubled-up "Pauza". */
    hidePauseLabel?: boolean
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
/** Translated mirror of `clockState`'s internal (hardcoded) label logic - kept
 *  as a separate function rather than threading `labels` through `clockState`
 *  itself, since `clockState` is exported and consumed by other pages/components
 *  (LiveMatchPanel, TournamentsPage) that never render its `.label` field. */
function translatedClockLabel(
    args: Omit<LiveClockProps, "showLabel" | "hidePauseLabel" | "size">,
    labels: Dictionary["components"]["liveMatch"]["clockLabels"],
): string {
    const paused = !!args.livePausedAt
    if (args.halfLengthMin == null || args.halfLengthMin <= 0) {
        return paused ? labels.pause : ""
    }
    const phase = matchPhase(args)
    const inRunningPhase = phase === "FIRST_HALF" || phase === "SECOND_HALF"
    if (paused && inRunningPhase) return labels.pause
    switch (phase) {
        case "FIRST_HALF": return labels.firstHalf
        case "HALFTIME": return labels.halftime
        case "SECOND_HALF": return labels.secondHalf
        case "FULL_TIME":
        default: return labels.fullTime
    }
}

export function LiveClock({
    liveStartedAt,
    firstHalfEndedAt,
    secondHalfStartedAt,
    livePausedAt,
    halfLengthMin,
    halfCount,
    showLabel,
    hidePauseLabel,
    size = "xs",
    labelOutside,
}: LiveClockProps) {
    const t = useTranslation()
    const [, setTick] = useState(0)
    useEffect(() => {
        const id = setInterval(() => setTick((n) => n + 1), 1000)
        return () => clearInterval(id)
    }, [])

    const st = clockState({ liveStartedAt, firstHalfEndedAt, secondHalfStartedAt, livePausedAt, halfLengthMin, halfCount })
    const label = translatedClockLabel(
        { liveStartedAt, firstHalfEndedAt, secondHalfStartedAt, livePausedAt, halfLengthMin, halfCount },
        t.components.liveMatch.clockLabels,
    )
    const clockColor = st.paused ? "fg.muted" : st.endingSoon ? "accent.amber" : "red.fg"
    const iconSize = size === "md" ? 14 : 11

    const showsLabel = (showLabel || (st.paused && !hidePauseLabel)) && !!label
    const labelEl = showsLabel ? (
        <Text as="span" color="fg.muted" fontWeight="medium">
            {label}
        </Text>
    ) : null

    const clock = (
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
            {!labelOutside && labelEl}
            {st.paused ? <FiPause size={iconSize} /> : <FiClock size={iconSize} />}
            {st.display}
        </Text>
    )

    // `labelOutside` lifts the phase label out of the clock's own flex and pins
    // it to the LEFT of it, so the TIME is what a centring container centres.
    // Inline, a longer label ("Poluvrijeme" vs "Kraj") pushed the digits off
    // centre and the clock visibly shifted at every half transition.
    if (!labelOutside) return clock
    return (
        <Box as="span" position="relative" display="inline-flex" alignItems="center">
            {labelEl && (
                <Box as="span" position="absolute" right="100%" pr="2" whiteSpace="nowrap">
                    {labelEl}
                </Box>
            )}
            {clock}
        </Box>
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
    const t = useTranslation()
    // Tick every second so the big clock + phase label stay live.
    const [, setTick] = useState(0)
    useEffect(() => {
        if (!isLive || !isTimer) return
        const id = setInterval(() => setTick((n) => n + 1), 1000)
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

    const phaseLabels = t.components.liveMatch.phaseLabels
    const phaseLabel =
        phase == null
            ? null
            : paused && (phase === "FIRST_HALF" || phase === "SECOND_HALF")
                ? phaseLabels.pause
                : phase === "FIRST_HALF" ? phaseLabels.firstHalf
                    : phase === "HALFTIME" ? phaseLabels.halftime
                        : phase === "SECOND_HALF" ? phaseLabels.secondHalf
                            : phaseLabels.fullTime

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
                                {t.common.live}
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
                                    aria-label={paused ? t.components.liveMatch.resumeAction : t.components.liveMatch.pauseAction}
                                    title={paused ? t.components.liveMatch.resumeAction : t.components.liveMatch.pauseAction}
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
    const t = useTranslation()
    const s = t.components.liveMatch.start
    return (
        <Menu.Root>
            <Menu.Trigger asChild>
                <Button size="sm" variant="solid" colorPalette="red" loading={loading}>
                    <FiPlay /> {s.buttonLabel}
                </Button>
            </Menu.Trigger>
            <Portal>
                <Menu.Positioner>
                    <Menu.Content minW="60">
                        <Menu.Item value="timer" onClick={() => onStart("TIMER")}>
                            <FiClock />
                            <Text ml="2">{s.timerOption}</Text>
                        </Menu.Item>
                        <Menu.Item value="simple" onClick={() => onStart("SIMPLE")}>
                            <FiPlay />
                            <Text ml="2">{s.simpleOption}</Text>
                        </Menu.Item>
                        {onEnterResult && (
                            <Menu.Item value="result" onClick={onEnterResult}>
                                <FiEdit2 />
                                <Text ml="2">{s.resultOnlyOption}</Text>
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
    const t = useTranslation()
    const ds = t.components.liveMatch.directScore
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
                    aria-label={ds.decreaseAria(name ?? "")}
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
                    aria-label={ds.increaseAria(name ?? "")}
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
                {ds.heading}
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
                        <FiEdit2 /> {ds.saveButton}
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
    foulOrdinal,
}: {
    ev: MatchEventDto
    team1Id: number | null
    canDelete: boolean
    deleting: boolean
    onDelete: () => void
    /** For a FOUL row: which accumulated foul of that team in that half this
     *  was. Only the timeline can count it, so it is passed in. */
    foulOrdinal?: number
}) {
    const t = useTranslation()
    const er = t.components.liveMatch.eventRow
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
                    : ev.type === "EXCLUSION" ? "🕑"
                            : ev.type === "PENALTY_GOAL" ? "✓"
                                : "✗"
    const iconColor =
        ev.type === "PENALTY_GOAL" ? "pitch.500"
            : ev.type === "PENALTY_MISSED" || ev.type === "PENALTY_MISSED_LIVE" ? "accent.red"
                : undefined
    const label = isPenalty ? er.penAbbrev : `${ev.minute}'`
    // No-name events: a goal without a named scorer shows the "unknown scorer"
    // fallback, a card "unknown player", an unattributed penalty kick "(gol)"/"(promašaj)".
    const noName = ev.playerName == null
    const displayName =
        ev.type === "OWN_GOAL"
            ? ev.playerName != null
                ? `${ev.playerName} (ag)`
                : capitalize(t.matchLive.ownGoal)
            : ev.type === "GOAL" && ev.penalty
                ? er.penSuffix(ev.playerName ?? capitalize(t.matchLive.unknownScorer))
                : ev.type === "PENALTY_MISSED_LIVE"
                    ? ev.playerName != null
                        ? er.penSuffix(ev.playerName)
                        : er.missedPenaltyLive
                    : ev.type === "FOUL"
                        // A foul is recorded against the team, so the row shows
                        // WHICH accumulated foul this was ("3. prekršaj") -
                        // that running number is the whole reason to put fouls
                        // on the timeline. `foulOrdinal` is computed by the
                        // timeline, which is the only place that can count.
                        ? er.foulLabel(foulOrdinal ?? 0)
                    : ev.type === "EXCLUSION"
                        ? ev.playerName != null
                            ? er.exclusionSuffix(ev.playerName)
                            : er.exclusionLabel
                        : ev.playerName ??
                          (ev.type === "GOAL"
                              ? capitalize(t.matchLive.unknownScorer)
                              : ev.type === "YELLOW_CARD" || ev.type === "RED_CARD"
                                  ? er.unknownPlayerFallback
                                  : ev.type === "PENALTY_MISSED"
                                      ? er.missedPenaltyFallback
                                      : er.scoredPenaltyFallback)

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
    ) : ev.type === "FOUL" ? (
        // The sliding-tackle mark the fullscreen board uses for accumulated
        // fouls - a foul is not a card and must not look like one.
        <Box as="span" display="inline-flex" color="fg.muted" lineHeight="1" flexShrink={0}>
            <GiSoccerKick size={14} />
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
                    {t.components.liveMatch.assistPrefix(ev.assistPlayerName)}
                </Text>
            )}
        </VStack>
    )
    const delEl = canDelete ? (
        <IconButton
            aria-label={er.removeAria}
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

/** Per-half accumulated team fouls handed to a timeline. Fouls are counters,
 *  NOT timestamped events - they never appear as rows on the timeline, only as
 *  this per-half summary. t1/t2 follow the caller's team1/team2 ordering. */
export type TimelineFouls = {
    t1First: number
    t1Second: number
    t2First: number
    t2Second: number
}

/** Compact "PREKRŠAJI 3 : 2" tally for a timeline section header. Renders the
 *  bare inline content (no background/padding) so the caller can drop it into
 *  whatever chip masks the dashed centre line. Mono numerals in `pitch.fg` to
 *  match the live console's cyan foul styling. */

/**
 * One team's accumulated fouls for a half, sitting on that team's SIDE of the
 * timeline.
 *
 * Replaces the single "PREKRŠAJI 3 : 0" chip that used to ride inside the half
 * pill: with a centred label and the counts split left/right, each number is
 * under the team it belongs to instead of the reader having to work out which
 * side of the colon is whose.
 */
export function HalfFoulSide({ count, align }: { count: number; align: "left" | "right" }) {
    return (
        <HStack
            as="span"
            gap="1"
            align="center"
            justify={align === "right" ? "flex-end" : "flex-start"}
            color="fg.muted"
            flexShrink={0}
        >
            {align === "right" && <FoulCountText value={count} />}
            <Box as="span" display="inline-flex" lineHeight="1"><GiSoccerKick size={12} /></Box>
            {align === "left" && <FoulCountText value={count} />}
        </HStack>
    )
}

/** Hairline between a half separator's foul count and its label. Rendered only
 *  when the counts are there - a divider with nothing on one side of it is just
 *  a stray line. */
export function HalfPillDivider() {
    return <Box as="span" w="1px" alignSelf="stretch" my="0.5" bg="border" flexShrink={0} />
}

function FoulCountText({ value }: { value: number }) {
    return (
        <Text
            as="span"
            fontFamily="mono"
            fontSize="2xs"
            fontWeight={800}
            color={value >= 5 ? "accent.red" : "pitch.fg"}
            fontVariantNumeric="tabular-nums"
        >
            {value}
        </Text>
    )
}

export function FoulChip({ a, b }: { a: number; b: number }) {
    const t = useTranslation()
    return (
        <HStack as="span" gap="1.5" align="center" flexShrink={0}>
            <Text
                as="span"
                fontFamily="mono"
                fontSize="2xs"
                fontWeight={700}
                letterSpacing="0.1em"
                color="fg.muted"
                whiteSpace="nowrap"
            >
                {t.components.liveMatch.timeline.foulsChipLabel}
            </Text>
            <Text
                as="span"
                fontFamily="mono"
                fontSize="2xs"
                fontWeight={800}
                color="pitch.fg"
                fontVariantNumeric="tabular-nums"
                whiteSpace="nowrap"
            >
                {a} : {b}
            </Text>
        </HStack>
    )
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
    fouls,
    showFouls = false,
    onRequestGoal,
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
    /** Accumulated per-half team fouls. When given, each half's section header
     *  gains a "PREKRŠAJI x : y" tally (omitted for a 0:0 half, and never on
     *  the "Penali" section). With no half boundary the whole timeline gets a
     *  single combined tally at the top instead. */
    fouls?: TimelineFouls | null
    /**
     * Force fouls onto the timeline as their own rows.
     *
     * Normally left unset: the panel reads the tournament's own
     * `showFoulsInTimeline` flag, so every timeline in the app - match details,
     * raspored, /uzivo, the group modal - follows one setting without each
     * caller having to thread it through. Pass true only to override.
     */
    showFouls?: boolean
    /** When given, every GOAL row gets a small "zatraži snimku gola" button on
     *  its outer edge that calls this with the event. Only the dedicated match
     *  page passes it - the compact timelines (live list, schedule, modal) stay
     *  action-free. */
    onRequestGoal?: (evt: MatchEventDto) => void
}) {
    const t = useTranslation()
    // The tournament's own "show fouls" setting, so every timeline in the app
    // follows one switch instead of five call sites threading a prop. Cached
    // and shared by query key, so several timelines on one screen cost one
    // request; the `showFouls` prop still overrides it.
    const { data: tournamentForFouls } = useQuery({
        queryKey: qk.tournamentDetails(tournamentUuid),
        queryFn: () => fetchTournamentDetails(tournamentUuid),
        enabled: !!tournamentUuid && !showFouls,
        staleTime: 5 * 60_000,
    })
    const foulsOnTimeline = showFouls || !!tournamentForFouls?.showFoulsInTimeline

    const [state, setState] = useState<EventTimelineState>({ status: "idle" })
    // Broadcast-delay hold (see the filter at render time below). The 1s tick
    // only runs while a delay is actually in force, so non-streamed matches
    // keep their old, completely static render.
    const broadcastDelayMs = useBroadcastDelayMs(tournamentUuid)
    const tickNow = useTick(broadcastDelayMs > 0 && state.status === "done")

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
            <Flex minH="120px" align="center" justify="center">
                <VStack gap="2">
                    <Box
                        color="brand.solid"
                        css={{
                            animation: "ftBallSpin 0.9s linear infinite",
                            "@keyframes ftBallSpin": { to: { transform: "rotate(360deg)" } },
                        }}
                    >
                        <GiSoccerBall size={22} />
                    </Box>
                    <Text fontSize="sm" color="fg.muted" fontWeight={600}>
                    {t.common.loading}
                    </Text>
                </VStack>
            </Flex>
        )
    }

    if (state.status === "error") {
        return (
            <Text fontSize="xs" color="fg.muted">
                {t.components.liveMatch.timeline.loadError}
            </Text>
        )
    }

    if (state.status === "done") {
        const { t1Id } = state
        // Broadcast hold: while this tournament streams through SpectoStream the
        // video runs a few seconds behind, so an event entered "now" must not
        // appear here until the viewer's picture reaches it. No stream (or an
        // event with no timestamp) = no hold, i.e. the original behaviour.
        const events = withinBroadcast(state.events, broadcastDelayMs, tickNow)

        // Regulation events (goals/cards/in-game penalties/2-min suspensions)
        // sit on the minute-sorted timeline; penalty-SHOOTOUT kicks get their
        // own marked "Penali" section below.
        const { hiddenYellowIds, secondYellowRedIds } = secondYellowPairs(events)

        const regulation = events
            .filter((e) => !hiddenYellowIds.has(e.id))
            .filter((e) =>
                e.type === "GOAL" || e.type === "OWN_GOAL"
                || e.type === "YELLOW_CARD" || e.type === "RED_CARD"
                || e.type === "PENALTY_MISSED_LIVE" || e.type === "EXCLUSION"
                || (foulsOnTimeline && e.type === "FOUL"))
            .sort((a, b) => a.minute - b.minute)

        // Which accumulated foul each FOUL row was, per team and per half -
        // exactly what the counters show, reconstructed for the timeline.
        // Counted by id, the order they were entered, NOT by minute: a foul
        // typed in late (a correction after the clock moved on) still happened
        // after the ones before it.
        const foulOrdinals = new Map<number, number>()
        if (foulsOnTimeline) {
            const running = new Map<string, number>()
            for (const e of events.filter((x) => x.type === "FOUL").sort((a, b) => a.id - b.id)) {
                const half = eventHalf(e, halfLengthMin)
                const key = `${e.teamId}:${half}`
                const next = (running.get(key) ?? 0) + 1
                running.set(key, next)
                foulOrdinals.set(e.id, next)
            }
        }
        const penalties = events.filter(
            (e) => e.type === "PENALTY_GOAL" || e.type === "PENALTY_MISSED",
        )

        const hl = halfLengthMin != null && halfLengthMin > 0 ? halfLengthMin : null

        // Accumulated per-half foul tallies. A half with no fouls on either
        // side gets no chip (pure noise otherwise); with no half boundary known
        // the two halves collapse into one combined tally.
        const foulPair = (a: number, b: number): [number, number] | null =>
            a > 0 || b > 0 ? [a, b] : null
        const foulsH1 = fouls ? foulPair(fouls.t1First, fouls.t2First) : null
        const foulsH2 = fouls ? foulPair(fouls.t1Second, fouls.t2Second) : null
        const foulsAll = fouls
            ? foulPair(fouls.t1First + fouls.t1Second, fouls.t2First + fouls.t2Second)
            : null
        const sectionFouls = (key: string): [number, number] | null =>
            key === "h1" ? foulsH1 : key === "h2" ? foulsH2 : null

        if (events.length === 0) {
            const note = emptyNote ?? (hideEmpty ? null : t.matchLive.emptyTimelineLive)
            // A match can accumulate fouls without a single event (e.g. a 0:0),
            // so the tally still shows rather than rendering nothing at all.
            if (!note && !foulsAll) return null
            return (
                <VStack align="center" gap="2" w="full">
                    {note && (
                        <Text fontSize="xs" color="fg.muted" textAlign="center">
                            {note}
                        </Text>
                    )}
                    {foulsAll && <FoulChip a={foulsAll[0]} b={foulsAll[1]} />}
                </VStack>
            )
        }

        // Group events into vertical-timeline sections. Regulation goals/cards
        // split into 1./2. poluvrijeme when the half length is known (an event's
        // half = its minute below / at-or-above the boundary); penalty-shootout
        // kicks always get their own "Penali" section.
        const sections: { key: string; title: string; events: MatchEventDto[] }[] = []
        if (hl != null) {
            const first = regulation.filter((e) => eventHalf(e, hl) === 1)
            const second = regulation.filter((e) => eventHalf(e, hl) === 2)
            // A half with fouls but no goals/cards still gets its header, so
            // the tally has somewhere to sit instead of being dropped.
            if (first.length || foulsH1) sections.push({ key: "h1", title: t.components.liveMatch.timeline.firstHalfTitle, events: first })
            if (second.length || foulsH2) sections.push({ key: "h2", title: t.components.liveMatch.timeline.secondHalfTitle, events: second })
        } else if (regulation.length > 0) {
            // No half boundary known - one headerless timeline section (the
            // parent already labels the whole thing "Tijek utakmice").
            sections.push({ key: "reg", title: "", events: regulation })
        }
        if (penalties.length > 0) {
            sections.push({ key: "pen", title: t.matchLive.penaltiesShort, events: penalties })
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
                {/* Headerless timeline (no half boundary known) - the per-half
                    tallies have nowhere to sit, so one combined chip goes on
                    top rather than losing the information entirely. */}
                {foulsAll && sections.some((s) => s.key === "reg") && (
                    <Flex justify="center" pb="2">
                        <Box bg="bg.panel" px="3">
                            <FoulChip a={foulsAll[0]} b={foulsAll[1]} />
                        </Box>
                    </Flex>
                )}
                {sections.map((sec) => {
                    const sf = sectionFouls(sec.key)
                    return (
                    <Box key={sec.key} w="full">
                        {/* Section header ("1./2. poluvrijeme" / "Penali") -
                            centred, masks the dashed line behind it. The half's
                            accumulated foul tally rides along on the right,
                            INSIDE the same masking chip so the dashed centre
                            line stays hidden behind the header. */}
                        {sec.title && (
                            <Flex justify="center" py="2">
                                {/* One masking chip around label + both foul
                                    counts, so the dashed centre line stays
                                    hidden behind the whole group and the
                                    numbers read as part of the header. */}
                                <HStack
                                    gap="2.5"
                                    align="center"
                                    // Same bordered pill as the zapisnik and
                                    // the stream ticker. `bg.panel` is not
                                    // decoration - it is what masks the dashed
                                    // centre line running behind the header.
                                    bg="bg.panel"
                                    borderWidth="1px"
                                    borderColor="border"
                                    rounded="full"
                                    px="3"
                                    py="1"
                                >
                                    {sf && <><HalfFoulSide count={sf[0]} align="right" /><HalfPillDivider /></>}
                                    <Text
                                        fontSize="xs"
                                        fontWeight={700}
                                        letterSpacing="0.04em"
                                        color="fg.muted"
                                        textAlign="center"
                                        whiteSpace="nowrap"
                                    >
                                        {sec.title}
                                    </Text>
                                    {sf && <><HalfPillDivider /><HalfFoulSide count={sf[1]} align="left" /></>}
                                </HStack>
                            </Flex>
                        )}
                        {sec.events.map((evt) => (
                            <TimelineEventLine
                                key={evt.id}
                                evt={evt}
                                isLeft={evt.teamId === t1Id}
                                scoreLabel={scoreLabels.get(evt.id) ?? null}
                                foulOrdinal={foulOrdinals.get(evt.id)}
                                secondYellow={secondYellowRedIds.has(evt.id)}
                                onRequestGoal={onRequestGoal}
                            />
                        ))}
                    </Box>
                    )
                })}
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
    onRequestGoal,
    foulOrdinal,
    secondYellow,
}: {
    evt: MatchEventDto
    isLeft: boolean
    /** This RED came from a second yellow - draw both cards in the one row. */
    secondYellow?: boolean
    /** For a FOUL row: which accumulated foul of that team in that half this
     *  was - the running number is the point of showing fouls at all. */
    foulOrdinal?: number
    /** SofaScore-style running score at this goal (e.g. "1 - 2"); a small pill
     *  sits nearest the centre line on the scoring side. Null for cards. */
    scoreLabel?: string | null
    /** When given, goal rows (and only goal rows) get an outer-edge button that
     *  opens the paid "snimka gola" request for this event. */
    onRequestGoal?: (evt: MatchEventDto) => void
}) {
    const t = useTranslation()
    const isPenGoal = evt.type === "PENALTY_GOAL"
    const isPenMiss = evt.type === "PENALTY_MISSED"
    const isPenalty = isPenGoal || isPenMiss
    const isOwnGoal = evt.type === "OWN_GOAL"

    // Icon nearest the line: ⚽ for a (penalty) goal, ❌ for a missed penalty
    // (shootout or in-game), 🕑 for a 2-min suspension, 🟨 / 🟥 for cards. An
    // own goal gets its OWN red-ball icon (rendered below), so it's not part
    // of this emoji map.
    const icon = isPenMiss || evt.type === "PENALTY_MISSED_LIVE"
        ? "❌"
        : evt.type === "EXCLUSION"
            ? "🕑"
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
    const er = t.components.liveMatch.eventRow
    const name = isOwnGoal
        ? evt.playerName != null
            ? `${evt.playerName} (ag)`
            : capitalize(t.matchLive.ownGoal)
        : evt.type === "GOAL" && evt.penalty
            ? er.penSuffix(evt.playerName ?? capitalize(t.matchLive.unknownScorer))
            : evt.type === "PENALTY_MISSED_LIVE"
                ? evt.playerName != null
                    ? er.penSuffix(evt.playerName)
                    : er.missedPenaltyLive
                : evt.type === "FOUL"
                    ? er.foulLabel(foulOrdinal ?? 0)
                : evt.type === "EXCLUSION"
                    ? evt.playerName != null
                        ? er.exclusionSuffix(evt.playerName)
                        : er.exclusionLabel
                    : evt.playerName ??
                      (evt.type === "GOAL" || isPenGoal
                          ? capitalize(t.matchLive.unknownScorer)
                          : evt.type === "YELLOW_CARD" || evt.type === "RED_CARD"
                              ? er.unknownPlayerFallback
                              : isPenMiss
                                  ? er.missedPenaltyFallback
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
    ) : evt.type === "FOUL" ? (
        // The sliding-tackle mark the fullscreen board uses for accumulated
        // fouls. Without it a foul had no entry in EVENT_ICON and fell through
        // to the "•" placeholder.
        <Box as="span" display="inline-flex" color="fg.muted" flexShrink={0} lineHeight="1">
            <GiSoccerKick size={13} />
        </Box>
    ) : secondYellow ? (
        // Second yellow: both cards in one row, so it reads as the sending-off
        // it is rather than as an unexplained straight red.
        <Text as="span" fontSize="xs" flexShrink={0} lineHeight="1.4" whiteSpace="nowrap">
            🟨🟥
        </Text>
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
                    {t.components.liveMatch.assistPrefix(evt.assistPlayerName)}
                </Text>
            )}
        </VStack>
    )

    // Paid "snimka gola" request - offered on scored goals only (a card or a
    // missed penalty has nothing to clip). Sits on the row's OUTER edge so it
    // never pushes the scorer name off the centre line.
    const canRequestClip =
        onRequestGoal != null &&
        (evt.type === "GOAL" || isOwnGoal || isPenGoal)
    const requestEl = canRequestClip ? (
        <IconButton
            aria-label={t.components.liveMatch.timeline.requestClipAria}
            title={t.components.liveMatch.timeline.requestClipTitle("5 €")}
            size="2xs"
            variant="ghost"
            colorPalette="pitch"
            flexShrink={0}
            onClick={() => onRequestGoal!(evt)}
        >
            <FiVideo />
        </IconButton>
    ) : null

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
                        {requestEl}
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
                        {requestEl}
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

/**
 * What the entry toggle can record. "PENALTY_SCORED" is UI-only sugar: it maps
 * to a GOAL event with `penalty: true` (an in-game penalty goal counts as a
 * regular goal in the score + scorer stats); every other kind IS the event
 * type it records.
 */
type GoalEntryKind = MatchEventType | "PENALTY_SCORED"

/** The MatchEventType a kind records. */
function kindEventType(kind: GoalEntryKind): MatchEventType {
    return kind === "PENALTY_SCORED" ? "GOAL" : kind
}

/** Whether a kind carries the in-game penalty flag. */
function kindIsPenaltyGoal(kind: GoalEntryKind): boolean {
    return kind === "PENALTY_SCORED"
}

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
    penaltyInProgress = false,
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
    /** True once a penalty shootout has kicks recorded on this match. Regulation
     *  goal entry (Gol / Auto-gol) is then blocked so a mis-tap can't create a
     *  GOAL event that would wrongly count as a scorer's goal + bump the score;
     *  penalties are entered only through the guided shootout recorder. Cards
     *  stay available. Defaults false (no change for group matches / callers that
     *  don't pass it). */
    penaltyInProgress?: boolean
}) {
    const t = useTranslation()
    const ge = t.components.liveMatch.goalEntry
    const isTimer = liveMode === "TIMER"
    const [rosters, setRosters] = useState<Record<number, PlayerDto[]>>({})
    const [kind, setKind] = useState<GoalEntryKind>("GOAL")
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

    // Gol / Auto-gol / in-game penalties are the regulation goal-ish kinds;
    // blocked while a penalty SHOOTOUT is being recorded so they can't leak
    // into the scorer stats (or be confused with shootout kicks).
    const shootoutBlockedKind = (k: GoalEntryKind) =>
        k === "GOAL" || k === "OWN_GOAL" || k === "PENALTY_SCORED" || k === "PENALTY_MISSED_LIVE"
    const goalKindBlocked = penaltyInProgress && shootoutBlockedKind(kind)

    async function pick(p: PlayerDto) {
        if (!minuteValid || addingId != null) return
        if (goalKindBlocked) return // penali su u tijeku
        if (sentOffPlayerIds?.has(p.id)) return // sent off - can't affect play
        const payload: CreateMatchEventRequest = {
            type: kindEventType(kind),
            playerId: p.id,
            minute: minuteNum,
            assistPlayerId: null,
            penalty: kindIsPenaltyGoal(kind) || undefined,
        }
        // Offline-aware path: record optimistically, queue if disconnected.
        if (onAddEvent) {
            const side = sideFor(teamOfPlayer(p))
            if (side == null) return
            onAddEvent(payload, {
                type: kindEventType(kind),
                playerId: p.id,
                playerName: p.name,
                teamId: side,
                minute: minuteNum,
                penalty: kindIsPenaltyGoal(kind),
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
        if (goalKindBlocked) return // penali su u tijeku
        const payload: CreateMatchEventRequest = {
            type: kindEventType(kind),
            playerId: null,
            teamId,
            minute: minuteNum,
            assistPlayerId: null,
            penalty: kindIsPenaltyGoal(kind) || undefined,
        }
        if (onAddEvent) {
            const side = sideFor(teamId)
            if (side == null) return
            onAddEvent(payload, {
                type: kindEventType(kind),
                playerId: null,
                playerName: null,
                teamId: side,
                minute: minuteNum,
                penalty: kindIsPenaltyGoal(kind),
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

    const TYPES: { value: GoalEntryKind; label: React.ReactNode; title: string }[] = [
        { value: "GOAL", label: `⚽ ${t.matchLive.goalAria}`, title: t.matchLive.goalAria },
        {
            value: "OWN_GOAL",
            // Own goal gets a red ball (matches the timeline / fullscreen).
            label: (
                <>
                    <Box as="span" display="inline-flex" alignItems="center" color="accent.red" mr="1">
                        <GiSoccerBall size={15} />
                    </Box>
                    {ge.ownGoalAbbrev}
                </>
            ),
            title: ge.ownGoalTitle,
        },
        { value: "YELLOW_CARD", label: "🟨", title: t.matchLive.yellowCardAria },
        { value: "RED_CARD", label: "🟥", title: t.matchLive.redCardAria },
    ]
    // Second toggle row: in-game penalty (scored / missed) + 2-min suspension.
    const TYPES2: { value: GoalEntryKind; label: React.ReactNode; title: string }[] = [
        { value: "PENALTY_SCORED", label: `⚽ ${ge.penScoredAbbrev}`, title: ge.penScoredTitle },
        {
            value: "PENALTY_MISSED_LIVE",
            label: (
                <>
                    <Box as="span" color="accent.red" fontWeight={800} mr="1">✗</Box>
                    {ge.penMissedAbbrev}
                </>
            ),
            title: ge.penMissedTitle,
        },
        { value: "EXCLUSION", label: `🕑 ${ge.exclusionAbbrev}`, title: ge.exclusionTitle },
    ]

    // The label of the per-team "unknown player" button follows the kind.
    const anonLabel =
        kind === "GOAL" ? ge.anonGoal
            : kind === "OWN_GOAL" ? ge.anonOwnGoal
                : kind === "YELLOW_CARD" ? ge.anonYellow
                    : kind === "RED_CARD" ? ge.anonRed
                        : kind === "PENALTY_SCORED" ? ge.anonPenScored
                            : kind === "PENALTY_MISSED_LIVE" ? ge.anonPenMissed
                                : ge.anonExclusion

    return (
        <Box>
            {/* Type toggle - all four in ONE compact row (equal width); the
                minute field sits on its own row below so nothing wraps on
                mobile and the four card types always stay on a single line. */}
            <VStack gap="2" align="stretch" mb="2">
                {[TYPES, TYPES2].map((row, rowIdx) => (
                    <HStack key={rowIdx} gap="1" w="full">
                        {row.map((ty) => {
                            // Goal-ish kinds are locked while shootout penalties
                            // are being recorded.
                            const blocked = penaltyInProgress && shootoutBlockedKind(ty.value)
                            return (
                                <Button
                                    key={ty.value}
                                    flex="1"
                                    minW="0"
                                    px="1"
                                    size={{ base: "xs", md: "sm" }}
                                    variant={kind === ty.value ? "solid" : "outline"}
                                    colorPalette={kind === ty.value ? "brand" : "gray"}
                                    disabled={blocked}
                                    onClick={() => setKind(ty.value)}
                                    title={blocked ? ge.penaltiesBlockedTitle : ty.title}
                                >
                                    {ty.label}
                                </Button>
                            )
                        })}
                    </HStack>
                ))}
                <HStack gap="2">
                    <Text fontSize="xs" color="fg.muted" fontWeight="medium">
                        {ge.minuteLabel}
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
                            title={autoMinute ? ge.nowButtonAutoTitle : ge.nowButtonManualTitle}
                        >
                            {ge.nowButton}
                        </Button>
                    )}
                </HStack>
            </VStack>

            {!minuteValid && (
                <Text fontSize="xs" color="red.fg" mb="2">
                    {ge.minuteRequiredNote}
                </Text>
            )}
            {goalKindBlocked && (
                <Text fontSize="xs" color="accent.amber" fontWeight={600} mb="2">
                    {ge.penaltiesInProgressNote}
                </Text>
            )}

            {/* Two rosters side by side - tap a player to record the event. */}
            <Grid templateColumns="1fr 1fr" gap="2">
                <PlayerPickColumn
                    teamName={team1Name}
                    teamId={team1Id}
                    players={team1Id != null ? rosters[team1Id] ?? [] : []}
                    addingId={addingId}
                    disabled={!minuteValid || goalKindBlocked}
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
                    disabled={!minuteValid || goalKindBlocked}
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
    anonLabel,
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
    const t = useTranslation()
    const pp = t.components.liveMatch.playerPick
    const resolvedAnonLabel = anonLabel ?? t.components.liveMatch.eventRow.unknownPlayerFallback
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
                    title={pp.unknownEventTitle}
                    aria-label={resolvedAnonLabel}
                >
                    <Text truncate fontStyle="italic" color="fg.muted">{resolvedAnonLabel}</Text>
                </Button>
            )}
            {players.length === 0 ? (
                <Text fontSize="xs" color="fg.subtle" textAlign={align}>
                    {pp.noPlayers}
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
                            title={sentOff ? pp.sentOffTitle : hasYellow ? pp.yellowCardTitle : undefined}
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

   Rules: best-of-3, teams alternate with the selected first team each round. The shootout
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
    /** The persisted MatchEvent id - every kick in `kicks` state is already
     *  saved server-side the moment it's added (see `shoot`/`editKick`
     *  below), so this is always set once the kick exists locally. */
    eventId: number
}

function shootoutState(kicks: PenaltyKick[], firstTeam: 1 | 2 | null) {
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
    const otherTeam = firstTeam === 1 ? 2 : 1
    const firstTaken = firstTeam === 1 ? a : b
    const otherTaken = otherTeam === 1 ? a : b
    const nextTeam: 1 | 2 | null = firstTeam == null ? null : firstTaken === otherTaken ? firstTeam : otherTeam
    const round = Math.min(a, b) + 1
    return { s1, s2, a, b, decided, winner, nextTeam, inSudden, round }
}

/** One team's roster picker for the current kick - a column of PlayerButton
 *  rows (plus "Nepoznati igrač"), matching the same left/right-team-column
 *  layout as LiveMatchPanel's normal event entry. Only the team actually up
 *  to shoot is tappable; the other side is dimmed/disabled - the shootout's
 *  turn order isn't a free choice. */
function ShootoutTeamColumn({
    teamName,
    color,
    players,
    active,
    pendingPlayerId,
    onSelect,
}: {
    teamName: string | null
    color: string
    players: PlayerDto[]
    active: boolean
    /** The shooter picked on THIS column - undefined when nothing is picked
     *  here (either nothing picked at all, or the pick belongs to the other
     *  column). */
    pendingPlayerId: number | null | undefined
    onSelect: (playerId: number | null, playerName: string | null) => void
}) {
    const t = useTranslation()
    const isPending = (playerId: number | null) => active && pendingPlayerId !== undefined && pendingPlayerId === playerId
    return (
        <VStack
            align="stretch"
            justify="center"
            gap="2"
            minW="0"
            borderWidth="1px"
            borderColor="border"
            borderTopWidth="4px"
            borderTopColor={color}
            rounded="xl"
            p="3"
            bg="bg.panel"
            opacity={active ? 1 : 0.55}
        >
            <Text fontSize="md" fontWeight={800} color="fg.ink" textAlign="center" truncate minW="0">{teamName ?? "-"}</Text>
            <VStack align="stretch" gap="1.5" maxH="240px" overflowY="auto">
                <PlayerButton
                    selected={isPending(null)}
                    color={color}
                    badge="?"
                    name={t.components.liveMatch.eventRow.unknownPlayerFallback}
                    muted
                    disabled={!active}
                    onClick={() => onSelect(null, null)}
                />
                {players.map((p) => (
                    <PlayerButton
                        key={p.id}
                        selected={isPending(p.id)}
                        color={color}
                        badge={p.number != null ? String(p.number) : "–"}
                        name={p.name}
                        disabled={!active}
                        onClick={() => onSelect(p.id, p.name)}
                    />
                ))}
                {players.length === 0 && (
                    <Text fontSize="xs" color="fg.subtle">{t.components.liveMatch.playerPick.noPlayers}</Text>
                )}
            </VStack>
        </VStack>
    )
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
    const t = useTranslation()
    const ps = t.components.liveMatch.penaltyShootout
    const [rosters, setRosters] = useState<Record<number, PlayerDto[]>>({})
    const [kicks, setKicks] = useState<PenaltyKick[]>([])
    const [firstTeam, setFirstTeam] = useState<1 | 2 | null>(null)
    /** Player selected for the upcoming kick (optional - "tko je pucao") -
     *  tapped from one of the two team columns below, not a dropdown. Also
     *  DOUBLES as the "who shoots first" pick: while `firstTeam` is still
     *  null, tapping a player in either column both picks the shooter AND
     *  confirms that column's team as the one that shoots first - there's
     *  no separate "prva puca" step. `null` = nothing picked yet;
     *  `{playerId: null}` = explicit anonymous. */
    const [pendingShooter, setPendingShooter] = useState<{ team: 1 | 2; playerId: number | null; playerName: string | null } | null>(null)
    const [persisting, setPersisting] = useState(false)

    const st = shootoutState(kicks, firstTeam)
    const t1 = team1Name ?? ps.defaultTeam1Name
    const t2 = team2Name ?? ps.defaultTeam2Name
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
                const loadedKicks = pens.map((e) => ({
                    team: e.teamId === team1Id ? 1 as const : 2 as const,
                    scored: e.type === "PENALTY_GOAL",
                    playerId: e.playerId ?? undefined,
                    playerName: e.playerName ?? undefined,
                    eventId: e.id,
                }))
                setKicks(
                    loadedKicks,
                )
                setFirstTeam(loadedKicks[0]?.team ?? null)
            } catch {
                /* error toast surfaced by the http interceptor */
            }
        }
        void loadKicks()
        return () => { cancelled = true }
    }, [uuid, matchId, team1Id])

    const team1Roster = team1Id != null ? rosters[team1Id] ?? [] : []
    const team2Roster = team2Id != null ? rosters[team2Id] ?? [] : []

    // Persisted the moment it's taken - same as a regular goal during normal
    // play (LiveGoalEntry's `pick`/`pickAnon` below), not batched until
    // confirm. This is also what lets SpectoStream mirror it live (backend
    // dispatches a `penalty` overlay event from the SAME create call).
    async function shoot(scored: boolean) {
        if (st.decided || busy) return
        // Before the first kick, `st.nextTeam` is null - whichever column the
        // shooter was tapped from IS the team that shoots first. After that,
        // the turn order is fixed and free choice is gone.
        const team = firstTeam == null ? pendingShooter?.team : st.nextTeam
        if (team == null) return
        const p = pendingShooter
        setPendingShooter(null)
        if (firstTeam == null) setFirstTeam(team)
        setPersisting(true)
        try {
            const created = await addMatchEvent(uuid, matchId, {
                type: scored ? "PENALTY_GOAL" : "PENALTY_MISSED",
                playerId: p?.playerId ?? null,
                teamId: team === 1 ? team1Id : team2Id,
                minute: 0,
                assistPlayerId: null,
            })
            setKicks((prev) => [
                ...prev,
                { team, scored, playerId: p?.playerId ?? undefined, playerName: p?.playerName ?? undefined, eventId: created.id },
            ])
        } catch {
            /* error toast surfaced by the http interceptor - kick wasn't
               saved, so it's simply not added locally; the organizer retaps. */
        } finally {
            setPersisting(false)
        }
    }

    // Edit a recorded kick in place (scored ✓/✗ and/or its shooter) by tapping
    // it. There's no partial-update endpoint for a match event, so an edit is
    // a delete-then-recreate against the server, same as any other kick.
    async function editKick(idx: number, patch: Partial<PenaltyKick>) {
        if (busy) return
        const current = kicks[idx]
        if (!current) return
        const next = { ...current, ...patch }
        if (next.scored === current.scored && next.playerId === current.playerId) return
        setPersisting(true)
        try {
            try {
                await deleteMatchEvent(uuid, matchId, current.eventId, { silent: true })
            } catch {
                /* best effort - recreate below anyway so the edit still lands */
            }
            const created = await addMatchEvent(uuid, matchId, {
                type: next.scored ? "PENALTY_GOAL" : "PENALTY_MISSED",
                playerId: next.playerId ?? null,
                teamId: next.team === 1 ? team1Id : team2Id,
                minute: 0,
                assistPlayerId: null,
            })
            setKicks((prev) => prev.map((k, i) => (i === idx ? { ...next, eventId: created.id } : k)))
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setPersisting(false)
        }
    }

    // Per-team kicks carrying their global index so a tap can flip the right one.
    const team1Kicks = kicks.map((k, i) => ({ k, i })).filter((x) => x.k.team === 1)
    const team2Kicks = kicks.map((k, i) => ({ k, i })).filter((x) => x.k.team === 2)

    // Every kick is already persisted by the time the shootout is decided -
    // just hand the made-count totals to the parent, which records the
    // knockout result.
    function handleConfirm() {
        onConfirm(st.s1, st.s2)
    }

    return (
        <Box borderWidth="1px" borderColor="border" rounded="xl" p="3">
            {/* Running penalty tally (team names already show in the header). */}
            <Flex align="center" justify="center" mb="3">
                <Text fontFamily="mono" fontSize="xl" fontWeight={800} fontVariantNumeric="tabular-nums">
                    {st.s1} : {st.s2}
                </Text>
            </Flex>

            {st.decided ? (
                <VStack gap="3">
                    <Text fontSize="sm" fontWeight={600} color="pitch.500" textAlign="center">
                        {ps.winnerAnnouncement(st.winner === 1 ? t1 : t2, st.s1, st.s2)}
                    </Text>
                    {kicks.length > 0 && (
                        <Grid templateColumns={{ base: "1fr", sm: "1fr 1fr" }} gap="2.5" w="full">
                            <TeamKickList kicks={team1Kicks} roster={team1Roster} onEdit={editKick} disabled={busy} side={1} />
                            <TeamKickList kicks={team2Kicks} roster={team2Roster} onEdit={editKick} disabled={busy} side={2} />
                        </Grid>
                    )}
                    <HStack gap="2" justify="center">
                        {onCancel && (
                            <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
                                {t.common.cancel}
                            </Button>
                        )}
                        <Button size="sm" colorPalette="brand" loading={busy} onClick={handleConfirm}>
                            {ps.confirmButton}
                        </Button>
                    </HStack>
                </VStack>
            ) : (
                <VStack gap="3">
                    <Text fontSize="xs" color="fg.muted" textAlign="center">
                        {firstTeam == null ? ps.pickFirstTeamNote : (
                            <>
                                {st.inSudden ? ps.suddenDeath : ps.seriesLabel(Math.min(st.round, 3))} {ps.aboutToShootSuffix}{" "}
                            </>
                        )}
                        <Box as="span" fontWeight={700} color="fg.ink">
                            {st.nextTeam == null ? "" : st.nextTeam === 1 ? t1 : t2}
                        </Box>
                    </Text>

                    {/* Step 1: who's taking this kick - tapped from a team
                        column below, NOT a dropdown. Before the first kick
                        BOTH columns are active - tapping one also confirms
                        that team shoots first (no separate "prva puca" step).
                        Picked BEFORE the gol/promašaj tiles, since tapping one
                        commits immediately. */}
                    <Grid templateColumns={{ base: "1fr", sm: "1fr 1fr" }} gap="2.5">
                        <ShootoutTeamColumn
                            teamName={t1}
                            color={ACTION_HOME}
                            players={team1Roster}
                            active={firstTeam == null || st.nextTeam === 1}
                            pendingPlayerId={pendingShooter?.team === 1 ? pendingShooter.playerId : undefined}
                            onSelect={(playerId, playerName) => setPendingShooter({ team: 1, playerId, playerName })}
                        />
                        <ShootoutTeamColumn
                            teamName={t2}
                            color={ACTION_AWAY}
                            players={team2Roster}
                            active={firstTeam == null || st.nextTeam === 2}
                            pendingPlayerId={pendingShooter?.team === 2 ? pendingShooter.playerId : undefined}
                            onSelect={(playerId, playerName) => setPendingShooter({ team: 2, playerId, playerName })}
                        />
                    </Grid>

                    {/* Step 2: gol / promašaj - same rounded icon tile as the
                        normal live-match event grid (ActionButton). Disabled
                        on the very first kick until a column tap has decided
                        who shoots first; after that an anonymous kick (no
                        column tap) is still fine, same as before. */}
                    <HStack gap="2" justify="center" wrap="wrap">
                        <ActionButton
                            type="PENALTY_GOAL"
                            label={t.components.liveMatchPanel.actions.penaltyGoal}
                            selected={false}
                            disabled={busy || (firstTeam == null ? pendingShooter == null : st.nextTeam == null)}
                            onClick={() => shoot(true)}
                            w="130px"
                        />
                        <ActionButton
                            type="PENALTY_MISSED"
                            label={t.components.liveMatchPanel.actions.penaltyMissed}
                            selected={false}
                            disabled={busy || (firstTeam == null ? pendingShooter == null : st.nextTeam == null)}
                            onClick={() => shoot(false)}
                            w="130px"
                        />
                    </HStack>

                    {/* Recorded kicks so far - one vertical list per team,
                        under its own side, between the tiles and Odustani. */}
                    {kicks.length > 0 && (
                        <Grid templateColumns={{ base: "1fr", sm: "1fr 1fr" }} gap="2.5" w="full">
                            <TeamKickList kicks={team1Kicks} roster={team1Roster} onEdit={editKick} disabled={busy} side={1} />
                            <TeamKickList kicks={team2Kicks} roster={team2Roster} onEdit={editKick} disabled={busy} side={2} />
                        </Grid>
                    )}

                    {onCancel && (
                        <Button size="xs" variant="ghost" color="fg.muted" onClick={onCancel} disabled={busy}>
                            {ps.cancelShootoutButton}
                        </Button>
                    )}
                </VStack>
            )}
        </Box>
    )
}

/** One team's VERTICAL list of recorded kicks (⚽/✗ + optional shooter), under
 *  that team's own column. Tap a kick to edit its result and shooter.
 *
 *  Mirrored around the centre line, the way the public "tijek utakmice"
 *  timeline reads: the home column hugs the axis from the left (chip, then
 *  its round number nearest the middle), the away column from the right
 *  (number first, then chip). Both lists therefore start at the same
 *  vertical line no matter how wide the shooter names are. */
function TeamKickList({
    kicks,
    roster,
    onEdit,
    disabled,
    side,
}: {
    kicks: { k: PenaltyKick; i: number }[]
    roster: PlayerDto[]
    onEdit: (i: number, patch: Partial<PenaltyKick>) => void
    disabled: boolean
    /** 1 = left of the axis (right-aligned), 2 = right of it (left-aligned). */
    side: 1 | 2
}) {
    if (kicks.length === 0) return <Box />
    const left = side === 1
    return (
        <VStack align="stretch" gap="1.5" px="1">
            {kicks.map(({ k, i }, idx) => {
                {/* Round number within THIS team's own series - 1st, 2nd,
                    3rd kick; sudden-death kicks keep counting up. */}
                const number = (
                    <Text fontSize="2xs" fontWeight={800} color="fg.subtle" minW="14px" flexShrink={0} textAlign={left ? "left" : "right"}>
                        {idx + 1}.
                    </Text>
                )
                const chip = (
                    <KickChip
                        kick={k}
                        roster={roster}
                        onEdit={(patch) => onEdit(i, patch)}
                        disabled={disabled}
                    />
                )
                // Below `sm` the columns stack, so there's no axis to mirror
                // around: row-reverse puts the left column back into the plain
                // "1. [chip]" reading order, and flex-end packs it against the
                // left edge (the main axis is reversed too).
                return (
                    <HStack
                        key={i}
                        gap="1.5"
                        flexDirection={left ? { base: "row-reverse", sm: "row" } : "row"}
                        justify={left ? "flex-end" : "flex-start"}
                    >
                        {left ? <>{chip}{number}</> : <>{number}{chip}</>}
                    </HStack>
                )
            })}
        </VStack>
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
    const t = useTranslation()
    const ps = t.components.liveMatch.penaltyShootout
    const sf = t.components.liveMatchPanel.scorerFallback
    // Always shows a label - a bare icon with no name reads as broken, and
    // it's what makes the chip an obvious tap target for "uredi u drugog
    // igrača" (fix a wrongly-attributed/anonymous kick to the real shooter).
    const label = kick.playerName ?? (kick.scored ? sf.unknownScorer : sf.missed)
    const chip = (
        <HStack
            role="button"
            gap="1.5"
            px="2"
            py="1"
            rounded="full"
            borderWidth="1px"
            borderColor={kick.scored ? "#16A34A" : "border.emphasized"}
            bg={kick.scored ? "rgba(22,163,74,0.12)" : "transparent"}
            cursor={disabled ? "default" : "pointer"}
            _hover={disabled ? undefined : { borderColor: "accent.amber" }}
        >
            {kick.scored ? (
                // Same green ball as a regular goal on "tijek utakmice",
                // instead of a plain checkmark.
                <Text as="span" fontSize="sm" lineHeight="1" flexShrink={0}>⚽</Text>
            ) : (
                <Box as="span" color="fg.muted" fontWeight={800} fontSize="10px" flexShrink={0}>✗</Box>
            )}
            <Text
                fontSize="2xs"
                color="fg.muted"
                fontStyle={kick.playerName ? undefined : "italic"}
                maxW="120px"
                truncate
            >
                {label}
            </Text>
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
                                        {ps.goalButton}
                                    </Button>
                                    <Button
                                        size="xs"
                                        flex="1"
                                        colorPalette="red"
                                        variant={!kick.scored ? "solid" : "outline"}
                                        onClick={() => onEdit({ scored: false })}
                                    >
                                        {ps.missButton}
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
                                        {ps.shooterLabel}
                                    </Text>
                                    <NativeSelect.Root size="sm">
                                        <NativeSelect.Field
                                            value={kick.playerId != null ? String(kick.playerId) : ""}
                                            onChange={(e) => {
                                                const p = roster.find((x) => String(x.id) === e.target.value)
                                                onEdit({ playerId: p?.id, playerName: p?.name })
                                            }}
                                        >
                                            <option value="">{ps.noPlayerOption}</option>
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
    /** Accumulated per-half team fouls - BracketMatch / GroupMatch already
     *  carry these, so passing either straight through keeps working. */
    fouls1First?: number | null
    fouls1Second?: number | null
    fouls2First?: number | null
    fouls2Second?: number | null
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
    const t = useTranslation()
    const isLive = match.status === "LIVE"
    const hasScore = match.score1 != null && match.score2 != null
    const colors = useTeamColors(uuid)
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
                                            {t.common.live}
                                        </Box>
                                    )}
                                    <HStack gap="1.5" justify="center">
                                        <TeamKitChip colors={colors} teamId={match.team1Id} size={11} />
                                        <Text fontSize="md" fontWeight="bold" color="fg.ink" textAlign="center">
                                            {match.team1Name ?? "-"}
                                        </Text>
                                    </HStack>
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
                                            {t.components.liveMatch.timeline.vsLabel}
                                        </Text>
                                    )}
                                    <HStack gap="1.5" justify="center">
                                        <TeamKitChip colors={colors} teamId={match.team2Id} size={11} />
                                        <Text fontSize="md" fontWeight="bold" color="fg.ink" textAlign="center">
                                            {match.team2Name ?? "-"}
                                        </Text>
                                    </HStack>
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
                                {t.components.liveMatch.timeline.heading}
                            </Text>
                            <GoalscorersPanel
                                tournamentUuid={uuid}
                                matchId={match.matchId}
                                team1Id={match.team1Id ?? null}
                                team2Id={match.team2Id ?? null}
                                halfLengthMin={halfLengthMin}
                                pollMs={isLive ? 6000 : undefined}
                                hideEmpty={!isLive}
                                fouls={{
                                    t1First: match.fouls1First ?? 0,
                                    t1Second: match.fouls1Second ?? 0,
                                    t2First: match.fouls2First ?? 0,
                                    t2Second: match.fouls2Second ?? 0,
                                }}
                                emptyNote={
                                    match.status === "FINISHED"
                                        ? t.matchLive.emptyTimelineFinished
                                        : undefined
                                }
                            />
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button variant="ghost" onClick={onClose}>
                                {t.common.close}
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
    const t = useTranslation()
    const fc = t.components.liveMatch.foulControls
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

    // The tournament-wide "show fouls on the timeline" switch lives here, next
    // to where fouls are actually entered. Per tournament and remembered: it is
    // stored on the tournament row, so it holds for every match and survives
    // being switched off and on (the FOUL events are never deleted).
    const queryClient = useQueryClient()
    const { data: tournamentForFouls } = useQuery({
        queryKey: qk.tournamentDetails(uuid),
        queryFn: () => fetchTournamentDetails(uuid),
        enabled: !!uuid,
        staleTime: 5 * 60_000,
    })
    const foulsOnTimeline = !!tournamentForFouls?.showFoulsInTimeline
    const [togglingTimeline, setTogglingTimeline] = useState(false)

    async function toggleTimelineFouls() {
        if (togglingTimeline) return
        try {
            setTogglingTimeline(true)
            const updated = await setShowFoulsInTimeline(uuid, !foulsOnTimeline)
            // Patch, then invalidate: every timeline on screen reads this same
            // query, so they all re-render at once instead of one by one.
            queryClient.setQueryData(qk.tournamentDetails(uuid), updated)
            queryClient.invalidateQueries({ queryKey: qk.tournamentDetails(uuid) })
        } finally {
            setTogglingTimeline(false)
        }
    }

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
                    {fc.label}
                </Text>
                <IconButton
                    aria-label={fc.resetAria}
                    size="2xs"
                    variant="ghost"
                    color="fg.muted"
                    onClick={confirmReset}
                >
                    <FiRotateCcw />
                </IconButton>
                <IconButton
                    aria-label={foulsOnTimeline ? fc.hideOnTimelineAria : fc.showOnTimelineAria}
                    title={foulsOnTimeline ? fc.hideOnTimelineAria : fc.showOnTimelineAria}
                    size="2xs"
                    variant={foulsOnTimeline ? "solid" : "ghost"}
                    colorPalette={foulsOnTimeline ? "pitch" : "gray"}
                    color={foulsOnTimeline ? undefined : "fg.muted"}
                    loading={togglingTimeline}
                    onClick={toggleTimelineFouls}
                >
                    <FiList />
                </IconButton>
            </HStack>
            <Box justifySelf="start">
                <FoulCounter count={cur2} busy={false} onMinus={() => bump(2, half, -1)} onPlus={() => bump(2, half, 1)} />
            </Box>
        </Box>
        <ConfirmDialog
            open={confirmResetOpen}
            danger
            title={fc.resetDialogTitle}
            description={fc.resetDialogDesc}
            confirmLabel={fc.resetConfirmLabel}
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
