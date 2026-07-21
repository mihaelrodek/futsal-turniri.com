import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Box, Flex, HStack, Spinner, Text, VStack, chakra } from "@chakra-ui/react"
import { useNavigate, useParams } from "react-router-dom"
import { FiClock, FiX } from "react-icons/fi"
import { GiSoccerBall, GiSoccerKick } from "react-icons/gi"
import { fetchTournamentDetails } from "../api/tournaments"
import { fetchSchedule } from "../api/schedule"
import { fetchLiveMatches } from "../api/live"
import { fetchMatchEvents } from "../api/matchEvents"
import { matchPhase } from "../components/liveMatch"
import { Logo } from "../components/Logo"
import { usePolling } from "../hooks/usePolling"
import { useLiveSocket } from "../hooks/useLiveSocket"
import { useColorMode } from "../color-mode"
import type { TournamentDetails } from "../types/tournaments"
import type { ScheduledMatch } from "../types/schedule"
import type { LiveMatch } from "../api/live"
import type { MatchEventDto } from "../types/matchEvents"

/* ──────────────────────────────────────────────────────────────────────────
   FullscreenTournamentPage - big-screen TV display for a single tournament.

   Use case: organizer plugs a laptop into a venue TV and opens this URL.
   Page renders a calm, high-contrast layout legible from across the room:
     • Greyish, theme-aware backdrop (light grey + black text in light mode,
       dark grey + white text in dark mode) with a faint logo watermark.
     • Tournament name + status as a strip across the top
     • Centerpiece: huge scoreboard for the current LIVE match (team
       names + 120px score). The scoreboard only PULSES (red ring) during
       the final minute of a half / the match - the rest of the time it
       stays static so the screen isn't constantly flashing.
     • Below: the single most-recent finished result + the single next
       scheduled match.
     • Polls live matches + schedule every 15 s so the display stays current

   Tries `document.documentElement.requestFullscreen()` on mount so the
   browser chrome is hidden too - ESC (or click X) leaves and returns to
   the regular detail page. Some browsers require a user gesture to
   enter fullscreen; if the requestFullscreen call rejects we silently
   fall back to a regular full-viewport layout.
   ────────────────────────────────────────────────────────────────────── */

// Fallback poll for the TV display. The WebSocket (useLiveSocket) is the
// instant path - a freshly-entered goal pushes immediately; this poll keeps the
// screen snappy even if the socket can't connect (e.g. before the backend is
// redeployed with the WS endpoint). The /live + events endpoints are no longer
// browser-cached (see PublicReadCacheFilter), so every poll is fresh.
const POLL_MS = 5_000

/**
 * Scale a block down (never up) so it always fits its container's height. The
 * scoreboard sizes its text with viewport units, but on short screens the
 * stack (clock + score + fouls + goalscorers) can still be taller than the
 * space between the header and the bottom strip - this guarantees nothing
 * (especially the goalscorers) gets clipped by measuring the natural height
 * and shrinking the whole block to fit. `deps` re-binds the refs when the
 * measured element changes (e.g. a live match appears/disappears).
 */
