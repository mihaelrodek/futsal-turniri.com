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
    chakra,
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
    FiInfo,
    FiList,
    FiMapPin,
    FiNavigation,
    FiCheck,
    FiDownload,
    FiPlay,
    FiPlus,
    FiSearch,
    FiShoppingCart,
    FiVolume2,
    FiSliders,
    FiVideo,
    FiX,
} from "react-icons/fi"
import type { TournamentCard } from "../types/tournaments"
import { fetchTournaments, fetchTournamentsCount, fetchTournamentDetails } from "../api/tournaments"
import { fetchSchedule } from "../api/schedule"
import { fetchLiveMatches, pickFeaturedFirst, type LiveMatch } from "../api/live"
import { useUserLocation } from "../hooks/useUserLocation"
import { haversineKm } from "../utils/distance"
import { useDocumentHead } from "../hooks/useDocumentHead"
import { useTranslation } from "../i18n"
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

/** Localized labels for `relativeDays` / `classifyStatus` - resolved on the
 *  render thread via `useTranslation()` and passed in, since these are plain
 *  helpers (not hooks) and can't call it directly. Mirrors the
 *  `ClockLabels` pattern in FullscreenTournamentPage.tsx. */
type StatusLabels = {
    finished: string
    live: string
    today: string
    tomorrow: string
    inDays: (n: number) => string
    upcoming: string
}
/** Localized short weekday/month names for the poster date-stamp badge
 *  (`decomposeDate`). */
type DateBadgeLabels = { weekdaysShort: string[]; monthsShort: string[] }

// ---------- formatters ----------
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
function relativeDays(iso: string | null | undefined, labels: StatusLabels): { days: number; label: string } | null {
    if (!iso) return null
    const startMs = new Date(iso).setHours(0, 0, 0, 0)
    const todayMs = new Date().setHours(0, 0, 0, 0)
    const diff = Math.round((startMs - todayMs) / (24 * 60 * 60 * 1000))
    if (diff < 0) return null
    if (diff === 0) return { days: 0, label: labels.today }
    if (diff === 1) return { days: 1, label: labels.tomorrow }
    if (diff <= 14) return { days: diff, label: labels.inDays(diff) }
    return { days: diff, label: labels.upcoming }
}

function decomposeDate(iso: string | null | undefined, labels: DateBadgeLabels) {
    if (!iso) return null
    const d = new Date(iso)
    return {
        day: labels.weekdaysShort[d.getDay()],
        dayNum: String(d.getDate()).padStart(2, "0"),
        month: labels.monthsShort[d.getMonth()],
        time: formatTime(iso),
    }
}

/** Map a tournament + helpers to the shared `StatusKind` the design uses. */
function classifyStatus(
    t: TournamentCardWithUuid,
    variant: "upcoming" | "finished",
    labels: StatusLabels,
): { status: "live" | "upcoming" | "soon" | "full" | "finished"; label: string } {
    if (variant === "finished") return { status: "finished", label: labels.finished }
    // A live match OR a started (but not finished) tournament both read as the
    // same red pulsing "U TIJEKU" badge - we no longer surface a separate
    // "UŽIVO" label, so the status stays stable between individual matches.
    if (t.liveMatch || t.status === "STARTED") return { status: "live", label: labels.live }
    // A full roster no longer overrides the date badge - the card shows
    // "Danas" / "Sutra" / "Za N dana" / "Nadolazeći" like every other upcoming
    // tournament (the popunjenost bar still shows the registered/max count).
    const rel = relativeDays(t.startAt, labels)
    if (rel && rel.days > 1 && rel.days <= 7) return { status: "soon", label: rel.label }
    return { status: "upcoming", label: rel?.label ?? labels.upcoming }
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
    const tr = useTranslation()
    const heroT = tr.pages.tournamentsPage.hero
    // Reuses the shared LiveConsoleHeader phase labels (components.liveMatch)
    // rather than duplicating a fourth copy of the same all-caps wording.
    const phaseLabels = tr.components.liveMatch.phaseLabels
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
            ? phaseLabels.pause
            : heroPhase === "HALFTIME" ? phaseLabels.halftime
                : heroPhase === "SECOND_HALF" ? phaseLabels.secondHalf
                    : heroPhase === "FULL_TIME" ? phaseLabels.fullTime
                        : heroPhase === "FIRST_HALF" ? phaseLabels.firstHalf
                            : match.secondHalfStartedAt ? phaseLabels.secondHalf : phaseLabels.firstHalf
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
            bgImage="linear-gradient(135deg, #132A3E, #0B1522)"
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
                        {heroT.liveKicker}
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
                        {heroT.watchLiveCta}
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
    color: "#0B1522",
    rounded: "xl",
    overflow: "hidden",
    boxShadow: "0 12px 30px rgba(0,0,0,0.34)",
    borderWidth: "1px",
    borderColor: "rgba(0,0,0,0.06)",
} as const

