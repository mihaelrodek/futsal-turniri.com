import { useCallback, useEffect, useMemo, useState } from "react"
import { Box, Flex, Grid, HStack, Heading, Text, VStack } from "@chakra-ui/react"
import { useNavigate } from "react-router-dom"
import { FiCalendar, FiChevronRight, FiClock, FiMapPin, FiRadio } from "react-icons/fi"
import {
    fetchLiveMatches,
    fetchUpcomingMatches,
    matchPhaseLabel,
    pickFeaturedFirst,
    type LiveMatch,
    type UpcomingMatch,
} from "../api/live"
import { fetchFeaturedTournament } from "../api/tournaments"
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
import { useLiveSocket } from "../hooks/useLiveSocket"
import { GoalscorersPanel, LiveClock } from "../components/liveMatch"
import MatchNotificationBell from "../components/MatchNotificationBell"
import { FiChevronDown, FiChevronUp } from "react-icons/fi"

/* ──────────────────────────────────────────────────────────────────────────
   LivePage — "Pitch" theme /uzivo.

   Structure:
     1. Header — pulsing live-now kicker, dynamic "{n} utakmica u tijeku"
        title, share + raspored ghost buttons.
     2. 2-column grid of live match cards (compact scoreboard per match),
        each expandable to reveal live minute + goalscorer timeline.
     3. "Nadolazeći turniri" calendar — same shape as the previous LivePage,
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

function teamShort(name: string | null | undefined): string {
    if (!name) return "??"
    const words = name.trim().split(/\s+/)
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
    return name.slice(0, 2).toUpperCase()
}

// Deterministic colour per team name — used for the team badge gradient.
const BADGE_COLORS = ["#dc2626", "#2563eb", "#7c3aed", "#f59e0b", "#10b981", "#06b6d4", "#ef4444", "#8b5cf6"]
function badgeColor(name?: string | null): string {
    if (!name) return BADGE_COLORS[0]
    let h = 0
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
    return BADGE_COLORS[h % BADGE_COLORS.length]
}

function TeamBadge({ name, size = 44 }: { name: string | null | undefined; size?: number }) {
    const c = badgeColor(name)
    return (
        <Flex
            w={`${size}px`}
            h={`${size}px`}
            rounded="md"
            align="center"
            justify="center"
            color="white"
            fontFamily="heading"
            fontSize={`${Math.round(size * 0.36)}px`}
            fontWeight={800}
            letterSpacing="-0.02em"
            flexShrink={0}
            bgImage={`linear-gradient(145deg, ${c}, ${c}cc)`}
            css={{ boxShadow: `0 8px 24px ${c}80` }}
        >
            {teamShort(name)}
        </Flex>
    )
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
    const dayNum = startDate ? String(startDate.getDate()).padStart(2, "0") : "—"
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
                {/* Poster column — fixed width on desktop, banner-style on mobile */}
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
                             button doesn't need to stopPropagation — both
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

/** Compact live match card — header strip, scoreboard, expandable scorer
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
    refreshSignal,
}: {
    match: LiveMatch
    onOpen: () => void
    refreshSignal?: number
}) {
    const half = match.secondHalfStartedAt ? "2. POL." : "1. POL."
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
        >
            {/* Header + scoreboard wrap — clicking anywhere on this region
                 toggles the expanded scorer timeline below. */}
            <Box cursor="pointer" onClick={() => setExpanded((v) => !v)}>
            {/* Header strip */}
            <Flex
                justify="space-between"
                align="center"
                px="4"
                py="2.5"
                bg="bg.surfaceTint2"
                borderBottomWidth="1px"
                borderColor="border"
                gap="2"
            >
                <HStack gap="2" minW="0">
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
                    >
                        <PulseDot color="white" size={5} />
                        UŽIVO
                    </HStack>
                    <Text fontSize="12px" fontWeight={600} color="fg.ink" truncate>
                        {match.tournamentName}
                    </Text>
                </HStack>
                <HStack gap="2">
                    {/* Live clock — pulls minute from the same fields the
                         tournament-page LiveMatchDialog uses, so the two
                         views stay numerically in sync. */}
                    {match.liveMode === "TIMER" && match.liveStartedAt && (
                        <LiveClock
                            liveStartedAt={match.liveStartedAt}
                            secondHalfStartedAt={match.secondHalfStartedAt ?? null}
                            halfLengthMin={match.halfLengthMin}
                            halfCount={match.halfCount}
                        />
                    )}
                    <MonoLabel color="fg.muted">{half}</MonoLabel>
                </HStack>
            </Flex>

            {/* Scoreboard — tighter on mobile so the card stays one-column
                 friendly while readable. Score scales 30px→42px, badges
                 38px→44px, team names truncate. */}
            <Grid
                templateColumns="1fr auto 1fr"
                alignItems="center"
                gap={{ base: "2", md: "3" }}
                px={{ base: "3", md: "5" }}
                py={{ base: "3", md: "5" }}
            >
                <Flex justify="flex-end" align="center" gap={{ base: "2", md: "3" }} minW="0">
                    <Text
                        fontSize={{ base: "13px", md: "16px" }}
                        fontWeight={700}
                        color="fg.ink"
                        textAlign="right"
                        truncate
                    >
                        {match.team1Name ?? "—"}
                    </Text>
                    <Box display={{ base: "none", sm: "block" }}>
                        <TeamBadge name={match.team1Name} size={44} />
                    </Box>
                    <Box display={{ base: "block", sm: "none" }}>
                        <TeamBadge name={match.team1Name} size={36} />
                    </Box>
                </Flex>
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
                <Flex align="center" gap={{ base: "2", md: "3" }} minW="0">
                    <Box display={{ base: "none", sm: "block" }}>
                        <TeamBadge name={match.team2Name} size={44} />
                    </Box>
                    <Box display={{ base: "block", sm: "none" }}>
                        <TeamBadge name={match.team2Name} size={36} />
                    </Box>
                    <Text fontSize={{ base: "13px", md: "16px" }} fontWeight={700} color="fg.ink" truncate>
                        {match.team2Name ?? "—"}
                    </Text>
                </Flex>
            </Grid>
            </Box>
            {/* End of clickable region */}

            {/* Expanded scorer timeline — only mounted when open so the
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
                        team1Id={null}
                        team2Id={null}
                        pollMs={8000}
                        refreshSignal={refreshSignal}
                    />
                </Box>
            )}

            {/* Footer — split into expand toggle (left) and open-tournament
                 navigation (right). Stops propagation so clicking the link
                 doesn't also toggle expand. */}
            <Box
                display="grid"
                gridTemplateColumns="1fr auto 1fr"
                alignItems="center"
                px="4"
                py="2.5"
                borderTopWidth="1px"
                borderColor="border"
            >
                <Box />
                <Flex
                    align="center"
                    gap="1.5"
                    color="fg.muted"
                    cursor="pointer"
                    justifySelf="center"
                    onClick={(e) => {
                        e.stopPropagation()
                        setExpanded((v) => !v)
                    }}
                    _hover={{ color: "fg.ink" }}
                >
                    {expanded ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
                    <Text fontSize="12px" fontWeight={600}>
                        {expanded ? "Sakrij događaje" : "Prikaži događaje"}
                    </Text>
                </Flex>
                <Box
                    as="span"
                    fontSize="12px"
                    fontWeight={700}
                    color="pitch.500"
                    cursor="pointer"
                    justifySelf="end"
                    onClick={(e) => {
                        e.stopPropagation()
                        onOpen()
                    }}
                    css={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
                    _hover={{ textDecoration: "underline" }}
                >
                    Otvori turnir →
                </Box>
            </Box>
        </Box>
    )
}

