import { Fragment, useEffect, useRef, useState } from "react"
import {
    Box,
    Button,
    chakra,
    Field,
    Flex,
    HStack,
    Input,
    NativeSelect,
    SimpleGrid,
    Text,
    VStack,
} from "@chakra-ui/react"
import { FiCalendar, FiChevronDown, FiChevronsDown, FiChevronUp, FiClock, FiDownload, FiEdit2, FiFilter, FiGrid, FiInfo, FiList, FiRefreshCw, FiTrash2 } from "react-icons/fi"
import { LuCalendarClock, LuCalendarX2, LuGripVertical } from "react-icons/lu"
import { clearSchedule, fetchSchedule, generateSchedule, reorderSchedule, updateKickoff } from "../api/schedule"
import MultiDaySchedulePlanner from "./MultiDaySchedulePlanner"
import { DateTimeField } from "./DateTimeField"
import { fetchGroups } from "../api/groups"
import { useQueryClient } from "@tanstack/react-query"
import { qk } from "../queryClient"
import type { Schedule, ScheduledMatch } from "../types/schedule"
import { GoalscorersPanel } from "./liveMatch"
import { ConfirmDialog, EmptyState, Loader, Panel } from "../ui/primitives"
import { GhostButton, PrimaryButton, SectionCard } from "../ui/pitch"
import { buildMatchIcs, downloadIcs } from "../utils/ics"
import { ExportDialog, type ExportMeta } from "./TournamentExport"

/* ────────────────────────────────────────────────────────────────────────────
   Schedule tab - match scheduling.

   Behaviour:
     a) Matches sorted: LIVE first, SCHEDULED second, FINISHED last.
        Within each group the original kickoff order is preserved.
     b) LIVE matches rendered with a red border (no text badge - the border
        plus the red score box carry the live signal on this screen).
     c) FINISHED and LIVE matches get a centered expand toggle that reveals
        the shared GoalscorersPanel (SofaScore-style event timeline).
        SCHEDULED matches get no expand toggle.
     d) "Format utakmice" config box is hidden once the tournament has
        started (any match is LIVE or FINISHED).
   ─────────────────────────────────────────────────────────────────────────── */

const STAGE_LABEL: Record<string, string> = {
    GROUP: "Grupa",
    ROUND_OF_32: "1/16 finala",
    ROUND_OF_16: "Osmina finala",
    QUARTERFINAL: "Četvrtfinale",
    SEMIFINAL: "Polufinale",
    FINAL: "Finale",
    THIRD_PLACE: "Za 3. mjesto",
}

/** Kickoff time in ms for sorting; matches without a time sort to the end. */
function kickoffMs(m: ScheduledMatch): number {
    return m.kickoffAt ? new Date(m.kickoffAt).getTime() : Number.POSITIVE_INFINITY
}

// Half count is fixed at 2 (a futsal match is always two halves) - no config.
const HALF_COUNT = 2

type Cfg = {
    halfLengthMin: string
    halftimeBreakMin: string
    breakBetweenMatchesMin: string
    bufferMin: string
    /** Knockout plays a different format than the groups (e.g. 2x6 → 2x8).
     *  Off → the ko* values are sent as null and the knockout inherits. */
    koEnabled: boolean
    koHalfLengthMin: string
    koHalftimeBreakMin: string
    /** Knockout break between matches. Empty = inherit the group break. */
    koBreakBetweenMatchesMin: string
}

/** The knockout format the config currently describes, in the shape the API
 *  wants: nulls when the override is off (backend then clears the fields).
 *  koBreakBetweenMatchesMin stays null when left empty so the backend falls
 *  back to the group break between matches. */
function koPayload(c: Cfg): {
    koHalfLengthMin: number | null
    koHalftimeBreakMin: number | null
    koBreakBetweenMatchesMin: number | null
} {
    if (!c.koEnabled)
        return { koHalfLengthMin: null, koHalftimeBreakMin: null, koBreakBetweenMatchesMin: null }
    return {
        koHalfLengthMin: numVal(c.koHalfLengthMin),
        koHalftimeBreakMin: numVal(c.koHalftimeBreakMin),
        koBreakBetweenMatchesMin: numValOrNull(c.koBreakBetweenMatchesMin),
    }
}

