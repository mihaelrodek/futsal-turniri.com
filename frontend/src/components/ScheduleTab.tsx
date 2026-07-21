import { Fragment, useEffect, useState } from "react"
import {
    Box,
    Button,
    chakra,
    Field,
    Flex,
    HStack,
    IconButton,
    Input,
    NativeSelect,
    SimpleGrid,
    Text,
    VStack,
} from "@chakra-ui/react"
import { FiCalendar, FiChevronDown, FiChevronRight, FiChevronsDown, FiChevronUp, FiClock, FiDownload, FiEdit2, FiGrid, FiInfo, FiList, FiMenu, FiRefreshCw, FiTrash2 } from "react-icons/fi"
import { FaBroom } from "react-icons/fa6"
import { LuCalendarClock, LuCalendarX2 } from "react-icons/lu"
import { useNavigate } from "react-router-dom"
import { clearSchedule, fetchSchedule, generateSchedule, updateKickoff } from "../api/schedule"
import MultiDaySchedulePlanner from "./MultiDaySchedulePlanner"
import MatchNotificationBell from "./MatchNotificationBell"
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

const RowButton = chakra("button")

/* -- Interactive-child click guard --------------------------------------- */
/** True when a click originated on an interactive child (button, link, form
 *  control, menu item). The compact list rows and grid-sm cards navigate on a
 *  body click but must ignore clicks on inner controls - same guard pattern as
 *  BracketTab's MatchCard onClick. */
function isInteractiveClick(e: React.MouseEvent): boolean {
    const t = e.target as HTMLElement | null
    return !!t?.closest(
        'button, a, input, select, textarea, label, [role="button"], [role="menu"], [role="menuitem"], [data-scope="menu"]',
    )
}

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

/* -- Shared "add to calendar" (.ics) action ------------------------------ */
/** Builds + downloads the per-match calendar entry. Shared by all three
 *  raspored layouts (the full MatchRow, the compact list row and the grid-sm
 *  card) so the SUMMARY / LOCATION / URL wording can't drift between them. */
