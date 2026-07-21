import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { Box, Button, Flex, Grid, HStack, Heading, Text, VStack } from "@chakra-ui/react"
import { useNavigate } from "react-router-dom"
import { FiCalendar, FiChevronRight, FiClock, FiGrid, FiList, FiMapPin, FiPlay, FiRadio } from "react-icons/fi"
import {
    fetchLiveMatches,
    fetchUpcomingMatches,
    matchPhaseLabel,
    pickFeaturedFirst,
    type LiveMatch,
    type UpcomingMatch,
} from "../api/live"
import { fetchFeaturedTournament, fetchTournamentDetails } from "../api/tournaments"
import { fetchSchedule } from "../api/schedule"
import { fetchStreamBanner, readStreamBannerHint, type StreamBanner } from "../api/streamBanner"
import type { TournamentCard } from "../types/tournaments"
import {
    MonoLabel,
    PitchBackdrop,
    PrimaryButton,
    PulseDot,
    SectionCard,
    TournamentPoster,
} from "../ui/pitch"
import { useDocumentHead } from "../hooks/useDocumentHead"
import { usePolling } from "../hooks/usePolling"
import { useQueryClient } from "@tanstack/react-query"
import { qk } from "../queryClient"
import { useLiveSocket } from "../hooks/useLiveSocket"
import { GoalscorersPanel, LiveClock, matchPhase } from "../components/liveMatch"
import MatchNotificationBell from "../components/MatchNotificationBell"
import { FiChevronDown, FiChevronUp } from "react-icons/fi"

/* ──────────────────────────────────────────────────────────────────────────
   LivePage - "Pitch" theme /uzivo.

   Structure:
     1. Header - pulsing live-now kicker, dynamic "{n} utakmica u tijeku"
        title, share + raspored ghost buttons.
     2. 2-column grid of live match cards (compact scoreboard per match),
        each expandable to reveal live minute + goalscorer timeline.
     3. "Nadolazeći turniri" calendar - same shape as the previous LivePage,
        the page works even when nothing is live.
   ────────────────────────────────────────────────────────────────────── */

const HR_WEEKDAYS = [
    "Nedjelja", "Ponedjeljak", "Utorak", "Srijeda",
    "Četvrtak", "Petak", "Subota",
]
const HR_MONTHS_GEN = [
    "siječnja", "veljače", "ožujka", "travnja", "svibnja", "lipnja",
    "srpnja", "kolovoza", "rujna", "listopada", "studenoga", "prosinca",
]
// Nominative month names used in the month-picker pills ("Siječanj 2026",
// not "siječnja 2026" which is the genitive form for dates).
const HR_MONTHS_NOM = [
    "Siječanj", "Veljača", "Ožujak", "Travanj", "Svibanj", "Lipanj",
    "Srpanj", "Kolovoz", "Rujan", "Listopad", "Studeni", "Prosinac",
]

function pad2(n: number): string {
    return String(n).padStart(2, "0")
}
function dateKey(d: Date): string {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}
function startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function dayHeading(d: Date, today: Date): string {
    const diff = Math.round(
        (startOfDay(d).getTime() - startOfDay(today).getTime()) / 86400000,
    )
    if (diff === 0) return "Danas"
    if (diff === 1) return "Sutra"
    return `${HR_WEEKDAYS[d.getDay()]}, ${d.getDate()}. ${HR_MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}.`
}
function formatTime(iso?: string | null): string {
    if (!iso) return ""
    const d = new Date(iso)
    return new Intl.DateTimeFormat("hr-HR", {
        hour: "2-digit",
        minute: "2-digit",
    }).format(d)
}

/**
 * Disabled: the old separate "tournament of the day" hero card. A featured
 * tournament is now promoted as the "GLAVNA UTAKMICA" live slot (here) and
 * first in the home-page list. Flip to true to restore the hero card.
 */
const FEATURED_HERO_ENABLED = false

/** Admin-curated "tournament of the day" hero.
 *
 *  Same visual family as the live match hero on /turniri (dark pitch
 *  gradient, mono kicker, big heading) but built around an upcoming
 *  tournament instead of an in-progress match. Renders the poster on
 *  the left, the meta block on the right, and an "Otvori turnir" CTA.
 *
 *  Selection is admin-driven: an admin clicks "Istakni za dan" on the
 *  tournament's detail page; the backend stores the timestamp; this
 *  block reads /tournaments/featured on mount and renders the result. */