function useFitScale(deps: unknown[]) {
    const availRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    const [scale, setScale] = useState(1)
    useLayoutEffect(() => {
        const avail = availRef.current
        const content = contentRef.current
        if (!avail || !content) return
        const recompute = () => {
            const ah = avail.clientHeight
            // offsetHeight is the LAYOUT (unscaled) height, so the measurement
            // is stable regardless of the transform we apply below.
            const nh = content.offsetHeight
            if (ah > 0 && nh > 0) setScale(Math.min(1, ah / nh))
        }
        recompute()
        const ro = new ResizeObserver(recompute)
        ro.observe(avail)
        ro.observe(content)
        window.addEventListener("resize", recompute)
        return () => {
            ro.disconnect()
            window.removeEventListener("resize", recompute)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps)
    return { availRef, contentRef, scale }
}

export default function FullscreenTournamentPage() {
    const { uuid } = useParams<{ uuid: string }>()
    const navigate = useNavigate()
    const { colorMode } = useColorMode()
    const dark = colorMode === "dark"

    const [tournament, setTournament] = useState<TournamentDetails | null>(null)
    const [matches, setMatches] = useState<ScheduledMatch[]>([])
    const [liveMatches, setLiveMatches] = useState<LiveMatch[]>([])
    // Half config drives the half-aware match clock; only the schedule
    // carries it (the /live DTO doesn't), so we stash it from the poll.
    const [halfLengthMin, setHalfLengthMin] = useState<number | null>(null)
    const [halfCount, setHalfCount] = useState<number | null>(null)
    const [loading, setLoading] = useState(true)

    // Try to enter true browser fullscreen on mount. Reverts on unmount.
    useEffect(() => {
        const el = document.documentElement
        if (el.requestFullscreen) {
            el.requestFullscreen().catch(() => {
                /* user gesture required / browser refused - fall back to layout-only fullscreen */
            })
        }
        return () => {
            if (document.fullscreenElement && document.exitFullscreen) {
                document.exitFullscreen().catch(() => {})
            }
        }
    }, [])

    // Lock page scroll while the fullscreen display is mounted - the layout
    // already fits in 100vh, so the stray right-hand scrollbar from the
    // underlying app document is pure noise on a TV. Restored on unmount.
    useEffect(() => {
        const prevBody = document.body.style.overflow
        const prevHtml = document.documentElement.style.overflow
        document.body.style.overflow = "hidden"
        document.documentElement.style.overflow = "hidden"
        return () => {
            document.body.style.overflow = prevBody
            document.documentElement.style.overflow = prevHtml
        }
    }, [])

    // ESC → leave the fullscreen page (back to the regular detail).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                navigate(`/turniri/${uuid}`)
            }
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [uuid, navigate])

    // Tournament details rarely change - fetch once at start.
    useEffect(() => {
        if (!uuid) return
        let cancelled = false
        fetchTournamentDetails(uuid)
            .then((t) => { if (!cancelled) setTournament(t) })
            .catch(() => { /* surfaced via toast already */ })
        return () => { cancelled = true }
    }, [uuid])

    // Bumped on every relevant WebSocket live-update so the goalscorer column
    // refetches instantly (see BigScorers refreshSignal).
    const [scorerTick, setScorerTick] = useState(0)

    const loadLive = useCallback(() => {
        if (!uuid) return
        Promise.all([
            fetchSchedule(uuid).catch(() => null),
            fetchLiveMatches().catch(() => []),
        ])
            .then(([sched, live]) => {
                if (sched) {
                    setMatches(sched.matches ?? [])
                    setHalfLengthMin(sched.halfLengthMin)
                    setHalfCount(sched.halfCount)
                }
                // The route param can be either the UUID or the pretty slug
                // (the Fullscreen button links with `slug ?? uuid`), so match
                // a live match on either field - otherwise a slug URL never
                // matches `tournamentUuid` and the live game never shows.
                setLiveMatches(
                    live.filter(
                        (m) => m.tournamentUuid === uuid || m.tournamentSlug === uuid,
                    ),
                )
            })
            .finally(() => setLoading(false))
    }, [uuid])

    // Fallback poll, paused while the tab is hidden - a backgrounded TV tab
    // stops hammering the API until it's foregrounded again.
    usePolling(loadLive, POLL_MS)

    // Realtime: refetch instantly when the backend pushes a change for THIS
    // tournament. The push carries the canonical uuid, but be liberal - accept
    // it if it matches the real uuid OR the route param (which may be a slug),
    // and always refetch when no uuid is given. Better an extra refetch than a
    // missed update.
    useLiveSocket((msg) => {
        const mine =
            !msg.tournamentUuid ||
            msg.tournamentUuid === tournament?.uuid ||
            msg.tournamentUuid === uuid
        if (!mine) return
        loadLive()
        setScorerTick((t) => t + 1)
    })

    const live = liveMatches[0] ?? null

    // Shrink the scoreboard block to fit the available height so the
    // goalscorers are never clipped on smaller screens.
    const fit = useFitScale([live?.matchId ?? null])

    // Goal flash - when the live match's total score rises (a goal was just
    // entered), flash the whole screen red for 2 seconds. Tracked by matchId
    // so switching matches doesn't trigger a false flash.
    const [goalFlash, setGoalFlash] = useState(false)
    const goalTrackRef = useRef<{ matchId: number | null; total: number }>({
        matchId: null,
        total: 0,
    })
    useEffect(() => {
        if (!live) {
            goalTrackRef.current = { matchId: null, total: 0 }
            return
        }
        const total = (live.score1 ?? 0) + (live.score2 ?? 0)
        const prev = goalTrackRef.current
        if (prev.matchId === live.matchId && total > prev.total) {
            setGoalFlash(true)
        }
        goalTrackRef.current = { matchId: live.matchId, total }
    }, [live])
    useEffect(() => {
        if (!goalFlash) return
        const id = setTimeout(() => setGoalFlash(false), 2000)
        return () => clearTimeout(id)
    }, [goalFlash])

    // The matching scheduled row gives us the team IDs so the scorers line
    // up under the right team (left = team1, right = team2).
    const liveScheduled = useMemo(
        () => (live ? matches.find((m) => m.matchId === live.matchId) ?? null : null),
        [live, matches],
    )

    // Only the single most-recent finished result.
    const lastFinished = useMemo(
        () =>
            [...matches]
                .filter((m) => m.status === "FINISHED")
                .sort(
                    (a, b) =>
                        new Date(b.kickoffAt ?? 0).getTime() -
                        new Date(a.kickoffAt ?? 0).getTime(),
                )
                .slice(0, 1),
        [matches],
    )

    // Only the single next scheduled match.
    const nextUp = useMemo(
        () =>
            [...matches]
                .filter((m) => m.status === "SCHEDULED")
                .sort(
                    (a, b) =>
                        new Date(a.kickoffAt ?? 0).getTime() -
                        new Date(b.kickoffAt ?? 0).getTime(),
                )
                .slice(0, 1),
        [matches],
    )

    const exitFullscreen = () => navigate(`/turniri/${uuid}`)

    if (loading || !tournament) {
        return (
            <FullscreenShell>
                <Flex h="100vh" align="center" justify="center" gap="4">
                    <Spinner size="lg" color="var(--fs-accent)" />
                    <Text fontSize="2xl" color="var(--fs-fg-muted)">
                        Učitavanje…
                    </Text>
                </Flex>
            </FullscreenShell>
        )
    }

    return (
        <FullscreenShell>
            {/* Goal flash - a soft, colourless veil that gently pulses for ~2s
                when a goal lands (white on dark, dark on light - no hue). */}
            {goalFlash && (
                <Box
                    position="fixed"
                    inset="0"
                    zIndex={20000}
                    pointerEvents="none"
                    bg={dark ? "rgba(255,255,255,0.13)" : "rgba(20,24,26,0.09)"}
                    css={{ animation: "pitchPulse 0.8s ease-in-out infinite" }}
                />
            )}

            {/* Exit X - top-right */}
            <Box
                as="button"
                position="fixed"
                top={{ base: "4", md: "6" }}
                right={{ base: "4", md: "6" }}
                w="48px"
                h="48px"
                rounded="full"
                bg="var(--fs-panel)"
                borderWidth="1px"
                borderColor="var(--fs-border)"
                color="var(--fs-fg)"
                display="grid"
                css={{ placeItems: "center" }}
                onClick={exitFullscreen}
                aria-label="Izađi iz fullscreena"
                cursor="pointer"
                _hover={{ bg: "var(--fs-border)" }}
                zIndex={10}
            >
                <FiX size={24} />
            </Box>

            <Flex direction="column" h="100vh" px={{ base: "6", md: "10" }} py={{ base: "6", md: "8" }}>
                {/* Header - logo lockup top-left, tournament name centred.
                    Desktop: `1fr minmax(0,3fr) 1fr` centres the name and BOUNDS
                    its column so a long name wraps to 2 lines (then ellipsis)
                    instead of truncating on one. Mobile: the columns collapse
                    to a single column (logo stacks above the name) and the logo
                    shrinks to the mark only, so the big name never overlaps the
                    wide "Futsal Turniri" wordmark or the floating exit X. */}
                <Box
                    display="grid"
                    gridTemplateColumns={{ base: "1fr", md: "1fr minmax(0, 3fr) 1fr" }}
                    alignItems="center"
                    gap={{ base: "2", md: "4" }}
                    mb={{ base: "5", md: "10" }}
                    pr={{ base: "14", md: "0" }}
                >
                    <Box justifySelf="start">
                        <Box display={{ base: "none", md: "block" }}>
                            <Logo variant={dark ? "dark" : "light"} size={64} asStatic />
                        </Box>
                        <Box display={{ base: "block", md: "none" }}>
                            <Logo variant={dark ? "dark" : "light"} size={40} asStatic markOnly />
                        </Box>
                    </Box>
                    <Text
                        // Tournament name is secondary to the score / clock, so
                        // keep it modest - and shrink it further when it's long
                        // (still wraps to 2 lines, then ellipsis).
                        fontSize={
                            (tournament.name?.length ?? 0) > 26
                                ? { base: "16px", md: "24px", lg: "32px" }
                                : { base: "20px", md: "32px", lg: "44px" }
                        }
                        fontWeight={800}
                        letterSpacing="-0.03em"
                        color="var(--fs-fg)"
                        lineHeight={1.1}
                        textAlign={{ base: "left", md: "center" }}
                        lineClamp="2"
                        minW="0"
                    >
                        {tournament.name}
                    </Text>
                    <Box display={{ base: "none", md: "block" }} />
                </Box>

                {/* Centerpiece: huge live scoreboard, or empty-state. Top-aligned
                    so the teams + score sit a bit higher and a long goalscorer
                    list just stacks downward instead of pushing everything up. */}
                <Flex
                    ref={fit.availRef}
                    flex="1"
                    align="flex-start"
                    justify="center"
                    minH="0"
                    overflow="hidden"
                >
                    {live ? (
                        <Box
                            ref={fit.contentRef}
                            w="full"
                            transformOrigin="top center"
                            style={{ transform: `scale(${fit.scale})` }}
                        >
                            <BigScoreboard
                                match={live}
                                team1Id={liveScheduled?.team1Id ?? null}
                                team2Id={liveScheduled?.team2Id ?? null}
                                halfLengthMin={halfLengthMin}
                                halfCount={halfCount}
                                refreshSignal={scorerTick}
                            />
                        </Box>
                    ) : (
                        <NoLiveMessage />
                    )}
                </Flex>

                {/* Bottom strip: last result + next match */}
                <Flex
                    gap={{ base: "6", md: "10" }}
                    pt="6"
                    borderTopWidth="1px"
                    borderColor="var(--fs-border)"
                    direction={{ base: "column", md: "row" }}
                    align="stretch"
                >
                    <MatchStrip
                        title="ZAVRŠENO"
                        matches={lastFinished}
                        emptyLabel="Nema završenih utakmica"
                    />
                    <MatchStrip
                        title="SLJEDEĆE"
                        matches={nextUp}
                        emptyLabel="Nema zakazanih utakmica"
                    />
                </Flex>
            </Flex>
        </FullscreenShell>
    )
}

