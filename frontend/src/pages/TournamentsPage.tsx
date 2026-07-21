import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
    Box,
    Button,
    Flex,
    Grid,
    Heading,
    HStack,
    IconButton,
    Input,
    Menu,
    Portal,
    Skeleton,
    Slider,
    Stack,
    Text,
    VStack,
} from "@chakra-ui/react"
import { Link as RouterLink, useNavigate } from "react-router-dom"
import { useQueryClient } from "@tanstack/react-query"
import { qk } from "../queryClient"
import {
    FiBell,
    FiCalendar,
    FiEdit3,
    FiChevronDown,
    FiChevronRight,
    FiChevronUp,
    FiClock,
    FiFilter,
    FiGrid,
    FiList,
    FiMapPin,
    FiNavigation,
    FiCheck,
    FiPlus,
    FiSearch,
    FiSliders,
    FiX,
} from "react-icons/fi"
import type { TournamentCard } from "../types/tournaments"
import { fetchTournaments, fetchTournamentsCount, fetchTournamentDetails } from "../api/tournaments"
import { fetchSchedule } from "../api/schedule"
import { fetchLiveMatches, pickFeaturedFirst, type LiveMatch } from "../api/live"
import { useUserLocation } from "../hooks/useUserLocation"
import { haversineKm } from "../utils/distance"
import { useDocumentHead } from "../hooks/useDocumentHead"
import { useLiveSocket } from "../hooks/useLiveSocket"
import { usePolling } from "../hooks/usePolling"
import {
    DateStamp,
    MonoLabel,
    PitchBackdrop,
    PulseDot,
    StatusChip,
    TournamentPoster,
} from "../ui/pitch"
import { clockState, matchPhase } from "../components/liveMatch"
import HelpFab from "../components/HelpFab"
import StreamHero, { buildStreamOverlay } from "../components/StreamHero"
import StreamPausedBanner from "../components/StreamPausedBanner"
import {
    fetchStreamBanner,
    readStreamBannerHint,
    writeStreamBannerHint,
    type StreamBanner,
} from "../api/streamBanner"
import { useStreamPresence } from "../hooks/useStreamPresence"

/* ──────────────────────────────────────────────────────────────────────────
   Turniri (listing) - "Pitch" theme.

   Layout:
     1. Live scoreboard hero        (rendered when a live match exists)
     2. Search + filter toolbar     (Filteri, view switcher, kotizacija slider)
     3. Status filter chips         (Svi turniri / Uživo / Nadolazeći / …)
     4. "Predstojeći turniri" grid  - 3-column tournament cards
     5. "Završeni turniri" section  - same card layout, finished variant
   ────────────────────────────────────────────────────────────────────── */

type TournamentCardWithUuid = TournamentCard & { uuid: string }

// ---------- formatters ----------
const HR_MONTHS_SHORT = [
    "SIJ", "VEL", "OŽU", "TRA", "SVI", "LIP", "SRP", "KOL", "RUJ", "LIS", "STU", "PRO",
]
const HR_WEEKDAYS_SHORT = ["NED", "PON", "UTO", "SRI", "ČET", "PET", "SUB"]

function formatTime(iso?: string | null) {
    if (!iso) return "-"
    const d = new Date(iso)
    return new Intl.DateTimeFormat("hr-HR", { hour: "2-digit", minute: "2-digit" }).format(d)
}
function fmtEuro(n?: number | null) {
    if (typeof n !== "number" || !isFinite(n)) return null
    const s = n.toFixed(2)
    const trimmed = s.endsWith(".00") ? s.slice(0, -3) : s
    return `${trimmed}€`
}
function relativeDays(iso?: string | null): { days: number; label: string } | null {
    if (!iso) return null
    const startMs = new Date(iso).setHours(0, 0, 0, 0)
    const todayMs = new Date().setHours(0, 0, 0, 0)
    const diff = Math.round((startMs - todayMs) / (24 * 60 * 60 * 1000))
    if (diff < 0) return null
    if (diff === 0) return { days: 0, label: "Danas" }
    if (diff === 1) return { days: 1, label: "Sutra" }
    if (diff <= 14) return { days: diff, label: `Za ${diff} dana` }
    return { days: diff, label: "Nadolazeći" }
}

function decomposeDate(iso?: string | null) {
    if (!iso) return null
    const d = new Date(iso)
    return {
        day: HR_WEEKDAYS_SHORT[d.getDay()],
        dayNum: String(d.getDate()).padStart(2, "0"),
        month: HR_MONTHS_SHORT[d.getMonth()],
        time: formatTime(iso),
    }
}

/** Map a tournament + helpers to the shared `StatusKind` the design uses. */
function classifyStatus(
    t: TournamentCardWithUuid,
    variant: "upcoming" | "finished",
): { status: "live" | "upcoming" | "soon" | "full" | "finished"; label: string } {
    if (variant === "finished") return { status: "finished", label: "Završen" }
    // A live match OR a started (but not finished) tournament both read as the
    // same red pulsing "U TIJEKU" badge - we no longer surface a separate
    // "UŽIVO" label, so the status stays stable between individual matches.
    if (t.liveMatch || t.status === "STARTED") return { status: "live", label: "U TIJEKU" }
    // A full roster no longer overrides the date badge - the card shows
    // "Danas" / "Sutra" / "Za N dana" / "Nadolazeći" like every other upcoming
    // tournament (the popunjenost bar still shows the registered/max count).
    const rel = relativeDays(t.startAt)
    if (rel && rel.days > 1 && rel.days <= 7) return { status: "soon", label: rel.label }
    return { status: "upcoming", label: rel?.label ?? "Nadolazeći" }
}

/** Prefetch a tournament's detail data into the react-query cache so opening it
 *  (click / tap) renders instantly instead of showing a spinner + refetch. The
 *  key is slug-or-uuid to match EXACTLY what TournamentDetailsPage reads. */