function isoToLocal(iso: string | null): string {
    if (!iso) return ""
    const d = new Date(iso)
    const p = (n: number) => String(n).padStart(2, "0")
    return (
        `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
        `T${p(d.getHours())}:${p(d.getMinutes())}`
    )
}

function numVal(v: string): number {
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : 0
}

/** Like numVal but keeps an empty/invalid entry as null (rather than 0) - used
 *  by the optional knockout "pauza između utakmica" field where empty means
 *  "inherit the group value" instead of "zero minutes". */
function numValOrNull(v: string): number | null {
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : null
}

/* -- Stage badge --------------------------------------------------------- */
function StageBadge({ stage, groupName }: { stage: string; groupName?: string | null }) {
    const isGroup = stage === "GROUP"
    // For group matches show which group ("Grupa A"); knockout keeps its
    // phase label ("Polufinale", "Finale", …).
    const label = isGroup
        ? groupName
            ? `Grupa ${groupName}`
            : "Grupa"
        : STAGE_LABEL[stage] ?? stage
    return (
        <Box
            as="span"
            px="2"
            py="0.5"
            rounded="full"
            fontSize="2xs"
            fontWeight="semibold"
            letterSpacing="wide"
            textTransform="uppercase"
            bg={isGroup ? "brand.subtle" : "bg.muted"}
            color={isGroup ? "brand.fg" : "fg.muted"}
            flexShrink={0}
            whiteSpace="nowrap"
        >
            {label}
        </Box>
    )
}

/* -- Day divider --------------------------------------------------------- */
/** Thin labelled separator inserted before the first match of each day, so a
 *  multi-day schedule reads as distinct days. Purely visual - carries no
 *  drag attributes, so the reorder pointer logic skips right over it. */
function DayDivider({ label, first }: { label: string; first?: boolean }) {
    return (
        <Flex align="center" gap="3" pt={first ? "0" : "2"} pb="0.5" aria-hidden>
            <Box flex="1" h="1px" bg="border.emphasized" />
            <HStack gap="1.5" flexShrink={0} color="fg.muted">
                <FiCalendar size={12} />
                <Text
                    fontFamily="mono"
                    fontSize="2xs"
                    fontWeight={800}
                    letterSpacing="0.08em"
                    textTransform="uppercase"
                    whiteSpace="nowrap"
                >
                    {label}
                </Text>
            </HStack>
            <Box flex="1" h="1px" bg="border.emphasized" />
        </Flex>
    )
}

/* -- Config field -------------------------------------------------------- */
/** Compact numeric field (uppercase label above a small "min"-suffixed input).
 *  Sized to pack three-across on one desktop row; on mobile it flexes to a
 *  tight two-column grid. The label reserves two lines so single- and
 *  two-line labels bottom-align and every input in the row lines up. */
function CfgField({
    label,
    value,
    onChange,
    placeholder,
}: {
    label: string
    value: string
    onChange: (v: string) => void
    /** Shown when empty - used by the knockout "pauza između utakmica" field to
     *  hint the inherited group value. */
    placeholder?: string
}) {
    return (
        <Field.Root
            flex={{ base: "1 1 calc(50% - 0.25rem)", md: "0 0 auto" }}
            w={{ base: "auto", md: "128px" }}
            minW="0"
        >
            <Field.Label
                fontSize="2xs"
                fontWeight="semibold"
                letterSpacing="wide"
                textTransform="uppercase"
                color="fg.muted"
                mb="0.5"
                lineHeight="1.15"
                minH="2.2em"
                alignItems="flex-end"
            >
                {label}
            </Field.Label>
            <Box position="relative" w="full">
                <Input
                    size="sm"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    rounded="lg"
                    textAlign="center"
                    fontWeight="semibold"
                    px="7"
                    value={value}
                    placeholder={placeholder}
                    // Digits only - strips any sign / letter so negatives and the
                    // "-" / "e" characters can never be entered.
                    onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
                />
                <Box
                    position="absolute"
                    right="2"
                    top="50%"
                    transform="translateY(-50%)"
                    fontSize="2xs"
                    color="fg.muted"
                    pointerEvents="none"
                >
                    min
                </Box>
            </Box>
        </Field.Root>
    )
}

/* -- Read-only format stat ----------------------------------------------- */
/** Compact read-only tile (uppercase label above a mono "N min" value) used by
 *  the collapsible format summary box between the filters and the schedule
 *  list. The read-only sibling of CfgField. */
function FormatStat({ label, value }: { label: string; value: string }) {
    return (
        <Box
            flex={{ base: "1 1 calc(50% - 0.25rem)", md: "0 0 auto" }}
            minW="0"
            borderWidth="1px"
            borderColor="border"
            rounded="lg"
            bg="bg.panel"
            px="3"
            py="2"
        >
            <Text
                fontSize="2xs"
                fontWeight={700}
                letterSpacing="wide"
                textTransform="uppercase"
                color="fg.muted"
                lineHeight="1.2"
            >
                {label}
            </Text>
            <Text fontFamily="mono" fontSize="15px" fontWeight={800} color="fg.ink" mt="0.5">
                {value}
            </Text>
        </Box>
    )
}

const RowButton = chakra("button")

/* -- Shared match display state ------------------------------------------ */
/** Derived render state shared by the list row (MatchRow) and the grid card
 *  (MatchCard) so the two layouts can't drift apart: status flags, resolved
 *  team names (with the predicted-pairing / slot-label fallbacks rendered
 *  muted) and the centre score/vs text. */
function matchDisplay(match: ScheduledMatch) {
    const hasScore = match.score1 != null && match.score2 != null
    const isLive = match.status === "LIVE"
    const isFinished = match.status === "FINISHED"
    // Scoreboard layout (team-left / score / team-right) for both LIVE and
    // FINISHED - mirrors the LivePage card design so the user has one
    // consistent mental model across the two screens.
    const scoreboard = isLive || isFinished
    // Undecided knockout slots fall back to the predicted pairing (real name once
    // the group finishes) → the slot label ("A1", "Pobj. ČF1") → "TBD" / "-".
    // A predicted/label placeholder renders muted; a real team name stays normal.
    const t1Name = match.team1Name ?? match.slot1PredictedName ?? match.slot1Label ?? (isFinished ? "-" : "TBD")
    const t2Name = match.team2Name ?? match.slot2PredictedName ?? match.slot2Label ?? (isFinished ? "-" : "TBD")
    const t1Muted = match.team1Name == null && (match.slot1PredictedName != null || match.slot1Label != null)
    const t2Muted = match.team2Name == null && (match.slot2PredictedName != null || match.slot2Label != null)
    const scoreText = hasScore ? `${match.score1}:${match.score2}` : scoreboard ? "-" : "vs"
    return { hasScore, isLive, isFinished, scoreboard, t1Name, t2Name, t1Muted, t2Muted, scoreText }
}

/* -- Match row ----------------------------------------------------------- */
function MatchRow({
    match,
    tournamentUuid,
    tournamentName,
    tournamentLocation,
    tournamentSlug,
    slotMinutes,
    halfLengthMin,
    onTimeChange,
    canEdit,
    isNext = false,
}: {
    match: ScheduledMatch
    tournamentUuid: string
    /** Half length (min) - splits the expanded timeline into 1./2. poluvrijeme. */
    halfLengthMin?: number | null
    /** Surfaced into the ICS SUMMARY so the calendar entry reads
     *  "Team A vs Team B - Tournament name". */
    tournamentName: string
    /** Optional venue carried into the ICS LOCATION field. */
    tournamentLocation?: string | null
    /** Slug used to build the deep-link back to the match page in the
     *  ICS URL + DESCRIPTION. */
    tournamentSlug?: string | null
    /** Total slot duration in minutes - used as the calendar event's
     *  default end time when the schedule has no explicit one. */
    slotMinutes: number
    onTimeChange: (m: ScheduledMatch, localValue: string) => void
    /** Owner / admin only - kickoff time editor goes read-only when false. */
    canEdit: boolean
    /** True for the single next-to-start (earliest scheduled) match - gets a
     *  red border so the organizer sees what's on deck. */
    isNext?: boolean
}) {
    const [expanded, setExpanded] = useState(false)
    const { isLive, isFinished, scoreboard, t1Name, t2Name, t1Muted, t2Muted, scoreText } =
        matchDisplay(match)
    // Only a started match (LIVE or FINISHED) has a timeline to expand; a match
    // that hasn't kicked off yet can't be expanded.
    const canExpand = scoreboard

    // Long club names shrink a touch and wrap (up to three lines) so they stay
    // readable in the schedule row instead of truncating with an ellipsis.
    const nameMaxLen = Math.max((match.team1Name ?? "").length, (match.team2Name ?? "").length)
    const nameFont = nameMaxLen > 26 ? { base: "12px", md: "13px" } : "sm"

    function addToCalendar() {
        if (!match.kickoffAt) return
        const start = new Date(match.kickoffAt)
        const end = new Date(start.getTime() + Math.max(slotMinutes, 30) * 60 * 1000)
        const t1 = match.team1Name ?? "-"
        const t2 = match.team2Name ?? "-"
        const url = tournamentSlug
            ? `${window.location.origin}/turniri/${tournamentSlug}`
            : `${window.location.origin}/turniri/${tournamentUuid}`
        const ics = buildMatchIcs({
            uid: `match-${match.matchId}@futsal-turniri.com`,
            summary: `${t1} vs ${t2} - ${tournamentName}`,
            location: tournamentLocation ?? undefined,
            description: `${tournamentName}`,
            url,
            start,
            end,
        })
        const safeName = `${t1}-${t2}`.replace(/[^a-z0-9\-]+/gi, "_").slice(0, 40)
        downloadIcs(`utakmica-${safeName}.ics`, ics)
    }

    // Kickoff time - editable picker for admins, read-only stamp otherwise.
    // Extracted so the scoreboard (live/finished) and scheduled headers can
    // share one source of truth for the time cell.
    const timeContent = canEdit ? (
        <DateTimeField
            compact
            value={match.kickoffAt ? new Date(match.kickoffAt) : null}
            onChange={(d) => {
                if (!d) return
                const p = (n: number) => String(n).padStart(2, "0")
                const local =
                    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
                    `T${p(d.getHours())}:${p(d.getMinutes())}`
                onTimeChange(match, local)
            }}
        />
    ) : match.kickoffAt ? (
        <HStack gap="1.5" fontSize="sm" fontWeight="600" color="fg.muted" fontFamily="mono">
            <FiClock size={12} />
            <Box>
                {(() => {
                    const v = isoToLocal(match.kickoffAt)
                    if (!v) return "-"
                    // YYYY-MM-DDTHH:MM → "DD.MM.YYYY HH:MM"
                    const [d, t] = v.split("T")
                    const [y, m, day] = d.split("-")
                    return `${day}.${m}.${y} ${t}`
                })()}
            </Box>
        </HStack>
    ) : (
        <Text fontSize="xs" color="fg.subtle">
            Termin nije određen
        </Text>
    )

    // "Add to calendar" action - scheduled rows only.
    const calendarBtn = match.kickoffAt ? (
        <RowButton
            type="button"
            display="inline-flex"
            alignItems="center"
            gap="1"
            px="2"
            py="1"
            cursor="pointer"
            color="pitch.500"
            fontSize="xs"
            fontWeight="medium"
            bg="bg.surfaceTint"
            border="1px solid"
            borderColor="border"
            borderRadius="md"
            _hover={{ bg: "pitch.50" }}
            onClick={(e: React.MouseEvent) => {
                e.stopPropagation()
                addToCalendar()
            }}
            aria-label="Dodaj u kalendar"
            flexShrink={0}
        >
            <FiCalendar size={12} />
            <chakra.span display={{ base: "none", md: "inline" }}>
                Dodaj u kalendar
            </chakra.span>
        </RowButton>
    ) : null

    return (
        <Panel
            px="4"
            py="2"
            borderColor={isLive || isNext ? "red.emphasized" : "border"}
            borderWidth={isLive || isNext ? "2px" : "1px"}
        >
            <VStack align="stretch" gap="1">
                {scoreboard ? (
                    /* LIVE / FINISHED header - stage badge on the left, kickoff
                       time centred between two equal-flex clusters (dead-centre
                       above the score). A LIVE match is signalled by the red
                       border + red score box alone - no "UŽIVO" text badge. */
                    <Flex align="center" gap="2" wrap="wrap">
                        <HStack gap="2" flex="1" minW="fit-content" wrap="wrap">
                            <StageBadge stage={match.stage} groupName={match.groupName} />
                        </HStack>
                        <Box flexShrink={0} w="200px" maxW="100%">
                            {timeContent}
                        </Box>
                        <Flex flex="1" minW="fit-content" justify="flex-end" />
                    </Flex>
                ) : (
                    /* SCHEDULED header - stage badge (left) + "add to calendar"
                       (right) on one row, kickoff time centred on its own row
                       below. Fixed positions so the badge, date and calendar
                       icon line up identically across every card regardless of
                       badge width. The next-to-start match keeps its red border
                       (the "Na redu" tag was dropped). */
                    <>
                        <Flex align="center" justify="space-between" gap="2">
                            <StageBadge stage={match.stage} groupName={match.groupName} />
                            {calendarBtn}
                        </Flex>
                        <Flex justify="center">{timeContent}</Flex>
                    </>
                )}

                {/* Teams + score - one fixed 3-column grid used for EVERY
                    row (live, finished, scheduled). team1 is right-aligned
                    to the centre score box, team2 left-aligned, so the
                    score column lines up perfectly straight down the list.
                    Scheduled matches show a muted "vs" in the same slot. */}
                <Box
                    display="grid"
                    gridTemplateColumns="1fr auto 1fr"
                    alignItems="center"
                    gap={{ base: "2", sm: "4" }}
                    cursor={canExpand ? "pointer" : "default"}
                    onClick={canExpand ? () => setExpanded((v) => !v) : undefined}
                >
                    <Text
                        fontSize={nameFont}
                        fontWeight={700}
                        color={t1Muted ? "fg.muted" : "fg.ink"}
                        textAlign="right"
                        lineClamp="3"
                    >
                        {t1Name}
                    </Text>
                    <Box
                        fontFamily="mono"
                        fontSize={scoreboard ? "lg" : "sm"}
                        fontWeight={scoreboard ? 800 : 600}
                        letterSpacing="-0.02em"
                        color={isLive ? "red.fg" : scoreboard ? "fg.ink" : "fg.muted"}
                        bg={isLive ? "red.subtle" : scoreboard ? "bg.surfaceTint" : "transparent"}
                        px="3"
                        py="1"
                        rounded="lg"
                        minW="72px"
                        textAlign="center"
                        fontVariantNumeric="tabular-nums"
                    >
                        {scoreText}
                    </Box>
                    <Text
                        fontSize={nameFont}
                        fontWeight={700}
                        color={t2Muted ? "fg.muted" : "fg.ink"}
                        textAlign="left"
                        lineClamp="3"
                    >
                        {t2Name}
                    </Text>
                </Box>
            </VStack>

            {/* Expand toggle - centered, only for LIVE and FINISHED */}
            {canExpand && (
                <Flex justify="center" mt="2">
                    <RowButton
                        type="button"
                        display="inline-flex"
                        alignItems="center"
                        gap="1"
                        px="2"
                        py="0.5"
                        cursor="pointer"
                        color="fg.muted"
                        fontSize="xs"
                        fontWeight="medium"
                        _hover={{ color: "fg" }}
                        onClick={() => setExpanded((v) => !v)}
                        background="none"
                        border="none"
                    >
                        {expanded ? <FiChevronUp size={13} /> : <FiChevronDown size={13} />}
                        Detalji
                    </RowButton>
                </Flex>
            )}

            {canExpand && expanded && (
                <Box mt="2" pt="2" borderTopWidth="1px" borderColor="border" px="1">
                    <GoalscorersPanel
                        tournamentUuid={tournamentUuid}
                        matchId={match.matchId}
                        team1Id={match.team1Id ?? null}
                        team2Id={match.team2Id ?? null}
                        halfLengthMin={halfLengthMin}
                        hideEmpty={!isLive}
                        emptyNote={
                            isFinished ? "Prikazan samo krajnji rezultat bez strijelca." : undefined
                        }
                    />
                </Box>
            )}
        </Panel>
    )
}

/* -- Match card (grid view) ---------------------------------------------- */
/** Compact, view-only card for the grid layout: stage/group badge + kickoff
 *  on top, then the same team / score / team scoreboard as MatchRow (shared
 *  via matchDisplay). No inline kickoff editing, no drag handle, no expand -
 *  the grid is a viewing layout; editing stays in the list view. */
function MatchCard({
    match,
    multiDay,
    isNext = false,
}: {
    match: ScheduledMatch
    /** Multi-day tournament - the kickoff stamp adds the date ("DD.MM. HH:MM"),
     *  matching the list's day-aware time display; single-day shows just HH:MM. */
    multiDay: boolean
    /** True for the single next-to-start match - same red-border emphasis as
     *  the list row (already suppressed upstream while any match is LIVE). */
    isNext?: boolean
}) {
    const { isLive, t1Name, t2Name, t1Muted, t2Muted, scoreText } = matchDisplay(match)

    // "HH:MM" for a single-day tournament; "DD.MM. HH:MM" across several days.
    const kickoffLabel = (() => {
        const v = isoToLocal(match.kickoffAt)
        if (!v) return null
        const [d, t] = v.split("T")
        const [, mo, day] = d.split("-")
        return multiDay ? `${day}.${mo}. ${t}` : t
    })()

    return (
        <Panel
            px="3"
            py="2.5"
            h="full"
            borderColor={isLive || isNext ? "red.emphasized" : "border"}
            borderWidth={isLive || isNext ? "2px" : "1px"}
        >
            <VStack align="stretch" gap="2" h="full" justify="space-between">
                <Flex align="center" justify="space-between" gap="2">
                    <StageBadge stage={match.stage} groupName={match.groupName} />
                    {kickoffLabel ? (
                        <HStack gap="1" fontSize="xs" fontWeight={600} color="fg.muted" fontFamily="mono" flexShrink={0}>
                            <FiClock size={11} />
                            <Box as="span">{kickoffLabel}</Box>
                        </HStack>
                    ) : (
                        <Text fontSize="2xs" color="fg.subtle" flexShrink={0}>
                            Termin nije određen
                        </Text>
                    )}
                </Flex>

                {/* Same 3-column scoreboard grid as the list row, sized down. */}
                <Box
                    display="grid"
                    gridTemplateColumns="1fr auto 1fr"
                    alignItems="center"
                    gap="2"
                >
                    <Text
                        fontSize="13px"
                        fontWeight={700}
                        color={t1Muted ? "fg.muted" : "fg.ink"}
                        textAlign="right"
                        lineClamp="2"
                    >
                        {t1Name}
                    </Text>
                    <Box
                        fontFamily="mono"
                        fontSize="sm"
                        fontWeight={isLive ? 800 : 600}
                        letterSpacing="-0.02em"
                        color={isLive ? "red.fg" : match.status === "FINISHED" ? "fg.ink" : "fg.muted"}
                        bg={isLive ? "red.subtle" : match.status === "FINISHED" ? "bg.surfaceTint" : "transparent"}
                        px="2.5"
                        py="0.5"
                        rounded="lg"
                        minW="56px"
                        textAlign="center"
                        fontVariantNumeric="tabular-nums"
                    >
                        {scoreText}
                    </Box>
                    <Text
                        fontSize="13px"
                        fontWeight={700}
                        color={t2Muted ? "fg.muted" : "fg.ink"}
                        textAlign="left"
                        lineClamp="2"
                    >
                        {t2Name}
                    </Text>
                </Box>
            </VStack>
        </Panel>
    )
}

/* -- View toggle --------------------------------------------------------- */
/** Segmented-control button for the list/grid view switcher - same pattern as
 *  the tournaments page "prikaz" toggle, sized to the schedule header. */
function ViewToggleButton({
    active,
    onClick,
    icon,
    label,
}: {
    active: boolean
    onClick: () => void
    icon: React.ReactNode
    label: string
}) {
    return (
        <Box
            as="button"
            onClick={onClick}
            // Icon-only control - the aria-label IS the accessible name.
            aria-label={label}
            title={label}
            aria-pressed={active}
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
            px="2.5"
            py="1.5"
            rounded="full"
            cursor="pointer"
            bg={active ? "pitch.500" : "transparent"}
            color={active ? "white" : "fg.muted"}
            transition="background 150ms"
            _hover={active ? undefined : { color: "fg.ink" }}
        >
            {icon}
        </Box>
    )
}

/** localStorage key for the list/grid choice - global (not per tournament) so
 *  the preferred prikaz follows the user across tournaments. */
const VIEW_KEY = "futsal:schedule-view"
type ScheduleView = "list" | "grid"

/* -- Main export --------------------------------------------------------- */
/** `canEdit` - owner/admin gate for the mutating actions: format config
 *  inputs, generate-schedule button, and per-match kickoff edits. When
 *  false the user sees a read-only schedule. */
export default function ScheduleTab({
    uuid,
    canEdit = false,
    finishedLocked = false,
    tournamentName,
    tournamentLocation,
    tournamentSlug,
    focusMatchId = null,
    format,
    startAt,
    exportMeta,
    autoOpenKnockoutTimes = false,
    onAutoOpenKnockoutTimesConsumed,
}: {
    uuid: string
    canEdit?: boolean
    /** Tournament is FINISHED and the viewer isn't an admin - every editing
     *  entry point is hidden and a single "locked" notice is shown instead
     *  (only for users who could otherwise edit; viewers see no change). */
    finishedLocked?: boolean
    /** Tournament start ISO - seeds the multi-day planner's default date/time. */
    startAt?: string | null
    /** Tournament format. For GROUPS_KNOCKOUT the group draw places teams into
     *  groups but does NOT create fixtures (those are built when the schedule
     *  is generated), so "draw done" must be detected from the groups, not the
     *  match list. */
    format?: string | null
    /** Surfaced into the per-match ICS export. The tournament name lands
     *  in the SUMMARY ("Team A vs Team B - Open Split 2026"), the
     *  location in LOCATION, and the slug in URL so the calendar entry
     *  links back to the match's tournament page. */
    tournamentName?: string
    tournamentLocation?: string | null
    tournamentSlug?: string | null
    /** When set (arriving from a /uzivo upcoming-match click), that match's
     *  row is scrolled into view + briefly highlighted. */
    focusMatchId?: number | null
    /** Tournament meta for the branded "Export raspored" poster. */
    exportMeta?: ExportMeta
    /** True when the tab is entered from the bracket position-save step - opens
     *  the knockout-only planner once on mount so the organizer confirms the new
     *  pairs' times (only the knockout kickoffs, not the group ones). */
    autoOpenKnockoutTimes?: boolean
    /** Called right after `autoOpenKnockoutTimes` is consumed so the parent can
     *  clear the request (a later manual visit won't re-open the dialog). */
    onAutoOpenKnockoutTimesConsumed?: () => void
}) {
    const queryClient = useQueryClient()
    // Seed from the shared schedule cache so returning to the Raspored tab (or a
    // recently-viewed tournament) paints instantly instead of refetching.
    const cachedSchedule = queryClient.getQueryData<Schedule>(qk.schedule(uuid))
    const [schedule, setSchedule] = useState<Schedule | null>(cachedSchedule ?? null)
    const [loading, setLoading] = useState(!cachedSchedule)
    const [generating, setGenerating] = useState(false)
    const [clearing, setClearing] = useState(false)
    /** Which destructive schedule action awaits confirmation in the popup. */
    const [confirmAction, setConfirmAction] = useState<null | "regenerate" | "clear">(null)
    /** Branded "Export raspored" poster dialog. */
    const [exportOpen, setExportOpen] = useState(false)
    /** The multi-day planner: "full" plans the whole tournament, "ko" plans
     *  only the knockout ("Raspored završnice"). null = closed. */
    const [plannerMode, setPlannerMode] = useState<null | "full" | "ko">(null)
    /** GROUPS_KNOCKOUT only - true once groups have been drawn (so the schedule
     *  can be generated even before any fixtures exist). */
    const [groupsDrawn, setGroupsDrawn] = useState(false)
    /** "Uredi raspored" - after the tournament starts, lets the organizer edit
     *  times + reorder matches that haven't started yet. */
    const [editScheduleMode, setEditScheduleMode] = useState(false)
    /** "Uredi format" - once the schedule is laid out, the inline format editor
     *  is hidden behind this toggle (before it's laid out the editor is always
     *  open, so the organizer can't miss it). No portal / popover involved. */
    const [formatEditorOpen, setFormatEditorOpen] = useState(false)
    /** "Sažmi" - collapse the upcoming list to just the next few matches.
     *  Persisted per tournament so the choice survives a reload. Default
     *  expanded (false). */
    const collapseKey = `futsal:schedule-collapsed:${uuid}`
    const [collapsed, setCollapsed] = useState<boolean>(() => {
        try {
            return localStorage.getItem(`futsal:schedule-collapsed:${uuid}`) === "1"
        } catch {
            return false
        }
    })
    // Re-read when switching between tournaments (uuid change without remount).
    useEffect(() => {
        try {
            setCollapsed(localStorage.getItem(`futsal:schedule-collapsed:${uuid}`) === "1")
        } catch {
            setCollapsed(false)
        }
    }, [uuid])
    useEffect(() => {
        try {
            localStorage.setItem(collapseKey, collapsed ? "1" : "0")
        } catch {
            /* storage unavailable - collapse just won't persist */
        }
    }, [collapseKey, collapsed])
    /** List (rows, default) vs grid (compact cards) prikaz. Persisted globally
     *  under one key - the choice is a viewing preference, not per tournament. */
    const [viewMode, setViewMode] = useState<ScheduleView>(() => {
        try {
            return localStorage.getItem(VIEW_KEY) === "grid" ? "grid" : "list"
        } catch {
            return "list"
        }
    })
    useEffect(() => {
        try {
            localStorage.setItem(VIEW_KEY, viewMode)
        } catch {
            /* storage unavailable - the view choice just won't persist */
        }
    }, [viewMode])
    /** Read-only format box (between the filters and the list): a one-line
     *  summary that expands to the compact stat cards. Default collapsed;
     *  the expand choice is persisted globally. */
    const [formatBoxOpen, setFormatBoxOpen] = useState<boolean>(() => {
        try {
            return localStorage.getItem("futsal:schedule-format-open") === "1"
        } catch {
            return false
        }
    })
    useEffect(() => {
        try {
            localStorage.setItem("futsal:schedule-format-open", formatBoxOpen ? "1" : "0")
        } catch {
            /* storage unavailable - the expand choice just won't persist */
        }
    }, [formatBoxOpen])
    /** Drag-and-drop reorder state: the match being dragged + the row hovered. */
    const [dragId, setDragId] = useState<number | null>(null)
    const [overId, setOverId] = useState<number | null>(null)
    /** Latest values read by the global pointer listeners (avoid stale state). */
    const overIdRef = useRef<number | null>(null)
    const orderRef = useRef<number[]>([])
    /** Team id (as string) to filter the schedule by; "" = all teams. */
    const [teamFilter, setTeamFilter] = useState<string>("")
    /** Group name (A, B, …) to filter by; "" = all groups. */
    const [groupFilter, setGroupFilter] = useState<string>("")
    /** Calendar day (local YYYY-MM-DD) to filter by; "" = all days. Only shown
     *  when the tournament spans more than one day. */
    const [dayFilter, setDayFilter] = useState<string>("")
    const [cfg, setCfg] = useState<Cfg>({
        halfLengthMin: "10",
        halftimeBreakMin: "5",
        breakBetweenMatchesMin: "5",
        // Buffer is hidden in the UI now; kept at 0 so the backend field stays.
        bufferMin: "0",
        koEnabled: false,
        koHalfLengthMin: "10",
        koHalftimeBreakMin: "5",
        // Empty = the knockout inherits the group break between matches.
        koBreakBetweenMatchesMin: "",
    })

    useEffect(() => {
        let cancelled = false
        // Only spinner on a cold load; a cache hit is already painted.
        if (!queryClient.getQueryData(qk.schedule(uuid))) setLoading(true)
        queryClient
            .fetchQuery({ queryKey: qk.schedule(uuid), queryFn: () => fetchSchedule(uuid), staleTime: 15_000 })
            .then((s) => {
                if (cancelled) return
                setSchedule(s)
                const groupHalf = s.halfLengthMin != null ? String(s.halfLengthMin) : "10"
                const groupBreak = s.halftimeBreakMin != null ? String(s.halftimeBreakMin) : "5"
                // A stored koHalfLengthMin is what "the knockout differs" means;
                // with none, seed the (hidden) inputs from the group values so
                // toggling the override on starts from the current format.
                const koOn = s.koHalfLengthMin != null && s.koHalfLengthMin > 0
                setCfg({
                    halfLengthMin: groupHalf,
                    halftimeBreakMin: groupBreak,
                    breakBetweenMatchesMin:
                        s.breakBetweenMatchesMin != null
                            ? String(s.breakBetweenMatchesMin)
                            : "5",
                    bufferMin: "0",
                    koEnabled: koOn,
                    koHalfLengthMin: koOn ? String(s.koHalfLengthMin) : groupHalf,
                    koHalftimeBreakMin:
                        koOn && s.koHalftimeBreakMin != null
                            ? String(s.koHalftimeBreakMin)
                            : groupBreak,
                    // Empty stays empty (inherit the group break); only a stored
                    // explicit knockout break seeds the field.
                    koBreakBetweenMatchesMin:
                        koOn && s.koBreakBetweenMatchesMin != null
                            ? String(s.koBreakBetweenMatchesMin)
                            : "",
                })
            })
            .catch(() => {
                if (!cancelled) setSchedule(null)
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        // For GROUPS_KNOCKOUT, fixtures are created only when the schedule is
        // generated - so right after the group draw there are 0 matches. Detect
        // "draw done" from the groups instead, so "Generiraj raspored" unlocks
        // as soon as the groups are drawn.
        if (format === "GROUPS_KNOCKOUT") {
            queryClient
                .fetchQuery({ queryKey: qk.groups(uuid), queryFn: () => fetchGroups(uuid), staleTime: 15_000 })
                .then((gs) => { if (!cancelled) setGroupsDrawn(gs.length > 0) })
                .catch(() => { /* leave default - stays gated */ })
        } else {
            setGroupsDrawn(false)
        }
        return () => {
            cancelled = true
        }
    }, [uuid, format])

    // Mirror the schedule into the shared cache so the Grupe/Eliminacija tabs
    // and a reopen see the latest generated/edited schedule, not a stale one.
    useEffect(() => {
        if (schedule) queryClient.setQueryData(qk.schedule(uuid), schedule)
    }, [schedule, uuid, queryClient])

    // Arriving from the bracket position-save step: open the planner in
    // knockout-only mode once (NOT the full planner - the group schedule is
    // left alone), then tell the parent to clear the request so a later plain
    // visit to this tab doesn't re-open it. Runs only on mount (the tab remounts
    // each time the Raspored section is entered), so it's race-free.
    useEffect(() => {
        if (autoOpenKnockoutTimes) {
            if (!finishedLocked) setPlannerMode("ko")
            onAutoOpenKnockoutTimesConsumed?.()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // Scroll to + highlight the match the user tapped on /uzivo. Runs once
    // the schedule has loaded so the target row exists in the DOM.
    useEffect(() => {
        if (focusMatchId == null || loading) return
        const el = document.getElementById(`sched-match-${focusMatchId}`)
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" })
    }, [focusMatchId, loading, schedule])

    // Pointer-based drag reorder - works with BOTH mouse and touch. While a row
    // is dragged we track the row under the pointer (elementFromPoint) and
    // commit the new order on release. orderRef holds the current draggable ids.
    useEffect(() => {
        if (dragId == null) return
        const onMove = (e: PointerEvent) => {
            const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
            const row = el?.closest("[data-sched-row]") as HTMLElement | null
            const attr = row?.getAttribute("data-match-id")
            const id = attr ? Number(attr) : null
            overIdRef.current = id
            setOverId(id)
        }
        const finish = () => {
            const dragged = dragId
            const target = overIdRef.current
            overIdRef.current = null
            setOverId(null)
            setDragId(null)
            if (dragged == null || target == null || dragged === target) return
            const ids = orderRef.current
            const from = ids.indexOf(dragged)
            const to = ids.indexOf(target)
            if (from === -1 || to === -1 || from === to) return
            const next = [...ids]
            const [moved] = next.splice(from, 1)
            next.splice(to, 0, moved)
            void commitReorder(next)
        }
        window.addEventListener("pointermove", onMove)
        window.addEventListener("pointerup", finish)
        window.addEventListener("pointercancel", finish)
        return () => {
            window.removeEventListener("pointermove", onMove)
            window.removeEventListener("pointerup", finish)
            window.removeEventListener("pointercancel", finish)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dragId])

    const fixedBreaks = numVal(cfg.breakBetweenMatchesMin) + numVal(cfg.bufferMin)
    const slot = HALF_COUNT * numVal(cfg.halfLengthMin) + numVal(cfg.halftimeBreakMin) + fixedBreaks
    // The knockout break between matches falls back to the group break when the
    // field is left empty (inherit), mirroring the backend.
    const koBreakBetween = numValOrNull(cfg.koBreakBetweenMatchesMin) ?? numVal(cfg.breakBetweenMatchesMin)
    const koFixedBreaks = koBreakBetween + numVal(cfg.bufferMin)
    // The knockout slot only differs while the override is on; mirrors the
    // backend's slotFor(stage) so the footer never disagrees with the layout.
    const koSlot = cfg.koEnabled
        ? HALF_COUNT * numVal(cfg.koHalfLengthMin) + numVal(cfg.koHalftimeBreakMin) + koFixedBreaks
        : slot
    // The override is only meaningful when there IS a knockout to differ from
    // the groups - KNOCKOUT_ONLY has no group stage, GROUPS_ONLY no knockout.
    const canSplitFormat = format === "GROUPS_KNOCKOUT"

    // A schedule change creates/retimes the group + knockout fixtures that the
    // Grupe and Eliminacija tabs render from their OWN cached queries. Those
    // tabs load once via fetchQuery(staleTime), so drop their caches here to
    // force a fresh fetch when the organizer switches over - otherwise Grupe
    // keeps showing "Idi na raspored" (and Eliminacija its old state) until the
    // staleTime elapses.
    const refreshLinkedTabs = () => {
        queryClient.removeQueries({ queryKey: qk.groups(uuid) })
        queryClient.removeQueries({ queryKey: qk.bracket(uuid) })
    }

    async function runGenerate() {
        setGenerating(true)
        try {
            const s = await generateSchedule(uuid, {
                halfCount: HALF_COUNT,
                halfLengthMin: numVal(cfg.halfLengthMin),
                halftimeBreakMin: numVal(cfg.halftimeBreakMin),
                breakBetweenMatchesMin: numVal(cfg.breakBetweenMatchesMin),
                bufferMin: numVal(cfg.bufferMin),
                ...koPayload(cfg),
            })
            setSchedule(s)
            refreshLinkedTabs()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setGenerating(false)
        }
    }

    async function runClear() {
        setClearing(true)
        try {
            setSchedule(await clearSchedule(uuid))
            refreshLinkedTabs()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setClearing(false)
        }
    }

    /** Persist a new play order - the backend keeps the time slots fixed and
     *  reassigns them to the matches in this order (so a move swaps times). */
    async function commitReorder(orderedIds: number[]) {
        try {
            setSchedule(await reorderSchedule(uuid, orderedIds))
            refreshLinkedTabs()
        } catch {
            /* error toast surfaced by the http interceptor */
        }
    }

    async function onTimeChange(m: ScheduledMatch, localValue: string) {
        if (!localValue) return
        try {
            const iso = new Date(localValue).toISOString()
            setSchedule(await updateKickoff(uuid, m.matchId, iso))
            refreshLinkedTabs()
        } catch {
            /* error toast surfaced by the http interceptor */
        }
    }

    if (loading) {
        return <Loader label="Učitavanje rasporeda..." />
    }

    const rawMatches = schedule?.matches ?? []

    // Sort strictly by kickoff time (play order) - matches without a time go
    // to the bottom. Array.sort is stable, so equal/no-time rows keep the
    // backend's original order.
    const byKickoff = [...rawMatches]
        .map((m, i) => ({ m, i }))
        .sort((a, b) => {
            const ka = kickoffMs(a.m)
            const kb = kickoffMs(b.m)
            if (ka !== kb) return ka - kb
            return a.i - b.i
        })
        .map((x) => x.m)

    // How many distinct teams / groups the tournament has in total (ignoring the
    // active filters). Drives whether each dropdown is worth showing at all.
    const allTeamCount = (() => {
        const s = new Set<number>()
        for (const m of rawMatches) {
            if (m.team1Id != null) s.add(m.team1Id)
            if (m.team2Id != null) s.add(m.team2Id)
        }
        return s.size
    })()
    const allGroupCount = (() => {
        const s = new Set<string>()
        for (const m of rawMatches) if (m.groupName) s.add(m.groupName)
        return s.size
    })()

    // Team dropdown options - narrowed to the selected group, so once a group is
    // picked only that group's teams can be chosen (and not the other way round).
    const teamOptions = (() => {
        const map = new Map<number, string>()
        for (const m of rawMatches) {
            if (groupFilter && m.groupName !== groupFilter) continue
            if (m.team1Id != null) map.set(m.team1Id, m.team1Name ?? `#${m.team1Id}`)
            if (m.team2Id != null) map.set(m.team2Id, m.team2Name ?? `#${m.team2Id}`)
        }
        return [...map.entries()]
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name, "hr"))
    })()

    // Group dropdown options (A, B, …) - narrowed to the group(s) the selected
    // team plays in, so picking a team limits the group filter to that team's
    // group. Only group-stage matches carry a groupName; empty for KNOCKOUT_ONLY.
    const groupOptions = (() => {
        const set = new Set<string>()
        for (const m of rawMatches) {
            if (
                teamFilter &&
                String(m.team1Id) !== teamFilter &&
                String(m.team2Id) !== teamFilter
            ) {
                continue
            }
            if (m.groupName) set.add(m.groupName)
        }
        return [...set].sort((a, b) => a.localeCompare(b, "hr"))
    })()

    // Local calendar-day key + friendly label for the "filter by day" dropdown.
    const dateKey = (iso?: string | null): string => {
        if (!iso) return ""
        const d = new Date(iso)
        const p = (n: number) => String(n).padStart(2, "0")
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    }
    const dayLabel = (key: string): string => {
        const [y, mo, da] = key.split("-").map(Number)
        return new Date(y, mo - 1, da).toLocaleDateString("hr-HR", {
            weekday: "short",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        })
    }
    // Distinct scheduled days. The day filter only appears for a multi-day
    // tournament (more than one distinct kickoff date).
    const dayOptions = (() => {
        const set = new Set<string>()
        for (const m of rawMatches) {
            const k = dateKey(m.kickoffAt)
            if (k) set.add(k)
        }
        return [...set].sort()
    })()
    const multiDay = dayOptions.length > 1

    // Compact label for the in-list day divider, e.g. "1. dan · pon 08.07.".
    // Unscheduled matches (no kickoff) group under "Bez termina".
    const dividerLabel = (key: string): string => {
        if (!key) return "Bez termina"
        const [y, mo, da] = key.split("-").map(Number)
        const wd = new Date(y, mo - 1, da).toLocaleDateString("hr-HR", { weekday: "short" })
        const p = (n: number) => String(n).padStart(2, "0")
        const num = dayOptions.indexOf(key) + 1
        return `${num}. dan · ${wd} ${p(da)}.${p(mo)}.`
    }

    const anyFilter = !!teamFilter || !!groupFilter || !!(multiDay && dayFilter)
    function clearFilters() {
        setTeamFilter("")
        setGroupFilter("")
        setDayFilter("")
    }

    // Apply the active filters (team AND group AND day).
    const visibleMatches = byKickoff.filter((m) => {
        if (teamFilter && String(m.team1Id) !== teamFilter && String(m.team2Id) !== teamFilter) {
            return false
        }
        if (groupFilter && m.groupName !== groupFilter) return false
        if (multiDay && dayFilter && dateKey(m.kickoffAt) !== dayFilter) return false
        return true
    })

    // Two sections: upcoming/live first (the schedule), finished at the bottom.
    const upcomingMatches = visibleMatches.filter((m) => m.status !== "FINISHED")
    const finishedMatches = visibleMatches.filter((m) => m.status === "FINISHED")

    // True while any match is being played (unfiltered list - a filter must not
    // resurrect the "next up" emphasis while a game is running off-screen).
    const anyLive = rawMatches.some((m) => m.status === "LIVE")
    // The next match to start: the earliest-kickoff SCHEDULED match (computed
    // from the full list so the highlight is the globally-next game). Gets a red
    // border so the organizer immediately sees which game is on deck - but ONLY
    // while no match is LIVE: during a live game the red border belongs to the
    // live row alone, and upcoming rows render plain.
    const nextMatchId = anyLive
        ? null
        : byKickoff.find((m) => m.status === "SCHEDULED")?.matchId ?? null

    const renderRow = (
        m: ScheduledMatch,
        dnd?: {
            handle: React.ReactNode
            isOver: boolean
            isDragging: boolean
        },
    ) => {
        const content = (
            <MatchRow
                match={m}
                tournamentUuid={uuid}
                tournamentName={tournamentName ?? "Futsal turnir"}
                tournamentLocation={tournamentLocation}
                tournamentSlug={tournamentSlug}
                slotMinutes={slot}
                halfLengthMin={schedule?.halfLengthMin}
                onTimeChange={onTimeChange}
                canEdit={scheduleEditable && m.status === "SCHEDULED"}
                isNext={m.matchId === nextMatchId}
            />
        )
        return (
            <Box
                key={m.matchId}
                id={`sched-match-${m.matchId}`}
                rounded="xl"
                opacity={dnd?.isDragging ? 0.4 : 1}
                transition="opacity 0.12s"
                data-sched-row={dnd ? "" : undefined}
                data-match-id={dnd ? m.matchId : undefined}
                css={{
                    ...(focusMatchId === m.matchId
                        ? { outline: "2px solid var(--chakra-colors-brand-solid)", outlineOffset: "2px" }
                        : {}),
                    ...(dnd?.isOver
                        ? { boxShadow: "0 -3px 0 0 var(--chakra-colors-brand-solid)" }
                        : {}),
                }}
            >
                {dnd ? (
                    <Flex align="center" gap="1">
                        {dnd.handle}
                        <Box flex="1" minW="0">{content}</Box>
                    </Flex>
                ) : (
                    content
                )}
            </Box>
        )
    }

    // Grid-view card - view-only (no kickoff editing, no drag), but it keeps
    // the sched-match id + focus outline so the /uzivo deep-link scroll works
    // in both views.
    const renderCard = (m: ScheduledMatch) => (
        <Box
            key={m.matchId}
            id={`sched-match-${m.matchId}`}
            rounded="2xl"
            css={
                focusMatchId === m.matchId
                    ? { outline: "2px solid var(--chakra-colors-brand-solid)", outlineOffset: "2px" }
                    : undefined
            }
        >
            <MatchCard match={m} multiDay={multiDay} isNext={m.matchId === nextMatchId} />
        </Box>
    )

    // Split a (kickoff-sorted) match list into per-day runs so the grid can
    // render the same DayDivider above each day's card group.
    const dayGroups = (ms: ScheduledMatch[]) => {
        const out: { key: string; items: ScheduledMatch[] }[] = []
        for (const m of ms) {
            const k = dateKey(m.kickoffAt)
            const last = out[out.length - 1]
            if (last && last.key === k) last.items.push(m)
            else out.push({ key: k, items: [m] })
        }
        return out
    }

    // Tournament has started once a REAL match is played. A knockout bye is
    // auto-FINISHED on generation (one team, no game) and must NOT count -
    // otherwise drawing an elimination with byes would hide the schedule
    // controls (generate / reorder) before anything has actually been played.
    const tournamentStarted = rawMatches.some(
        (m) =>
            m.status === "LIVE" ||
            (m.status === "FINISHED" && m.team1Id != null && m.team2Id != null),
    )

    // The schedule has a stored format once it's been generated.
    const scheduleHasConfig = schedule != null && schedule.halfLengthMin != null
    // The stored knockout format differs from the groups (only meaningful once
    // the schedule is generated).
    const koFormatOn = schedule != null && schedule.koHalfLengthMin != null && schedule.koHalfLengthMin > 0
    // Matches without a kickoff (e.g. knockout drawn after the group schedule).
    const unscheduledCount = rawMatches.filter((m) => !m.kickoffAt).length
    // The organizer sees the editable config card (only before the start); the
    // read-only summary is for everyone else - and for organizers after start.
    // A finished-locked organizer never sees any editing surface.
    const showEditableConfig = canEdit && !tournamentStarted && !finishedLocked
    // A schedule can be generated once the draw is done. For KNOCKOUT_ONLY that
    // means the bracket exists (→ matches exist); for GROUPS_KNOCKOUT the group
    // draw is enough, since generating the schedule is what builds the group
    // fixtures (so there are no matches yet at that point).
    const drawGenerated = rawMatches.length > 0 || groupsDrawn
    // True once the schedule has actually been laid out (≥1 kickoff assigned).
    // Then the organizer gets "ponovno postavi" / "očisti" instead of the
    // first-time "Generiraj raspored".
    const scheduleLaidOut = rawMatches.some((m) => m.kickoffAt != null)
    // The schedule is freely editable before the tournament starts. Once it
    // starts it's read-only UNLESS the organizer turns on "Uredi raspored" -
    // which re-enables editing kickoff times + reorder for matches that haven't
    // started yet (SCHEDULED only).
    const scheduleEditable = canEdit && (!tournamentStarted || editScheduleMode) && !finishedLocked
    // Drag-and-drop reorder - only SCHEDULED (not-yet-played) matches, not
    // while any filter is active (the visible subset isn't the real order),
    // and only in the list view (the grid is a view-only layout).
    const reorderEnabled = scheduleEditable && scheduleLaidOut && !anyFilter && viewMode === "list"
    // Keep the current draggable order in a ref the pointer listeners can read.
    orderRef.current = reorderEnabled
        ? upcomingMatches
              .filter((m) => m.status === "SCHEDULED" && m.kickoffAt != null)
              .map((m) => m.matchId)
        : []

    // Any knockout matches (stage !== "GROUP")? Gates the "Termini završnice"
    // button that opens the knockout-only planner (group kickoffs untouched).
    const hasKnockout = byKickoff.some((m) => m.stage !== "GROUP")

    /* ── Format summary (read-only) ────────────────────────────────────────
       Compact "2×6 min · završnica 2×8 min" readout of the STORED schedule
       format, shown in the collapsible box between the filters and the list.
       Reads from the stored schedule once generated (mirrors the live `cfg`
       only as a harmless fallback before that - the box itself is gated on the
       schedule being generated). */
    const pillHalfCount = scheduleHasConfig ? (schedule?.halfCount ?? HALF_COUNT) : HALF_COUNT
    const pillGroupLen = scheduleHasConfig ? (schedule?.halfLengthMin ?? 0) : numVal(cfg.halfLengthMin)
    const pillKoOn = scheduleHasConfig ? koFormatOn : cfg.koEnabled
    const pillKoLen = scheduleHasConfig ? (schedule?.koHalfLengthMin ?? 0) : numVal(cfg.koHalfLengthMin)
    const pillText =
        `${pillHalfCount}×${pillGroupLen} min` +
        (pillKoOn ? ` · završnica ${pillHalfCount}×${pillKoLen} min` : "")
    // Short pauza readout appended after the format in the collapsed header
    // (half-time break / between-matches break), e.g. "pauze 5/5 min".
    const pauzeShort =
        `pauze ${schedule?.halftimeBreakMin ?? 0}/${schedule?.breakBetweenMatchesMin ?? 0} min`
    // Inline format editor (CfgFields + KO override + generate / regenerate /
    // clear). No popover, no portal:
    //   - forced open before the schedule is laid out, so the organizer has to
    //     set the format before they can generate (no toggle);
    //   - after it's laid out, revealed on demand via the "Uredi format" button.
    const configBoxForced = showEditableConfig && !scheduleLaidOut
    const configBoxToggle = showEditableConfig && scheduleLaidOut
    const showConfigBox = configBoxForced || (configBoxToggle && formatEditorOpen)

    /* ── Collapse ("Sažmi") ────────────────────────────────────────────────
       When collapsed, keep every LIVE row + only the next few SCHEDULED rows,
       then a single "+ još N utakmica" summary row expands the list again. */
    const COLLAPSE_LIMIT = 3
    const scheduledUpcomingCount = upcomingMatches.filter((m) => m.status === "SCHEDULED").length
    const canCollapse = scheduledUpcomingCount > COLLAPSE_LIMIT
    const hiddenUpcomingCount = canCollapse && collapsed ? scheduledUpcomingCount - COLLAPSE_LIMIT : 0
    let shownScheduled = 0
    const displayedUpcoming = canCollapse && collapsed
        ? upcomingMatches.filter((m) => {
              if (m.status !== "SCHEDULED") return true
              if (shownScheduled < COLLAPSE_LIMIT) {
                  shownScheduled++
                  return true
              }
              return false
          })
        : upcomingMatches
    // Collapsed - one subtle row folds the rest of the upcoming matches; click
    // (or "Prikaži sve") reopens. Shared by the list and grid prikaz.
    const showMoreButton = hiddenUpcomingCount > 0 ? (
        <chakra.button
            type="button"
            onClick={() => setCollapsed(false)}
            display="flex"
            alignItems="center"
            justifyContent="center"
            gap="2"
            w="full"
            py="2.5"
            rounded="lg"
            borderWidth="1px"
            borderStyle="dashed"
            borderColor="border.emphasized"
            bg="bg.surfaceTint"
            color="fg.muted"
            fontSize="sm"
            fontWeight={600}
            cursor="pointer"
            _hover={{ bg: "bg.panel", color: "fg.ink" }}
        >
            <FiChevronsDown size={14} />
            + još {hiddenUpcomingCount} utakmica
        </chakra.button>
    ) : null

    /* ── Config editor (moved into the header popover) ─────────────────────
       Same CfgField inputs + "Završnica se igra drugačije" override + the
       generate / re-generate / clear actions that used to live in the box
       above the list. Values still feed MultiDaySchedulePlanner via koPayload. */
    const configEditor = (
        <VStack align="stretch" gap="3">
            <Text fontSize="13px" fontWeight={800} color="fg.ink" letterSpacing="-0.01em">
                Format utakmice
            </Text>

            {/* Two columns: the normal (group) format on the left, the knockout
                format on the right. Side by side on desktop, stacked on mobile.
                Both column headers share the same height so the field rows below
                line up. */}
            <Flex gap={{ base: "3", md: "6" }} wrap="wrap" align="flex-start">
                {/* Left - group format */}
                <Box flex={{ base: "1 1 100%", md: "0 1 auto" }} minW="0">
                    {canSplitFormat && (
                        <Text
                            fontSize="2xs"
                            fontWeight={700}
                            letterSpacing="wide"
                            textTransform="uppercase"
                            color="fg.muted"
                            minH="20px"
                            mb="1.5"
                            display="flex"
                            alignItems="center"
                        >
                            Grupe
                        </Text>
                    )}
                    <Flex gap={{ base: "2", md: "3" }} wrap="wrap" align="flex-end">
                        <CfgField
                            label="Trajanje poluvrijeme"
                            value={cfg.halfLengthMin}
                            onChange={(v) => setCfg((c) => ({ ...c, halfLengthMin: v }))}
                        />
                        <CfgField
                            label="Pauza poluvrijeme"
                            value={cfg.halftimeBreakMin}
                            onChange={(v) => setCfg((c) => ({ ...c, halftimeBreakMin: v }))}
                        />
                        <CfgField
                            label="Pauza između utakmica"
                            value={cfg.breakBetweenMatchesMin}
                            onChange={(v) => setCfg((c) => ({ ...c, breakBetweenMatchesMin: v }))}
                        />
                    </Flex>
                </Box>

                {/* Right - knockout format (only for GROUPS_KNOCKOUT). The
                    "Završnica se igra drugačije" checkbox is this column's header;
                    the fields appear below it only when the override is on
                    (e.g. groups 2x6, završnica 2x8). The break field is optional -
                    empty inherits the group break. */}
                {canSplitFormat && (
                    <Box
                        flex={{ base: "1 1 100%", md: "0 1 auto" }}
                        minW="0"
                        borderTopWidth={{ base: "1px", md: "0" }}
                        borderLeftWidth={{ base: "0", md: "1px" }}
                        borderColor="border"
                        pt={{ base: "3", md: "0" }}
                        pl={{ base: "0", md: "6" }}
                    >
                        <Flex
                            as="label"
                            align="center"
                            gap="2"
                            cursor="pointer"
                            userSelect="none"
                            minH="20px"
                            mb="1.5"
                        >
                            <chakra.input
                                type="checkbox"
                                checked={cfg.koEnabled}
                                // Read the value synchronously: the updater below
                                // runs in React's reducer phase, by which time the
                                // synthetic event's currentTarget is already null.
                                onChange={(e) => {
                                    const checked = e.target.checked
                                    setCfg((c) => ({ ...c, koEnabled: checked }))
                                }}
                                w="16px"
                                h="16px"
                                accentColor="pitch.500"
                                cursor="pointer"
                                flexShrink={0}
                            />
                            <Text fontSize="12px" fontWeight={700} color="fg.ink" lineHeight="1.2">
                                Završnica se igra drugačije
                            </Text>
                        </Flex>
                        {cfg.koEnabled && (
                            <Flex gap={{ base: "2", md: "3" }} wrap="wrap" align="flex-end">
                                <CfgField
                                    label="Završnica - poluvrijeme"
                                    value={cfg.koHalfLengthMin}
                                    onChange={(v) => setCfg((c) => ({ ...c, koHalfLengthMin: v }))}
                                />
                                <CfgField
                                    label="Završnica - pauza poluvrijeme"
                                    value={cfg.koHalftimeBreakMin}
                                    onChange={(v) => setCfg((c) => ({ ...c, koHalftimeBreakMin: v }))}
                                />
                                <CfgField
                                    label="Završnica - pauza između utakmica"
                                    placeholder={cfg.breakBetweenMatchesMin || "5"}
                                    value={cfg.koBreakBetweenMatchesMin}
                                    onChange={(v) => setCfg((c) => ({ ...c, koBreakBetweenMatchesMin: v }))}
                                />
                            </Flex>
                        )}
                    </Box>
                )}
            </Flex>

            {/* Unified termin readout - one compact mono line for both slots
                (završnica only when the override is on). */}
            <Text fontFamily="mono" fontSize="12px" color="fg.muted" fontWeight={600}>
                Termin grupe: {slot} min
                {cfg.koEnabled ? ` · Termin završnice: ${koSlot} min` : ""}
            </Text>

            {/* Actions - a tight button row (no big padded panel). */}
            <VStack align="stretch" gap="2">
                {!drawGenerated && (
                    <Text fontSize="12px" color="fg.muted">
                        Prvo izvuci ždrijeb (grupe / eliminacija), pa generiraj raspored.
                    </Text>
                )}
                <Flex gap="2" wrap="wrap" align="center">
                    {scheduleLaidOut ? (
                        <>
                            <PrimaryButton
                                onClick={() => setPlannerMode("full")}
                                disabled={generating || clearing}
                                icon={<FiRefreshCw size={14} />}
                            >
                                Ponovno postavi
                            </PrimaryButton>
                            <GhostButton
                                danger
                                onClick={() => setConfirmAction("clear")}
                                disabled={generating || clearing}
                                icon={<FiTrash2 size={14} />}
                            >
                                Očisti raspored
                            </GhostButton>
                        </>
                    ) : (
                        <PrimaryButton
                            onClick={() => setPlannerMode("full")}
                            disabled={generating || !drawGenerated}
                            icon={<LuCalendarClock size={14} />}
                        >
                            {generating ? "Generiranje…" : "Generiraj raspored"}
                        </PrimaryButton>
                    )}
                </Flex>
            </VStack>
        </VStack>
    )

    // The compact action cluster shown in the "Raspored" header (or standalone
    // above the list when there is no upcoming section to host it).
    const scheduleControls = (
        <HStack gap="2" wrap="wrap" justify="flex-end">
            {/* Reopen the knockout planner any time knockout matches exist - so
                the završnica kickoffs stay schedulable after the one-shot flow. */}
            {canEdit && hasKnockout && !finishedLocked && (
                <GhostButton
                    px="3.5"
                    py="2"
                    fontSize="13px"
                    icon={<LuCalendarClock size={14} />}
                    onClick={() => setPlannerMode("ko")}
                >
                    Termini završnice
                </GhostButton>
            )}
            {configBoxToggle && (
                <GhostButton
                    px="3.5"
                    py="2"
                    fontSize="13px"
                    icon={<FiEdit2 size={14} />}
                    onClick={() => setFormatEditorOpen((v) => !v)}
                >
                    {formatEditorOpen ? "Zatvori format" : "Uredi format"}
                </GhostButton>
            )}
            {canEdit && tournamentStarted && !finishedLocked && (
                <PrimaryButton
                    px="3.5"
                    py="2"
                    fontSize="13px"
                    icon={<FiEdit2 size={14} />}
                    onClick={() => setEditScheduleMode((v) => !v)}
                >
                    {editScheduleMode ? "Gotovo" : "Uredi raspored"}
                </PrimaryButton>
            )}
            {rawMatches.length > 0 && (
                <GhostButton
                    px="3.5"
                    py="2"
                    fontSize="13px"
                    icon={<FiDownload size={14} />}
                    onClick={() => setExportOpen(true)}
                >
                    Preuzmi
                </GhostButton>
            )}
            {/* List / grid prikaz switcher - same segmented pattern as the
                tournaments page toggle, compacted to icon-only buttons. */}
            {rawMatches.length > 0 && (
                <HStack
                    gap="0.5"
                    px="0.5"
                    py="0.5"
                    bg="bg.panel"
                    borderWidth="1px"
                    borderColor="border"
                    rounded="lg"
                    flexShrink={0}
                >
                    <ViewToggleButton
                        active={viewMode === "list"}
                        onClick={() => setViewMode("list")}
                        icon={<FiList size={14} />}
                        label="Popis"
                    />
                    <ViewToggleButton
                        active={viewMode === "grid"}
                        onClick={() => setViewMode("grid")}
                        icon={<FiGrid size={14} />}
                        label="Mreža"
                    />
                </HStack>
            )}
        </HStack>
    )
    // The "Raspored" section header hosts the controls whenever it renders;
    // otherwise (empty list, filtered-out, or finished-only) they sit in a
    // standalone row above the list so generate / export stay reachable.
    const controlsInHeader = upcomingMatches.length > 0

    return (
        <VStack align="stretch" gap="5" py="2">
            {/* Finished-lock notice - replaces every editing entry point with a
                single unobtrusive row (only for users who could otherwise edit). */}
            {finishedLocked && canEdit && (
                <Flex
                    align="center"
                    gap="2"
                    px="3"
                    py="2"
                    borderWidth="1px"
                    borderColor="border"
                    rounded="lg"
                    bg="bg.surfaceTint"
                    color="fg.muted"
                >
                    <FiInfo size={14} />
                    <Text fontFamily="mono" fontSize="xs" fontWeight={600}>
                        Turnir je završen. Obrati se administratoru za otključavanje.
                    </Text>
                </Flex>
            )}

            {/* Schedule controls (Termini završnice · Uredi format · Uredi
                raspored · Preuzmi · view toggle). When there is an upcoming
                list they live in its "Raspored" header; otherwise they sit here
                so generate / export stay reachable. */}
            {!controlsInHeader && rawMatches.length > 0 && (
                <Flex justify="flex-end">{scheduleControls}</Flex>
            )}

            {/* Inline format editor - an always-open, prominent box for the
                organizer before the schedule is laid out (they must set the
                match format here), then toggled via "Uredi format" afterwards.
                Rendered inline (never a portal) so it can't float over other
                dialogs the way the old popover did. */}
            {showConfigBox && (
                <Box
                    bg="bg.panel"
                    borderWidth="1px"
                    borderColor="border"
                    rounded="xl"
                    p={{ base: "4", md: "5" }}
                >
                    {configEditor}
                </Box>
            )}

            <ExportDialog
                open={exportOpen}
                onClose={() => setExportOpen(false)}
                kind="schedule"
                meta={exportMeta ?? {
                    tournamentName: tournamentName ?? "Turnir",
                    tournamentUrl: `${window.location.origin}/turniri/${tournamentSlug ?? uuid}`,
                }}
                matches={rawMatches}
            />

            {/* Some matches have no kickoff (typically the knockout drawn after
                the group schedule). Let the organizer re-confirm so they get a
                slot - useful for day-split tournaments. */}
            {canEdit && unscheduledCount > 0 && !finishedLocked && (
                <Flex
                    align="center"
                    justify="space-between"
                    gap="3"
                    wrap="wrap"
                    bg="brand.subtle"
                    borderWidth="1px"
                    borderColor="brand.emphasized"
                    rounded="xl"
                    px="4"
                    py="3"
                >
                    <HStack gap="2" minW="0">
                        <FiClock size={16} />
                        <Text fontSize="sm" color="fg.ink" fontWeight={500}>
                            {unscheduledCount === 1
                                ? "1 utakmica nema raspored"
                                : `${unscheduledCount} utakmica nema raspored`}{" "}
                            (npr. eliminacija). Uredi termine ili ih popuni automatski.
                        </Text>
                    </HStack>
                    <PrimaryButton
                        onClick={() => setPlannerMode("ko")}
                        icon={<LuCalendarClock size={14} />}
                    >
                        Uredi termine
                    </PrimaryButton>
                </Flex>
            )}

            {/* Filter the schedule - by team, by group, and (multi-day only) by
                day. Centred box that lights up when any filter is active. */}
            {(allTeamCount > 1 || allGroupCount > 1 || multiDay) && (
                <Flex justify="center">
                    <Flex
                        align="center"
                        justify="center"
                        gap="3"
                        wrap="wrap"
                        borderWidth="1px"
                        borderColor={anyFilter ? "brand.emphasized" : "border.emphasized"}
                        bg={anyFilter ? "brand.subtle" : "bg.surfaceTint"}
                        rounded="xl"
                        px="5"
                        py="3"
                        shadow="xs"
                        transition="background-color 0.15s, border-color 0.15s"
                    >
                        <HStack gap="1.5" color={anyFilter ? "brand.fg" : "fg.ink"} flexShrink={0}>
                            <FiFilter size={15} />
                            <Text fontSize="sm" fontWeight={600} whiteSpace="nowrap">
                                Filtriraj:
                            </Text>
                        </HStack>

                        {allTeamCount > 1 && (
                            <NativeSelect.Root size="sm" w="auto" minW="170px" maxW="240px">
                                <NativeSelect.Field
                                    value={teamFilter}
                                    onChange={(e) => setTeamFilter(e.target.value)}
                                    fontWeight={600}
                                    aria-label="Filtriraj po ekipi"
                                >
                                    <option value="">Sve ekipe</option>
                                    {teamOptions.map((t) => (
                                        <option key={t.id} value={t.id}>
                                            {t.name}
                                        </option>
                                    ))}
                                </NativeSelect.Field>
                                <NativeSelect.Indicator />
                            </NativeSelect.Root>
                        )}

                        {allGroupCount > 1 && (
                            <NativeSelect.Root size="sm" w="auto" minW="130px" maxW="180px">
                                <NativeSelect.Field
                                    value={groupFilter}
                                    onChange={(e) => setGroupFilter(e.target.value)}
                                    fontWeight={600}
                                    aria-label="Filtriraj po skupini"
                                >
                                    <option value="">Sve skupine</option>
                                    {groupOptions.map((g) => (
                                        <option key={g} value={g}>
                                            Skupina {g}
                                        </option>
                                    ))}
                                </NativeSelect.Field>
                                <NativeSelect.Indicator />
                            </NativeSelect.Root>
                        )}

                        {multiDay && (
                            <NativeSelect.Root size="sm" w="auto" minW="150px" maxW="220px">
                                <NativeSelect.Field
                                    value={dayFilter}
                                    onChange={(e) => setDayFilter(e.target.value)}
                                    fontWeight={600}
                                    aria-label="Filtriraj po danu"
                                >
                                    <option value="">Svi dani</option>
                                    {dayOptions.map((d) => (
                                        <option key={d} value={d}>
                                            {dayLabel(d)}
                                        </option>
                                    ))}
                                </NativeSelect.Field>
                                <NativeSelect.Indicator />
                            </NativeSelect.Root>
                        )}

                        {/* Always rendered (hidden when inactive) so the box keeps
                            its size and the layout doesn't shift on pick. */}
                        <Button
                            size="xs"
                            variant="ghost"
                            colorPalette="brand"
                            onClick={clearFilters}
                            visibility={anyFilter ? "visible" : "hidden"}
                            aria-hidden={!anyFilter}
                            tabIndex={anyFilter ? 0 : -1}
                            flexShrink={0}
                        >
                            Poništi filtere
                        </Button>
                    </Flex>
                </Flex>
            )}

            {/* Read-only format summary - a one-line header (format + short
                pauza) that expands to the compact stat cards. Sits between the
                filters and the list; shown once the schedule has a stored
                format. Replaces the old header pill (no duplication). */}
            {scheduleHasConfig && schedule && (
                <Box
                    borderWidth="1px"
                    borderColor="border"
                    bg="bg.surfaceTint"
                    rounded="xl"
                    overflow="hidden"
                >
                    <chakra.button
                        type="button"
                        onClick={() => setFormatBoxOpen((v) => !v)}
                        aria-expanded={formatBoxOpen}
                        display="flex"
                        alignItems="center"
                        justifyContent="space-between"
                        gap="3"
                        w="full"
                        px="4"
                        py="2.5"
                        bg="transparent"
                        border="none"
                        cursor="pointer"
                        textAlign="left"
                        _hover={{ bg: "bg.panel" }}
                    >
                        <Flex align="center" gap="2" minW="0" wrap="wrap" color="fg.muted">
                            <FiClock size={13} />
                            <Box
                                as="span"
                                fontFamily="mono"
                                fontSize="12px"
                                fontWeight={700}
                                color="fg.ink"
                                whiteSpace="nowrap"
                            >
                                {pillText}
                            </Box>
                            <Box
                                as="span"
                                fontFamily="mono"
                                fontSize="11px"
                                color="fg.muted"
                                whiteSpace="nowrap"
                            >
                                · {pauzeShort}
                            </Box>
                        </Flex>
                        <Box color="fg.muted" flexShrink={0} display="inline-flex">
                            {formatBoxOpen ? <FiChevronUp size={16} /> : <FiChevronDown size={16} />}
                        </Box>
                    </chakra.button>

                    {formatBoxOpen && (
                        <Box px="4" pt="1" pb="3.5" borderTopWidth="1px" borderColor="border">
                            <VStack align="stretch" gap="3" pt="2.5">
                                {koFormatOn && (
                                    <Text
                                        fontSize="2xs"
                                        fontWeight={700}
                                        letterSpacing="wide"
                                        textTransform="uppercase"
                                        color="fg.muted"
                                    >
                                        Grupe
                                    </Text>
                                )}
                                <Flex gap="2" wrap="wrap">
                                    <FormatStat
                                        label="Trajanje poluvrijeme"
                                        value={`${schedule.halfLengthMin ?? 0} min`}
                                    />
                                    <FormatStat
                                        label="Pauza poluvrijeme"
                                        value={`${schedule.halftimeBreakMin ?? 0} min`}
                                    />
                                    <FormatStat
                                        label="Pauza između utakmica"
                                        value={`${schedule.breakBetweenMatchesMin ?? 0} min`}
                                    />
                                </Flex>
                                {koFormatOn && (
                                    <>
                                        <Text
                                            fontSize="2xs"
                                            fontWeight={700}
                                            letterSpacing="wide"
                                            textTransform="uppercase"
                                            color="fg.muted"
                                        >
                                            Završnica
                                        </Text>
                                        <Flex gap="2" wrap="wrap">
                                            <FormatStat
                                                label="Poluvrijeme"
                                                value={`${schedule.koHalfLengthMin ?? 0} min`}
                                            />
                                            <FormatStat
                                                label="Pauza poluvrijeme"
                                                value={`${schedule.koHalftimeBreakMin ?? 0} min`}
                                            />
                                            {schedule.koBreakBetweenMatchesMin != null && (
                                                <FormatStat
                                                    label="Pauza između utakmica"
                                                    value={`${schedule.koBreakBetweenMatchesMin} min`}
                                                />
                                            )}
                                        </Flex>
                                    </>
                                )}
                            </VStack>
                        </Box>
                    )}
                </Box>
            )}

            {/* Match list - upcoming (the schedule) first, finished at the bottom. */}
            {rawMatches.length === 0 ? (
                <Panel>
                    <EmptyState
                        icon={LuCalendarX2}
                        title="Nema utakmica"
                        description="Još nema utakmica. Izvuci grupe ili generiraj eliminacijsku ljestvicu, pa generiraj raspored."
                    />
                </Panel>
            ) : visibleMatches.length === 0 ? (
                <Panel>
                    <EmptyState
                        icon={LuCalendarX2}
                        title="Nema utakmica"
                        description="Nijedna utakmica ne odgovara odabranom filteru."
                        action={
                            anyFilter ? (
                                <Button size="sm" variant="outline" onClick={clearFilters}>
                                    Poništi filtere
                                </Button>
                            ) : undefined
                        }
                    />
                </Panel>
            ) : (
                <>
                    {upcomingMatches.length > 0 && (
                        <SectionCard
                            icon={LuCalendarClock}
                            title="Raspored"
                            subtitle={
                                reorderEnabled ? (
                                    <>
                                        Povuci utakmicom klikom na{" "}
                                        <Box
                                            as="span"
                                            display="inline-flex"
                                            verticalAlign="middle"
                                            color="fg.muted"
                                            mx="0.5"
                                        >
                                            <LuGripVertical size={14} />
                                        </Box>{" "}
                                        za promjenu rasporeda - satnica se ažurira automatski
                                    </>
                                ) : undefined
                            }
                            padding="4"
                            action={scheduleControls}
                        >
                            {viewMode === "grid" ? (
                                /* Grid prikaz - view-only cards, day dividers
                                   above each day's card group (multi-day only),
                                   collapse shares the same "+ još N" row. */
                                <VStack align="stretch" gap="2">
                                    {dayGroups(displayedUpcoming).map((g, gi) => (
                                        <Fragment key={g.key || "bez-termina"}>
                                            {multiDay && (
                                                <DayDivider label={dividerLabel(g.key)} first={gi === 0} />
                                            )}
                                            <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} gap="2">
                                                {g.items.map((m) => renderCard(m))}
                                            </SimpleGrid>
                                        </Fragment>
                                    ))}
                                    {showMoreButton}
                                </VStack>
                            ) : (
                            <VStack align="stretch" gap="2">
                                {displayedUpcoming.map((m, idx) => {
                                    // Day separator before the first match of each
                                    // day (multi-day tournaments only). Doesn't touch
                                    // the drag order - it's not a [data-sched-row].
                                    const curKey = dateKey(m.kickoffAt)
                                    const prevKey = idx > 0 ? dateKey(displayedUpcoming[idx - 1].kickoffAt) : null
                                    const dayNode = multiDay && curKey !== prevKey
                                        ? <DayDivider label={dividerLabel(curKey)} first={idx === 0} />
                                        : null
                                    const row = !(reorderEnabled && m.status === "SCHEDULED" && m.kickoffAt != null)
                                        ? renderRow(m)
                                        : renderRow(m, {
                                            isOver: overId === m.matchId && dragId != null && dragId !== m.matchId,
                                            isDragging: dragId === m.matchId,
                                            handle: (
                                            <Box
                                                onPointerDown={(e) => {
                                                    e.preventDefault()
                                                    // Capture the pointer so the drag keeps tracking even
                                                    // when the finger/cursor leaves the small handle - this
                                                    // is what makes touch drag-and-drop work on phones.
                                                    try {
                                                        ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                                                    } catch { /* not supported - falls back to window listeners */ }
                                                    setDragId(m.matchId)
                                                    overIdRef.current = m.matchId
                                                }}
                                                cursor="grab"
                                                color={dragId === m.matchId ? "brand.solid" : "fg.subtle"}
                                                _hover={{ color: "fg.muted" }}
                                                display="flex"
                                                alignItems="center"
                                                justifyContent="center"
                                                px="2"
                                                py="1.5"
                                                flexShrink={0}
                                                style={{ touchAction: "none", userSelect: "none" }}
                                                title="Povuci za promjenu rasporeda"
                                                aria-label="Povuci za promjenu rasporeda"
                                            >
                                                {/* pointer-events none so the touch lands on the handle Box
                                                    (which has touch-action:none), not the SVG. */}
                                                <LuGripVertical size={18} style={{ pointerEvents: "none" }} />
                                            </Box>
                                        ),
                                    })
                                    return (
                                        <Fragment key={m.matchId}>
                                            {dayNode}
                                            {row}
                                        </Fragment>
                                    )
                                })}
                                {showMoreButton}
                            </VStack>
                            )}
                        </SectionCard>
                    )}
                    {finishedMatches.length > 0 && (
                        <SectionCard
                            icon={LuCalendarClock}
                            title="Završene utakmice"
                            padding="4"
                        >
                            {viewMode === "grid" ? (
                                <VStack align="stretch" gap="2">
                                    {dayGroups(finishedMatches).map((g, gi) => (
                                        <Fragment key={g.key || "bez-termina"}>
                                            {multiDay && (
                                                <DayDivider label={dividerLabel(g.key)} first={gi === 0} />
                                            )}
                                            <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} gap="2">
                                                {g.items.map((m) => renderCard(m))}
                                            </SimpleGrid>
                                        </Fragment>
                                    ))}
                                </VStack>
                            ) : (
                            <VStack align="stretch" gap="2">
                                {finishedMatches.map((m, idx) => {
                                    const curKey = dateKey(m.kickoffAt)
                                    const prevKey = idx > 0 ? dateKey(finishedMatches[idx - 1].kickoffAt) : null
                                    const dayNode = multiDay && curKey !== prevKey
                                        ? <DayDivider label={dividerLabel(curKey)} first={idx === 0} />
                                        : null
                                    return (
                                        <Fragment key={m.matchId}>
                                            {dayNode}
                                            {renderRow(m)}
                                        </Fragment>
                                    )
                                })}
                            </VStack>
                            )}
                        </SectionCard>
                    )}
                </>
            )}

            {/* Confirm popup for the two destructive schedule actions. */}
            <ConfirmDialog
                open={confirmAction !== null}
                busy={confirmAction === "clear" ? clearing : generating}
                danger={confirmAction === "clear"}
                title={confirmAction === "clear" ? "Očistiti raspored?" : "Ponovno postaviti raspored?"}
                description={
                    confirmAction === "clear"
                        ? "Svi termini utakmica bit će obrisani. Utakmice (grupe / eliminacija) ostaju, ali bez termina - možeš ih kasnije ponovno postaviti ili unijeti ručno."
                        : "Termini svih utakmica bit će ponovno postavljeni prema trenutnim postavkama formata. Ručno upisani termini bit će prepisani."
                }
                confirmLabel={confirmAction === "clear" ? "Da, očisti" : "Da, ponovno postavi"}
                onClose={() => setConfirmAction(null)}
                onConfirm={async () => {
                    if (confirmAction === "clear") await runClear()
                    else await runGenerate()
                    setConfirmAction(null)
                }}
            />

            {/* Multi-day generate flow: date range → per-day matches → sketch
                preview → confirm & generate. In "ko" mode it plans only the
                knockout matches ("Raspored završnice") - the group kickoffs are
                left untouched - replacing the old KnockoutTimesDialog. */}
            {plannerMode && (
                <MultiDaySchedulePlanner
                    uuid={uuid}
                    startAt={startAt}
                    koOnly={plannerMode === "ko"}
                    cfg={{
                        halfCount: HALF_COUNT,
                        halfLengthMin: numVal(cfg.halfLengthMin),
                        halftimeBreakMin: numVal(cfg.halftimeBreakMin),
                        breakBetweenMatchesMin: numVal(cfg.breakBetweenMatchesMin),
                        bufferMin: numVal(cfg.bufferMin),
                        ...koPayload(cfg),
                    }}
                    onClose={() => setPlannerMode(null)}
                    onGenerated={(s) => { setSchedule(s); refreshLinkedTabs() }}
                />
            )}
        </VStack>
    )
}