/* ── Greyish, theme-aware shell used by all states. Sets the --fs-* CSS
   variables every child reads, paints the grey backdrop and the faint
   logo watermark. */
function FullscreenShell({ children }: { children: React.ReactNode }) {
    const { colorMode } = useColorMode()
    const dark = colorMode === "dark"
    return (
        <Box
            position="fixed"
            inset="0"
            overflow="hidden"
            zIndex={9999}
            color="var(--fs-fg)"
            bg={
                dark
                    ? "linear-gradient(135deg, #1B2A38 0%, #0B1522 100%)"
                    : "linear-gradient(135deg, #EEFAF8 0%, #E3F7F5 100%)"
            }
            css={{
                "--fs-fg": dark ? "#ffffff" : "#14181a",
                "--fs-fg-muted": dark ? "rgba(255,255,255,0.68)" : "rgba(20,24,26,0.62)",
                "--fs-fg-subtle": dark ? "rgba(255,255,255,0.40)" : "rgba(20,24,26,0.38)",
                "--fs-panel": dark ? "rgba(255,255,255,0.05)" : "rgba(11,21,34,0.045)",
                "--fs-border": dark ? "rgba(255,255,255,0.14)" : "rgba(11,21,34,0.12)",
                "--fs-accent": dark ? "#2AD4C8" : "#0E8A81",
            }}
        >
            <Box position="relative" zIndex={1} h="100%">
                {children}
            </Box>
        </Box>
    )
}