function useTournamentPrefetch() {
    const queryClient = useQueryClient()
    return useCallback(
        (idOrSlug?: string | null) => {
            if (!idOrSlug) return
            queryClient.prefetchQuery({
                queryKey: qk.tournamentDetails(idOrSlug),
                queryFn: () => fetchTournamentDetails(idOrSlug),
                staleTime: 30_000,
            })
        },
        [queryClient],
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   Live scoreboard hero - the dark gradient panel that opens the page when
   at least one match is live. Pulls the highest-watching live match and
   renders the score block (team names, no abbreviation badges).
   ────────────────────────────────────────────────────────────────────── */

/** Shared min-height for the two home-hero slides so the promo banner and the
 *  live scoreboard swap in place without reflowing. Tuned to the scoreboard's
 *  natural height per breakpoint. */
const HERO_MIN_H = { base: "300px", md: "260px" } as const

function LiveHero({ match }: { match: LiveMatch }) {
    const queryClient = useQueryClient()
    // Warm the featured match's tournament (detail + schedule) on hover/press so
    // "Prati uživo →" opens its match page instantly.
    const warm = () => {
        const idOrSlug = match.tournamentSlug ?? match.tournamentUuid
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
    }
    // Tick every second so the live minute keeps counting between the
    // WebSocket-pushed refreshes (which deliver fresh instants/scores).
    const [, setHeroTick] = useState(0)
    useEffect(() => {
        if (match.liveMode !== "TIMER") return
        const id = setInterval(() => setHeroTick((t) => t + 1), 1000)
        return () => clearInterval(id)
    }, [match.liveMode])

    const heroPhase =
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
    const heroHalfLabel =
        match.livePausedAt && (heroPhase === "FIRST_HALF" || heroPhase === "SECOND_HALF")
            ? "PAUZA"
            : heroPhase === "HALFTIME" ? "POLUVRIJEME"
                : heroPhase === "SECOND_HALF" ? "2. POLUVRIJEME"
                    : heroPhase === "FULL_TIME" ? "KRAJ"
                        : heroPhase === "FIRST_HALF" ? "1. POLUVRIJEME"
                            : match.secondHalfStartedAt ? "2. POLUVRIJEME" : "1. POLUVRIJEME"
    // Running match minute (m:ss) - TIMER matches only.
    const heroClock =
        match.liveMode === "TIMER"
            ? clockState({
                  liveStartedAt: match.liveStartedAt,
                  firstHalfEndedAt: match.firstHalfEndedAt ?? null,
                  secondHalfStartedAt: match.secondHalfStartedAt ?? null,
                  livePausedAt: match.livePausedAt ?? null,
                  halfLengthMin: match.halfLengthMin,
                  halfCount: match.halfCount,
              })
            : null
    return (
        <Box
            position="relative"
            overflow="hidden"
            color="white"
            minH={HERO_MIN_H}
            flex="1 0 auto"
            display="flex"
            flexDirection="column"
            bgImage="linear-gradient(135deg, #0b6b3a, #084a28)"
        >
            <PitchBackdrop opacity={0.15} variant="hero" tone="pitch" />
            <Box
                position="absolute"
                inset="0"
                pointerEvents="none"
                bg="repeating-linear-gradient(90deg, transparent 0, transparent 70px, rgba(0,0,0,0.05) 70px, rgba(0,0,0,0.05) 140px)"
            />

            {/* Top sub-bar - just the UŽIVO kicker; the tournament name sits
                centred in the scoreboard below. */}
            <Flex
                position="relative"
                align="center"
                px={{ base: 4, md: 7 }}
                py="2.5"
                borderBottomWidth="1px"
                borderColor="rgba(255,255,255,0.12)"
                bg="rgba(220, 38, 38, 0.18)"
                gap="3"
            >
                <HStack gap="2.5">
                    <PulseDot color="white" size={8} glow />
                    <Box fontFamily="mono" fontSize="11px" fontWeight={700} letterSpacing="0.15em">
                        UŽIVO
                    </Box>
                </HStack>
            </Flex>

            {/* ── Mobile scoreboard (base only) - one vertical column. The
                 order is deliberately different from the desktop 3-column
                 layout: tournament name + phase sit ABOVE the home team, the
                 score sits between the two teams, and the site watermark drops
                 BELOW the away team. The CTA below is centred. */}
            <VStack
                display={{ base: "flex", md: "none" }}
                position="relative"
                flex="1"
                justify="center"
                gap="0"
                px="4"
                py="4"
                textAlign="center"
            >
                {match.tournamentName && (
                    <Box
                        fontFamily="heading"
                        fontSize="16px"
                        fontWeight={800}
                        letterSpacing="-0.01em"
                        lineHeight={1.15}
                    >
                        {match.tournamentName}
                    </Box>
                )}
                <Box
                    fontFamily="mono"
                    color="accent.goal"
                    letterSpacing="0.14em"
                    fontWeight={700}
                    fontVariantNumeric="tabular-nums"
                    mt="0.5"
                    mb="2"
                >
                    {heroClock && (
                        <Flex justify="center" align="center" gap="1.5" fontSize="15px">
                            <FiClock size={13} />
                            {heroClock.display}
                        </Flex>
                    )}
                    <Box fontSize="11px" mt={heroClock ? "0.5" : "0"}>
                        {heroHalfLabel}
                    </Box>
                </Box>
                {/* Home team */}
                <Box
                    fontFamily="heading"
                    fontSize="16px"
                    fontWeight={700}
                    letterSpacing="-0.02em"
                    lineHeight={1.2}
                >
                    {match.team1Name ?? "-"}
                </Box>
                {/* Score */}
                <Box
                    fontFamily="mono"
                    fontSize="40px"
                    fontWeight={800}
                    letterSpacing="-0.05em"
                    lineHeight={1}
                    my="1.5"
                >
                    {match.score1 ?? 0}
                    <Box as="span" color="rgba(255,255,255,0.35)" px="2.5">
                        :
                    </Box>
                    {match.score2 ?? 0}
                </Box>
                {/* Away team */}
                <Box
                    fontFamily="heading"
                    fontSize="16px"
                    fontWeight={700}
                    letterSpacing="-0.02em"
                    lineHeight={1.2}
                >
                    {match.team2Name ?? "-"}
                </Box>
                {/* Site watermark - below the away team */}
                <MonoLabel
                    color="rgba(255,255,255,0.5)"
                    letterSpacing="0.15em"
                    mt="2.5"
                    display="block"
                >
                    FUTSAL-TURNIRI.COM
                </MonoLabel>
            </VStack>

            {/* ── Desktop scoreboard (md+) - the classic 3-column layout with
                 the team names flanking the centred score/tournament block. */}
            <Grid
                display={{ base: "none", md: "grid" }}
                position="relative"
                flex="1"
                alignContent="center"
                templateColumns="1fr auto 1fr"
                alignItems="center"
                gap="6"
                px="8"
                py="5"
            >
                <Box textAlign={{ base: "center", md: "right" }}>
                    <Box
                        fontFamily="heading"
                        fontSize={{ base: "15px", md: "24px" }}
                        fontWeight={700}
                        letterSpacing="-0.02em"
                        lineHeight={1.1}
                    >
                        {match.team1Name ?? "-"}
                    </Box>
                </Box>

                <Box textAlign="center" px="2">
                    {/* Tournament name - centred, prominent. */}
                    {match.tournamentName && (
                        <Box
                            fontFamily="heading"
                            fontSize={{ base: "15px", md: "19px" }}
                            fontWeight={800}
                            letterSpacing="-0.01em"
                            lineHeight={1.15}
                            mb="1"
                        >
                            {match.tournamentName}
                        </Box>
                    )}
                    {/* Live minute + phase - each on its own line (UŽIVO already
                        sits top-left). */}
                    <Box
                        fontFamily="mono"
                        color="accent.goal"
                        letterSpacing="0.14em"
                        fontWeight={700}
                        fontVariantNumeric="tabular-nums"
                    >
                        {heroClock && (
                            <Flex justify="center" align="center" gap="1.5" fontSize="15px">
                                <FiClock size={13} />
                                {heroClock.display}
                            </Flex>
                        )}
                        <Box fontSize="11px" mt={heroClock ? "0.5" : "0"}>
                            {heroHalfLabel}
                        </Box>
                    </Box>
                    <Box
                        fontFamily="mono"
                        fontSize={{ base: "36px", md: "64px" }}
                        fontWeight={800}
                        letterSpacing="-0.05em"
                        lineHeight={1}
                        mt="1"
                    >
                        {match.score1 ?? 0}
                        <Box as="span" color="rgba(255,255,255,0.35)" px={{ base: "1.5", md: "3.5" }}>
                            :
                        </Box>
                        {match.score2 ?? 0}
                    </Box>
                    <MonoLabel
                        color="rgba(255,255,255,0.5)"
                        letterSpacing="0.15em"
                        mt="1"
                        display="block"
                    >
                        FUTSAL-TURNIRI.COM
                    </MonoLabel>
                </Box>

                <Box textAlign={{ base: "center", md: "left" }}>
                    <Box
                        fontFamily="heading"
                        fontSize={{ base: "15px", md: "24px" }}
                        fontWeight={700}
                        letterSpacing="-0.02em"
                        lineHeight={1.1}
                    >
                        {match.team2Name ?? "-"}
                    </Box>
                </Box>
            </Grid>

            {/* Bottom CTA strip */}
            <Flex
                position="relative"
                borderTopWidth="1px"
                borderColor="rgba(255,255,255,0.12)"
                bg="rgba(0,0,0,0.3)"
                px={{ base: 4, md: 7 }}
                py="2.5"
                justify="center"
                align="center"
                gap="3"
                wrap="wrap"
            >
                <Button
                    asChild
                    size="sm"
                    bg="accent.goal"
                    color="fg.ink"
                    fontWeight={700}
                    rounded="md"
                    _hover={{ bg: "#e8aa15" }}
                >
                    <RouterLink
                        to={
                            match.tournamentUuid
                                ? `/turniri/${match.tournamentSlug ?? match.tournamentUuid}/utakmica/${match.matchId}`
                                : "/uzivo"
                        }
                        onMouseEnter={warm}
                        onPointerDown={warm}
                    >
                        Prati uživo →
                    </RouterLink>
                </Button>
            </Flex>
        </Box>
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   Promo heroes - the two marketing slides that share the home hero slot with
   the live scoreboard. Same outer shell (gradient panel, pitch backdrop,
   diagonal stripes) and the shared HERO_MIN_H / flex-fill so every slide is the
   same height and swaps in place without the layout jumping. There are two
   variants - one aimed at organisers, one at followers - so the carousel always
   has something to page through even when nothing is live.
   ────────────────────────────────────────────────────────────────────── */

/* Shared shell for the faux "app screenshot" cards. Plain divs (not images) so
   they stay crisp and theme-proof; text is pinned dark since the cards always
   sit on a white surface. The cards are desktop-only (hidden on mobile). */
const MOCK_SHELL = {
    bg: "rgba(255,255,255,0.97)",
    color: "#0e1f15",
    rounded: "xl",
    overflow: "hidden",
    boxShadow: "0 12px 30px rgba(0,0,0,0.34)",
    borderWidth: "1px",
    borderColor: "rgba(0,0,0,0.06)",
} as const

/* Follower: a live scoreboard with a goal + a yellow-card event logged. */
function PromoMockLive() {
    return (
        <Box {...MOCK_SHELL} w="210px">
            <Flex
                align="center"
                justify="space-between"
                px="3"
                py="1.5"
                bg="rgba(193,18,31,0.08)"
                borderBottomWidth="1px"
                borderColor="rgba(0,0,0,0.06)"
            >
                <HStack gap="1.5">
                    <PulseDot color="#c1121f" size={6} glow />
                    <Box
                        fontFamily="mono"
                        fontSize="9.5px"
                        fontWeight={800}
                        letterSpacing="0.14em"
                        color="#c1121f"
                        css={{ animation: "pitchPulse 1.6s infinite" }}
                    >
                        UŽIVO
                    </Box>
                </HStack>
                <HStack gap="1" fontFamily="mono" fontSize="10px" fontWeight={700} color="rgba(0,0,0,0.55)">
                    <FiClock size={10} />
                    <Box>12:34</Box>
                </HStack>
            </Flex>
            <VStack align="stretch" gap="1" px="3" py="2">
                <Flex align="center" justify="space-between">
                    <Box fontSize="12px" fontWeight={700}>Sokol</Box>
                    <Box fontFamily="mono" fontSize="17px" fontWeight={800}>2</Box>
                </Flex>
                <Flex align="center" justify="space-between">
                    <Box fontSize="12px" fontWeight={700}>Dinamo MŽ</Box>
                    <Box fontFamily="mono" fontSize="17px" fontWeight={800}>1</Box>
                </Flex>
            </VStack>
            <VStack
                align="stretch"
                gap="0"
                borderTopWidth="1px"
                borderColor="rgba(0,0,0,0.08)"
                bg="rgba(0,0,0,0.02)"
            >
                <Flex align="center" gap="2" px="3" py="1.5">
                    <Box fontSize="11px">⚽</Box>
                    <Box fontSize="10.5px" color="rgba(0,0,0,0.55)">
                        <Box as="span" fontWeight={700} color="#0e1f15">12'</Box> Marko Horvat
                    </Box>
                </Flex>
                <Flex
                    align="center"
                    gap="2"
                    px="3"
                    py="1.5"
                    borderTopWidth="1px"
                    borderColor="rgba(0,0,0,0.06)"
                >
                    <Box w="9px" h="12px" rounded="2px" bg="#eab308" flexShrink={0} />
                    <Box fontSize="10.5px" color="rgba(0,0,0,0.55)">
                        <Box as="span" fontWeight={700} color="#0e1f15">18'</Box> Ivan Kovač
                    </Box>
                </Flex>
            </VStack>
        </Box>
    )
}

/* Follower: a push notification announcing a goal. */
function PromoMockNotif() {
    return (
        <Box {...MOCK_SHELL} w="216px">
            <Flex align="center" gap="2.5" px="3" py="2.5">
                <Flex
                    align="center"
                    justify="center"
                    w="26px"
                    h="26px"
                    rounded="lg"
                    bg="#0b6b3a"
                    color="white"
                    flexShrink={0}
                >
                    <FiBell size={13} />
                </Flex>
                <Box flex="1" minW="0">
                    <Flex align="center" justify="space-between" gap="2">
                        <Box
                            fontSize="9.5px"
                            fontWeight={700}
                            color="rgba(0,0,0,0.55)"
                            whiteSpace="nowrap"
                            overflow="hidden"
                            textOverflow="ellipsis"
                        >
                            futsal-turniri.com
                        </Box>
                        <Box fontSize="9px" color="rgba(0,0,0,0.4)" flexShrink={0}>sada</Box>
                    </Flex>
                    <Box fontSize="11.5px" fontWeight={800} mt="0.5">⚽ GOL! Sokol 2–1</Box>
                    <Box fontSize="10px" color="rgba(0,0,0,0.55)">Marko Horvat, 12'</Box>
                </Box>
            </Flex>
        </Box>
    )
}

/* Follower mock cluster: the live card with the goal notification popping over. */
function PromoMockFollower() {
    return (
        <Box position="relative" w="250px" h="180px">
            <Box position="absolute" left="0" bottom="0" transform="rotate(-3deg)">
                <PromoMockLive />
            </Box>
            <Box position="absolute" right="0" top="0" transform="rotate(2.5deg)" zIndex={1}>
                <PromoMockNotif />
            </Box>
        </Box>
    )
}

/* Organiser: the match-record console (zapisnik) with faux add controls. */
function PromoMockZapisnik() {
    return (
        <Box {...MOCK_SHELL} w="205px">
            <Flex align="center" justify="space-between" px="3" py="1.5" bg="#0b6b3a" color="white">
                <HStack gap="1.5">
                    <FiEdit3 size={11} />
                    <Box fontFamily="mono" fontSize="9.5px" fontWeight={700} letterSpacing="0.1em">
                        ZAPISNIK
                    </Box>
                </HStack>
                <Box fontFamily="mono" fontSize="11px" fontWeight={800}>2 : 1</Box>
            </Flex>
            <VStack align="stretch" gap="0" px="3" pt="1.5" pb="1">
                <Flex align="center" gap="2" py="1">
                    <Box fontSize="11px">⚽</Box>
                    <Box fontFamily="mono" fontSize="9.5px" fontWeight={700} color="#0b6b3a" w="18px">
                        12'
                    </Box>
                    <Box
                        fontSize="10.5px"
                        fontWeight={600}
                        flex="1"
                        whiteSpace="nowrap"
                        overflow="hidden"
                        textOverflow="ellipsis"
                    >
                        Marko Horvat
                    </Box>
                </Flex>
                <Flex
                    align="center"
                    gap="2"
                    py="1"
                    borderTopWidth="1px"
                    borderColor="rgba(0,0,0,0.06)"
                >
                    <Box w="9px" h="12px" rounded="2px" bg="#eab308" flexShrink={0} />
                    <Box fontFamily="mono" fontSize="9.5px" fontWeight={700} color="#0b6b3a" w="18px">
                        18'
                    </Box>
                    <Box fontSize="10.5px" fontWeight={600} flex="1">Ivan Kovač</Box>
                </Flex>
            </VStack>
            <Flex gap="1.5" px="3" pb="2.5" pt="1">
                <Box
                    flex="1"
                    textAlign="center"
                    fontSize="9.5px"
                    fontWeight={700}
                    color="white"
                    bg="#0b6b3a"
                    rounded="md"
                    py="1"
                >
                    + Gol
                </Box>
                <Box
                    flex="1"
                    textAlign="center"
                    fontSize="9.5px"
                    fontWeight={700}
                    color="#0e1f15"
                    bg="rgba(0,0,0,0.06)"
                    rounded="md"
                    py="1"
                >
                    + Karton
                </Box>
            </Flex>
        </Box>
    )
}

/* Organiser: a mini elimination bracket. */
function PromoMockBracket() {
    const pair = (a: string, b: string, aWins: boolean) => (
        <Box borderWidth="1px" borderColor="rgba(0,0,0,0.1)" rounded="md" overflow="hidden" bg="rgba(0,0,0,0.02)">
            <Box
                fontSize="9px"
                fontWeight={aWins ? 800 : 600}
                color={aWins ? "#0b6b3a" : "#0e1f15"}
                px="1.5"
                py="0.5"
                whiteSpace="nowrap"
                overflow="hidden"
                textOverflow="ellipsis"
            >
                {a}
            </Box>
            <Box h="1px" bg="rgba(0,0,0,0.08)" />
            <Box
                fontSize="9px"
                fontWeight={aWins ? 600 : 800}
                color={aWins ? "#0e1f15" : "#0b6b3a"}
                px="1.5"
                py="0.5"
                whiteSpace="nowrap"
                overflow="hidden"
                textOverflow="ellipsis"
            >
                {b}
            </Box>
        </Box>
    )
    return (
        <Box {...MOCK_SHELL} w="200px">
            <Flex align="center" gap="1.5" px="3" py="1.5" bg="#0b6b3a" color="white">
                <FiGrid size={11} />
                <Box fontFamily="mono" fontSize="9.5px" fontWeight={700} letterSpacing="0.1em">
                    ELIMINACIJA
                </Box>
            </Flex>
            <Flex align="center" gap="1.5" px="3" py="2.5">
                <VStack gap="2" flex="1" minW="0">
                    {pair("Sokol", "Dinamo", true)}
                    {pair("Mladost", "Zrinski", false)}
                </VStack>
                <Box w="8px" h="1px" bg="rgba(0,0,0,0.18)" flexShrink={0} />
                <Box flex="1" minW="0">
                    {pair("Sokol", "Mladost", true)}
                    <Box
                        fontSize="7.5px"
                        fontWeight={700}
                        color="#0b6b3a"
                        letterSpacing="0.12em"
                        textAlign="center"
                        mt="1"
                    >
                        FINALE
                    </Box>
                </Box>
            </Flex>
        </Box>
    )
}

/* Organiser mock cluster: the bracket behind, the live record console in front. */
function PromoMockOrganizer() {
    return (
        <Box position="relative" w="250px" h="180px">
            <Box position="absolute" left="0" top="0" transform="rotate(-4deg)">
                <PromoMockBracket />
            </Box>
            <Box position="absolute" right="0" bottom="0" transform="rotate(3deg)" zIndex={1}>
                <PromoMockZapisnik />
            </Box>
        </Box>
    )
}

type PromoSlide = {
    kicker: string
    title: string
    gold: string
    subtitle: string
    /** Two-card collage - shown on both breakpoints, scaled down on mobile. */
    mock: React.ReactNode
}

const PROMO_SLIDES: PromoSlide[] = [
    {
        kicker: "ZA ORGANIZATORE",
        title: "Organiziraš turnir?",
        gold: "Od sada to možeš potpuno besplatno!",
        subtitle:
            "Prijavi ekipe, izvuci ždrijeb, vodi zapisnik utakmice — bez Excela i papira, potpuno automatizirano.",
        mock: <PromoMockOrganizer />,
    },
    {
        kicker: "ZA PRATITELJE",
        title: "Prati sve turnire uživo.",
        gold: "Na jednom mjestu.",
        subtitle:
            "Prati svoju ekipu uživo, primaj obavijesti o golovima i pronađi turnire u blizini na karti.",
        mock: <PromoMockFollower />,
    },
]

function PromoHero({ data }: { data: PromoSlide }) {
    return (
        <Box
            position="relative"
            overflow="hidden"
            color="white"
            minH={HERO_MIN_H}
            maxH={HERO_MIN_H}
            flex="1 0 auto"
            display="flex"
            flexDirection="column"
            bgImage="linear-gradient(135deg, #0b6b3a, #084a28)"
        >
            <PitchBackdrop opacity={0.15} variant="hero" tone="pitch" />
            <Box
                position="absolute"
                inset="0"
                pointerEvents="none"
                bg="repeating-linear-gradient(90deg, transparent 0, transparent 70px, rgba(0,0,0,0.05) 70px, rgba(0,0,0,0.05) 140px)"
            />

            {/* Top sub-bar - the audience kicker, mirroring the UŽIVO bar on the
                live hero so every slide opens the same way. */}
            <Flex
                position="relative"
                align="center"
                px={{ base: 4, md: 7 }}
                py="2.5"
                borderBottomWidth="1px"
                borderColor="rgba(255,255,255,0.12)"
                bg="rgba(11, 107, 58, 0.32)"
                gap="3"
            >
                <HStack gap="2.5">
                    <PulseDot color="accent.goal" size={8} glow />
                    <Box fontFamily="mono" fontSize="11px" fontWeight={700} letterSpacing="0.15em">
                        {data.kicker}
                    </Box>
                </HStack>
            </Flex>

            {/* Body - landing-style split: copy + faux app "screenshot". On
                desktop the copy sits left with the full mock collage right; on
                mobile the copy stacks above a single mock card (the subtitle is
                dropped there to keep everything inside the fixed hero height). */}
            <Flex
                position="relative"
                flex="1"
                minH="0"
                direction={{ base: "column", md: "row" }}
                align="center"
                justify="center"
                gap={{ base: 3, md: 8 }}
                px={{ base: 5, md: 8 }}
                py={{ base: 3, md: 4 }}
            >
                {/* Copy column */}
                <VStack
                    flex={{ md: "1" }}
                    maxW={{ md: "430px" }}
                    align={{ base: "center", md: "flex-start" }}
                    textAlign={{ base: "center", md: "left" }}
                    gap={{ base: "1.5", md: "2" }}
                >
                    <Box
                        fontFamily="heading"
                        fontWeight={800}
                        letterSpacing="-0.02em"
                        lineHeight={1.1}
                        fontSize={{ base: "18px", md: "26px" }}
                    >
                        {data.title}
                    </Box>
                    <Box
                        fontFamily="heading"
                        fontWeight={800}
                        letterSpacing="-0.01em"
                        lineHeight={1.05}
                        fontSize={{ base: "15.5px", md: "22px" }}
                        color="accent.goal"
                    >
                        {data.gold}
                    </Box>
                    <Text
                        fontSize={{ base: "11px", md: "13.5px" }}
                        color="rgba(255,255,255,0.85)"
                        lineHeight={{ base: 1.35, md: 1.45 }}
                        maxW="42ch"
                        mt="1"
                    >
                        {data.subtitle}
                    </Text>
                </VStack>

                {/* Faux app screenshots - the full two-card collage on both
                    breakpoints, just scaled down to fit the tighter fixed height
                    on mobile (the scaled wrapper reserves only its shrunk box). */}
                <Box display={{ base: "none", md: "flex" }} flexShrink={0} justifyContent="center">
                    {data.mock}
                </Box>
                <Box
                    display={{ base: "flex", md: "none" }}
                    w="full"
                    h="110px"
                    justifyContent="center"
                    alignItems="flex-start"
                    overflow="visible"
                >
                    <Box transform="scale(0.6)" transformOrigin="top center" flexShrink={0}>
                        {data.mock}
                    </Box>
                </Box>
            </Flex>
        </Box>
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   Home hero carousel - the top slot on the listing page. A swipeable (touch +
   mouse) carousel over the live scoreboard slide and the two promo slides.
   Live content always leads, so the zapisnik-scored live scoreboard (when a
   match is in progress) is never buried behind the promos. While it's present
   the carousel pins to it and never auto-cycles into the promos - manual
   swipe/dots still reach them; with nothing live the two promos auto-advance
   every 5s. Snaps on drag release, shows paging dots. The live/promo slides
   share HERO_MIN_H / flex-fill so paging never reflows the page.
   NOTE - the admin live-stream banner is NOT part of this carousel: when it's
   streaming, the page renders <StreamHero> alone in the hero slot instead of
   mounting this component at all (see the render branch below), so the stream
   is the sole focus with no rotating banners underneath it.
   ────────────────────────────────────────────────────────────────────── */

function HomeHero({ match }: { match: LiveMatch | null }) {
    // Slide order, live content first so a live hero is never buried behind
    // the promos: the zapisnik-scored live scoreboard (when a match is in
    // progress), then the two always-present promo slides.
    const liveSlide = match ? <LiveHero key="live" match={match} /> : null
    const promos = PROMO_SLIDES.map((p) => <PromoHero key={p.kicker} data={p} />)
    const slides = liveSlide ? [liveSlide, ...promos] : promos
    const liveCount = liveSlide ? 1 : 0
    const count = slides.length
    const [idx, setIdx] = useState(0)
    const active = idx % count
    const go = (n: number) => setIdx(((n % count) + count) % count)

    // Autoplay every 5s. With no live content the promos rotate as before. With
    // the live scoreboard present the carousel never rotates into the promos:
    // it just pins to that single live slide. Manual swiping to the promos
    // still works; autoplay simply won't take the viewer there (the guard also
    // stays defensive - there are always the two promos behind).
    const [paused, setPaused] = useState(false)
    useEffect(() => {
        // How many leading slides autoplay may cycle through: only the live
        // one while it's present, otherwise all (promo) slides.
        const cycleLen = liveCount > 0 ? liveCount : count
        if (cycleLen < 2 || paused) return
        const id = setInterval(() => setIdx((i) => (i + 1) % cycleLen), 5000)
        return () => clearInterval(id)
    }, [count, liveCount, paused])

    // Keep the active slide sensible as the live set changes underneath us (a
    // match starts or ends, promos-only <-> live): snap back to the first
    // slide. With live content that pins the hero on the scoreboard slide;
    // with none it just re-seeds the promo rotation. Also clamps away a
    // now-out-of-range index when the slide count shrinks.
    useEffect(() => {
        setIdx(0)
    }, [liveCount])

    // Touch / mouse drag - follow the pointer, then snap to the nearest slide
    // on release. `touch-action: pan-y` lets vertical page scrolling through.
    const viewportRef = useRef<HTMLDivElement>(null)
    const drag = useRef({ active: false, startX: 0, dx: 0, moved: false })
    const [dragX, setDragX] = useState(0)
    const [dragging, setDragging] = useState(false)

    const onPointerDown = (e: React.PointerEvent) => {
        if (count < 2) return
        drag.current = { active: true, startX: e.clientX, dx: 0, moved: false }
        setPaused(true)
    }
    const onPointerMove = (e: React.PointerEvent) => {
        const d = drag.current
        if (!d.active) return
        d.dx = e.clientX - d.startX
        if (!d.moved && Math.abs(d.dx) > 8) {
            d.moved = true
            setDragging(true)
            try { viewportRef.current?.setPointerCapture(e.pointerId) } catch { /* noop */ }
        }
        if (d.moved) setDragX(d.dx)
    }
    const endDrag = (e: React.PointerEvent) => {
        const d = drag.current
        if (!d.active) return
        d.active = false
        const w = viewportRef.current?.offsetWidth ?? 1
        const threshold = Math.min(80, w * 0.2)
        if (d.moved) {
            if (d.dx <= -threshold) go(active + 1)
            else if (d.dx >= threshold) go(active - 1)
        }
        setDragX(0)
        setDragging(false)
        setPaused(false)
        try { viewportRef.current?.releasePointerCapture(e.pointerId) } catch { /* noop */ }
    }
    // Swallow the click that ends a real swipe so the CTA link inside the slide
    // doesn't fire when the user was only swiping.
    const onClickCapture = (e: React.MouseEvent) => {
        if (drag.current.moved) {
            e.preventDefault()
            e.stopPropagation()
            drag.current.moved = false
        }
    }

    return (
        <Box mb="0">
            <Box
                ref={viewportRef}
                position="relative"
                overflow="hidden"
                rounded="2xl"
                css={{ touchAction: "pan-y" }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onClickCapture={onClickCapture}
            >
                <Flex
                    align="stretch"
                    style={{
                        transform: `translate3d(calc(${-active * 100}% + ${dragX}px), 0, 0)`,
                        transition: dragging
                            ? "none"
                            : "transform 600ms cubic-bezier(0.22, 1, 0.36, 1)",
                    }}
                >
                    {slides.map((slide, i) => (
                        <Box key={i} flex="0 0 100%" minW="100%" display="flex" flexDirection="column">
                            {slide}
                        </Box>
                    ))}
                </Flex>
            </Box>

            {/* Dots - only when there's more than the promo to page through. */}
            {count > 1 && (
                <Flex justify="center" align="center" gap="2" mt="3">
                    {slides.map((_, i) => (
                        <Box
                            as="button"
                            key={i}
                            aria-label={`Prikaži slajd ${i + 1}`}
                            onClick={() => go(i)}
                            h="8px"
                            w={i === active ? "22px" : "8px"}
                            rounded="full"
                            bg="accent.goal"
                            opacity={i === active ? 1 : 0.3}
                            transition="width 300ms ease, opacity 300ms ease"
                            cursor="pointer"
                        />
                    ))}
                </Flex>
            )}
        </Box>
    )
}

/* Normalised location string for card display.
 *
 * Geocoded addresses come back from Nominatim as the full reverse-geocode
 * tail - e.g. "Žarovnica, Grad Lepoglava, Varaždinska županija, 42250,
 * Hrvatska". Showing all five segments makes one card look "fuller" than a
 * sibling that only has a city name and creates an inconsistent visual
 * rhythm across the listing grid.
 *
 * Rule: keep the first 1-2 comma segments (venue + city in most cases),
 * drop county / postal code / country. Strip pure numeric segments (postal
 * codes) and the country tail. Final string is then hard-capped to 38
 * characters with an ellipsis - guarantees the row never wraps even at
 * the narrowest mobile viewport (~320px). */
const COUNTRY_TAIL = new Set([
    "hrvatska",
    "croatia",
    "bosna i hercegovina",
    "bih",
    "slovenija",
    "slovenia",
    "srbija",
    "serbia",
    "crna gora",
    "montenegro",
])
function shortLocation(loc: string | null | undefined): string {
    if (!loc) return ""
    const parts = loc
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        // Drop postal codes (pure digits, possibly with spaces) and the
        // country tail; both are noise on a card.
        .filter((p) => !/^\d[\d\s]*$/.test(p))
        .filter((p) => !COUNTRY_TAIL.has(p.toLowerCase()))
    if (parts.length === 0) return loc.trim()
    // Take first two meaningful segments - typically "Venue, City" or
    // just "City". A third "County" segment is dropped so cards stay
    // visually balanced.
    const head = parts.slice(0, 2).join(", ")
    // Hard char cap as a safety net for unusually long venue names.
    return head.length > 38 ? head.slice(0, 36).trimEnd() + "…" : head
}

/* ──────────────────────────────────────────────────────────────────────────
   Tournament card - full Pitch redesign with overlay date stamp, status
   badge, capacity progress bar and pitch-tinted "Detalji →" pill.
   ────────────────────────────────────────────────────────────────────── */
function TournamentCardView({
    t,
    variant,
    priority = false,
}: {
    t: TournamentCardWithUuid
    variant: "upcoming" | "finished"
    /** True for the first (above-the-fold, likely-LCP) card - its poster
     *  loads eagerly with fetchpriority=high; the rest lazy-load. */
    priority?: boolean
}) {
    const ds = decomposeDate(t.startAt)
    const status = classifyStatus(t, variant)
    // Fill ratio for the popunjenost bar. With a real cap it's the actual
    // ratio; with no cap (unlimited, shown as "x/∞") we SIMULATE progress with
    // an asymptotic curve n/(n+5) - grows with each signup, never reaches
    // full (an unlimited tournament can't be "full").
    const reg = typeof t.registeredTeams === "number" ? t.registeredTeams : 0
    const fill =
        typeof t.maxTeams === "number" && t.maxTeams > 0
            ? Math.min(1, reg / t.maxTeams)
            : reg > 0
                ? reg / (reg + 5)
                : 0
    const accent =
        status.status === "live"
            ? "accent.red"
            : status.status === "soon"
                ? "accent.amber"
                : status.status === "full"
                    ? "fg.muted"
                    : status.status === "finished"
                        ? "fg.muted"
                        : "pitch.400"
    const price = fmtEuro(t.entryPrice)
    const prize = fmtEuro(t.prizeTotal)
    const winner = (t.winnerName ?? "").trim()
    const prefetch = useTournamentPrefetch()
    const warm = () => prefetch(t.slug ?? t.uuid)

    return (
        <RouterLink
            to={`/turniri/${t.slug ?? t.uuid}`}
            onMouseEnter={warm}
            onPointerDown={warm}
            style={{ textDecoration: "none", color: "inherit", display: "block", height: "100%" }}
        >
            <Box
                bg="bg.panel"
                rounded="xl"
                overflow="hidden"
                borderWidth="1px"
                borderColor="border"
                borderStyle={t.hidden ? "dashed" : "solid"}
                h="full"
                display="flex"
                flexDirection="column"
                transition="transform .15s, box-shadow .15s"
                _hover={{ transform: "translateY(-2px)", shadow: "md" }}
                cursor="pointer"
                // Admin-hidden tournament (only its creator/admin receive it):
                // greyed-out + dashed border so it visibly differs from public.
                // A FINISHED tournament is desaturated too (lighter than hidden)
                // so a spectator instantly reads it as "over" in the list.
                css={
                    t.hidden
                        ? { filter: "grayscale(0.7)", opacity: 0.75 }
                        : status.status === "finished"
                            ? { filter: "grayscale(0.6)", opacity: 0.82 }
                            : undefined
                }
            >
                {/* Poster area - shorter on mobile so the card stays compact
                     and the body remains the focus. */}
                <Box position="relative" h={{ base: "140px", md: "180px" }}>
                    <TournamentPoster
                        name={t.name}
                        bannerUrl={t.bannerUrl}
                        height="100%"
                        seed={t.uuid}
                        priority={priority}
                    />
                    <Box position="absolute" top="3" left="3">
                        {ds ? <DateStamp day={ds.day} dayNum={ds.dayNum} month={ds.month} /> : null}
                    </Box>
                    <Box position="absolute" top="3" right="3">
                        <StatusChip status={status.status} label={status.label} />
                    </Box>
                    {t.hidden && (
                        <Box
                            position="absolute"
                            bottom="3"
                            left="3"
                            bg="rgba(0,0,0,0.65)"
                            color="white"
                            px="2.5"
                            py="1"
                            rounded="full"
                            fontFamily="mono"
                            fontSize="10px"
                            fontWeight={800}
                            letterSpacing="0.1em"
                        >
                            🔒 SKRIVENO
                        </Box>
                    )}
                    {ds ? (
                        <Flex
                            position="absolute"
                            bottom="3"
                            right="3"
                            bg="rgba(0,0,0,0.55)"
                            color="white"
                            px="2.5"
                            py="1"
                            rounded="md"
                            align="center"
                            gap="1.5"
                            css={{ backdropFilter: "blur(8px)" }}
                        >
                            <FiClock size={12} />
                            <Box fontFamily="mono" fontSize="14px" fontWeight={700} letterSpacing="-0.02em">
                                {ds.time}
                            </Box>
                        </Flex>
                    ) : null}
                </Box>

                {/* Body - flex column with FIXED-HEIGHT title and location
                     rows so every card in a grid row has identical body
                     dimensions regardless of content length. The progress
                     block flows naturally and the footer is pinned to the
                     bottom via `mt="auto"`. A long Croatian address ("…,
                     Varaždinska županija, 42250, Hrvatska") truncates with
                     ellipsis instead of wrapping and stretching the card. */}
                <VStack
                    align="stretch"
                    gap="3"
                    p="4"
                    flex="1"
                    minW="0"
                >
                    {/* Title + location bundled - fixed heights so a
                         one-line name and a two-line name both occupy the
                         same vertical space, and a long address truncates
                         to one line with ellipsis instead of wrapping. */}
                    <Box minW="0">
                        <Heading
                            as="h3"
                            fontSize="17px"
                            fontWeight={700}
                            color="fg.ink"
                            letterSpacing="-0.01em"
                            lineHeight={1.25}
                            m="0"
                            css={{
                                display: "-webkit-box",
                                WebkitBoxOrient: "vertical",
                                WebkitLineClamp: 2,
                                overflow: "hidden",
                                wordBreak: "break-word",
                                // Lock to exactly two line-heights - one-line
                                // and two-line titles take identical space.
                                height: "calc(2 * 17px * 1.25)",
                            }}
                        >
                            {t.name}
                        </Heading>
                        <Box
                            mt="1"
                            h="20px"
                            display="flex"
                            alignItems="center"
                            gap="1"
                            color="fg.muted"
                            fontSize="13px"
                            minW="0"
                            overflow="hidden"
                        >
                            {t.location ? (
                                <>
                                    <Box flexShrink={0} display="inline-flex">
                                        <FiMapPin size={12} />
                                    </Box>
                                    <Box
                                        flex="1"
                                        minW="0"
                                        title={t.location}
                                        css={{
                                            whiteSpace: "nowrap",
                                            overflow: "hidden",
                                            textOverflow: "ellipsis",
                                        }}
                                    >
                                        {shortLocation(t.location)}
                                    </Box>
                                </>
                            ) : null}
                        </Box>
                    </Box>

                    {variant === "finished" && winner ? (
                        <HStack gap="2" align="center">
                            <Box
                                fontFamily="mono"
                                fontSize="10px"
                                color="fg.muted"
                                letterSpacing="0.1em"
                                fontWeight={700}
                            >
                                POBJEDNIK
                            </Box>
                            <Box
                                bg="rgba(245,185,33,0.15)"
                                color="accent.amber"
                                px="2"
                                py="0.5"
                                rounded="full"
                                fontSize="12px"
                                fontWeight={700}
                            >
                                {winner}
                            </Box>
                        </HStack>
                    ) : (
                        <Box>
                            <Flex justify="space-between" align="baseline" mb="1.5">
                                <Text fontSize="12px" color="fg.muted" fontWeight={500}>
                                    Popunjenost
                                </Text>
                                <Box fontFamily="mono" fontSize="12px" fontWeight={700} color="fg.ink">
                                    {/* No cap → "x/∞"; the bar below simulates progress. */}
                                    {t.registeredTeams ?? 0} / {typeof t.maxTeams === "number" ? t.maxTeams : "∞"}
                                </Box>
                            </Flex>
                            <Box h="6px" bg="bg.surfaceTint" rounded="full" overflow="hidden">
                                <Box
                                    h="100%"
                                    w={`${fill * 100}%`}
                                    rounded="full"
                                    bgImage={`linear-gradient(90deg, var(--chakra-colors-pitch-400), var(--chakra-colors-${
                                        accent === "accent.red"
                                            ? "accent-red"
                                            : accent === "accent.amber"
                                                ? "accent-amber"
                                                : accent === "fg.muted"
                                                    ? "ink-mute"
                                                    : "pitch-400"
                                    }))`}
                                />
                            </Box>
                        </Box>
                    )}

                    <Flex
                        align="center"
                        pt="3"
                        borderTopWidth="1px"
                        borderColor="border"
                        mt="auto"
                    >
                        {/* Kotizacija + ukupna nagrada on one row, separated by a
                            "/". The whole card is a link, so there's no separate
                            "Detalji" button - a tap anywhere opens the details. */}
                        <HStack gap="2" align="baseline" wrap="wrap" minW="0">
                            <HStack gap="1.5" color="pitch.500" fontWeight={700} fontSize="16px" align="baseline">
                                {price ? (
                                    <>
                                        <Box>{price}</Box>
                                        <Box fontSize="11px" color="fg.muted" fontWeight={500}>
                                            kotizacija
                                        </Box>
                                    </>
                                ) : (
                                    <Box fontSize="13px" color="fg.muted" fontWeight={500}>
                                        Besplatan ulaz
                                    </Box>
                                )}
                            </HStack>
                            {variant === "upcoming" && prize && (
                                <>
                                    <Box as="span" color="fg.subtle" fontSize="14px" fontWeight={500}>
                                        /
                                    </Box>
                                    <HStack gap="1.5" color="accent.amber" fontWeight={700} fontSize="16px" align="baseline">
                                        <Box>{prize}</Box>
                                        <Box fontSize="11px" color="fg.muted" fontWeight={500}>
                                            ukupna nagrada
                                        </Box>
                                    </HStack>
                                </>
                            )}
                        </HStack>
                    </Flex>
                </VStack>
            </Box>
        </RouterLink>
    )
}

/** Skeleton matching the card shape. */
function CardSkeleton() {
    return (
        <Box bg="bg.panel" borderWidth="1px" borderColor="border" rounded="xl" overflow="hidden">
            <Skeleton h="180px" />
            <VStack align="stretch" gap="2" p="4">
                <Skeleton h="4" w="70%" />
                <Skeleton h="3" w="50%" />
                <Skeleton h="2" w="100%" mt="2" />
            </VStack>
        </Box>
    )
}

/** Dashed-border empty state with the pitch backdrop, used both for filtered
 *  empty results and for the "Završeni turniri" empty case. */
function EmptyState({
    title,
    description,
    cta,
    withBackdrop = true,
}: {
    title: string
    description?: string
    cta?: React.ReactNode
    withBackdrop?: boolean
}) {
    return (
        <Box
            position="relative"
            overflow="hidden"
            bg="bg.panel"
            borderStyle="dashed"
            borderWidth="1px"
            borderColor="border"
            rounded="xl"
            py="12"
            px="6"
            textAlign="center"
        >
            {withBackdrop ? (
                <Box position="absolute" inset="0" opacity={0.04} pointerEvents="none">
                    <PitchBackdrop opacity={1} />
                </Box>
            ) : null}
            <Box position="relative">
                <Flex
                    display="inline-flex"
                    align="center"
                    justify="center"
                    w="56px"
                    h="56px"
                    rounded="full"
                    bg="bg.surfaceTint"
                    color="pitch.500"
                    mx="auto"
                    mb="3"
                >
                    <FiCalendar size={22} />
                </Flex>
                <Heading size="md" color="fg.ink">
                    {title}
                </Heading>
                {description ? (
                    <Text color="fg.muted" fontSize="sm" mt="1" maxW="md" mx="auto">
                        {description}
                    </Text>
                ) : null}
                {cta ? <Box mt="3">{cta}</Box> : null}
            </Box>
        </Box>
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   List view (by month) - moved here from /uzivo. Renders the upcoming
   tournaments as compact rows grouped first by month, then by day. The
   grid view stays the default; this is the alternate, calendar-style read.
   ────────────────────────────────────────────────────────────────────── */

const HR_MONTHS_NOM = [
    "Siječanj", "Veljača", "Ožujak", "Travanj", "Svibanj", "Lipanj",
    "Srpanj", "Kolovoz", "Rujan", "Listopad", "Studeni", "Prosinac",
]
const HR_MONTHS_GEN = [
    "siječnja", "veljače", "ožujka", "travnja", "svibnja", "lipnja",
    "srpnja", "kolovoza", "rujna", "listopada", "studenoga", "prosinca",
]
const HR_WEEKDAYS = [
    "Nedjelja", "Ponedjeljak", "Utorak", "Srijeda", "Četvrtak", "Petak", "Subota",
]
function pad2(n: number): string {
    return String(n).padStart(2, "0")
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
    return `${HR_WEEKDAYS[d.getDay()]}, ${d.getDate()}. ${HR_MONTHS_GEN[d.getMonth()]}`
}
function timeLabel(iso?: string | null): string {
    if (!iso) return "-"
    return new Intl.DateTimeFormat("hr-HR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
}

type MonthGroup = {
    key: string
    label: string
    sort: number
    days: { key: string; date: Date; items: TournamentCard[] }[]
}

/** Group a flat upcoming-tournament list into month → day buckets,
 *  chronological throughout. Tournaments without a start date are dropped
 *  (they can't be placed on a calendar). */
function groupByMonth(items: TournamentCard[]): MonthGroup[] {
    const months = new Map<string, MonthGroup>()
    for (const t of items) {
        if (!t.startAt) continue
        const d = new Date(t.startAt)
        const mKey = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
        let mg = months.get(mKey)
        if (!mg) {
            mg = {
                key: mKey,
                label: `${HR_MONTHS_NOM[d.getMonth()]} ${d.getFullYear()}`,
                sort: d.getFullYear() * 12 + d.getMonth(),
                days: [],
            }
            months.set(mKey, mg)
        }
        const dKey = `${mKey}-${pad2(d.getDate())}`
        let day = mg.days.find((x) => x.key === dKey)
        if (!day) {
            day = { key: dKey, date: d, items: [] }
            mg.days.push(day)
        }
        day.items.push(t)
    }
    const out = [...months.values()].sort((a, b) => a.sort - b.sort)
    for (const m of out) {
        m.days.sort((a, b) => a.date.getTime() - b.date.getTime())
        for (const day of m.days) {
            day.items.sort((a, b) => {
                const ta = a.startAt ? new Date(a.startAt).getTime() : 0
                const tb = b.startAt ? new Date(b.startAt).getTime() : 0
                return ta - tb
            })
        }
    }
    return out
}

/** A single tournament row in the list view. */
function ListRow({ t }: { t: TournamentCard }) {
    const prefetch = useTournamentPrefetch()
    const warm = () => prefetch(t.slug ?? t.uuid)
    return (
        <RouterLink
            to={`/turniri/${t.slug ?? t.uuid}`}
            onMouseEnter={warm}
            onPointerDown={warm}
            style={{ textDecoration: "none" }}
        >
            <Flex
                align="center"
                gap="3"
                px="3"
                py="2.5"
                rounded="lg"
                borderWidth="1px"
                borderColor="border"
                borderStyle={t.hidden ? "dashed" : "solid"}
                bg="bg.panel"
                transition="background 0.15s"
                _hover={{ bg: "bg.surfaceTint" }}
                // Admin-hidden - greyed out, visible only to creator/admin.
                css={t.hidden ? { filter: "grayscale(0.7)", opacity: 0.75 } : undefined}
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
                    <Text fontFamily="mono" fontSize="sm" fontWeight={800} lineHeight="1.1">
                        {timeLabel(t.startAt)}
                    </Text>
                </Flex>
                <Box flex="1" minW="0">
                    <HStack gap="1.5" minW="0">
                        <Text fontSize="sm" fontWeight={600} truncate color="fg.ink">
                            {t.name}
                        </Text>
                        {t.hidden && (
                            <Box
                                as="span"
                                flexShrink={0}
                                px="1.5"
                                py="0.5"
                                rounded="sm"
                                bg="bg.muted"
                                color="fg.muted"
                                fontFamily="mono"
                                fontSize="9px"
                                fontWeight={800}
                                letterSpacing="0.08em"
                            >
                                🔒 SKRIVEN
                            </Box>
                        )}
                    </HStack>
                    <HStack gap="1" mt="0.5" color="fg.muted">
                        {t.location ? (
                            <>
                                <FiMapPin size={11} />
                                <Text fontSize="xs" truncate>{t.location}</Text>
                            </>
                        ) : (
                            <>
                                <FiClock size={11} />
                                <Text fontSize="xs">Lokacija nije navedena</Text>
                            </>
                        )}
                    </HStack>
                </Box>
                <Box as="span" color="fg.muted" flexShrink={0}>
                    <FiChevronRight />
                </Box>
            </Flex>
        </RouterLink>
    )
}

/** Segmented-control button for the grid/list view switcher. */
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
            // The text label is hidden on phones (icon-only) - without an
            // aria-label the button has NO accessible name there (PSI
            // "button-name" fail). Set it always; harmless on desktop.
            aria-label={label}
            aria-pressed={active}
            display="inline-flex"
            alignItems="center"
            gap="1.5"
            px="3"
            py="1.5"
            rounded="full"
            fontSize="12px"
            fontWeight={700}
            cursor="pointer"
            bg={active ? "pitch.500" : "transparent"}
            color={active ? "white" : "fg.muted"}
            transition="background 150ms"
            _hover={active ? undefined : { color: "fg.ink" }}
        >
            {icon}
            <Box as="span" display={{ base: "none", sm: "inline" }}>{label}</Box>
        </Box>
    )
}

/** Month-grouped calendar list of tournaments. Ascending by default (upcoming);
 *  pass `desc` for most-recent-first (the finished archive). */
function MonthList({ items, desc = false }: { items: TournamentCard[]; desc?: boolean }) {
    const today = useMemo(() => new Date(), [])
    const groups = useMemo(() => {
        const g = groupByMonth(items)
        if (!desc) return g
        return [...g].reverse().map((m) => ({ ...m, days: [...m.days].reverse() }))
    }, [items, desc])

    if (groups.length === 0) {
        return (
            <Text fontSize="sm" color="fg.muted" textAlign="center" py="4">
                Nijedan turnir ne odgovara odabranim filterima.
            </Text>
        )
    }

    return (
        <VStack align="stretch" gap="6">
            {groups.map((m) => (
                <Box key={m.key}>
                    <Flex align="center" gap="3" mb="3">
                        <Heading
                            fontFamily="heading"
                            fontSize="18px"
                            fontWeight={700}
                            letterSpacing="-0.02em"
                            color="fg.ink"
                        >
                            {m.label}
                        </Heading>
                        <Box flex="1" h="1px" bg="border" />
                        <Text fontFamily="mono" fontSize="11px" fontWeight={700} color="pitch.500" letterSpacing="0.05em">
                            {m.days.reduce((s, d) => s + d.items.length, 0)}
                        </Text>
                    </Flex>
                    <VStack align="stretch" gap="4">
                        {m.days.map((day) => (
                            <Box key={day.key}>
                                <MonoLabel color="pitch.500">
                                    {dayHeading(day.date, today)}
                                </MonoLabel>
                                <VStack align="stretch" gap="1.5" mt="2">
                                    {day.items.map((t) => (
                                        <ListRow key={t.uuid} t={t} />
                                    ))}
                                </VStack>
                            </Box>
                        ))}
                    </VStack>
                </Box>
            ))}
        </VStack>
    )
}

/* ────────────────────────────────────────────────────────────────── page ── */
const FINISHED_PREVIEW_LIMIT = 6
const RADIUS_MAX_KM = 100

/* ── Sort options ──────────────────────────────────────────────────────────
   Driven by the toolbar's "Sortiraj" menu. Each entry has:
     - key:   internal id (also persisted to localStorage if we add it later)
     - label: Croatian copy shown in the menu + in the active button label
     - cmp:   pure comparator on TournamentCardWithUuid pairs

   Comparator helpers normalise missing values: a tournament without a date
   sorts to the END of any date-based ordering, a missing entryPrice sorts to
   the END of the cheapest-first ordering, and so on - the user shouldn't
   see "unknown" rows interleaved with sorted ones.
   ────────────────────────────────────────────────────────────────── */
type SortMode = "date_asc" | "date_desc" | "price_asc" | "popular" | "name_asc"
const SORT_OPTIONS: Array<{ key: SortMode; label: string; description: string }> = [
    { key: "date_asc", label: "Najraniji prvi", description: "Datum početka, najbliži prvi" },
    { key: "date_desc", label: "Najkasniji prvi", description: "Datum početka, najudaljeniji prvi" },
    { key: "price_asc", label: "Najjeftiniji", description: "Kotizacija od najniže" },
    { key: "popular", label: "Najpopularniji", description: "Najviše prijavljenih ekipa" },
    { key: "name_asc", label: "Po imenu A-Ž", description: "Abecedno po imenu turnira" },
]
function sortTournaments(
    list: TournamentCardWithUuid[],
    mode: SortMode,
): TournamentCardWithUuid[] {
    // Always operate on a copy - the `filtered` array comes straight from a
    // .filter() and mutating it would also mutate the upstream state-derived
    // memo on re-render.
    const arr = [...list]
    const dateOf = (t: TournamentCardWithUuid): number =>
        t.startAt ? new Date(t.startAt).getTime() : Number.POSITIVE_INFINITY
    const fillRatio = (t: TournamentCardWithUuid): number => {
        if (typeof t.registeredTeams !== "number" || typeof t.maxTeams !== "number" || t.maxTeams <= 0) {
            return -1 // unknowns sort last under desc
        }
        return t.registeredTeams / t.maxTeams
    }
    switch (mode) {
        case "date_asc":
            return arr.sort((a, b) => dateOf(a) - dateOf(b))
        case "date_desc":
            return arr.sort((a, b) => dateOf(b) - dateOf(a))
        case "price_asc":
            return arr.sort((a, b) => {
                const ap = typeof a.entryPrice === "number" ? a.entryPrice : Number.POSITIVE_INFINITY
                const bp = typeof b.entryPrice === "number" ? b.entryPrice : Number.POSITIVE_INFINITY
                if (ap !== bp) return ap - bp
                return dateOf(a) - dateOf(b)
            })
        case "popular":
            return arr.sort((a, b) => {
                const diff = fillRatio(b) - fillRatio(a)
                if (diff !== 0) return diff
                return dateOf(a) - dateOf(b)
            })
        case "name_asc":
            return arr.sort((a, b) =>
                a.name.localeCompare(b.name, "hr", { sensitivity: "base" }),
            )
    }
}

export default function TournamentsPage() {
    useDocumentHead({
        title: "Futsal turniri u Hrvatskoj - futsal-turniri.com",
        description:
            "Pregled svih nadolazećih i odigranih Futsal turnira u Hrvatskoj i regiji. Pretraži po lokaciji, datumu i cijeni.",
        ogTitle: "Futsal turniri u Hrvatskoj",
        ogDescription:
            "Pregled svih nadolazećih i odigranih Futsal turnira u Hrvatskoj i regiji.",
        ogType: "website",
        canonical: "https://futsal-turniri.com/turniri",
    })

    const queryClient = useQueryClient()
    // Seed the upcoming list from the react-query cache so returning to this
    // page within the stale window (30 s) paints INSTANTLY - no skeleton, no
    // refetch. First-ever visit has no cache → normal loading spinner.
    const cachedUpcoming = queryClient.getQueryData<TournamentCardWithUuid[]>(qk.tournamentsUpcoming)
    const cachedFinished = queryClient.getQueryData<TournamentCardWithUuid[]>(qk.tournamentsFinishedFirst)
    const cachedFinishedTotal = queryClient.getQueryData<number>(qk.tournamentsFinishedCount)
    const [loading, setLoading] = useState(!cachedUpcoming)
    const [error, setError] = useState<string | null>(null)
    const [loadingFinished, setLoadingFinished] = useState(!cachedFinished)
    const [errorFinished, setErrorFinished] = useState<string | null>(null)

    const [upcoming, setUpcoming] = useState<TournamentCardWithUuid[]>(cachedUpcoming ?? [])
    const [finished, setFinished] = useState<TournamentCardWithUuid[]>(cachedFinished ?? [])
    const [finishedTotal, setFinishedTotal] = useState(cachedFinishedTotal ?? 0)
    const [loadingMoreFinished, setLoadingMoreFinished] = useState(false)
    // Seed the live list from the shared cache (warmed by the nav-bar live
    // badge, /uzivo, and the tournament detail page) so on a return visit the
    // hero paints together with the (also-cached) list instead of popping in a
    // beat later after its own network round-trip. The featured-match hero is
    // derived from it; when a stream is linked to a tournament we instead pick
    // that tournament's live match (see streamMatch below).
    const [liveList, setLiveList] = useState<LiveMatch[]>(
        () => queryClient.getQueryData<LiveMatch[]>(qk.liveMatches) ?? [],
    )
    const liveTop = useMemo(() => pickFeaturedFirst(liveList)[0] ?? null, [liveList])

    // ---- Search + filters ----
    const [filtersOpen, setFiltersOpen] = useState(false)
    // Upcoming-section view mode: "grid" (cards, default) or "list"
    // (compact rows grouped by month - the calendar moved here from /uzivo).
    const [upcomingView, setUpcomingView] = useState<"grid" | "list">("grid")
    const [sortMode, setSortMode] = useState<SortMode>("date_asc")
    const [search, setSearch] = useState("")
    const [locationFilter, setLocationFilter] = useState("")
    const [priceMin, setPriceMin] = useState("")
    const [priceMax, setPriceMax] = useState("")
    const [prizeMin, setPrizeMin] = useState("")
    const [prizeMax, setPrizeMax] = useState("")
    const [radiusKm, setRadiusKm] = useState<number>(RADIUS_MAX_KM)

    const { pos: userPos, status: geoStatus, request: requestLocation } = useUserLocation()

    const sanitizeNum = (s: string) => s.replace(/[^\d.,]/g, "").replace(",", ".")
    const parseNum = (s: string): number | null => {
        if (!s.trim()) return null
        const n = parseFloat(s)
        return Number.isFinite(n) ? n : null
    }
    const activeFilterCount =
        (locationFilter.trim() ? 1 : 0) +
        (priceMin.trim() ? 1 : 0) +
        (priceMax.trim() ? 1 : 0) +
        (prizeMin.trim() ? 1 : 0) +
        (prizeMax.trim() ? 1 : 0) +
        (userPos && radiusKm < RADIUS_MAX_KM ? 1 : 0)
    const resetFilters = () => {
        setSearch("")
        setLocationFilter("")
        setPriceMin("")
        setPriceMax("")
        setPrizeMin("")
        setPrizeMax("")
        setRadiusKm(RADIUS_MAX_KM)
    }

    // Featured live match shown in the home hero. Promote a match from the
    // admin-featured tournament when one is live; otherwise the first live
    // match. `pickFeaturedFirst` sorts: featured-tournament matches first
    // (most recently featured wins on ties), then by liveStartedAt asc.
    const loadLive = useCallback(async () => {
        try {
            const live = await fetchLiveMatches()
            // Share the full live list with the /uzivo page's cache so opening
            // it from here paints instantly.
            queryClient.setQueryData(qk.liveMatches, live)
            setLiveList(live)
        } catch {
            /* keep the last value; the poll / socket will retry */
        }
    }, [queryClient])

    // Keep the hero current: poll while the tab is visible, and refetch the
    // instant the backend pushes a live change (goal, finish, …) so a goal
    // shows on the home hero immediately instead of on the next reload.
    usePolling(loadLive, 15_000)
    useLiveSocket(() => { void loadLive() })

    // ── Site-wide live-stream banner (Veo camera) ── admin-controlled.
    // While switched on, the video player takes over the whole hero slot
    // (promo slides + the live scoreboard). Polled while the tab is visible
    // (and re-checked on focus) so flipping the switch in the dashboard
    // shows/hides the banner within seconds - the endpoint itself is
    // Cache-Control: no-store, so no browser/SW copy can ever go stale.
    // Seed from the synchronous localStorage hint so a reload paints the right
    // hero (stream / paused / promo) on the FIRST frame instead of flashing the
    // green promo hero while the (no-store, polled) banner fetch resolves.
    const [streamBanner, setStreamBanner] = useState<StreamBanner | null>(
        () => readStreamBannerHint(),
    )
    usePolling(() => {
        fetchStreamBanner()
            .then((b) => {
                writeStreamBannerHint(b)
                setStreamBanner(b)
            })
            .catch(() => { /* keep last state; next tick retries */ })
        // Poll fast while streaming so an admin-toggled overlay (halftime
        // graphic…) appears within a few seconds; slow otherwise.
    }, streamBanner?.state === "STREAMING" && !!streamBanner?.url ? 7_000 : 30_000)
    // The banner's mode drives what the home hero slot renders. Fall back to
    // the legacy live/url shape for a stale first-paint hint without `state`.
    const streamState =
        streamBanner?.state ?? (streamBanner?.live ? "STREAMING" : streamBanner?.url ? "PAUSED" : "OFF")
    const streamBannerLive = streamState === "STREAMING" && !!streamBanner?.url
    // Admin-toggled media drawn centred over the video (halftime graphic, etc.).
    const streamOverlay = buildStreamOverlay(streamBanner?.overlayUrl, streamBanner?.overlayMediaType)
    // "How many people are watching" - heartbeats while the stream is on.
    const streamViewers = useStreamPresence(streamBannerLive)

    // Which live match drives the stream hero's side panels (tijek utakmice +
    // group table). When the stream is linked to a tournament, follow THAT
    // tournament's live match (null when it isn't playing anything right now -
    // the panels then show their empty state while the video keeps playing).
    // Unlinked, fall back to the globally-featured live match.
    const streamMatch = useMemo(() => {
        const linked = streamBanner?.tournamentUuid
        if (!linked) return liveTop
        const inTournament = liveList.filter((m) => m.tournamentUuid === linked)
        return pickFeaturedFirst(inTournament)[0] ?? null
    }, [streamBanner?.tournamentUuid, liveList, liveTop])

    // The globally-featured live match, shown as its own scoreboard slide in the
    // home hero carousel. Suppressed when the stream slide is already featuring
    // that same game, so one match never appears twice (once as the stream,
    // once as a scoreboard).
    const liveHeroMatch =
        streamBannerLive && liveTop && liveTop.matchId === streamMatch?.matchId ? null : liveTop

    // "Turnir mode" - opens the immersive, SHAREABLE live-stream page for the
    // streamed tournament at its own URL (/turniri/{slug}/uzivo) instead of an
    // in-place overlay, so the link can be sent to spectators.
    const navigate = useNavigate()
    const enterTheater = () => {
        const dest = streamMatch?.tournamentSlug ?? streamBanner?.tournamentUuid
        if (dest) navigate(`/turniri/${dest}/uzivo`)
    }

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                // Spinners only on a cold load; cache hits are already painted.
                if (!queryClient.getQueryData(qk.tournamentsUpcoming)) setLoading(true)
                setError(null)
                if (!queryClient.getQueryData(qk.tournamentsFinishedFirst)) setLoadingFinished(true)
                setErrorFinished(null)
                const [dataUpcoming, dataFinishedPage, finishedTotalCount] = await Promise.all([
                    // Cache-aware: returns the cached list instantly when fresh
                    // (< staleTime) and dedupes with any in-flight prefetch;
                    // otherwise fetches once and populates the cache.
                    queryClient.fetchQuery({
                        queryKey: qk.tournamentsUpcoming,
                        queryFn: () => fetchTournaments("upcoming"),
                        staleTime: 30_000,
                    }),
                    queryClient.fetchQuery({
                        queryKey: qk.tournamentsFinishedFirst,
                        queryFn: () => fetchTournaments("finished", { offset: 0, limit: FINISHED_PREVIEW_LIMIT }),
                        staleTime: 30_000,
                    }),
                    queryClient.fetchQuery({
                        queryKey: qk.tournamentsFinishedCount,
                        queryFn: () => fetchTournamentsCount("finished"),
                        staleTime: 30_000,
                    }),
                ])
                if (!cancelled) {
                    setUpcoming(dataUpcoming as TournamentCardWithUuid[])
                    setFinished(dataFinishedPage as TournamentCardWithUuid[])
                    setFinishedTotal(finishedTotalCount)
                }
            } catch (e: any) {
                if (!cancelled) {
                    setError(e?.message ?? "Failed to load tournaments")
                    setErrorFinished(e?.message ?? "Failed to load finished tournaments")
                    setUpcoming([])
                    setFinished([])
                    setFinishedTotal(0)
                }
            } finally {
                if (!cancelled) {
                    setLoading(false)
                    setLoadingFinished(false)
                }
            }
        })()
        return () => {
            cancelled = true
        }
    }, [])

    async function loadMoreFinished() {
        if (loadingMoreFinished) return
        if (finished.length >= finishedTotal) return
        setLoadingMoreFinished(true)
        try {
            const next = await fetchTournaments("finished", {
                offset: finished.length,
                limit: FINISHED_PREVIEW_LIMIT,
            })
            setFinished((prev) => [...prev, ...(next as TournamentCardWithUuid[])])
        } catch {
            /* toast surfaces error */
        } finally {
            setLoadingMoreFinished(false)
        }
    }

    const finishedHasMore = finished.length < finishedTotal

    const filteredUpcoming = useMemo(() => {
        const q = search.trim().toLowerCase()
        const loc = locationFilter.trim().toLowerCase()
        const min = parseNum(priceMin)
        const max = parseNum(priceMax)
        const pMin = parseNum(prizeMin)
        const pMax = parseNum(prizeMax)
        const me = userPos ? { lat: userPos[0], lng: userPos[1] } : null
        const filtered = upcoming.filter((t) => {
            if (q && !t.name.toLowerCase().includes(q)) return false
            if (loc && !(t.location ?? "").toLowerCase().includes(loc)) return false
            if (typeof t.entryPrice === "number") {
                if (min != null && t.entryPrice < min) return false
                if (max != null && t.entryPrice > max) return false
            } else if (min != null || max != null) {
                return false
            }
            // Total prize fund - same missing-value convention as kotizacija:
            // a tournament without a prize fund only survives when neither
            // bound is set.
            if (typeof t.prizeTotal === "number") {
                if (pMin != null && t.prizeTotal < pMin) return false
                if (pMax != null && t.prizeTotal > pMax) return false
            } else if (pMin != null || pMax != null) {
                return false
            }
            if (me && radiusKm < RADIUS_MAX_KM) {
                if (typeof t.latitude !== "number" || typeof t.longitude !== "number") return false
                if (haversineKm(me, { lat: t.latitude, lng: t.longitude }) > radiusKm) return false
            }
            return true
        })
        const sorted = sortTournaments(filtered, sortMode)
        // A featured tournament always comes first, then live ones, then the
        // rest - preserving the chosen sort within each group (stable sort).
        const rank = (t: TournamentCardWithUuid) => (t.featuredAt ? 2 : t.liveMatch ? 1 : 0)
        return [...sorted].sort((a, b) => rank(b) - rank(a))
    }, [upcoming, search, locationFilter, priceMin, priceMax, prizeMin, prizeMax, userPos, radiusKm, sortMode])

    const isFiltering = search.trim().length > 0 || activeFilterCount > 0

    const gridCols = { base: "1fr", md: "1fr 1fr", lg: "repeat(3, 1fr)" }

    return (
        <VStack align="stretch" gap="4">
            <HelpFab />
            {/* Stream mode drives the hero slot: STREAMING → the video hero
                takes over the ENTIRE slot alone - no carousel, no promo
                slides, no live-scoreboard slide (the stream panel already
                shows the match timeline itself); ADS → sponsor banner; PAUSED
                → "pauziran" placeholder - these also take over the whole slot.
                OFF (nothing live to stream) → the normal promo/live carousel,
                which still pins to a live scoreboard match and never
                auto-cycles into the promo banners (ordering/pinning live in
                HomeHero). */}
            {streamState === "ADS" ? (
                <StreamPausedBanner
                    mode="ads"
                    adUrl={streamBanner?.adUrl ?? null}
                    adMediaType={streamBanner?.adMediaType ?? null}
                />
            ) : streamState === "PAUSED" ? (
                <StreamPausedBanner mode="paused" />
            ) : streamBannerLive ? (
                <StreamHero
                    url={streamBanner!.url!}
                    match={streamMatch}
                    tournamentName={streamBanner?.tournamentName ?? streamMatch?.tournamentName ?? null}
                    tournamentUuid={streamBanner?.tournamentUuid ?? streamMatch?.tournamentUuid ?? null}
                    viewers={streamViewers}
                    onEnterTheater={enterTheater}
                    centerOverlay={streamOverlay}
                />
            ) : (
                <HomeHero match={liveHeroMatch} />
            )}

            {/* ── Toolbar ─────────────────────────────────────────────────── */}
            <Box>
                <Stack direction={{ base: "column", md: "row" }} gap="3" align="stretch">
                    {/* Search */}
                    <Box position="relative" flex="1" minW={{ base: "100%", md: "260px" }}>
                        <Box
                            position="absolute"
                            left="4"
                            top="50%"
                            color="fg.muted"
                            pointerEvents="none"
                            css={{ transform: "translateY(-50%)" }}
                        >
                            <FiSearch />
                        </Box>
                        <Input
                            pl="10"
                            pr={search ? "16" : "4"}
                            h="46px"
                            bg="bg.panel"
                            borderColor="border"
                            rounded="lg"
                            placeholder="Pretraži po imenu turnira, gradu ili dvorani…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        <Box
                            position="absolute"
                            right="3"
                            top="50%"
                            display={{ base: "none", md: "block" }}
                            css={{ transform: "translateY(-50%)" }}
                        >
                            {search ? (
                                <IconButton
                                    aria-label="Očisti pretragu"
                                    size="xs"
                                    variant="ghost"
                                    onClick={() => setSearch("")}
                                >
                                    <FiX />
                                </IconButton>
                            ) : (
                                <Box
                                    fontFamily="mono"
                                    fontSize="10px"
                                    color="fg.muted"
                                    bg="bg.surfaceTint"
                                    px="1.5"
                                    py="0.5"
                                    rounded="sm"
                                >
                                    ⌘ K
                                </Box>
                            )}
                        </Box>
                    </Box>
                    {/* Filter controls - kept on a single row on mobile too
                        (no wrap), with slightly smaller buttons so Filteri +
                        Sortiraj + the grid/list toggle all fit one line. */}
                    <HStack
                        gap="2"
                        wrap={{ base: "nowrap", md: "wrap" }}
                        justify={{ base: "space-between", md: "flex-start" }}
                    >
                        <Button
                            h={{ base: "40px", md: "46px" }}
                            px={{ base: "3", md: "4" }}
                            flexShrink={1}
                            bg={activeFilterCount > 0 ? "pitch.500" : "bg.panel"}
                            color={activeFilterCount > 0 ? "white" : "fg.ink"}
                            borderWidth="1px"
                            borderColor={activeFilterCount > 0 ? "pitch.500" : "border"}
                            rounded="lg"
                            fontWeight={600}
                            onClick={() => setFiltersOpen((v) => !v)}
                            aria-expanded={filtersOpen}
                        >
                            <FiFilter /> Filteri
                            {activeFilterCount > 0 && (
                                <Box
                                    ml="2"
                                    bg={activeFilterCount > 0 ? "rgba(255,255,255,0.25)" : "pitch.500"}
                                    color="white"
                                    rounded="full"
                                    px="2"
                                    py="0.5"
                                    fontSize="10px"
                                    fontWeight={700}
                                >
                                    {activeFilterCount}
                                </Box>
                            )}
                            {filtersOpen ? <FiChevronUp /> : <FiChevronDown />}
                        </Button>

                        {/* Sort menu - sits between Filteri and Kreiraj
                             turnir. The current option is shown inline on
                             desktop ("Sortiraj: Najraniji prvi") and
                             collapsed to just the icon on narrow screens
                             so the toolbar still fits the search input. */}
                        <Menu.Root>
                            <Menu.Trigger asChild>
                                <Button
                                    h={{ base: "40px", md: "46px" }}
                                    px={{ base: "3", md: "4" }}
                                    flexShrink={1}
                                    bg="bg.panel"
                                    color="fg.ink"
                                    borderWidth="1px"
                                    borderColor="border"
                                    rounded="lg"
                                    fontWeight={600}
                                >
                                    <FiSliders />
                                    <Box as="span" display={{ base: "none", md: "inline" }}>
                                        Sortiraj:{" "}
                                        <Box as="span" color="pitch.500" fontWeight={700}>
                                            {SORT_OPTIONS.find((o) => o.key === sortMode)?.label ?? "-"}
                                        </Box>
                                    </Box>
                                    <Box as="span" display={{ base: "inline", md: "none" }}>
                                        Sortiraj
                                    </Box>
                                    <FiChevronDown />
                                </Button>
                            </Menu.Trigger>
                            <Portal>
                                <Menu.Positioner>
                                    <Menu.Content
                                        minW="260px"
                                        rounded="lg"
                                        borderWidth="1px"
                                        borderColor="border"
                                        bg="bg.panel"
                                        shadow="lg"
                                        py="1"
                                    >
                                        {SORT_OPTIONS.map((opt) => {
                                            const active = opt.key === sortMode
                                            return (
                                                <Menu.Item
                                                    key={opt.key}
                                                    value={opt.key}
                                                    onClick={() => setSortMode(opt.key)}
                                                    px="3"
                                                    py="2.5"
                                                    cursor="pointer"
                                                    _hover={{ bg: "bg.surfaceTint" }}
                                                    bg={active ? "bg.surfaceTint" : undefined}
                                                >
                                                    <Flex w="full" align="center" gap="3">
                                                        <Box
                                                            color="pitch.500"
                                                            opacity={active ? 1 : 0}
                                                            flexShrink={0}
                                                        >
                                                            <FiCheck />
                                                        </Box>
                                                        <Box flex="1" minW="0">
                                                            <Text
                                                                fontSize="14px"
                                                                fontWeight={active ? 700 : 600}
                                                                color="fg.ink"
                                                            >
                                                                {opt.label}
                                                            </Text>
                                                            <Text fontSize="12px" color="fg.muted">
                                                                {opt.description}
                                                            </Text>
                                                        </Box>
                                                    </Flex>
                                                </Menu.Item>
                                            )
                                        })}
                                    </Menu.Content>
                                </Menu.Positioner>
                            </Portal>
                        </Menu.Root>

                        {/* Grid / list view switcher - replaces the old
                            "Kreiraj turnir" button (creating a tournament
                            already lives in the top nav, so a second button
                            here was redundant). Grid is the default card
                            layout; list groups upcoming by month. */}
                        <HStack
                            gap="0.5"
                            h={{ base: "40px", md: "46px" }}
                            px="1"
                            bg="bg.panel"
                            borderWidth="1px"
                            borderColor="border"
                            rounded="lg"
                            flexShrink={0}
                        >
                            <ViewToggleButton
                                active={upcomingView === "grid"}
                                onClick={() => setUpcomingView("grid")}
                                icon={<FiGrid size={16} />}
                                label="Mreža"
                            />
                            <ViewToggleButton
                                active={upcomingView === "list"}
                                onClick={() => setUpcomingView("list")}
                                icon={<FiList size={16} />}
                                label="Popis"
                            />
                        </HStack>
                    </HStack>
                </Stack>

                {filtersOpen && (
                    <Box
                        mt="4"
                        p="4"
                        bg="bg.panel"
                        borderWidth="1px"
                        borderColor="border"
                        rounded="lg"
                    >
                        {/* Desktop: all three filters share ONE row (location
                            gets the flexible share; the two €-ranges size to
                            compact fixed-width inputs). Mobile: each filter
                            stacks into its own row. */}
                        <Grid templateColumns={{ base: "1fr", md: "minmax(160px, 1fr) auto auto" }} gap="3">
                            <Box>
                                <MonoLabel>LOKACIJA</MonoLabel>
                                <Input
                                    mt="1"
                                    size="sm"
                                    placeholder="npr. Zagreb"
                                    value={locationFilter}
                                    onChange={(e) => setLocationFilter(e.target.value)}
                                />
                            </Box>
                            <Box>
                                <MonoLabel>KOTIZACIJA (€)</MonoLabel>
                                <HStack mt="1" gap="1.5">
                                    <Input
                                        size="sm"
                                        w={{ base: "full", md: "72px" }}
                                        inputMode="decimal"
                                        placeholder="od"
                                        value={priceMin}
                                        onChange={(e) => setPriceMin(sanitizeNum(e.target.value))}
                                    />
                                    <Text color="fg.muted">–</Text>
                                    <Input
                                        size="sm"
                                        w={{ base: "full", md: "72px" }}
                                        inputMode="decimal"
                                        placeholder="do"
                                        value={priceMax}
                                        onChange={(e) => setPriceMax(sanitizeNum(e.target.value))}
                                    />
                                </HStack>
                            </Box>
                            <Box>
                                <MonoLabel>UKUPNA NAGRADA (€)</MonoLabel>
                                <HStack mt="1" gap="1.5">
                                    <Input
                                        size="sm"
                                        w={{ base: "full", md: "72px" }}
                                        inputMode="decimal"
                                        placeholder="od"
                                        value={prizeMin}
                                        onChange={(e) => setPrizeMin(sanitizeNum(e.target.value))}
                                    />
                                    <Text color="fg.muted">–</Text>
                                    <Input
                                        size="sm"
                                        w={{ base: "full", md: "72px" }}
                                        inputMode="decimal"
                                        placeholder="do"
                                        value={prizeMax}
                                        onChange={(e) => setPrizeMax(sanitizeNum(e.target.value))}
                                    />
                                </HStack>
                            </Box>
                        </Grid>
                        <Box mt="3">
                            <HStack gap="2" mb="1.5" align="center" wrap="wrap">
                                <MonoLabel>U KRUGU OD:</MonoLabel>
                                <Text fontSize="xs" fontWeight={700} color="pitch.500">
                                    {userPos
                                        ? radiusKm >= RADIUS_MAX_KM
                                            ? "Sve"
                                            : `${radiusKm} km`
                                        : "-"}
                                </Text>
                                {!userPos && (
                                    <Button
                                        size="xs"
                                        variant="ghost"
                                        colorPalette="pitch"
                                        onClick={requestLocation}
                                        disabled={geoStatus === "asking" || geoStatus === "unsupported"}
                                        loading={geoStatus === "asking"}
                                    >
                                        <FiNavigation /> Uključi lokaciju
                                    </Button>
                                )}
                                {geoStatus === "denied" && (
                                    <Text fontSize="xs" color="fg.muted">
                                        Lokacija je odbijena u pregledniku.
                                    </Text>
                                )}
                                <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={resetFilters}
                                    disabled={!isFiltering}
                                    ml="auto"
                                >
                                    Očisti sve
                                </Button>
                            </HStack>
                            <Slider.Root
                                min={1}
                                max={RADIUS_MAX_KM}
                                step={1}
                                value={[radiusKm]}
                                onValueChange={(e) => setRadiusKm(e.value[0])}
                                disabled={!userPos}
                                colorPalette="pitch"
                            >
                                <Slider.Control>
                                    <Slider.Track>
                                        <Slider.Range />
                                    </Slider.Track>
                                    <Slider.Thumbs />
                                </Slider.Control>
                            </Slider.Root>
                        </Box>
                    </Box>
                )}

            </Box>

            {/* ── Upcoming section ────────────────────────────────────────── */}
            <Box>
                <Flex justify="space-between" align="flex-end" mb="4" gap="3" wrap="wrap">
                    <Box>
                        <Heading
                            fontFamily="heading"
                            fontSize="22px"
                            fontWeight={700}
                            letterSpacing="-0.02em"
                            color="fg.ink"
                        >
                            Nadolazeći turniri
                        </Heading>
                    </Box>
                </Flex>

                {loading ? (
                    <Grid templateColumns={gridCols} gap="4">
                        <CardSkeleton />
                        <CardSkeleton />
                        <CardSkeleton />
                    </Grid>
                ) : upcoming.length === 0 ? (
                    <EmptyState
                        title={error ? "Nije moguće učitati turnire" : "Nema nadolazećih turnira"}
                        description={error ?? "Kreiraj turnir i počni primati prijave ekipa."}
                        cta={
                            !error && (
                                <Button asChild size="sm" colorPalette="pitch">
                                    <RouterLink to="/turniri/novi">
                                        <FiPlus /> Kreiraj turnir
                                    </RouterLink>
                                </Button>
                            )
                        }
                    />
                ) : filteredUpcoming.length === 0 ? (
                    <EmptyState
                        title="Nema rezultata"
                        description="Nijedan turnir ne odgovara odabranim filterima."
                        cta={
                            <Button size="sm" variant="outline" onClick={resetFilters}>
                                Očisti filtere
                            </Button>
                        }
                    />
                ) : upcomingView === "list" ? (
                    <MonthList items={filteredUpcoming} />
                ) : (
                    <Grid templateColumns={gridCols} gap="5">
                        {filteredUpcoming.map((t, i) => (
                            <TournamentCardView key={t.uuid} t={t} variant="upcoming" priority={i === 0} />
                        ))}
                    </Grid>
                )}
            </Box>

            {/* ── Finished section ────────────────────────────────────────── */}
            <Box>
                <Flex justify="space-between" align="baseline" mb="4">
                    <Heading
                        fontFamily="heading"
                        fontSize="22px"
                        fontWeight={700}
                        letterSpacing="-0.02em"
                        color="fg.ink"
                    >
                        Završeni turniri
                    </Heading>
                    {finished.length > 0 ? (
                        <Box fontSize="13px" color="pitch.500" fontWeight={600}>
                        </Box>
                    ) : null}
                </Flex>

                {loadingFinished ? (
                    <Grid templateColumns={gridCols} gap="4">
                        <CardSkeleton />
                        <CardSkeleton />
                        <CardSkeleton />
                    </Grid>
                ) : finished.length === 0 ? (
                    <EmptyState
                        title={
                            errorFinished
                                ? "Nije moguće učitati završene turnire"
                                : "Još nema završenih turnira"
                        }
                        description={
                            errorFinished
                                ? errorFinished
                                : "Završeni turniri će se pojaviti ovdje s konačnim rezultatima, statistikama i strijelcima."
                        }
                    />
                ) : (
                    <>
                        {upcomingView === "list" ? (
                            <MonthList items={finished} desc />
                        ) : (
                            <Grid templateColumns={gridCols} gap="5">
                                {finished.map((t) => (
                                    <TournamentCardView key={t.uuid} t={t} variant="finished" />
                                ))}
                            </Grid>
                        )}
                        {finishedHasMore && (
                            <HStack justify="center" mt="4">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    colorPalette="pitch"
                                    onClick={loadMoreFinished}
                                    loading={loadingMoreFinished}
                                >
                                    Učitaj više ({finishedTotal - finished.length})
                                </Button>
                            </HStack>
                        )}
                    </>
                )}
            </Box>
        </VStack>
    )
}