function FeaturedTournamentHero({
    tournament,
    onOpen,
}: {
    tournament: TournamentCard
    onOpen: () => void
}) {
    const startDate = tournament.startAt ? new Date(tournament.startAt) : null
    const dayNum = startDate ? String(startDate.getDate()).padStart(2, "0") : "-"
    const monthNom = startDate ? HR_MONTHS_NOM[startDate.getMonth()].toUpperCase() : ""
    const yearStr = startDate ? String(startDate.getFullYear()) : ""
    return (
        <Box
            position="relative"
            rounded="2xl"
            overflow="hidden"
            color="white"
            bgImage="linear-gradient(135deg, #0b6b3a, #084a28)"
            cursor="pointer"
            onClick={onOpen}
            transition="transform .15s, box-shadow .15s"
            _hover={{ shadow: "lg" }}
        >
            <PitchBackdrop opacity={0.18} variant="featured-hero" tone="pitch" />
            <Box
                position="absolute"
                inset="0"
                pointerEvents="none"
                bg="repeating-linear-gradient(90deg, transparent 0, transparent 70px, rgba(0,0,0,0.05) 70px, rgba(0,0,0,0.05) 140px)"
            />

            <Grid
                position="relative"
                templateColumns={{ base: "1fr", md: "220px 1fr" }}
                gap={{ base: 0, md: 0 }}
                alignItems="stretch"
            >
                {/* Poster column - fixed width on desktop, banner-style on mobile */}
                <Box
                    h={{ base: "140px", md: "auto" }}
                    minH={{ md: "220px" }}
                    overflow="hidden"
                    borderRightWidth={{ base: 0, md: "1px" }}
                    borderBottomWidth={{ base: "1px", md: 0 }}
                    borderColor="rgba(255,255,255,0.12)"
                >
                    <TournamentPoster
                        name={tournament.name}
                        bannerUrl={tournament.bannerUrl}
                        height="100%"
                        seed={tournament.uuid}
                    />
                </Box>

                {/* Meta column */}
                <Flex direction="column" px={{ base: 4, md: 7 }} py={{ base: 4, md: 6 }} gap="3">
                    <HStack gap="2" color="rgba(255,255,255,0.85)">
                        <Box
                            fontFamily="mono"
                            fontSize="10px"
                            fontWeight={800}
                            letterSpacing="0.2em"
                            bg="rgba(255,255,255,0.12)"
                            px="2.5"
                            py="1"
                            rounded="full"
                        >
                            ★ ISTAKNUTI TURNIR
                        </Box>
                        {startDate && (
                            <Box
                                fontFamily="mono"
                                fontSize="11px"
                                color="rgba(255,255,255,0.7)"
                                letterSpacing="0.1em"
                                fontWeight={700}
                            >
                                {dayNum}. {monthNom} {yearStr}
                            </Box>
                        )}
                    </HStack>
                    <Heading
                        fontFamily="heading"
                        fontSize={{ base: "22px", md: "32px" }}
                        fontWeight={800}
                        letterSpacing="-0.025em"
                        lineHeight={1.1}
                    >
                        {tournament.name}
                    </Heading>
                    <HStack gap="4" wrap="wrap" color="rgba(255,255,255,0.85)" fontSize="13px">
                        {tournament.location && (
                            <HStack gap="1.5">
                                <FiMapPin size={13} />
                                <Text truncate maxW={{ base: "260px", md: "420px" }}>
                                    {tournament.location}
                                </Text>
                            </HStack>
                        )}
                        {startDate && (
                            <HStack gap="1.5">
                                <FiClock size={13} />
                                <Text>{formatTime(tournament.startAt)}</Text>
                            </HStack>
                        )}
                        {typeof tournament.registeredTeams === "number" &&
                            typeof tournament.maxTeams === "number" && (
                                <HStack gap="1.5">
                                    <FiCalendar size={13} />
                                    <Text>
                                        {tournament.registeredTeams} / {tournament.maxTeams} ekipa
                                    </Text>
                                </HStack>
                            )}
                    </HStack>
                    <Box mt="2">
                        {/* Outer Box already wires `onOpen` on click, so the
                             button doesn't need to stopPropagation - both
                             paths fire the same handler. */}
                        <PrimaryButton onClick={onOpen}>
                            Otvori turnir →
                        </PrimaryButton>
                    </Box>
                </Flex>
            </Grid>
        </Box>
    )
}

/** Compact live match card - header strip, scoreboard, expandable scorer
 *  timeline, footer CTA.
 *
 *  Behaviour:
 *    - Clicking the card body (header strip + scoreboard) toggles an
 *      inline expansion that reveals the running match minute and a
 *      polled goalscorers timeline (SofaScore-style).
 *    - The "Otvori turnir →" footer button navigates to the tournament
 *      detail page. Both handlers stop event propagation appropriately
 *      so the two interactions don't fight each other.
 *    - When the card is expanded, `GoalscorersPanel` polls events every
 *      15 s so a goal scored during the page session shows up without
 *      a manual refresh. */