/* ── Huge live-match scoreboard - the visual focal point. Static by default;
   only the red ring pulses during the final minute of a half / the match. */
function BigScoreboard({
    match,
    team1Id,
    team2Id,
    halfLengthMin,
    halfCount,
    refreshSignal,
}: {
    match: LiveMatch
    team1Id: number | null
    team2Id: number | null
    halfLengthMin: number | null
    halfCount: number | null
    refreshSignal?: number
}) {
    // Re-render every second so the clock counts up and the last-minute
    // pulse turns on/off exactly when the remaining time crosses 60s.
    const [, setTick] = useState(0)
    useEffect(() => {
        const id = setInterval(() => setTick((t) => t + 1), 1000)
        return () => clearInterval(id)
    }, [])

    const clock = computeClock(match, halfLengthMin, halfCount)
    const pulsing = clock.lastMinute

    // Accumulated fouls for the running half (resets when the 2nd half starts).
    const half = match.secondHalfStartedAt ? 2 : 1
    const fouls1 = half === 1 ? (match.fouls1First ?? 0) : (match.fouls1Second ?? 0)
    const fouls2 = half === 1 ? (match.fouls2First ?? 0) : (match.fouls2Second ?? 0)

    return (
        <Box
            w="full"
            maxW="1600px"
            mx="auto"
            position="relative"
            rounded="3xl"
            px={{ base: "6", md: "10", lg: "14" }}
            py={{ base: "3", md: "5", lg: "6" }}
        >
            {/* Last-minute pulse - a red ring overlay that fades in/out, so the
                score/names underneath stay perfectly readable. Only mounted
                during the final minute of a half (or the match). */}
            {pulsing && (
                <Box
                    position="absolute"
                    inset="0"
                    rounded="3xl"
                    borderWidth="4px"
                    borderColor="accent.red"
                    css={{
                        boxShadow:
                            "0 0 90px rgba(220,38,38,0.55), inset 0 0 70px rgba(220,38,38,0.22)",
                        animation: "pitchPulse 1.1s infinite",
                        pointerEvents: "none",
                    }}
                />
            )}

            {/* Live tag */}
            <Flex
                justify="center"
                mb="clamp(6px, 1.6vh, 20px)"
                gap="3"
                align="center"
            >
                <Box
                    w="14px"
                    h="14px"
                    rounded="full"
                    bg="accent.red"
                    css={{ boxShadow: "0 0 16px var(--chakra-colors-accent-red)" }}
                />
                <Text
                    fontFamily="mono"
                    fontSize={{ base: "16px", md: "20px" }}
                    fontWeight={800}
                    letterSpacing="0.3em"
                    color="accent.red"
                >
                    UŽIVO
                </Text>
            </Flex>

            {/* Live match clock (counts up, half-aware) */}
            <BigMatchClock display={clock.display} label={clock.label} pulsing={pulsing} />

            {/* Scoreboard row */}
            <Flex
                align="center"
                justify="space-between"
                gap={{ base: "4", md: "10" }}
                direction={{ base: "column", lg: "row" }}
            >
                <BigTeamName name={match.team1Name ?? "-"} align="right" />
                <Flex
                    fontFamily="mono"
                    fontSize="clamp(56px, 17vh, 180px)"
                    fontWeight={800}
                    color="var(--fs-fg)"
                    letterSpacing="-0.05em"
                    lineHeight={1}
                    gap={{ base: "4", md: "8" }}
                    align="center"
                    justify="center"
                    minW={{ base: "auto", lg: "400px" }}
                >
                    <Box>{match.score1 ?? 0}</Box>
                    <Box opacity={0.4}>:</Box>
                    <Box>{match.score2 ?? 0}</Box>
                </Flex>
                <BigTeamName name={match.team2Name ?? "-"} align="left" />
            </Flex>

            {/* Accumulated fouls - a centred "AKUMULIRANI PREKRŠAJI" label with
                each team's five foul icons on its own side (they fill up as
                fouls are committed; red once in deveterac territory). */}
            <Flex
                align="center"
                justify="center"
                gap={{ base: "8", md: "24" }}
                mt="clamp(8px, 2vh, 20px)"
                wrap="wrap"
            >
                <FoulIcons fouls={fouls1} />
                <Text
                    fontSize="clamp(13px, 2vh, 24px)"
                    fontWeight={800}
                    letterSpacing="0.06em"
                    textTransform="uppercase"
                    color="var(--fs-fg-muted)"
                    whiteSpace="nowrap"
                >
                    Akumulirani prekršaji
                </Text>
                <FoulIcons fouls={fouls2} />
            </Flex>

            {/* Goalscorers (strijelci) - left = team1, right = team2 */}
            <BigScorers
                tournamentUuid={match.tournamentUuid}
                matchId={match.matchId}
                team1Id={team1Id}
                team2Id={team2Id}
                pollMs={POLL_MS}
                refreshSignal={refreshSignal}
            />
        </Box>
    )
}