type IcsOpts = {
    tournamentUuid: string
    tournamentName: string
    tournamentLocation?: string | null
    tournamentSlug?: string | null
    slotMinutes: number
}
function downloadMatchIcs(match: ScheduledMatch, opts: IcsOpts) {
    if (!match.kickoffAt) return
    const start = new Date(match.kickoffAt)
    const end = new Date(start.getTime() + Math.max(opts.slotMinutes, 30) * 60 * 1000)
    const t1 = match.team1Name ?? "-"
    const t2 = match.team2Name ?? "-"
    const url = opts.tournamentSlug
        ? `${window.location.origin}/turniri/${opts.tournamentSlug}`
        : `${window.location.origin}/turniri/${opts.tournamentUuid}`
    const ics = buildMatchIcs({
        uid: `match-${match.matchId}@futsal-turniri.com`,
        summary: `${t1} vs ${t2} - ${opts.tournamentName}`,
        location: opts.tournamentLocation ?? undefined,
        description: `${opts.tournamentName}`,
        url,
        start,
        end,
    })
    const safeName = `${t1}-${t2}`.replace(/[^a-z0-9\-]+/gi, "_").slice(0, 40)
    downloadIcs(`utakmica-${safeName}.ics`, ics)
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
    // Only a FINISHED match offers the "Detalji" timeline expand - a live
    // match's row stays clean (its details live on the match page), and a
    // match that hasn't kicked off has nothing to expand.
    const canExpand = isFinished

    // Long club names shrink a touch and wrap (up to three lines) so they stay
    // readable in the schedule row instead of truncating with an ellipsis.
    const nameMaxLen = Math.max((match.team1Name ?? "").length, (match.team2Name ?? "").length)
    const nameFont = nameMaxLen > 26 ? { base: "12px", md: "13px" } : "sm"

    function addToCalendar() {
        downloadMatchIcs(match, {
            tournamentUuid,
            tournamentName,
            tournamentLocation,
            tournamentSlug,
            slotMinutes,
        })
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
                       time dead-centre in a true 1fr/auto/1fr grid (the centre
                       column stays centred regardless of how wide the two side
                       clusters are). A LIVE match is signalled by the red
                       border + red score box alone - no "UŽIVO" text badge. */
                    <Box display="grid" gridTemplateColumns="1fr auto 1fr" alignItems="center" gap="2">
                        <HStack gap="2" wrap="wrap" minW="0" justify="flex-start">
                            <StageBadge stage={match.stage} groupName={match.groupName} />
                        </HStack>
                        <Box flexShrink={0} w="200px" maxW="100%">
                            {timeContent}
                        </Box>
                        <Flex wrap="wrap" minW="0" justify="flex-end">
                            {isLive && (
                                <MatchNotificationBell
                                    tournamentUuid={tournamentUuid}
                                    matchId={match.matchId}
                                />
                            )}
                        </Flex>
                    </Box>
                ) : (
                    /* SCHEDULED header - all on ONE row: stage badge (left),
                       kickoff time dead-centre, and the "add to calendar" button
                       (right). A true 1fr/auto/1fr grid keeps the centre column
                       dead-centre regardless of how wide the two side clusters
                       are (the old equal-flex clusters drifted once the right
                       cluster - calendar button + bell - grew wider than the
                       left stage badge). The next-to-start match keeps its red
                       border (the "Na redu" tag was dropped). */
                    <Box display="grid" gridTemplateColumns="1fr auto 1fr" alignItems="center" gap="2">
                        <HStack gap="2" wrap="wrap" minW="0" justify="flex-start">
                            <StageBadge stage={match.stage} groupName={match.groupName} />
                        </HStack>
                        <Box flexShrink={0} w="200px" maxW="100%">
                            {timeContent}
                        </Box>
                        <Flex wrap="wrap" minW="0" justify="flex-end" align="center" gap="1.5">
                            {calendarBtn}
                            <MatchNotificationBell
                                tournamentUuid={tournamentUuid}
                                matchId={match.matchId}
                            />
                        </Flex>
                    </Box>
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
    onOpen,
    tournamentUuid,
    tournamentName,
    tournamentLocation,
    tournamentSlug,
    slotMinutes,
    isNext = false,
}: {
    match: ScheduledMatch
    /** Multi-day tournament - the kickoff stamp adds the date ("DD.MM. HH:MM"),
     *  matching the list's day-aware time display; single-day shows just HH:MM. */
    multiDay: boolean
    /** Navigate to the match-details page on a body click (clicks on inner
     *  controls are ignored via isInteractiveClick). */
    onOpen: (m: ScheduledMatch) => void
    /** ICS + notification-bell props (threaded like MatchRow) so the card can
     *  offer the same add-to-calendar / notify actions. */
    tournamentUuid: string
    tournamentName: string
    tournamentLocation?: string | null
    tournamentSlug?: string | null
    slotMinutes: number
    /** True for the single next-to-start match - same red-border emphasis as
     *  the list row (already suppressed upstream while any match is LIVE). */
    isNext?: boolean
}) {
    const { isLive, t1Name, t2Name, t1Muted, t2Muted, scoreText } = matchDisplay(match)
    // Add-to-calendar only for a scheduled match that has a termin; the notify
    // bell for scheduled + live (pointless once finished).
    const showCalBtn = match.status === "SCHEDULED" && !!match.kickoffAt
    const showBell = match.status !== "FINISHED"

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
            cursor="pointer"
            transition="background 0.15s"
            _hover={{ bg: "bg.muted" }}
            onClick={(e) => {
                if (isInteractiveClick(e)) return
                onOpen(match)
            }}
            borderColor={isLive || isNext ? "red.emphasized" : "border"}
            borderWidth={isLive || isNext ? "2px" : "1px"}
        >
            <VStack align="stretch" gap="2" h="full" justify="space-between">
                <Box display="grid" gridTemplateColumns="1fr auto 1fr" alignItems="center" gap="2">
                    {/* Left cell - icon-only "add to calendar" button (scheduled
                        matches only). Right cell mirrors it with the bell, so a
                        true 1fr/auto/1fr grid keeps the centre cell (stage badge
                        + kickoff) dead-centre regardless of which side actions
                        are present. */}
                    <Flex justify="flex-start" minW="0">
                        {showCalBtn && (
                            <IconButton
                                aria-label="Dodaj u kalendar"
                                title="Dodaj u kalendar"
                                size="xs"
                                variant="ghost"
                                colorPalette="gray"
                                rounded="full"
                                flexShrink={0}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    downloadMatchIcs(match, {
                                        tournamentUuid,
                                        tournamentName,
                                        tournamentLocation,
                                        tournamentSlug,
                                        slotMinutes,
                                    })
                                }}
                            >
                                <FiCalendar size={13} />
                            </IconButton>
                        )}
                    </Flex>
                    <VStack gap="0.5" align="center" minW="0">
                        <StageBadge stage={match.stage} groupName={match.groupName} />
                        {kickoffLabel ? (
                            <HStack gap="1" fontSize="xs" fontWeight={600} color="fg.muted" fontFamily="mono">
                                <FiClock size={11} />
                                <Box as="span">{kickoffLabel}</Box>
                            </HStack>
                        ) : (
                            <Text fontSize="2xs" color="fg.subtle">
                                Termin nije određen
                            </Text>
                        )}
                    </VStack>
                    <Flex justify="flex-end" minW="0">
                        {showBell && (
                            <MatchNotificationBell
                                tournamentUuid={tournamentUuid}
                                matchId={match.matchId}
                            />
                        )}
                    </Flex>
                </Box>

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