function LiveMatchCard({
    match,
    onOpen,
    onOpenMatch,
    onWarm,
    refreshSignal,
}: {
    match: LiveMatch
    /** Navigate to the tournament detail page ("na turnir"). */
    onOpen: () => void
    /** Navigate to this match's own live page ("na utakmicu"). */
    onOpenMatch: () => void
    /** Prefetch the match's data on hover/press so opening it is instant. */
    onWarm?: () => void
    refreshSignal?: number
}) {
    // Long club names shrink a touch and wrap up to three lines so they stay
    // fully readable in the hero scoreboard instead of truncating.
    const heroMaxLen = Math.max((match.team1Name ?? "").length, (match.team2Name ?? "").length)
    const heroNameFont = heroMaxLen > 24 ? { base: "12px", md: "15px" } : { base: "13px", md: "16px" }
    const livePhase =
        match.liveMode === "TIMER"
            ? matchPhase({
                  liveStartedAt: match.liveStartedAt,
                  firstHalfEndedAt: match.firstHalfEndedAt ?? null,
                  secondHalfStartedAt: match.secondHalfStartedAt ?? null,
                  livePausedAt: match.livePausedAt ?? null,
                  halfLengthMin: match.halfLengthMin,
                  halfCount: match.halfCount,
              })
            : null
    const half =
        match.livePausedAt && (livePhase === "FIRST_HALF" || livePhase === "SECOND_HALF")
            ? "PAUZA"
            : livePhase === "HALFTIME" ? "PAUZA"
                : livePhase === "SECOND_HALF" ? "2. POL."
                    : livePhase === "FULL_TIME" ? "KRAJ"
                        : livePhase === "FIRST_HALF" ? "1. POL."
                            : match.secondHalfStartedAt ? "2. POL." : "1. POL."
    const [expanded, setExpanded] = useState(false)
    return (
        <Box
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border"
            rounded="xl"
            overflow="hidden"
            transition="box-shadow .15s, transform .15s"
            _hover={{ shadow: "md" }}
            css={{ boxShadow: "0 0 0 3px rgba(220,38,38,0.06)" }}
            onMouseEnter={onWarm}
            onPointerDown={onWarm}
        >
            {/* Header + scoreboard wrap - clicking anywhere on this region
                 toggles the expanded scorer timeline below. */}
            <Box cursor="pointer" onClick={() => setExpanded((v) => !v)}>
            {/* Header strip: top row (UŽIVO · centred phase/clock · bell), then
                the tournament name centred underneath, right above the score. */}
            <Box
                px="3.5"
                py="2"
                bg="bg.surfaceTint2"
                borderBottomWidth="1px"
                borderColor="border"
            >
                <Box
                    display="grid"
                    gridTemplateColumns="1fr auto 1fr"
                    alignItems="center"
                    gap="2"
                >
                    <HStack
                        gap="1"
                        px="2"
                        py="0.5"
                        rounded="full"
                        bg="accent.red"
                        color="white"
                        fontFamily="mono"
                        fontSize="9px"
                        fontWeight={800}
                        letterSpacing="0.1em"
                        justifySelf="start"
                        w="fit-content"
                    >
                        <PulseDot color="white" size={5} />
                        UŽIVO
                    </HStack>
                    <HStack gap="2" justifySelf="center" minW="0">
                        {/* Live clock - pulls minute from the same fields the
                             tournament-page LiveMatchDialog uses, so the two
                             views stay numerically in sync. */}
                        {match.liveMode === "TIMER" && match.liveStartedAt && (
                            <LiveClock
                                liveStartedAt={match.liveStartedAt}
                                firstHalfEndedAt={match.firstHalfEndedAt ?? null}
                                secondHalfStartedAt={match.secondHalfStartedAt ?? null}
                                livePausedAt={match.livePausedAt ?? null}
                                halfLengthMin={match.halfLengthMin}
                                halfCount={match.halfCount}
                                size="md"
                            />
                        )}
                        <MonoLabel color="fg.muted">{half}</MonoLabel>
                    </HStack>
                    {/* Follow this live match - goal / finish notifications. */}
                    <Box justifySelf="end">
                        <MatchNotificationBell
                            tournamentUuid={match.tournamentUuid}
                            matchId={match.matchId}
                        />
                    </Box>
                </Box>
                <Text
                    fontSize="12px"
                    fontWeight={600}
                    color="fg.ink"
                    textAlign="center"
                    truncate
                    mt="1"
                >
                    {match.tournamentName}
                </Text>
            </Box>

            {/* Scoreboard - tighter on mobile so the card stays one-column
                 friendly while readable. Score scales 30px→42px; long team
                 names wrap to two lines (no abbreviation badges). */}
            <Grid
                templateColumns="1fr auto 1fr"
                alignItems="center"
                gap={{ base: "2", md: "3" }}
                px={{ base: "3", md: "4" }}
                py={{ base: "2.5", md: "3.5" }}
            >
                <Text
                    fontSize={heroNameFont}
                    fontWeight={700}
                    color="fg.ink"
                    textAlign="right"
                    lineClamp="3"
                    minW="0"
                >
                    {match.team1Name ?? "-"}
                </Text>
                <Box textAlign="center" px={{ base: "0", md: "1" }}>
                    <Box
                        fontFamily="mono"
                        fontSize={{ base: "30px", md: "42px" }}
                        fontWeight={800}
                        color="fg.ink"
                        letterSpacing="-0.04em"
                        lineHeight={1}
                    >
                        {match.score1 ?? 0}
                        <Box as="span" color="border.strong" px={{ base: "1.5", md: "2.5" }}>
                            :
                        </Box>
                        {match.score2 ?? 0}
                    </Box>
                </Box>
                <Text
                    fontSize={heroNameFont}
                    fontWeight={700}
                    color="fg.ink"
                    textAlign="left"
                    lineClamp="3"
                    minW="0"
                >
                    {match.team2Name ?? "-"}
                </Text>
            </Grid>
            </Box>
            {/* End of clickable region */}

            {/* Toggle bar - sits right under the score (above the timeline). It's
                 the single show/hide control: "Prikaži događaje" when collapsed,
                 "Sakrij događaje" when open, so the hide button is reachable at
                 the top without scrolling past the whole timeline. */}
            <Flex
                align="center"
                justify="center"
                gap="1.5"
                px="3.5"
                py="2"
                borderTopWidth="1px"
                borderColor="border"
                color="fg.muted"
                cursor="pointer"
                _hover={{ color: "fg.ink" }}
                onClick={() => setExpanded((v) => !v)}
            >
                {expanded ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
                <Text fontSize="12px" fontWeight={600}>
                    {expanded ? "Sakrij događaje" : "Prikaži događaje"}
                </Text>
            </Flex>

            {/* Expanded scorer timeline - only mounted when open so the
                 polled fetch isn't spent for every card in the grid. */}
            {expanded && (
                <Box
                    px="4"
                    py="3"
                    borderTopWidth="1px"
                    borderColor="border"
                    bg="bg.surfaceTint"
                >
                    <Box
                        display="grid"
                        gridTemplateColumns="1fr auto 1fr"
                        alignItems="center"
                        mb="2"
                    >
                        <Box />
                        <MonoLabel color="fg.muted">DOGAĐAJI UTAKMICE</MonoLabel>
                        <HStack gap="1" color="fg.muted" justifySelf="end">
                            <PulseDot color="accent.red" size={5} />
                            <Text fontSize="10px" fontFamily="mono" letterSpacing="0.1em">
                                AŽURIRA SE
                            </Text>
                        </HStack>
                    </Box>
                    <GoalscorersPanel
                        tournamentUuid={match.tournamentUuid}
                        matchId={match.matchId}
                        team1Id={match.team1Id ?? null}
                        team2Id={match.team2Id ?? null}
                        halfLengthMin={match.halfLengthMin}
                        pollMs={8000}
                        refreshSignal={refreshSignal}
                    />
                </Box>
            )}

            {/* Footer - "na turnir" (left) + "na utakmicu" (right). Shown ONLY
                 when the card is expanded; a collapsed card keeps just the
                 toggle bar above. */}
            {expanded && (
                <Flex
                    align="center"
                    justify="space-between"
                    px="4"
                    py="2.5"
                    borderTopWidth="1px"
                    borderColor="border"
                    gap="2"
                >
                    <Box
                        as="span"
                        fontSize="12px"
                        fontWeight={700}
                        color="pitch.500"
                        cursor="pointer"
                        onClick={(e) => {
                            e.stopPropagation()
                            onOpen()
                        }}
                        css={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                        _hover={{ textDecoration: "underline" }}
                    >
                        ← na turnir
                    </Box>
                    <Box
                        as="span"
                        fontSize="12px"
                        fontWeight={700}
                        color="pitch.500"
                        cursor="pointer"
                        onClick={(e) => {
                            e.stopPropagation()
                            onOpenMatch()
                        }}
                        css={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                        _hover={{ textDecoration: "underline" }}
                    >
                        na utakmicu →
                    </Box>
                </Flex>
            )}
        </Box>
    )
}

type MatchDayGroup = { key: string; date: Date; matches: UpcomingMatch[] }

/* ──────────────────────────────────────────────────────────────────────────
   Live-matches VIEW toggle.

   Two renderings of the same LiveMatch[]:
     - "list"  - a compact SofaScore-style list, matches grouped by tournament
                 (the new default).
     - "cards" - the original GLAVNA / OSTALE scoreboard cards.
   The choice is a viewing preference (not per-tournament), persisted globally
   under `futsal:live-view` - same convention as `futsal:schedule-view`.
   ────────────────────────────────────────────────────────────────────────── */
const LIVE_VIEW_KEY = "futsal:live-view"
type LiveView = "list" | "cards"

/** Icon-only segmented button - same pattern as the schedule/tournaments
 *  view switchers (active = solid pitch pill, inactive = muted ghost). */
function ViewToggleButton({
    active,
    onClick,
    icon,
    label,
}: {
    active: boolean
    onClick: () => void
    icon: ReactNode
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

/** Two-letter initials from a team name (first letters of the first two
 *  words). Mirrors the TeamAvatar convention in tournament/parts. */
function initialsOf(name: string | null): string {
    return (
        (name || "?")
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((s) => s[0]?.toUpperCase())
            .join("") || "?"
    )
}

/** Small round initials tile for a team row (plain, no kit colours - the
 *  /live DTO doesn't carry team colours). */
function TeamInitials({ name }: { name: string | null }) {
    return (
        <Flex
            w="22px"
            h="22px"
            rounded="full"
            bg="brand.subtle"
            color="brand.fg"
            align="center"
            justify="center"
            fontSize="10px"
            fontWeight={700}
            flexShrink={0}
        >
            {initialsOf(name)}
        </Flex>
    )
}

/** Croatian phase label ("1. POL." / "PAUZA" / "2. POL." / "KRAJ") for a live
 *  match - identical logic to the LiveMatchCard header so the two views stay
 *  in sync. */
function livePhaseLabel(m: LiveMatch): string {
    const phase =
        m.liveMode === "TIMER"
            ? matchPhase({
                  liveStartedAt: m.liveStartedAt,
                  firstHalfEndedAt: m.firstHalfEndedAt ?? null,
                  secondHalfStartedAt: m.secondHalfStartedAt ?? null,
                  livePausedAt: m.livePausedAt ?? null,
                  halfLengthMin: m.halfLengthMin,
                  halfCount: m.halfCount,
              })
            : null
    return m.livePausedAt && (phase === "FIRST_HALF" || phase === "SECOND_HALF")
        ? "PAUZA"
        : phase === "HALFTIME" ? "PAUZA"
            : phase === "SECOND_HALF" ? "2. POL."
                : phase === "FULL_TIME" ? "KRAJ"
                    : phase === "FIRST_HALF" ? "1. POL."
                        : m.secondHalfStartedAt ? "2. POL." : "1. POL."
}

/** One live match rendered as a slim SofaScore-style row: live minute/status
 *  on the left, two stacked team lines (initials + name + bold score) in the
 *  middle, follow-bell + action on the right. */
function LiveListRow({
    match: m,
    showTopBorder,
    hasStream,
    onOpenMatch,
    onWatch,
    onWarm,
}: {
    match: LiveMatch
    /** Hairline above the row - every row except the group's first. */
    showTopBorder: boolean
    /** This match's tournament is currently being streamed → show "Gledaj". */
    hasStream: boolean
    /** Open the match's own live page ("na utakmicu" / match details). */
    onOpenMatch: () => void
    /** Open the shareable tournament stream theater (/turniri/:slug/uzivo). */
    onWatch: () => void
    /** Prefetch the tournament on hover/press so opening is instant. */
    onWarm: () => void
}) {
    const s1 = m.score1 ?? 0
    const s2 = m.score2 ?? 0
    const lead1 = s1 > s2
    const lead2 = s2 > s1
    return (
        <Box
            role="button"
            tabIndex={0}
            onClick={onOpenMatch}
            onMouseEnter={onWarm}
            onPointerDown={onWarm}
            onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    onOpenMatch()
                }
            }}
            cursor="pointer"
            borderTopWidth={showTopBorder ? "1px" : "0"}
            borderColor="border"
            transition="background 0.15s"
            _hover={{ bg: "bg.surfaceTint" }}
        >
            <Grid templateColumns="56px 1fr auto auto" alignItems="center" gap="3" px="3" py="2.5">
                {/* Left: live minute (TIMER clock) or "UŽIVO", with the phase
                    label underneath - live accent colours of the pitch theme. */}
                <VStack gap="0.5" minW="52px" align="center" justify="center" flexShrink={0}>
                    {m.liveMode === "TIMER" && m.liveStartedAt ? (
                        <LiveClock
                            liveStartedAt={m.liveStartedAt}
                            firstHalfEndedAt={m.firstHalfEndedAt ?? null}
                            secondHalfStartedAt={m.secondHalfStartedAt ?? null}
                            livePausedAt={m.livePausedAt ?? null}
                            halfLengthMin={m.halfLengthMin}
                            halfCount={m.halfCount}
                            size="xs"
                            /* The row prints its own "PAUZA" phase label below,
                               so let the clock drop the redundant "Pauza" word
                               (keep just the ⏸ icon + frozen time). */
                            hidePauseLabel
                        />
                    ) : (
                        <HStack
                            gap="1"
                            color="accent.red"
                            fontFamily="mono"
                            fontSize="9px"
                            fontWeight={800}
                            letterSpacing="0.1em"
                        >
                            <PulseDot color="accent.red" size={5} />
                            UŽIVO
                        </HStack>
                    )}
                    <Text
                        fontFamily="mono"
                        fontSize="9px"
                        fontWeight={700}
                        letterSpacing="0.08em"
                        color="fg.muted"
                        whiteSpace="nowrap"
                    >
                        {livePhaseLabel(m)}
                    </Text>
                </VStack>

                {/* Middle: two stacked team lines (initials + name). The leading
                    team's name is a touch bolder. Scores live in the right-edge
                    column below so they line up with rows that have no stream. */}
                <VStack gap="1" align="stretch" minW="0">
                    <Flex align="center" gap="2" minW="0">
                        <TeamInitials name={m.team1Name} />
                        <Text
                            fontSize="sm"
                            fontWeight={lead1 ? 700 : 600}
                            color="fg.ink"
                            truncate
                            flex="1"
                            minW="0"
                        >
                            {m.team1Name ?? "-"}
                        </Text>
                    </Flex>
                    <Flex align="center" gap="2" minW="0">
                        <TeamInitials name={m.team2Name} />
                        <Text
                            fontSize="sm"
                            fontWeight={lead2 ? 700 : 600}
                            color="fg.ink"
                            truncate
                            flex="1"
                            minW="0"
                        >
                            {m.team2Name ?? "-"}
                        </Text>
                    </Flex>
                </VStack>

                {/* Action slot: a live stream on this match's tournament shows a
                    solid "Gledaj" here, between the names and the scores;
                    otherwise this column has nothing and collapses to zero
                    width (no layout cost for plain rows). */}
                {hasStream ? (
                    <Button
                        size="xs"
                        colorPalette="pitch"
                        onClick={(e) => {
                            e.stopPropagation()
                            onWatch()
                        }}
                    >
                        <FiPlay /> Gledaj
                    </Button>
                ) : null}

                {/* Right edge: scores (each wrapped to TeamInitials' 22px row
                    height so they stay level with their team's name line),
                    follow-bell (stops its own click), then ALWAYS the chevron
                    into the match page - also next to "Gledaj", so it stays
                    obvious the row itself opens the match. */}
                <HStack gap="1" flexShrink={0}>
                    <VStack gap="1" align="flex-end">
                        <Flex align="center" h="22px">
                            <Text
                                fontFamily="mono"
                                fontSize="sm"
                                fontWeight={800}
                                fontVariantNumeric="tabular-nums"
                                color="fg.ink"
                            >
                                {s1}
                            </Text>
                        </Flex>
                        <Flex align="center" h="22px">
                            <Text
                                fontFamily="mono"
                                fontSize="sm"
                                fontWeight={800}
                                fontVariantNumeric="tabular-nums"
                                color="fg.ink"
                            >
                                {s2}
                            </Text>
                        </Flex>
                    </VStack>
                    <MatchNotificationBell tournamentUuid={m.tournamentUuid} matchId={m.matchId} />
                    <Box as="span" color="fg.muted" display="inline-flex">
                        <FiChevronRight />
                    </Box>
                </HStack>
            </Grid>
        </Box>
    )
}

/** A tournament's live matches, grouped for the list view. */
type LiveGroup = {
    tournamentUuid: string
    tournamentName: string
    tournamentSlug: string
    /** Non-null when this tournament is the admin-curated daily highlight. */
    featuredAt: string | null
    matches: LiveMatch[]
}

export default function LivePage() {
    const queryClient = useQueryClient()
    // Seed the live list from the cache (populated here on each poll AND by the
    // home page's hero) so opening /uzivo paints instantly, then polling below
    // keeps it fresh.
    const cachedLive = queryClient.getQueryData<LiveMatch[]>(qk.liveMatches)
    const [matches, setMatches] = useState<LiveMatch[]>(cachedLive ?? [])
    const [matchesLoading, setMatchesLoading] = useState(!cachedLive)
    const [upcomingMatches, setUpcomingMatches] = useState<UpcomingMatch[]>([])
    const [upcomingLoading, setUpcomingLoading] = useState(true)
    const [featured, setFeatured] = useState<TournamentCard | null>(null)
    // Bumped on every WebSocket live-update so expanded event timelines refetch
    // instantly (see GoalscorersPanel refreshSignal).
    const [liveTick, setLiveTick] = useState(0)

    // Live-matches view: the new grouped "list" (default) or the original
    // "cards" scoreboards. Persisted globally - a viewing preference. An
    // unknown / legacy stored value falls back to the new "list".
    const [liveView, setLiveView] = useState<LiveView>(() => {
        try {
            return localStorage.getItem(LIVE_VIEW_KEY) === "cards" ? "cards" : "list"
        } catch {
            return "list"
        }
    })
    useEffect(() => {
        try {
            localStorage.setItem(LIVE_VIEW_KEY, liveView)
        } catch {
            /* storage unavailable - the view choice just won't persist */
        }
    }, [liveView])

    // Global stream banner (the camera is a single site-wide switch, optionally
    // linked to ONE tournament). Seeded synchronously from the last-known hint
    // so the "Gledaj" button paints without a flash, then polled. Purely a
    // nicety: any failure just leaves rows with a chevron instead of "Gledaj".
    const [streamBanner, setStreamBanner] = useState<StreamBanner | null>(() => readStreamBannerHint())
    usePolling(() => {
        fetchStreamBanner()
            .then(setStreamBanner)
            .catch(() => {
                /* silent - rows fall back to the chevron action */
            })
    }, 20000)

    const navigate = useNavigate()
    const today = useMemo(() => new Date(), [])

    const loadLive = useCallback(() => {
        fetchLiveMatches()
            .then((l) => {
                setMatches(l)
                queryClient.setQueryData(qk.liveMatches, l)
                setMatchesLoading(false)
            })
            .catch(() => setMatchesLoading(false))
    }, [queryClient])

    // Realtime: the backend pushes a ping whenever any live match changes;
    // refetch the live list immediately and nudge the open timelines. Polling
    // below stays as a fallback if the socket can't connect.
    useLiveSocket(() => {
        loadLive()
        setLiveTick((t) => t + 1)
    })

    useDocumentHead({
        title: "Uživo i raspored - futsal-turniri.com",
        description:
            "Prati futsal utakmice koje su trenutno u tijeku i pogledaj nadolazeće utakmice kroz sve turnire na jednom mjestu.",
        canonical: "https://futsal-turniri.com/uzivo",
    })

    // Fallback poll (the WebSocket above is the instant path). Kept snappy so
    // the page stays current even if the socket can't connect. usePolling pauses
    // while the tab is hidden and refreshes on return.
    usePolling(loadLive, 8000)

    usePolling(() => {
        fetchUpcomingMatches()
            .then((u) => setUpcomingMatches(u))
            .catch(() => {
                /* network error - section just shows empty state */
            })
            .finally(() => setUpcomingLoading(false))
    }, 30000)

    // Admin-curated daily highlight. Silent endpoint (204 when unset) -
    // failure / empty just leaves `featured` null and the hero block is
    // skipped entirely.
    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                const f = await fetchFeaturedTournament()
                if (!cancelled) setFeatured(f)
            } catch {
                /* silent - no hero, page still works */
            }
        })()
        return () => {
            cancelled = true
        }
    }, [])

    function goToMatch(m: LiveMatch) {
        navigate(`/turniri/${m.tournamentSlug || m.tournamentUuid}`)
    }
    function goToMatchPage(m: LiveMatch) {
        navigate(`/turniri/${m.tournamentSlug || m.tournamentUuid}/utakmica/${m.matchId}`)
    }
    // Shareable "turnir mode" stream theater - where the "Gledaj" button goes.
    function goToTheater(m: LiveMatch) {
        navigate(`/turniri/${m.tournamentSlug || m.tournamentUuid}/uzivo`)
    }

    // The tournament (if any) whose camera is live right now. Only an explicitly
    // linked stream attributes to a specific tournament; an unlinked (site-wide)
    // stream stays ambiguous, so those rows keep the chevron.
    const streamedTournamentUuid =
        streamBanner?.live && streamBanner?.url ? streamBanner.tournamentUuid : null

    // Prefetch a match's tournament (detail + schedule) on hover/press so
    // opening it - or its tournament page - from /uzivo is instant. These are
    // CROSS-tournament links, so unlike navigating within a tournament's own
    // tabs, the schedule usually isn't cached yet.
    const warmTournament = useCallback(
        (idOrSlug?: string | null) => {
            if (!idOrSlug) return
            queryClient.prefetchQuery({
                queryKey: qk.tournamentDetails(idOrSlug),
                queryFn: () => fetchTournamentDetails(idOrSlug),
                staleTime: 30_000,
            })
            queryClient.prefetchQuery({
                queryKey: qk.schedule(idOrSlug),
                queryFn: () => fetchSchedule(idOrSlug),
                staleTime: 15_000,
            })
        },
        [queryClient],
    )

    // Live matches grouped by tournament for the list view. The global order
    // (featured tournament first, then by liveStartedAt) comes from
    // pickFeaturedFirst; grouping preserves first-appearance order, so the
    // featured tournament's group leads and each match keeps its within-group
    // ordering.
    const liveGroups = useMemo<LiveGroup[]>(() => {
        const sorted = pickFeaturedFirst(matches)
        const map = new Map<string, LiveGroup>()
        const order: string[] = []
        for (const m of sorted) {
            let g = map.get(m.tournamentUuid)
            if (!g) {
                g = {
                    tournamentUuid: m.tournamentUuid,
                    tournamentName: m.tournamentName,
                    tournamentSlug: m.tournamentSlug,
                    featuredAt: m.tournamentFeaturedAt ?? null,
                    matches: [],
                }
                map.set(m.tournamentUuid, g)
                order.push(m.tournamentUuid)
            }
            g.matches.push(m)
        }
        return order.map((k) => map.get(k)!)
    }, [matches])

    // Upcoming matches grouped by day, soonest first. Each day's matches
    // are already kickoff-sorted by the backend; we keep that order.
    const matchDayGroups = useMemo<MatchDayGroup[]>(() => {
        const map = new Map<string, MatchDayGroup>()
        for (const m of upcomingMatches) {
            if (!m.kickoffAt) continue
            const d = new Date(m.kickoffAt)
            const k = dateKey(d)
            const existing = map.get(k)
            if (existing) existing.matches.push(m)
            else map.set(k, { key: k, date: d, matches: [m] })
        }
        const groups = [...map.values()].sort((a, b) => a.date.getTime() - b.date.getTime())
        for (const g of groups) {
            g.matches.sort(
                (a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime(),
            )
        }
        return groups
    }, [upcomingMatches])

    return (
        <VStack align="stretch" gap="7">
            {/* ── Admin-curated daily hero ─────────────────────────────
                 Disabled: a featured tournament is now surfaced as the
                 "GLAVNA UTAKMICA" live slot below + first on the home list,
                 instead of this separate "tournament of the day" card.
                 Code kept - flip FEATURED_HERO_ENABLED to bring it back. */}
            {FEATURED_HERO_ENABLED && featured && <FeaturedTournamentHero tournament={featured} onOpen={() => {
                navigate(`/turniri/${featured.slug ?? featured.uuid}`)
            }} />}

            {/* ── Header - the pulsing red "UŽIVO SADA" kicker only appears
                 when something is actually live. Nothing live → no red,
                 no pulse (it was misleading to pulse on an empty page). */}
            {!matchesLoading && matches.length > 0 && (
                <Flex justify="space-between" align="flex-end" gap="4" wrap="wrap">
                    <Box>
                        <HStack
                            gap="2"
                            color="accent.red"
                            fontFamily="mono"
                            fontSize="11px"
                            letterSpacing="0.2em"
                            fontWeight={700}
                        >
                            <PulseDot color="accent.red" size={8} glow />
                            UŽIVO SADA · {matches.length}
                        </HStack>
                    </Box>
                    {/* List / cards view switcher - icon-only segmented control,
                         same pattern as the schedule + tournaments toggles. */}
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
                            active={liveView === "list"}
                            onClick={() => setLiveView("list")}
                            icon={<FiList size={15} />}
                            label="Lista"
                        />
                        <ViewToggleButton
                            active={liveView === "cards"}
                            onClick={() => setLiveView("cards")}
                            icon={<FiGrid size={15} />}
                            label="Kartice"
                        />
                    </HStack>
                </Flex>
            )}

            {/* ── Live matches grid ───────────────────────────────────── */}
            <Box>
                {matchesLoading ? (
                    <SectionCard padding="6">
                        <Text color="fg.muted">Učitavanje utakmica…</Text>
                    </SectionCard>
                ) : matches.length === 0 ? (
                    // Calm, slim banner - no big empty card, no red pulse.
                    // The page's focus shifts to "Nadolazeće utakmice" below.
                    <Flex
                        align="center"
                        gap="3"
                        px="4"
                        py="3.5"
                        rounded="xl"
                        bg="bg.panel"
                        borderWidth="1px"
                        borderColor="border"
                    >
                        <Flex
                            w="40px"
                            h="40px"
                            rounded="full"
                            align="center"
                            justify="center"
                            bg="bg.surfaceTint"
                            color="fg.muted"
                            flexShrink={0}
                        >
                            <FiRadio size={18} />
                        </Flex>
                        <Box minW="0">
                            <Text fontWeight={600} color="fg.ink">
                                Trenutno nema utakmica uživo
                            </Text>
                            <Text fontSize="sm" color="fg.muted">
                                Pogledaj nadolazeće utakmice ispod.
                            </Text>
                        </Box>
                    </Flex>
                ) : liveView === "list" ? (
                    // Grouped-by-tournament compact list (default). One small
                    // header per tournament, then a bordered card of slim,
                    // hairline-separated match rows.
                    <VStack align="stretch" gap="5">
                        {liveGroups.map((g) => {
                            const featured = !!g.featuredAt
                            return (
                                <Box key={g.tournamentUuid}>
                                    {/* Group header: dot + tournament name + optional featured badge. */}
                                    <HStack gap="2" mb="2" px="1">
                                        <PulseDot
                                            color={featured ? "pitch.500" : "accent.red"}
                                            size={7}
                                            glow={featured}
                                        />
                                        <Text
                                            fontSize="13px"
                                            fontWeight={700}
                                            color="fg.ink"
                                            truncate
                                            minW="0"
                                        >
                                            {g.tournamentName}
                                        </Text>
                                        {featured && (
                                            <Box
                                                fontFamily="mono"
                                                fontSize="9px"
                                                fontWeight={800}
                                                letterSpacing="0.16em"
                                                color="pitch.500"
                                                bg="pitch.50"
                                                px="1.5"
                                                py="0.5"
                                                rounded="full"
                                                flexShrink={0}
                                            >
                                                ★ ISTAKNUTO
                                            </Box>
                                        )}
                                        <Box flex="1" />
                                        <Text fontSize="xs" fontWeight={600} color="fg.muted">
                                            {g.matches.length}
                                        </Text>
                                    </HStack>
                                    {/* Bordered card of hairline-separated match rows. */}
                                    <Box
                                        borderWidth="1px"
                                        borderColor="border"
                                        rounded="xl"
                                        bg="bg.panel"
                                        overflow="hidden"
                                    >
                                        {g.matches.map((m, i) => (
                                            <LiveListRow
                                                key={m.matchId}
                                                match={m}
                                                showTopBorder={i > 0}
                                                hasStream={
                                                    !!streamedTournamentUuid &&
                                                    streamedTournamentUuid === m.tournamentUuid
                                                }
                                                onOpenMatch={() => goToMatchPage(m)}
                                                onWatch={() => goToTheater(m)}
                                                onWarm={() =>
                                                    warmTournament(m.tournamentSlug || m.tournamentUuid)
                                                }
                                            />
                                        ))}
                                    </Box>
                                </Box>
                            )
                        })}
                    </VStack>
                ) : (() => {
                    // Promote the admin-featured tournament's live match
                    // into a full-width "izdvojena utakmica" slot above
                    // the regular grid. Fallback: when no featured
                    // tournament has a live match, the first sorted match
                    // takes the spot - same visual hierarchy, so the
                    // /uzivo header always has one dominant card.
                    const sorted = pickFeaturedFirst(matches)
                    const [featured, ...rest] = sorted
                    const isAdminFeatured = !!featured?.tournamentFeaturedAt
                    return (
                        <VStack align="stretch" gap="4">
                            <Box>
                                <HStack gap="2" mb="2">
                                    <Box
                                        fontFamily="mono"
                                        fontSize="10px"
                                        fontWeight={800}
                                        letterSpacing="0.2em"
                                        color={isAdminFeatured ? "pitch.500" : "fg.muted"}
                                    >
                                        {isAdminFeatured ? "★ GLAVNA UTAKMICA" : "GLAVNA UTAKMICA"}
                                    </Box>
                                </HStack>
                                <Box
                                    css={{
                                        // Slightly heavier visual weight than
                                        // grid cards so the featured slot
                                        // reads as the page's primary subject.
                                        boxShadow: isAdminFeatured
                                            ? "0 0 0 3px rgba(11,107,58,0.16)"
                                            : undefined,
                                        borderRadius: 12,
                                    }}
                                >
                                    <LiveMatchCard
                                        match={featured}
                                        onOpen={() => goToMatch(featured)}
                                        onOpenMatch={() => goToMatchPage(featured)}
                                        onWarm={() => warmTournament(featured.tournamentSlug || featured.tournamentUuid)}
                                        refreshSignal={liveTick}
                                    />
                                </Box>
                            </Box>
                            {rest.length > 0 && (
                                <Box>
                                    <Box
                                        fontFamily="mono"
                                        fontSize="10px"
                                        fontWeight={800}
                                        letterSpacing="0.2em"
                                        color="fg.muted"
                                        mb="2"
                                    >
                                        OSTALE UTAKMICE · {rest.length}
                                    </Box>
                                    <Grid templateColumns={{ base: "1fr", lg: "1fr 1fr" }} gap="4">
                                        {rest.map((m) => (
                                            <LiveMatchCard
                                                key={m.matchId}
                                                match={m}
                                                onOpen={() => goToMatch(m)}
                                                onOpenMatch={() => goToMatchPage(m)}
                                                onWarm={() => warmTournament(m.tournamentSlug || m.tournamentUuid)}
                                                refreshSignal={liveTick}
                                            />
                                        ))}
                                    </Grid>
                                </Box>
                            )}
                        </VStack>
                    )
                })()}
            </Box>

            {/* ── Upcoming matches ─────────────────────────────────────
                 Matches scheduled to start soon across ALL tournaments,
                 grouped by day. Replaces the old by-month tournament
                 calendar (that moved to the home page list view). */}
            <SectionCard
                icon={FiClock}
                title="Nadolazeće utakmice"
                subtitle={
                    upcomingLoading
                        ? "Učitavanje…"
                        : upcomingMatches.length > 0
                            ? "Utakmice koje uskoro počinju kroz sve turnire"
                            : "Trenutno nema zakazanih utakmica"
                }
            >
                {upcomingLoading ? (
                    <Text color="fg.muted">Učitavanje utakmica…</Text>
                ) : matchDayGroups.length === 0 ? (
                    <Flex direction="column" align="center" py="8" px="4" gap="2" textAlign="center">
                        <Heading size="sm">Nema nadolazećih utakmica</Heading>
                        <Text fontSize="sm" color="fg.muted" maxW="md">
                            Kad organizatori zakažu termine utakmica, pojavit će se ovdje.
                        </Text>
                    </Flex>
                ) : (
                    <VStack align="stretch" gap="4">
                        {matchDayGroups.map((g) => (
                            <Box key={g.key}>
                                <HStack
                                    gap="2"
                                    pb="1.5"
                                    mb="2"
                                    borderBottomWidth="1px"
                                    borderColor="border"
                                >
                                    <MonoLabel color="pitch.500">
                                        {dayHeading(g.date, today)}
                                    </MonoLabel>
                                    <Box flex="1" />
                                    <Text fontSize="xs" fontWeight={600} color="fg.muted">
                                        {g.matches.length}
                                    </Text>
                                </HStack>
                                <VStack align="stretch" gap="1.5">
                                    {g.matches.map((m) => {
                                        const openMatch = () =>
                                            navigate(
                                                `/turniri/${m.tournamentSlug || m.tournamentUuid}` +
                                                    `?tab=bracket&match=${m.matchId}` +
                                                    // GROUP match → grupe (default sub);
                                                    // any knockout stage → eliminacija.
                                                    (m.stage && m.stage !== "GROUP" ? "&sub=eliminacija" : ""),
                                            )
                                        return (
                                            <Flex
                                                key={m.matchId}
                                                role="button"
                                                tabIndex={0}
                                                onClick={openMatch}
                                                onMouseEnter={() => warmTournament(m.tournamentSlug || m.tournamentUuid)}
                                                onPointerDown={() => warmTournament(m.tournamentSlug || m.tournamentUuid)}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter" || e.key === " ") {
                                                        e.preventDefault()
                                                        openMatch()
                                                    }
                                                }}
                                                cursor="pointer"
                                                align="center"
                                                gap="3"
                                                px="3"
                                                py="2.5"
                                                rounded="lg"
                                                borderWidth="1px"
                                                borderColor="border"
                                                bg="bg.panel"
                                                transition="background 0.15s"
                                                _hover={{ bg: "bg.surfaceTint" }}
                                            >
                                                <Flex
                                                    direction="column"
                                                    align="center"
                                                    justify="center"
                                                    minW="14"
                                                    px="2"
                                                    py="1"
                                                    rounded="md"
                                                    bg="pitch.50"
                                                    color="pitch.500"
                                                >
                                                    <Text
                                                        fontFamily="mono"
                                                        fontSize="sm"
                                                        fontWeight={800}
                                                        lineHeight="1.1"
                                                    >
                                                        {formatTime(m.kickoffAt)}
                                                    </Text>
                                                </Flex>
                                                <Box flex="1" minW="0">
                                                    <Text fontSize="sm" fontWeight={700} truncate color="fg.ink">
                                                        {m.team1Name ?? "-"}{" "}
                                                        <Box as="span" color="fg.muted" fontWeight={500}>vs</Box>{" "}
                                                        {m.team2Name ?? "-"}
                                                    </Text>
                                                    <HStack gap="1" mt="0.5" color="fg.muted">
                                                        <FiCalendar size={11} />
                                                        <Text fontSize="xs" truncate>
                                                            {m.tournamentName}
                                                            {matchPhaseLabel(m) ? ` · ${matchPhaseLabel(m)}` : ""}
                                                        </Text>
                                                    </HStack>
                                                </Box>
                                                <MatchNotificationBell
                                                    tournamentUuid={m.tournamentUuid}
                                                    matchId={m.matchId}
                                                />
                                                <Box as="span" color="fg.muted" flexShrink={0}>
                                                    <FiChevronRight />
                                                </Box>
                                            </Flex>
                                        )
                                    })}
                                </VStack>
                            </Box>
                        ))}
                    </VStack>
                )}
            </SectionCard>
        </VStack>
    )
}