/* Follower: a live scoreboard with a goal + a yellow-card event logged. */
function PromoMockLive() {
    const tr = useTranslation()
    const mockT = tr.pages.tournamentsPage.hero.mock
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
                        {mockT.liveLabel}
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
                        <Box as="span" fontWeight={700} color="#0B1522">12'</Box> Marko Horvat
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
                        <Box as="span" fontWeight={700} color="#0B1522">18'</Box> Ivan Kovač
                    </Box>
                </Flex>
            </VStack>
        </Box>
    )
}

/* Follower: a push notification announcing a goal. */
function PromoMockNotif() {
    const tr = useTranslation()
    const mockT = tr.pages.tournamentsPage.hero.mock
    return (
        <Box {...MOCK_SHELL} w="216px">
            <Flex align="center" gap="2.5" px="3" py="2.5">
                <Flex
                    align="center"
                    justify="center"
                    w="26px"
                    h="26px"
                    rounded="lg"
                    bg="#2AD4C8"
                    color="#0B1522"
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
                        <Box fontSize="9px" color="rgba(0,0,0,0.4)" flexShrink={0}>{mockT.nowLabel}</Box>
                    </Flex>
                    <Box fontSize="11.5px" fontWeight={800} mt="0.5">{mockT.goalNotifTitle("Sokol 2–1")}</Box>
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

/**
 * Sample match recording shown on the "buy a recording" slide.
 *
 * <p>A file YOU host: drop the clip in `frontend/public/promo/` and point this
 * at it. Self-hosted rather than embedded on purpose - no third-party player
 * chrome to fight, no cookie banner, no branding, and the clip is whatever you
 * decide to show. Keep it SHORT and small (a 10-20 s, <5 MB, 720p mp4): it is
 * on the home page, and it autoplays.
 *
 * <p>Set to an empty string and the slide falls back to the faux package
 * cards, so a missing file degrades to the old look instead of a black box.
 */
const PROMO_VIDEO_SRC = "/promo/zamuda_primavita_highlights.mp4"

/**
 * How long the carousel holds on the clip's slide. A ceiling, not a wait: the
 * slide advances as soon as the video reaches its end. This only covers the
 * case where playback never starts (autoplay blocked, file missing, codec the
 * browser won't touch) - without it the carousel would park there forever.
 * Keep it a little above the clip's real length.
 */
const VIDEO_SLIDE_MS = 130_000

/**
 * Sample recording on the "buy a recording" slide - a silent, looping clip
 * with a tap to hear it.
 *
 * <p>Two states:
 *   - <b>showreel</b> (default): autoplaying, MUTED, looping, no controls.
 *     Muted is not a preference - every browser blocks autoplay with sound, so
 *     an unmuted autoplay would simply never start.
 *   - <b>with sound</b>: one click unmutes and reveals the native controls. A
 *     user gesture is exactly what makes audio allowed, so nothing has to be
 *     reloaded - the clip keeps playing from where it is.
 *
 * <p>`active` is what plays it: only the visible slide runs, and leaving the
 * slide pauses (and rewinds) it, so the home page never has a video playing
 * behind two other banners. `preload="metadata"` keeps the first frame ready
 * without pulling the whole file for visitors who never reach this slide.
 */
function PromoVideo({
    src,
    active,
    onPlay,
    onEnded,
}: {
    src: string
    active: boolean
    onPlay?: () => void
    /** Fired when the clip reaches its end - the carousel moves on then. */
    onEnded?: () => void
}) {
    const tr = useTranslation()
    const videoRef = useRef<HTMLVideoElement>(null)
    const [withSound, setWithSound] = useState(false)
    const label = tr.pages.tournamentsPage.recordingPromo.videoPlayAria

    useEffect(() => {
        const el = videoRef.current
        if (!el) return
        if (active) {
            // play() rejects when autoplay is blocked - nothing to do about it
            // here, the poster frame simply stays.
            void el.play().catch(() => { /* autoplay blocked - leave the frame */ })
        } else {
            el.pause()
            el.currentTime = 0
        }
    }, [active])

    function enableSound() {
        const el = videoRef.current
        if (!el) return
        el.muted = false
        void el.play().catch(() => { /* noop */ })
        setWithSound(true)
        onPlay?.()
    }

    return (
        <Box
            position="relative"
            w={{ base: "100%", md: "420px" }}
            maxW={{ base: "340px", md: "none" }}
            css={{ aspectRatio: "16 / 9" }}
            rounded="xl"
            overflow="hidden"
            boxShadow="0 12px 30px rgba(0,0,0,0.34)"
            borderWidth="1px"
            borderColor="rgba(255,255,255,0.18)"
            bg="#000"
        >
            <chakra.video
                ref={videoRef}
                src={src}
                muted={!withSound}
                // Deliberately NOT looping: the carousel waits for the clip to
                // finish and then advances, and a looping video never finishes.
                onEnded={onEnded}
                playsInline
                preload="metadata"
                controls={withSound}
                position="absolute"
                inset="0"
                w="100%"
                h="100%"
                objectFit="cover"
                // `cover` fills the 16:9 box in the banner, but fullscreen hands
                // the video the whole SCREEN - and a 16:10 laptop panel is not
                // 16:9, so cover cropped the sides off (the scoreboard overlay
                // burned into the clip was the first thing to go). Fullscreen
                // switches to `contain`: whole frame, letterboxed if needed.
                css={{
                    "&:fullscreen": { objectFit: "contain" },
                    "&:-webkit-full-screen": { objectFit: "contain" },
                }}
                aria-label={label}
            />

            {/* Click target while muted: unmutes, shows the real controls and
                stops the carousel, so the slide can't rotate away from a video
                someone just started listening to. */}
            {!withSound && (
                <chakra.button
                    type="button"
                    aria-label={label}
                    onClick={enableSound}
                    position="absolute"
                    inset="0"
                    w="100%"
                    h="100%"
                    cursor="pointer"
                    border="0"
                    p="0"
                    bg="transparent"
                >
                    <Flex position="absolute" inset="0" align="center" justify="center">
                        <Flex
                            align="center"
                            justify="center"
                            w="46px"
                            h="46px"
                            rounded="full"
                            bg="rgba(0,0,0,0.45)"
                            color="white"
                            borderWidth="1px"
                            borderColor="rgba(255,255,255,0.5)"
                        >
                            <FiVolume2 size={20} />
                        </Flex>
                    </Flex>
                </chakra.button>
            )}
        </Box>
    )
}

/* Buyer: the recording package card + its "spremno za preuzimanje" row - the
   two states of the paid flow, so the slide shows what the money produces. */
function PromoMockRecording() {
    const tr = useTranslation()
    const mockT = tr.pages.tournamentsPage.hero.mock
    return (
        <Box {...MOCK_SHELL} w="212px">
            <Flex align="center" justify="space-between" px="3" py="1.5" bg="rgba(180,83,9,0.10)">
                <HStack gap="1.5">
                    <Box color="#b45309" display="inline-flex"><FiVideo size={11} /></Box>
                    <Box fontFamily="mono" fontSize="9.5px" fontWeight={800} letterSpacing="0.1em" color="#b45309">
                        {mockT.recordingLabel}
                    </Box>
                </HStack>
                <Box fontFamily="mono" fontSize="10.5px" fontWeight={800} color="#b45309">
                    {mockT.recordingPrice}
                </Box>
            </Flex>
            {/* Faux video frame - a dark block with a play glyph, so the card
                reads as "a video" without shipping an actual image. */}
            <Box position="relative" h="74px" bg="#0B1522">
                <PitchBackdrop opacity={0.25} variant="hero" tone="pitch" />
                <Flex position="absolute" inset="0" align="center" justify="center">
                    <Flex
                        align="center"
                        justify="center"
                        w="28px"
                        h="28px"
                        rounded="full"
                        bg="rgba(255,255,255,0.92)"
                        color="#0B1522"
                    >
                        <FiPlay size={13} />
                    </Flex>
                </Flex>
            </Box>
            <VStack align="stretch" gap="0.5" px="3" py="2">
                <Box fontSize="11px" fontWeight={700}>{mockT.recordingTitle}</Box>
                <Flex align="center" gap="1.5" color="rgba(0,0,0,0.55)">
                    <FiDownload size={10} />
                    <Box fontSize="9.5px" fontWeight={600}>{mockT.recordingDownload}</Box>
                </Flex>
            </VStack>
        </Box>
    )
}

/* Buyer collage: the recording card over a live scoreboard - "gledao si je
   uživo, sad je možeš imati". */
function PromoMockBuyer() {
    return (
        <Box position="relative" w="250px" h="180px">
            <Box position="absolute" left="0" bottom="0" transform="rotate(-3deg)">
                <PromoMockLive />
            </Box>
            <Box position="absolute" right="0" top="0" transform="rotate(2.5deg)" zIndex={1}>
                <PromoMockRecording />
            </Box>
        </Box>
    )
}

/* Organiser: the match-record console (zapisnik) with faux add controls. */
function PromoMockZapisnik() {
    const tr = useTranslation()
    const mockT = tr.pages.tournamentsPage.hero.mock
    return (
        <Box {...MOCK_SHELL} w="205px">
            <Flex align="center" justify="space-between" px="3" py="1.5" bg="#2AD4C8" color="#0B1522">
                <HStack gap="1.5">
                    <FiEdit3 size={11} />
                    <Box fontFamily="mono" fontSize="9.5px" fontWeight={700} letterSpacing="0.1em">
                        {mockT.zapisnikLabel}
                    </Box>
                </HStack>
                <Box fontFamily="mono" fontSize="11px" fontWeight={800}>2 : 1</Box>
            </Flex>
            <VStack align="stretch" gap="0" px="3" pt="1.5" pb="1">
                <Flex align="center" gap="2" py="1">
                    <Box fontSize="11px">⚽</Box>
                    <Box fontFamily="mono" fontSize="9.5px" fontWeight={700} color="#0E8A81" w="18px">
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
                    <Box fontFamily="mono" fontSize="9.5px" fontWeight={700} color="#0E8A81" w="18px">
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
                    color="#0B1522"
                    bg="#2AD4C8"
                    rounded="md"
                    py="1"
                >
                    {mockT.addGoal}
                </Box>
                <Box
                    flex="1"
                    textAlign="center"
                    fontSize="9.5px"
                    fontWeight={700}
                    color="#0B1522"
                    bg="rgba(0,0,0,0.06)"
                    rounded="md"
                    py="1"
                >
                    {mockT.addCard}
                </Box>
            </Flex>
        </Box>
    )
}

/* Organiser: a mini elimination bracket. */
function PromoMockBracket() {
    const tr = useTranslation()
    const mockT = tr.pages.tournamentsPage.hero.mock
    const pair = (a: string, b: string, aWins: boolean) => (
        <Box borderWidth="1px" borderColor="rgba(0,0,0,0.1)" rounded="md" overflow="hidden" bg="rgba(0,0,0,0.02)">
            <Box
                fontSize="9px"
                fontWeight={aWins ? 800 : 600}
                color={aWins ? "#0E8A81" : "#0B1522"}
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
                color={aWins ? "#0B1522" : "#0E8A81"}
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
            <Flex align="center" gap="1.5" px="3" py="1.5" bg="#2AD4C8" color="#0B1522">
                <FiGrid size={11} />
                <Box fontFamily="mono" fontSize="9.5px" fontWeight={700} letterSpacing="0.1em">
                    {mockT.eliminationLabel}
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
                        color="#0E8A81"
                        letterSpacing="0.12em"
                        textAlign="center"
                        mt="1"
                    >
                        {mockT.finalLabel}
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
    /** Optional in-app CTA. Only the "buy a recording" slide has one: the other
     *  two describe free features, where a button would be noise. */
    ctaLabel?: string
    ctaTo?: string
    /** Replaces the faux screenshot collage. Used by the "buy a recording"
     *  slide to show a REAL sample recording - the most convincing thing that
     *  slide can carry is the product itself. */
    media?: React.ReactNode
}

/** Mock collage per slide, in the same order as
 *  `t.pages.tournamentsPage.hero.promoSlides` (organiser, then follower). The
 *  copy is translated; these faux "app screenshot" collages are built from
 *  JSX so they stay here rather than in the dictionary. */
const PROMO_MOCKS: React.ReactNode[] = [
    <PromoMockOrganizer key="organizer" />,
    <PromoMockFollower key="follower" />,
    <PromoMockBuyer key="buyer" />,
]

function PromoHero({ data }: { data: PromoSlide }) {
    return (
        <Box
            position="relative"
            overflow="hidden"
            color="white"
            // minH only - deliberately NO maxH. The carousel track stretches to
            // its tallest slide, and the live scoreboard grows past this floor
            // whenever a team name wraps. A capped promo slide then stopped
            // short of the track's bottom edge, leaving a transparent strip
            // inside the rounded viewport - which read as the banner's footer
            // being cut off. Without the cap it just fills the row.
            minH={HERO_MIN_H}
            flex="1 0 auto"
            display="flex"
            flexDirection="column"
            bgImage="linear-gradient(135deg, #132A3E, #0B1522)"
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
                bg="rgba(42, 212, 200, 0.32)"
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
                        // A media slide drops the paragraph on phones: every
                        // line of it pushes the clip further down, and on that
                        // slide the clip is the argument, not the copy.
                        hideBelow={data.media ? "md" : undefined}
                    >
                        {data.subtitle}
                    </Text>
                    {data.ctaLabel && data.ctaTo && (
                        <Button size="sm" colorPalette="pitch" mt="1" asChild>
                            <RouterLink to={data.ctaTo}>
                                <FiShoppingCart /> {data.ctaLabel}
                            </RouterLink>
                        </Button>
                    )}
                </VStack>

                {/* Faux app screenshots - the full two-card collage on both
                    breakpoints, just scaled down to fit the tighter fixed height
                    on mobile (the scaled wrapper reserves only its shrunk box). */}
                {data.media ? (
                    /* Real media (the sample recording). Unlike the faux
                       collages it is already sized in its own aspect ratio, so
                       it is NOT scaled down on mobile - a 0.6 scale would make
                       the play button a hard target on the smallest phones. */
                    <Flex
                        flexShrink={0}
                        justify="center"
                        w={{ base: "full", md: "auto" }}
                        alignSelf={{ md: "flex-start" }}
                        // Nudged up so the clip's lower edge lands on the pitch
                        // line drawn in the backdrop. A fixed offset, not a
                        // computed one: PitchBackdrop is an SVG rendered with
                        // `preserveAspectRatio="slice"`, so where that line
                        // falls depends on the hero's aspect ratio - there is
                        // no CSS length that tracks it. Tuned for desktop; the
                        // phone layout stacks and doesn't use it.
                        mt={{ md: "-5" }}
                    >
                        {data.media}
                    </Flex>
                ) : (
                    <>
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
                    </>
                )}
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
    const tr = useTranslation()
    // Carousel state comes FIRST: the buyer slide needs to know whether it is
    // the visible one (it only mounts the video player then), and the slides
    // themselves are built below - so the index cannot be derived from them.
    // The slide count is the promo count plus the optional live slide, which is
    // knowable without building anything.
    const liveCount = match ? 1 : 0
    const count = tr.pages.tournamentsPage.hero.promoSlides.length + liveCount
    const [idx, setIdx] = useState(0)
    const active = idx % count
    const [paused, setPaused] = useState(false)
    // Which SLIDE carries the sample recording: the third promo, shifted right
    // by the live slide when one is present. -1 when there is no clip at all.
    const videoSlideIdx = PROMO_VIDEO_SRC ? 2 + liveCount : -1

    // Slide order, live content first so a live hero is never buried behind
    // the promos: the zapisnik-scored live scoreboard (when a match is in
    // progress), then the two always-present promo slides.
    const liveSlide = match ? <LiveHero key="live" match={match} /> : null
    const promos = tr.pages.tournamentsPage.hero.promoSlides.map((p, i) => (
        <PromoHero
            key={i}
            data={{
                ...p,
                mock: PROMO_MOCKS[i],
                // Only the buyer slide gets a button, and it reuses the strip's
                // label so the two never drift apart.
                ...(i === 2
                    ? {
                        ctaLabel: tr.pages.tournamentsPage.recordingPromo.button,
                        ctaTo: "/kosarica",
                        // A sample of the actual product, when one is configured.
                        media: PROMO_VIDEO_SRC
                            ? (
                                <PromoVideo
                                    src={PROMO_VIDEO_SRC}
                                    // `i` indexes the PROMOS, `active` indexes
                                    // the SLIDES - and a live slide shifts every
                                    // promo one place to the right.
                                    active={active === i + liveCount}
                                    onPlay={() => setPaused(true)}
                                    // Played out - move on immediately rather
                                    // than sit on a finished clip until the
                                    // ceiling above runs out.
                                    onEnded={() => setIdx((i2) => i2 + 1)}
                                />
                            )
                            : undefined,
                    }
                    : {}),
            }}
        />
    ))
    const slides = liveSlide ? [liveSlide, ...promos] : promos
    const go = (n: number) => setIdx(((n % count) + count) % count)

    // Autoplay. Every slide gets 5s EXCEPT the one with the sample recording,
    // which holds until the clip has played out - showing three seconds of a
    // two-minute video and sliding away is worse than not showing it. It also
    // advances the moment the clip ends (see `onEnded` below), so the long
    // dwell is only the ceiling, not the actual wait.
    //
    // With the live scoreboard present the carousel never rotates into the
    // promos at all: it pins to that single live slide. Manual swiping/dots
    // still reach them; autoplay simply won't take the viewer there.
    useEffect(() => {
        // How many leading slides autoplay may cycle through: only the live
        // one while it's present, otherwise all (promo) slides.
        const cycleLen = liveCount > 0 ? liveCount : count
        if (cycleLen < 2 || paused) return
        // setTimeout, not setInterval: the dwell differs per slide, so the
        // timer is re-armed on every change rather than fixed once.
        const dwell = active === videoSlideIdx ? VIDEO_SLIDE_MS : 5000
        const id = setTimeout(() => setIdx((i) => (i + 1) % cycleLen), dwell)
        return () => clearTimeout(id)
    }, [count, liveCount, paused, active, videoSlideIdx])

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
                            aria-label={tr.pages.tournamentsPage.hero.slideIndicatorAria(i + 1)}
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
    const tr = useTranslation()
    const tp = tr.pages.tournamentsPage
    const ds = decomposeDate(t.startAt, tp.dateBadge)
    const status = classifyStatus(t, variant, tp.status)
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
                            {tp.card.hiddenBadge}
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

                    {/* A finished tournament with no result ever entered was
                        run on paper, not here: no schedule, no standings, no
                        scorers behind the card. The fill bar in its place read
                        as "12/16 signed up" - a promise of content that isn't
                        there. `anyResult === false` (not falsy): an older cached
                        card without the field must keep the bar. */}
                    {variant === "finished" && !winner && t.anyResult === false ? (
                        <HStack gap="2" align="center" color="fg.muted">
                            <Box flexShrink={0} display="inline-flex">
                                <FiInfo size={13} />
                            </Box>
                            <Text fontSize="12px" fontWeight={600} lineHeight="1.3">
                                {tp.card.notRecordedLabel}
                            </Text>
                        </HStack>
                    ) : variant === "finished" && winner ? (
                        <HStack gap="2" align="center">
                            <Box
                                fontFamily="mono"
                                fontSize="10px"
                                color="fg.muted"
                                letterSpacing="0.1em"
                                fontWeight={700}
                            >
                                {tp.card.winnerLabel}
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
                                    {tp.card.fillLabel}
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
                                            {tp.card.entryFeeLabel}
                                        </Box>
                                    </>
                                ) : (
                                    <Box fontSize="13px" color="fg.muted" fontWeight={500}>
                                        {tp.card.freeEntry}
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
                                            {tp.card.totalPrizeLabel}
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

/** Localized labels for `dayHeading` - resolved via `useTranslation()` in
 *  `MonthList` and passed in, since `dayHeading` is a plain helper. */
type DayHeadingLabels = {
    today: string
    tomorrow: string
    weekdaysFull: string[]
    monthsGenitive: string[]
}
function pad2(n: number): string {
    return String(n).padStart(2, "0")
}
function startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}
function dayHeading(d: Date, today: Date, labels: DayHeadingLabels): string {
    const diff = Math.round(
        (startOfDay(d).getTime() - startOfDay(today).getTime()) / 86400000,
    )
    if (diff === 0) return labels.today
    if (diff === 1) return labels.tomorrow
    return `${labels.weekdaysFull[d.getDay()]}, ${d.getDate()}. ${labels.monthsGenitive[d.getMonth()]}`
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
function groupByMonth(items: TournamentCard[], monthsNominative: string[]): MonthGroup[] {
    const months = new Map<string, MonthGroup>()
    for (const t of items) {
        if (!t.startAt) continue
        const d = new Date(t.startAt)
        const mKey = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
        let mg = months.get(mKey)
        if (!mg) {
            mg = {
                key: mKey,
                label: `${monthsNominative[d.getMonth()]} ${d.getFullYear()}`,
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
    const tr = useTranslation()
    const lv = tr.pages.tournamentsPage.listView
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
                                {lv.hiddenBadge}
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
                                <Text fontSize="xs">{lv.locationNotSpecified}</Text>
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
    const tr = useTranslation()
    const tp = tr.pages.tournamentsPage
    const lv = tp.listView
    const today = useMemo(() => new Date(), [])
    const groups = useMemo(() => {
        const g = groupByMonth(items, lv.monthsNominative)
        if (!desc) return g
        return [...g].reverse().map((m) => ({ ...m, days: [...m.days].reverse() }))
    }, [items, desc, lv.monthsNominative])

    if (groups.length === 0) {
        return (
            <Text fontSize="sm" color="fg.muted" textAlign="center" py="4">
                {tp.emptyStates.noResultsHint}
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
                                    {dayHeading(day.date, today, {
                                        today: tp.status.today,
                                        tomorrow: tp.status.tomorrow,
                                        weekdaysFull: lv.weekdaysFull,
                                        monthsGenitive: lv.monthsGenitive,
                                    })}
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
/** Order matches `t.pages.tournamentsPage.sortOptions` (label + description
 *  live in the dictionary; only the internal keys stay here). */
const SORT_KEYS: SortMode[] = ["date_asc", "date_desc", "price_asc", "popular", "name_asc"]
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
    const tr = useTranslation()
    const tp = tr.pages.tournamentsPage
    useDocumentHead({
        title: tp.documentTitle,
        description: tp.documentDescription,
        ogTitle: tp.ogTitle,
        ogDescription: tp.ogDescription,
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
    const SORT_OPTIONS = useMemo(
        () => SORT_KEYS.map((key, i) => ({ key, label: tp.sortOptions[i].label, description: tp.sortOptions[i].description })),
        [tp.sortOptions],
    )
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
                            placeholder={tp.toolbar.searchPlaceholder}
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
                                    aria-label={tp.toolbar.clearSearchAria}
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
                            <FiFilter /> {tp.toolbar.filtersButton}
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
                                    // Fixed on desktop (where the label shows) so picking a
                                    // shorter/longer sort option never resizes the button and
                                    // shifts the rest of the toolbar - sized to the longest
                                    // label ("Najkasniji prvi"), not just whichever is active.
                                    minW={{ base: "auto", md: "224px" }}
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
                                        {tp.toolbar.sortPrefix}{" "}
                                        <Box as="span" color="pitch.500" fontWeight={700}>
                                            {SORT_OPTIONS.find((o) => o.key === sortMode)?.label ?? "-"}
                                        </Box>
                                    </Box>
                                    <Box as="span" display={{ base: "inline", md: "none" }}>
                                        {tp.toolbar.sortButtonMobile}
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
                                label={tp.viewToggle.grid}
                            />
                            <ViewToggleButton
                                active={upcomingView === "list"}
                                onClick={() => setUpcomingView("list")}
                                icon={<FiList size={16} />}
                                label={tp.viewToggle.list}
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
                                <MonoLabel>{tp.filters.locationLabel}</MonoLabel>
                                <Input
                                    mt="1"
                                    size="sm"
                                    placeholder={tp.filters.locationPlaceholder}
                                    value={locationFilter}
                                    onChange={(e) => setLocationFilter(e.target.value)}
                                />
                            </Box>
                            <Box>
                                <MonoLabel>{tp.filters.priceLabel}</MonoLabel>
                                <HStack mt="1" gap="1.5">
                                    <Input
                                        size="sm"
                                        w={{ base: "full", md: "72px" }}
                                        inputMode="decimal"
                                        placeholder={tp.filters.fromPlaceholder}
                                        value={priceMin}
                                        onChange={(e) => setPriceMin(sanitizeNum(e.target.value))}
                                    />
                                    <Text color="fg.muted">–</Text>
                                    <Input
                                        size="sm"
                                        w={{ base: "full", md: "72px" }}
                                        inputMode="decimal"
                                        placeholder={tp.filters.toPlaceholder}
                                        value={priceMax}
                                        onChange={(e) => setPriceMax(sanitizeNum(e.target.value))}
                                    />
                                </HStack>
                            </Box>
                            <Box>
                                <MonoLabel>{tp.filters.prizeLabel}</MonoLabel>
                                <HStack mt="1" gap="1.5">
                                    <Input
                                        size="sm"
                                        w={{ base: "full", md: "72px" }}
                                        inputMode="decimal"
                                        placeholder={tp.filters.fromPlaceholder}
                                        value={prizeMin}
                                        onChange={(e) => setPrizeMin(sanitizeNum(e.target.value))}
                                    />
                                    <Text color="fg.muted">–</Text>
                                    <Input
                                        size="sm"
                                        w={{ base: "full", md: "72px" }}
                                        inputMode="decimal"
                                        placeholder={tp.filters.toPlaceholder}
                                        value={prizeMax}
                                        onChange={(e) => setPrizeMax(sanitizeNum(e.target.value))}
                                    />
                                </HStack>
                            </Box>
                        </Grid>
                        <Box mt="3">
                            <HStack gap="2" mb="1.5" align="center" wrap="wrap">
                                <MonoLabel>{tp.filters.radiusLabel}</MonoLabel>
                                <Text fontSize="xs" fontWeight={700} color="pitch.500">
                                    {userPos
                                        ? radiusKm >= RADIUS_MAX_KM
                                            ? tp.filters.radiusAll
                                            : tp.filters.radiusValue(radiusKm)
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
                                        <FiNavigation /> {tp.filters.enableLocation}
                                    </Button>
                                )}
                                {geoStatus === "denied" && (
                                    <Text fontSize="xs" color="fg.muted">
                                        {tp.filters.locationDenied}
                                    </Text>
                                )}
                                <Button
                                    size="xs"
                                    variant="ghost"
                                    onClick={resetFilters}
                                    disabled={!isFiltering}
                                    ml="auto"
                                >
                                    {tp.filters.clearAll}
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
                            {tp.sections.upcomingHeading}
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
                        title={error ? tp.emptyStates.loadFailedTitle : tp.emptyStates.noUpcomingTitle}
                        description={error ?? tp.emptyStates.noUpcomingHint}
                        cta={
                            !error && (
                                <Button asChild size="sm" colorPalette="pitch">
                                    <RouterLink to="/turniri/novi">
                                        <FiPlus /> {tr.nav.createTournament}
                                    </RouterLink>
                                </Button>
                            )
                        }
                    />
                ) : filteredUpcoming.length === 0 ? (
                    <EmptyState
                        title={tp.emptyStates.noResultsTitle}
                        description={tp.emptyStates.noResultsHint}
                        cta={
                            <Button size="sm" variant="outline" onClick={resetFilters}>
                                {tp.emptyStates.clearFilters}
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

            {/* ── "Kupi snimku" strip ─────────────────────────────────────
                Sits BETWEEN the two tournament sections on purpose: high
                enough to be seen while scrolling, low enough that it never
                pushes the live hero or the upcoming tournaments down. Amber,
                like the recording pill on a match page, so the one commercial
                colour in the app stays consistent. */}
            <Box
                borderWidth="1px"
                borderColor="accent.amber"
                rounded="2xl"
                p={{ base: "4", md: "5" }}
                bg="bg.panel"
            >
                <Flex
                    direction={{ base: "column", md: "row" }}
                    align={{ base: "stretch", md: "center" }}
                    gap={{ base: "3", md: "5" }}
                >
                    <Flex
                        align="center"
                        justify="center"
                        boxSize="44px"
                        rounded="xl"
                        flexShrink={0}
                        color="accent.amber"
                        borderWidth="1px"
                        borderColor="accent.amber"
                    >
                        <FiVideo size={22} />
                    </Flex>
                    <Box flex="1" minW="0">
                        <Heading
                            as="h2"
                            fontFamily="heading"
                            fontSize={{ base: "18px", md: "20px" }}
                            fontWeight={700}
                            letterSpacing="-0.01em"
                            color="fg.ink"
                        >
                            {tp.recordingPromo.title}
                        </Heading>
                        <Text fontSize="sm" color="fg.muted" mt="1" lineHeight="1.55">
                            {tp.recordingPromo.body}
                        </Text>
                    </Box>
                    <Button
                        size="md"
                        colorPalette="pitch"
                        flexShrink={0}
                        alignSelf={{ base: "stretch", md: "center" }}
                        asChild
                    >
                        <RouterLink to="/kosarica">
                            <FiShoppingCart /> {tp.recordingPromo.button}
                        </RouterLink>
                    </Button>
                </Flex>
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
                        {tp.sections.finishedHeading}
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
                                ? tp.emptyStates.loadFailedFinishedTitle
                                : tp.emptyStates.noFinishedTitle
                        }
                        description={
                            errorFinished
                                ? errorFinished
                                : tp.emptyStates.noFinishedHint
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
                                    {tp.loadMore(finishedTotal - finished.length)}
                                </Button>
                            </HStack>
                        )}
                    </>
                )}
            </Box>
        </VStack>
    )
}