/* -- Match compact row (list view) --------------------------------------- */
/** Slim, view-only row for the default "list" prikaz - the register of the
 *  /uzivo "Nadolazeće utakmice" list: a mono time pill (replaced by the score
 *  once the match is LIVE / FINISHED, shown in the time's place like MatchRow)
 *  on the left, the resolved "Team A vs Team B" bold with a muted stage/group
 *  tag beneath, and a chevron on the right. The whole row is a click-through to
 *  the match page (inner-control clicks ignored via isInteractiveClick). Team
 *  names reuse the shared matchDisplay so the predicted-pairing / slot-label
 *  fallbacks render muted, exactly like the other two layouts. */
function MatchCompactRow({
    match,
    multiDay,
    onOpen,
    tournamentUuid,
    tournamentName,
    tournamentLocation,
    tournamentSlug,
    slotMinutes,
    isNext = false,
}: {
    match: ScheduledMatch
    /** Multi-day tournament - the time pill adds the date ("DD.MM. HH:MM"). */
    multiDay: boolean
    /** Navigate to the match-details page on a body click. */
    onOpen: (m: ScheduledMatch) => void
    /** ICS + notification-bell props (threaded like MatchRow) so the slim row
     *  can offer the same add-to-calendar / notify actions. */
    tournamentUuid: string
    tournamentName: string
    tournamentLocation?: string | null
    tournamentSlug?: string | null
    slotMinutes: number
    /** True for the single next-to-start match - red border, same as MatchRow. */
    isNext?: boolean
}) {
    const { isLive, isFinished, scoreboard, t1Name, t2Name, t1Muted, t2Muted, scoreText } =
        matchDisplay(match)
    // Add-to-calendar only for a scheduled match that has a termin; the notify
    // bell for scheduled + live (pointless once finished).
    const showCalBtn = match.status === "SCHEDULED" && !!match.kickoffAt
    const showBell = !isFinished

    // "HH:MM" (single-day) / "DD.MM. HH:MM" (multi-day); null when no kickoff.
    const kickoffLabel = (() => {
        const v = isoToLocal(match.kickoffAt)
        if (!v) return null
        const [d, t] = v.split("T")
        const [, mo, day] = d.split("-")
        return multiDay ? `${day}.${mo}. ${t}` : t
    })()

    // The left pill shows the score once the match is LIVE / FINISHED (in the
    // time's place, like MatchRow), else the kickoff time - or "-" when a match
    // has no termin yet (MatchRow's unscheduled fallback, compacted to a dash).
    const pillText = scoreboard ? scoreText : kickoffLabel ?? "-"

    return (
        <Panel
            px="3"
            py="2.5"
            cursor="pointer"
            transition="background 0.15s"
            _hover={{ bg: "bg.muted" }}
            onClick={(e) => {
                if (isInteractiveClick(e)) return
                onOpen(match)
            }}
            borderColor={isLive || isNext ? "red.emphasized" : "border"}
            borderWidth={isLive || isNext ? "2px" : "1px"}
        >
            <Flex align="center" gap="2.5">
                {/* LEFT column - the time/score pill with the stage tag directly
                    under it. Both are narrow and fixed-width so the two team
                    names to the right always start at the same x down the list.
                    Multi-day floor = the widest content, "DD.MM. HH:MM" (12 mono
                    chars, `ch` tracks this Box's own font) + the 2×8px padding -
                    the slight negative letter-spacing keeps the date's natural
                    width just UNDER the floor, so live/score pills and date
                    pills all render at exactly the same width. */}
                <VStack gap="1" flexShrink={0} align="stretch">
                    <Box
                        fontFamily="mono"
                        // Smaller than the team names on purpose: the names are
                        // what a reader scans for, the score is the detail.
                        fontSize="13px"
                        fontWeight={scoreboard ? 800 : 600}
                        letterSpacing="-0.02em"
                        color={isLive ? "red.fg" : isFinished ? "fg.ink" : "fg.muted"}
                        bg={isLive ? "red.subtle" : "bg.surfaceTint"}
                        px="2"
                        py="1"
                        rounded="lg"
                        minW={multiDay ? "calc(12ch + 16px)" : "58px"}
                        textAlign="center"
                        fontVariantNumeric="tabular-nums"
                    >
                        {pillText}
                    </Box>
                    <Flex justify="center" minW="0">
                        <StageBadge stage={match.stage} groupName={match.groupName} />
                    </Flex>
                </VStack>

                {/* Teams - ONE PER LINE. Squeezed onto a single "A vs B" line
                    they truncated to nothing on a phone; stacked, each name gets
                    the full remaining width. Muted colouring is preserved for
                    undecided knockout slots. */}
                <VStack flex="1" minW="0" gap="0.5" align="stretch">
                    <Text
                        fontSize="sm"
                        fontWeight={700}
                        lineHeight="1.25"
                        truncate
                        color={t1Muted ? "fg.muted" : "fg.ink"}
                    >
                        {t1Name}
                    </Text>
                    <Text
                        fontSize="sm"
                        fontWeight={700}
                        lineHeight="1.25"
                        truncate
                        color={t2Muted ? "fg.muted" : "fg.ink"}
                    >
                        {t2Name}
                    </Text>
                </VStack>

                {(showCalBtn || showBell) && (
                    <HStack gap="0.5" flexShrink={0}>
                        {showCalBtn && (
                            <IconButton
                                aria-label="Dodaj u kalendar"
                                title="Dodaj u kalendar"
                                size="xs"
                                variant="ghost"
                                colorPalette="gray"
                                rounded="full"
                                flexShrink={0}
                                onClick={(e) => {
                                    e.stopPropagation()
                                    downloadMatchIcs(match, {
                                        tournamentUuid,
                                        tournamentName,
                                        tournamentLocation,
                                        tournamentSlug,
                                        slotMinutes,
                                    })
                                }}
                            >
                                <FiCalendar size={13} />
                            </IconButton>
                        )}
                        {showBell && (
                            <MatchNotificationBell
                                tournamentUuid={tournamentUuid}
                                matchId={match.matchId}
                            />
                        )}
                    </HStack>
                )}

                <Box as="span" color="fg.muted" flexShrink={0} display="inline-flex">
                    <FiChevronRight />
                </Box>
            </Flex>
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
type ScheduleView = "list" | "grid" | "grid-sm"

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
    const navigate = useNavigate()
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
    /** Prikaz: "list" = slim compact rows (default), "grid" = full detail rows
     *  (MatchRow: inline time editing + add-to-calendar), "grid-sm" = compact
     *  MatchCard cards. Persisted globally under one key - a viewing preference,
     *  not per tournament. An unknown / legacy stored value falls back to the
     *  new compact "list" (a previously stored "list"/"grid" simply maps onto
     *  the new meanings). */
    const [viewMode, setViewMode] = useState<ScheduleView>(() => {
        try {
            const v = localStorage.getItem(VIEW_KEY)
            return v === "grid" || v === "grid-sm" ? v : "list"
        } catch {
            return "list"
        }
    })
    // Phones only offer "list" + "grid-sm": the full-detail "grid" rows need
    // desktop width to be readable, so its toggle button is hidden below md and
    // a stored "grid" preference (or one set on a wide screen, then resized)
    // falls back to "list" - otherwise a phone could get stuck in a view with
    // no way back out.
    useEffect(() => {
        if (typeof window === "undefined" || !window.matchMedia) return
        // Chakra's md breakpoint is 48em; below it we're in the phone layout.
        const mq = window.matchMedia("(max-width: 47.99em)")
        const apply = () => {
            if (mq.matches) setViewMode((v) => (v === "grid" ? "list" : v))
        }
        apply()
        mq.addEventListener("change", apply)
        return () => mq.removeEventListener("change", apply)
    }, [])
    useEffect(() => {
        try {
            localStorage.setItem(VIEW_KEY, viewMode)
        } catch {
            /* storage unavailable - the view choice just won't persist */
        }
    }, [viewMode])
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

    const fixedBreaks = numVal(cfg.breakBetweenMatchesMin) + numVal(cfg.bufferMin)
    const slot = HALF_COUNT * numVal(cfg.halfLengthMin) + numVal(cfg.halftimeBreakMin) + fixedBreaks
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

    // Click-through target for the compact list rows and the grid-sm cards: the
    // match-details page, the same destination the bracket uses. Prefer the
    // human slug, fall back to the uuid when the tournament has none.
    const openMatch = (m: ScheduledMatch) =>
        navigate(`/turniri/${tournamentSlug ?? uuid}/utakmica/${m.matchId}`)

    const renderRow = (m: ScheduledMatch) => {
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
                canEdit={inlineTimeEditable && m.status === "SCHEDULED"}
                isNext={m.matchId === nextMatchId}
            />
        )
        return (
            <Box
                key={m.matchId}
                id={`sched-match-${m.matchId}`}
                rounded="xl"
                css={
                    focusMatchId === m.matchId
                        ? { outline: "2px solid var(--chakra-colors-brand-solid)", outlineOffset: "2px" }
                        : undefined
                }
            >
                {content}
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
            <MatchCard
                match={m}
                multiDay={multiDay}
                onOpen={openMatch}
                tournamentUuid={uuid}
                tournamentName={tournamentName ?? "Futsal turnir"}
                tournamentLocation={tournamentLocation}
                tournamentSlug={tournamentSlug}
                slotMinutes={slot}
                isNext={m.matchId === nextMatchId}
            />
        </Box>
    )

    // Compact list row (default prikaz) - view-only + click-through, keeping the
    // sched-match id + focus outline so the /uzivo deep-link scroll still works
    // here too. Mirrors renderCard/renderRow's wrapper (id + focus outline).
    const renderCompactRow = (m: ScheduledMatch) => (
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
            <MatchCompactRow
                match={m}
                multiDay={multiDay}
                onOpen={openMatch}
                tournamentUuid={uuid}
                tournamentName={tournamentName ?? "Futsal turnir"}
                tournamentLocation={tournamentLocation}
                tournamentSlug={tournamentSlug}
                slotMinutes={slot}
                isNext={m.matchId === nextMatchId}
            />
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

    // Render one day-grouped match section for the active prikaz. "grid-sm"
    // lays the compact cards into a responsive grid under each day divider;
    // "list" (slim compact rows) and "grid" (full MatchRow rows) share a flat
    // per-day-divided VStack and differ only in the row renderer. `trailer` is
    // the collapse "+ još N" button (upcoming section) or null (finished).
    const renderMatchSection = (matches: ScheduledMatch[], trailer: React.ReactNode) => {
        if (viewMode === "grid-sm") {
            return (
                <VStack align="stretch" gap="2">
                    {dayGroups(matches).map((g, gi) => (
                        <Fragment key={g.key || "bez-termina"}>
                            {multiDay && (
                                <DayDivider label={dividerLabel(g.key)} first={gi === 0} />
                            )}
                            <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} gap="2">
                                {g.items.map((m) => renderCard(m))}
                            </SimpleGrid>
                        </Fragment>
                    ))}
                    {trailer}
                </VStack>
            )
        }
        // "list" → compact rows, "grid" → full rows; identical day scaffolding.
        const renderItem = viewMode === "list" ? renderCompactRow : renderRow
        return (
            <VStack align="stretch" gap="2">
                {matches.map((m, idx) => {
                    // Day separator before the first match of each day (multi-day).
                    const curKey = dateKey(m.kickoffAt)
                    const prevKey = idx > 0 ? dateKey(matches[idx - 1].kickoffAt) : null
                    const dayNode = multiDay && curKey !== prevKey
                        ? <DayDivider label={dividerLabel(curKey)} first={idx === 0} />
                        : null
                    return (
                        <Fragment key={m.matchId}>
                            {dayNode}
                            {renderItem(m)}
                        </Fragment>
                    )
                })}
                {trailer}
            </VStack>
        )
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
    // Inline per-match kickoff editing is available ONLY before the tournament
    // starts. Once it starts (or when finished-locked) every edit - times and
    // reordering alike - goes through the planner ("Uredi raspored"), so the
    // inline time pickers go read-only.
    const inlineTimeEditable = canEdit && !tournamentStarted && !finishedLocked

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
                (završnica only when the override is on).
            <Text fontFamily="mono" fontSize="12px" color="fg.muted" fontWeight={600}>
                Termin grupe: {slot} min
                {cfg.koEnabled ? ` · Termin završnice: ${koSlot} min` : ""}
             </Text>
             */}
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

    // The compact action cluster (Termini završnice · Uredi format · Uredi
    // raspored · Preuzmi) that lives in the combined card's header row, in the
    // right cluster after the prikaz toggle - the single home for these actions.
    // `ml="auto"` keeps the cluster pinned right when the row wraps on narrow
    // screens.
    const scheduleControls = (
        <HStack gap="2" wrap="wrap" align="center" justify="flex-end" ml="auto">
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
            {/* "Uredi raspored" now opens the planner (same modal as sketching,
                full mode) - all drag&drop reordering + time edits after start
                happen there. The backend only re-plans the remaining matches. */}
            {canEdit && !finishedLocked && (
                <PrimaryButton
                    px="3.5"
                    py="2"
                    fontSize="13px"
                    icon={<FiEdit2 size={14} />}
                    onClick={() => setPlannerMode("full")}
                >
                    Uredi
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
        </HStack>
    )

    /* 3-way prikaz switcher - lives in the combined card's header row, in the
       right cluster before the schedule actions (see the header below). "list" =
       slim compact rows (default), "grid" = full detail rows, "grid-sm" = compact
       cards. Same segmented pattern as the tournaments page toggle, icon-only. */
    const viewToggle = (
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
                label="Lista"
            />
            {/* Desktop only - the full-detail rows are unreadable at phone
                width, so phones are offered just Lista + Mali prikaz (the
                effect above also un-sticks a stored "grid" down there). */}
            <Box display={{ base: "none", md: "contents" }}>
                <ViewToggleButton
                    active={viewMode === "grid"}
                    onClick={() => setViewMode("grid")}
                    icon={<FiMenu size={14} />}
                    label="Veliki prikaz"
                />
            </Box>
            <ViewToggleButton
                active={viewMode === "grid-sm"}
                onClick={() => setViewMode("grid-sm")}
                icon={<FiGrid size={14} />}
                label="Mali prikaz"
            />
        </HStack>
    )

    /** True when the header renders the filter row at all. On phones the prikaz
     *  toggle rides along on that row's tail (next to "Svi dani"); with no
     *  filters to show it stays in the actions row instead, so it can never
     *  disappear entirely. */
    const hasFilters = allTeamCount > 1 || allGroupCount > 1 || multiDay

    return (
        // No top padding: the first row (format chip) must sit flush with the
        // content-column top so it aligns with the sidebar card's top edge -
        // same treatment as the Grupe/Ždrijeb tabs. `pb` keeps tail room.
        <VStack align="stretch" gap="5" pb="2">
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

            {/* Format summary - one compact non-expandable row above the
                combined schedule card: group timings, then (when set) the
                završnica timings in the same line. Organizers get a small
                pencil on the right that toggles the inline format editor
                (same target as the "Uredi format" button below). */}
            {scheduleHasConfig && schedule && (
                <Box
                    borderWidth="1px"
                    borderColor="border"
                    bg="bg.surfaceTint"
                    rounded="xl"
                    px="4"
                    py="2.5"
                >
                    <Flex
                        align="center"
                        gap="2"
                        wrap="wrap"
                        fontFamily="mono"
                        fontSize="12px"
                        color="fg.muted"
                    >
                        <FiClock size={13} />
                        <Box as="span">
                            Poluvrijeme:{" "}
                            <chakra.span fontWeight={700} color="fg.ink">
                                {schedule.halfLengthMin ?? 0}
                            </chakra.span>{" "}
                            min · pauza:{" "}
                            <chakra.span fontWeight={700} color="fg.ink">
                                {schedule.halftimeBreakMin ?? 0}
                            </chakra.span>{" "}
                            min · između utakmica:{" "}
                            <chakra.span fontWeight={700} color="fg.ink">
                                {schedule.breakBetweenMatchesMin ?? 0}
                            </chakra.span>{" "}
                            min
                        </Box>
                        {koFormatOn && (
                            <>
                                <Box as="span" color="border.emphasized" aria-hidden>
                                    ·
                                </Box>
                                <Box as="span">
                                    Završnica - poluvrijeme:{" "}
                                    <chakra.span fontWeight={700} color="fg.ink">
                                        {schedule.koHalfLengthMin ?? 0}
                                    </chakra.span>{" "}
                                    min · pauza:{" "}
                                    <chakra.span fontWeight={700} color="fg.ink">
                                        {schedule.koHalftimeBreakMin ?? 0}
                                    </chakra.span>{" "}
                                    min
                                    {schedule.koBreakBetweenMatchesMin != null && (
                                        <>
                                            {" "}
                                            · između utakmica:{" "}
                                            <chakra.span fontWeight={700} color="fg.ink">
                                                {schedule.koBreakBetweenMatchesMin}
                                            </chakra.span>{" "}
                                            min
                                        </>
                                    )}
                                </Box>
                            </>
                        )}
                        {/* Small pencil (organizers, schedule laid out) - jumps
                            straight into the inline format editor, same toggle
                            as the "Uredi format" button in the card header. */}
                        {configBoxToggle && (
                            <IconButton
                                aria-label="Uredi format"
                                title="Uredi format"
                                size="2xs"
                                variant="ghost"
                                rounded="full"
                                ml="auto"
                                flexShrink={0}
                                onClick={() => setFormatEditorOpen((v) => !v)}
                            >
                                <FiEdit2 size={13} />
                            </IconButton>
                        )}
                    </Flex>
                </Box>
            )}

            {/* Match list - one combined card. The header row carries the
                filters (left) plus the prikaz toggle and schedule actions
                (right); the body merges the upcoming schedule with the finished
                matches, split by a labelled delimiter when both are present. The
                two empty-state branches below are unchanged. */}
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
                <SectionCard padding="4">
                    <VStack align="stretch" gap="4">
                        {/* Header row - filters on the left, the prikaz toggle +
                            schedule actions on the right (pushed with ml:auto).
                            Wraps cleanly on narrow screens (the actions drop under
                            the filters). Replaces the old icon + "Raspored" title. */}
                        <Flex
                            // Mobile: two tidy stacked rows (filters row, then
                            // toggle+actions row) instead of free-form wrapping,
                            // which let the right cluster land between / over
                            // the wrapped selects. lg+: everything on one row.
                            direction={{ base: "column", lg: "row" }}
                            align={{ base: "stretch", lg: "center" }}
                            gap="2"
                            pb="3"
                            borderBottomWidth="1px"
                            borderColor="border"
                        >
                            {/* Filters - only the dropdowns worth showing, same
                                conditions + handlers as before, now inline in the
                                header (the old standalone tinted box is gone).
                                Base used to squeeze all three selects onto ONE
                                row (~84px each on a 412px phone), clipping their
                                labels to "Sve ekip" / "Sve sku" / "Svi dan". Now
                                wrap="wrap" lets them break into two rows: ekipe +
                                skupine each get a 40% basis so that pair alone
                                fits one line, while dani gets 60% so it can never
                                also fit on that line and wraps to its own row,
                                pulling the broom (last in DOM order, tiny fixed
                                width) down with it. With fewer than three selects
                                there's more slack, so the broom simply lands on
                                whichever row still has room - i.e. it always ends
                                up at the end of the last real row. lg+: flex goes
                                back to equal "1 1 0" shares (with the per-select
                                maxW caps below) and nowrap keeps everything on the
                                single original row. */}
                            {hasFilters && (
                                <Flex
                                    align="center"
                                    gap="2"
                                    minW="0"
                                    flex="1"
                                    wrap={{ base: "wrap", lg: "nowrap" }}
                                >
                                    {allTeamCount > 1 && (
                                        <NativeSelect.Root
                                            size="sm"
                                            flex={{ base: "1 1 40%", lg: "1 1 0" }}
                                            minW="0"
                                            maxW={{ lg: "220px" }}
                                        >
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
                                        <NativeSelect.Root
                                            size="sm"
                                            flex={{ base: "1 1 40%", lg: "1 1 0" }}
                                            minW="0"
                                            maxW={{ lg: "170px" }}
                                        >
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
                                        <NativeSelect.Root
                                            size="sm"
                                            // 50% (not 60%) so this select still
                                            // can't join the ekipe+skupine row
                                            // (80% + 50% > 100%) yet leaves room
                                            // for the broom AND the prikaz toggle
                                            // beside it on the second row.
                                            flex={{ base: "1 1 50%", lg: "1 1 0" }}
                                            minW="0"
                                            maxW={{ lg: "200px" }}
                                        >
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

                                    {/* Icon-only, always rendered to reserve its
                                        space so picking a filter doesn't shift the
                                        row; hidden visually (not removed from
                                        layout) when no filter is active. */}
                                    <IconButton
                                        aria-label="Poništi filtere"
                                        title="Poništi filtere"
                                        size="xs"
                                        variant="outline"
                                        colorPalette="brand"
                                        rounded="full"
                                        onClick={clearFilters}
                                        flexShrink={0}
                                        visibility={anyFilter ? "visible" : "hidden"}
                                        aria-hidden={!anyFilter}
                                        tabIndex={anyFilter ? 0 : -1}
                                    >
                                        <FaBroom size={13} />
                                    </IconButton>

                                    {/* PHONES: the prikaz toggle finishes the
                                        filters' last row (right of "Svi dani"),
                                        so the row below is left to Preuzmi /
                                        Uredi alone. On lg it moves back into the
                                        right cluster - see below. */}
                                    <Box display={{ base: "block", lg: "none" }} ml="auto">
                                        {viewToggle}
                                    </Box>
                                </Flex>
                            )}

                            {/* Right cluster - prikaz toggle then the schedule
                                actions (Termini završnice · Uredi format · Uredi
                                raspored · Preuzmi). Base: its own row under the
                                filters holding ONLY the actions (the toggle sits
                                up in the filter row); with no filters at all the
                                toggle stays here so it never disappears. lg+:
                                pushed to the right edge of the single header row. */}
                            <Flex
                                align="center"
                                gap="2"
                                wrap={{ base: "wrap", lg: "nowrap" }}
                                justify={{ base: hasFilters ? "flex-end" : "space-between", lg: "flex-end" }}
                                ml={{ lg: "auto" }}
                                flexShrink={0}
                            >
                                <Box display={hasFilters ? { base: "none", lg: "block" } : undefined}>
                                    {viewToggle}
                                </Box>
                                {scheduleControls}
                            </Flex>
                        </Flex>

                        {/* Merged body - upcoming schedule first, then (only when
                            BOTH lists exist) a labelled delimiter, then the
                            finished matches. "Sažmi"/show-more stays on upcoming. */}
                        {upcomingMatches.length > 0 &&
                            renderMatchSection(displayedUpcoming, showMoreButton)}

                        {finishedMatches.length > 0 && (
                            <>
                                {upcomingMatches.length > 0 ? (
                                    /* Delimiter between the two lists - a muted
                                       uppercase label flanked by hairline rules
                                       (mirrors DayDivider, without the date icon). */
                                    <Flex align="center" gap="3" aria-hidden>
                                        <Box flex="1" h="1px" bg="green.muted" />
                                        <Text
                                            fontFamily="mono"
                                            fontSize="sm"
                                            fontWeight={800}
                                            letterSpacing="0.08em"
                                            textTransform="uppercase"
                                            color="green.fg"
                                            whiteSpace="nowrap"
                                        >
                                            Završene utakmice
                                        </Text>
                                        <Box flex="1" h="1px" bg="green.muted" />
                                    </Flex>
                                ) : (
                                    /* Only finished matches remain - a plain left
                                       label, no delimiter rules needed. */
                                    <Text
                                        fontFamily="mono"
                                        fontSize="2xs"
                                        fontWeight={800}
                                        letterSpacing="0.08em"
                                        textTransform="uppercase"
                                        color="fg.muted"
                                    >
                                        Završene utakmice
                                    </Text>
                                )}
                                {renderMatchSection(finishedMatches, null)}
                            </>
                        )}
                    </VStack>
                </SectionCard>
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
                left untouched - replacing the old KnockoutTimesDialog. The
                "full" mode ("Uredi raspored") skips straight to the sketch via
                autoSketch, since both entry points now land on the same
                drag-drop screen. */}
            {plannerMode && (
                <MultiDaySchedulePlanner
                    uuid={uuid}
                    startAt={startAt}
                    koOnly={plannerMode === "ko"}
                    autoSketch={plannerMode === "full"}
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