/* ── Whole seconds since an ISO instant (>= 0). While `pausedAt` is set the
   elapsed time is measured up to the pause instant, freezing the display. */
function elapsedSecs(at: string | null | undefined, pausedAt?: string | null): number {
    if (!at) return 0
    const s = new Date(at).getTime()
    if (!Number.isFinite(s)) return 0
    let now = Date.now()
    if (pausedAt) {
        const p = new Date(pausedAt).getTime()
        if (Number.isFinite(p)) now = p
    }
    const d = now - s
    return d > 0 ? Math.floor(d / 1000) : 0
}

function fmtClock(total: number): string {
    const s = Math.max(0, Math.floor(total))
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

type ClockInfo = { display: string; label: string; lastMinute: boolean }

/* ── Scoreboard clock state. TIMER mode counts the cumulative match time UP,
   freezing at each half boundary (1st half → half length → 2× half length),
   and flags `lastMinute` when ≤60s remain in the running half; SIMPLE /
   no-config just counts elapsed time up and never flags last-minute (we don't
   know when a half ends). */
function computeClock(
    match: LiveMatch,
    halfLengthMin: number | null,
    halfCount: number | null,
): ClockInfo {
    const paused = match.livePausedAt ?? null
    const isTimer =
        match.liveMode === "TIMER" && halfLengthMin != null && halfLengthMin > 0
    if (!isTimer) {
        return {
            display: fmtClock(elapsedSecs(match.liveStartedAt, paused)),
            label: paused ? "PAUZA" : "",
            lastMinute: false,
        }
    }
    const halfSecs = halfLengthMin! * 60
    const halves = halfCount === 1 ? 1 : 2
    const phase = matchPhase({
        liveStartedAt: match.liveStartedAt,
        firstHalfEndedAt: match.firstHalfEndedAt,
        secondHalfStartedAt: match.secondHalfStartedAt,
        livePausedAt: paused,
        halfLengthMin,
        halfCount,
    })
    // Counts UP the cumulative match minute, freezing at each half boundary
    // (and at the pause instant while the organizer has the clock paused).
    switch (phase) {
        case "FIRST_HALF": {
            const into = elapsedSecs(match.liveStartedAt, paused)
            const rem = halfSecs - into
            return { display: fmtClock(Math.min(into, halfSecs)), label: paused ? "PAUZA" : "1. POLUVRIJEME", lastMinute: !paused && rem > 0 && rem <= 60 }
        }
        case "HALFTIME":
            return { display: fmtClock(halfSecs), label: "POLUVRIJEME", lastMinute: false }
        case "SECOND_HALF": {
            const into = elapsedSecs(match.secondHalfStartedAt, paused)
            const rem = halfSecs - into
            return { display: fmtClock(Math.min(halfSecs + into, 2 * halfSecs)), label: paused ? "PAUZA" : "2. POLUVRIJEME", lastMinute: !paused && rem > 0 && rem <= 60 }
        }
        case "FULL_TIME":
        default:
            return { display: fmtClock(halves * halfSecs), label: "KRAJ", lastMinute: false }
    }
}

/* ── Clock display - presentational. Turns red in the final minute. */
function BigMatchClock({
    display,
    label,
    pulsing,
}: {
    display: string
    label: string
    pulsing: boolean
}) {
    return (
        <VStack gap="0.5" mb="clamp(8px, 2.5vh, 32px)">
            <Text
                fontFamily="mono"
                fontSize="clamp(34px, 7vh, 68px)"
                fontWeight={800}
                color={pulsing ? "accent.red" : "var(--fs-fg)"}
                letterSpacing="-0.02em"
                lineHeight={1}
                css={{ fontVariantNumeric: "tabular-nums" }}
            >
                {display}
            </Text>
            <Text
                fontFamily="mono"
                fontSize="clamp(11px, 1.5vh, 15px)"
                fontWeight={700}
                letterSpacing="0.25em"
                color={pulsing ? "accent.red" : "var(--fs-fg-muted)"}
            >
                {label}
            </Text>
        </VStack>
    )
}

/* ── Goalscorers under the scoreboard. Polls match events, shows GOAL
   events split left (team1) / right (team2). */
function BigScorers({
    tournamentUuid,
    matchId,
    team1Id,
    team2Id,
    pollMs,
    refreshSignal,
}: {
    tournamentUuid: string
    matchId: number
    team1Id: number | null
    team2Id: number | null
    pollMs: number
    /** Bumped from a WebSocket live-update → refetch instantly. */
    refreshSignal?: number
}) {
    const [events, setEvents] = useState<MatchEventDto[]>([])

    useEffect(() => {
        let stopped = false
        const load = () =>
            fetchMatchEvents(tournamentUuid, matchId)
                .then((e) => { if (!stopped) setEvents(e) })
                .catch(() => { /* keep last data on transient errors */ })
        load()
        const id = setInterval(load, pollMs)
        return () => { stopped = true; clearInterval(id) }
        // refreshSignal in deps → an instant refetch when the socket pings.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tournamentUuid, matchId, pollMs, refreshSignal])

    // Regular goals AND own goals (an own goal's teamId is the beneficiary,
    // so it already lands on the correct side). Own goals carry a red-ball
    // marker + "(ag)" so they read distinctly from a normal goal.
    const goals = useMemo(
        () =>
            events
                .filter((e) => e.type === "GOAL" || e.type === "OWN_GOAL")
                .sort((a, b) => a.minute - b.minute),
        [events],
    )

    // Resolve team IDs - prefer the scheduled ones, else auto-detect (smaller
    // id → left) so the columns still split sensibly.
    let t1 = team1Id
    let t2 = team2Id
    if (t1 == null || t2 == null) {
        const distinct = Array.from(new Set(goals.map((g) => g.teamId))).sort((a, b) => a - b)
        t1 = t1 ?? distinct[0] ?? null
        t2 = t2 ?? distinct[1] ?? null
    }

    if (goals.length === 0) return null

    const left = goals.filter((g) => g.teamId === t1)
    const right = goals.filter((g) => g.teamId === t2)

    return (
        <Flex
            mt="clamp(10px, 2.4vh, 36px)"
            pt="clamp(8px, 1.8vh, 28px)"
            borderTopWidth="1px"
            borderColor="var(--fs-border)"
            gap={{ base: "5", md: "10" }}
            align="flex-start"
            justify="center"
        >
            <ScorerColumn goals={left} align="right" />
            <Box w="1px" alignSelf="stretch" bg="var(--fs-border)" minH="20px" />
            <ScorerColumn goals={right} align="left" />
        </Flex>
    )
}

function ScorerColumn({
    goals,
    align,
}: {
    goals: MatchEventDto[]
    align: "left" | "right"
}) {
    return (
        <VStack flex="1" minW="0" maxW="46%" gap="1" align={align === "right" ? "flex-end" : "flex-start"}>
            {goals.map((g) => {
                const own = g.type === "OWN_GOAL"
                // Anonymous scorer (no named player) - shown as "Nepoznati
                // strijelac" (or "Autogol" for an unattributed own goal), in
                // italics so it reads distinctly from a named scorer.
                const noName = g.playerName == null
                // Own goal: name of the player who put it in his own net + "(ag)"
                // (or just "Autogol" when anonymous); a red ball marks it.
                const name = own
                    ? g.playerName != null ? `${g.playerName} (ag)` : "Autogol"
                    : g.playerName ?? "Nepoznati strijelac"
                const ball = own ? (
                    <chakra.span display="inline-flex" flexShrink={0} css={{ color: "#ff5c4e" }}>
                        <GiSoccerBall size="1em" />
                    </chakra.span>
                ) : null
                const minuteEl = (
                    <chakra.span color="var(--fs-fg-subtle)" fontWeight={800} flexShrink={0}>
                        {g.minute}&apos;
                    </chakra.span>
                )
                return (
                    <Flex
                        key={g.id}
                        align="center"
                        gap="1.5"
                        maxW="full"
                        minW="0"
                        justify={align === "right" ? "flex-end" : "flex-start"}
                        fontSize="clamp(14px, 2vh, 26px)"
                        fontWeight={600}
                        color="var(--fs-fg)"
                    >
                        {align === "right" ? (
                            <>
                                {ball}
                                <chakra.span truncate minW="0" fontStyle={noName ? "italic" : undefined}>{name}</chakra.span>
                                {minuteEl}
                            </>
                        ) : (
                            <>
                                {minuteEl}
                                <chakra.span truncate minW="0" fontStyle={noName ? "italic" : undefined}>{name}</chakra.span>
                                {ball}
                            </>
                        )}
                    </Flex>
                )
            })}
        </VStack>
    )
}

function BigTeamName({ name, align }: { name: string; align: "left" | "right" }) {
    return (
        <Box flex="1" textAlign={{ base: "center", lg: align }} minW="0">
            <Text
                fontSize="clamp(26px, 7vh, 72px)"
                fontWeight={800}
                color="var(--fs-fg)"
                letterSpacing="-0.02em"
                lineHeight={1.05}
                truncate
            >
                {name}
            </Text>
        </Box>
    )
}

/* ── FoulIcons - a team's accumulated-foul icons for the current half. The
   first four are black (dim until committed); from the 5th foul (deveterac)
   each further foul adds a red icon - so 4 black + N red shows N deveterci. */
function FoulIcons({ fouls }: { fouls: number }) {
    const total = Math.max(5, fouls)
    return (
        <HStack gap="1.5" flexWrap="wrap" justify="center">
            {Array.from({ length: total }, (_, i) => {
                const committed = i < fouls
                const red = i >= 4 // the 5th icon onward is a deveterac (red)
                return (
                    <Box
                        as="span"
                        key={i}
                        display="inline-flex"
                        color={red ? "accent.red" : "var(--fs-fg)"}
                        opacity={committed ? 1 : 0.18}
                    >
                        <GiSoccerKick size={22} />
                    </Box>
                )
            })}
        </HStack>
    )
}

/* ── No live match - show a friendly waiting message. */
function NoLiveMessage() {
    return (
        <VStack gap="6">
            <Text
                fontFamily="mono"
                fontSize={{ base: "16px", md: "20px" }}
                fontWeight={700}
                letterSpacing="0.3em"
                color="var(--fs-fg-subtle)"
            >
                NEMA UTAKMICE U TIJEKU
            </Text>
            <Text
                fontSize={{ base: "28px", md: "40px" }}
                fontWeight={600}
                color="var(--fs-fg-subtle)"
            >
                Čekamo sljedeći termin…
            </Text>
        </VStack>
    )
}

/* ── Bottom strip - last result / next match. */
function MatchStrip({
    title,
    matches,
    emptyLabel,
}: {
    title: string
    matches: ScheduledMatch[]
    emptyLabel: string
}) {
    // Equal width (flex 1) AND equal height: the parent strip is align="stretch"
    // and the content box flex-grows, so the bordered card / empty box always
    // fill the same area in both columns regardless of content.
    const ROW_MIN_H = { base: "60px", md: "74px" }
    return (
        <Box flex="1" minW="0" display="flex" flexDirection="column">
            <Text
                fontFamily="mono"
                fontSize={{ base: "12px", md: "14px" }}
                fontWeight={800}
                letterSpacing="0.2em"
                color="var(--fs-accent)"
                mb="3"
            >
                {title}
            </Text>
            <Box flex="1">
                {matches.length === 0 ? (
                    <Flex
                        h="full"
                        minH={ROW_MIN_H}
                        align="center"
                        px="4"
                        rounded="lg"
                        borderWidth="1px"
                        borderColor="var(--fs-border)"
                        bg="var(--fs-panel)"
                    >
                        <Text fontSize="lg" color="var(--fs-fg-subtle)">
                            {emptyLabel}
                        </Text>
                    </Flex>
                ) : (
                    <VStack align="stretch" gap="2" h="full">
                        {matches.map((m) => (
                            <Flex
                                key={m.matchId}
                                h="full"
                                minH={ROW_MIN_H}
                                justify="space-between"
                                align="center"
                                gap="3"
                                px="4"
                                py="3"
                                bg="var(--fs-panel)"
                                rounded="lg"
                                borderLeftWidth="3px"
                                borderColor={
                                    m.status === "FINISHED"
                                        ? "var(--fs-accent)"
                                        : "var(--fs-border)"
                                }
                            >
                                <Flex align="center" gap="3" flex="1" minW="0">
                                    <FiClock size={14} opacity={0.4} />
                                    <Text
                                        fontFamily="mono"
                                        fontSize="14px"
                                        color="var(--fs-fg-subtle)"
                                        fontWeight={600}
                                    >
                                        {formatKickoff(m.kickoffAt)}
                                    </Text>
                                    <Text
                                        fontSize={{ base: "15px", md: "18px" }}
                                        fontWeight={600}
                                        color="var(--fs-fg)"
                                        truncate
                                        minW="0"
                                    >
                                        {m.team1Name ?? "-"} vs {m.team2Name ?? "-"}
                                    </Text>
                                </Flex>
                                {m.status === "FINISHED" && (
                                    <Text
                                        fontFamily="mono"
                                        fontSize={{ base: "16px", md: "20px" }}
                                        fontWeight={800}
                                        color="var(--fs-fg)"
                                        bg="var(--fs-panel)"
                                        px="3"
                                        py="1"
                                        rounded="md"
                                        whiteSpace="nowrap"
                                    >
                                        {m.score1 ?? 0}:{m.score2 ?? 0}
                                        {m.penalties1 != null && m.penalties2 != null && (
                                            <Box
                                                as="span"
                                                ml="1.5"
                                                fontSize={{ base: "11px", md: "13px" }}
                                                fontWeight={700}
                                                color="var(--fs-fg-subtle)"
                                            >
                                                ({m.penalties1}:{m.penalties2} pen)
                                            </Box>
                                        )}
                                    </Text>
                                )}
                            </Flex>
                        ))}
                    </VStack>
                )}
            </Box>
        </Box>
    )
}

function formatKickoff(iso: string | null | undefined): string {
    if (!iso) return "-"
    try {
        const d = new Date(iso)
        return d.toLocaleTimeString("hr-HR", {
            hour: "2-digit",
            minute: "2-digit",
        })
    } catch {
        return "-"
    }
}