type MatchDayGroup = { key: string; date: Date; matches: UpcomingMatch[] }

export default function LivePage() {
    const [matches, setMatches] = useState<LiveMatch[]>([])
    const [matchesLoading, setMatchesLoading] = useState(true)
    const [upcomingMatches, setUpcomingMatches] = useState<UpcomingMatch[]>([])
    const [upcomingLoading, setUpcomingLoading] = useState(true)
    const [featured, setFeatured] = useState<TournamentCard | null>(null)
    // Bumped on every WebSocket live-update so expanded event timelines refetch
    // instantly (see GoalscorersPanel refreshSignal).
    const [liveTick, setLiveTick] = useState(0)

    const navigate = useNavigate()
    const today = useMemo(() => new Date(), [])

    const loadLive = useCallback(() => {
        fetchLiveMatches()
            .then((l) => {
                setMatches(l)
                setMatchesLoading(false)
            })
            .catch(() => setMatchesLoading(false))
    }, [])

    // Realtime: the backend pushes a ping whenever any live match changes;
    // refetch the live list immediately and nudge the open timelines. Polling
    // below stays as a fallback if the socket can't connect.
    useLiveSocket(() => {
        loadLive()
        setLiveTick((t) => t + 1)
    })

    useDocumentHead({
        title: "Uživo i raspored — futsal-turniri.com",
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
                /* network error — section just shows empty state */
            })
            .finally(() => setUpcomingLoading(false))
    }, 30000)

    // Admin-curated daily highlight. Silent endpoint (204 when unset) —
    // failure / empty just leaves `featured` null and the hero block is
    // skipped entirely.
    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                const f = await fetchFeaturedTournament()
                if (!cancelled) setFeatured(f)
            } catch {
                /* silent — no hero, page still works */
            }
        })()
        return () => {
            cancelled = true
        }
    }, [])

    function goToMatch(m: LiveMatch) {
        navigate(`/turniri/${m.tournamentSlug || m.tournamentUuid}`)
    }

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
                 Code kept — flip FEATURED_HERO_ENABLED to bring it back. */}
            {FEATURED_HERO_ENABLED && featured && <FeaturedTournamentHero tournament={featured} onOpen={() => {
                navigate(`/turniri/${featured.slug ?? featured.uuid}`)
            }} />}

            {/* ── Header — the pulsing red "UŽIVO SADA" kicker only appears
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
                </Flex>
            )}

            {/* ── Live matches grid ───────────────────────────────────── */}
            <Box>
                {matchesLoading ? (
                    <SectionCard padding="6">
                        <Text color="fg.muted">Učitavanje utakmica…</Text>
                    </SectionCard>
                ) : matches.length === 0 ? (
                    // Calm, slim banner — no big empty card, no red pulse.
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
                ) : (() => {
                    // Promote the admin-featured tournament's live match
                    // into a full-width "izdvojena utakmica" slot above
                    // the regular grid. Fallback: when no featured
                    // tournament has a live match, the first sorted match
                    // takes the spot — same visual hierarchy, so the
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
                                                    `?tab=raspored&match=${m.matchId}`,
                                            )
                                        return (
                                            <Flex
                                                key={m.matchId}
                                                role="button"
                                                tabIndex={0}
                                                onClick={openMatch}
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
                                                        {m.team1Name ?? "—"}{" "}
                                                        <Box as="span" color="fg.muted" fontWeight={500}>vs</Box>{" "}
                                                        {m.team2Name ?? "—"}
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
