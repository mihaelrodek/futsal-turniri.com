import { useEffect, useMemo, useState } from "react"
import { Box, Flex, Spinner, Text, VStack } from "@chakra-ui/react"
import { useNavigate, useParams } from "react-router-dom"
import { FiClock, FiX } from "react-icons/fi"
import { fetchTournamentDetails } from "../api/tournaments"
import { fetchSchedule } from "../api/schedule"
import { fetchLiveMatches } from "../api/live"
import type { TournamentDetails } from "../types/tournaments"
import type { ScheduledMatch } from "../types/schedule"
import type { LiveMatch } from "../api/live"

/* ──────────────────────────────────────────────────────────────────────────
   FullscreenTournamentPage — big-screen TV display for a single tournament.

   Use case: organizer plugs a laptop into a venue TV and opens this URL.
   Page renders a dark, high-contrast layout legible from across the room:
     • Tournament name + status as a strip across the top
     • Centerpiece: huge scoreboard for the current LIVE match (team
       names + 120px score), pulsing red border
     • Below: a recent-results row (last 3 finished) and an
       upcoming-matches row (next 3 scheduled)
     • Polls live matches + schedule every 15 s so the display stays current

   Tries `document.documentElement.requestFullscreen()` on mount so the
   browser chrome is hidden too — ESC (or click X) leaves and returns to
   the regular detail page. Some browsers require a user gesture to
   enter fullscreen; if the requestFullscreen call rejects we silently
   fall back to a regular full-viewport layout.
   ────────────────────────────────────────────────────────────────────── */

const POLL_MS = 15_000

export default function FullscreenTournamentPage() {
    const { uuid } = useParams<{ uuid: string }>()
    const navigate = useNavigate()

    const [tournament, setTournament] = useState<TournamentDetails | null>(null)
    const [matches, setMatches] = useState<ScheduledMatch[]>([])
    const [liveMatches, setLiveMatches] = useState<LiveMatch[]>([])
    const [loading, setLoading] = useState(true)

    // Try to enter true browser fullscreen on mount. Reverts on unmount.
    useEffect(() => {
        const el = document.documentElement
        if (el.requestFullscreen) {
            el.requestFullscreen().catch(() => {
                /* user gesture required / browser refused — fall back to layout-only fullscreen */
            })
        }
        return () => {
            if (document.fullscreenElement && document.exitFullscreen) {
                document.exitFullscreen().catch(() => {})
            }
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

    // Initial fetch + 15s poll for live matches and schedule. Tournament
    // details rarely change so we re-fetch them once at start.
    useEffect(() => {
        if (!uuid) return
        let cancelled = false
        const loadOnce = async () => {
            try {
                const t = await fetchTournamentDetails(uuid)
                if (!cancelled) setTournament(t)
            } catch {
                /* surfaced via toast already */
            }
        }
        const loadStream = async () => {
            try {
                const [sched, live] = await Promise.all([
                    fetchSchedule(uuid).catch(() => null),
                    fetchLiveMatches().catch(() => []),
                ])
                if (cancelled) return
                if (sched) setMatches(sched.matches ?? [])
                setLiveMatches(live.filter((m) => m.tournamentUuid === uuid))
            } catch {
                /* network blip — keep what we had */
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        loadOnce()
        loadStream()
        const id = setInterval(loadStream, POLL_MS)
        return () => {
            cancelled = true
            clearInterval(id)
        }
    }, [uuid])

    const live = liveMatches[0] ?? null

    const finishedRecent = useMemo(
        () =>
            [...matches]
                .filter((m) => m.status === "FINISHED")
                .sort(
                    (a, b) =>
                        new Date(b.kickoffAt ?? 0).getTime() -
                        new Date(a.kickoffAt ?? 0).getTime(),
                )
                .slice(0, 3),
        [matches],
    )

    const upcomingNext = useMemo(
        () =>
            [...matches]
                .filter((m) => m.status === "SCHEDULED")
                .sort(
                    (a, b) =>
                        new Date(a.kickoffAt ?? 0).getTime() -
                        new Date(b.kickoffAt ?? 0).getTime(),
                )
                .slice(0, 3),
        [matches],
    )

    const exitFullscreen = () => navigate(`/turniri/${uuid}`)

    if (loading || !tournament) {
        return (
            <FullscreenShell>
                <Flex h="100vh" align="center" justify="center" gap="4">
                    <Spinner size="lg" color="white" />
                    <Text fontSize="2xl" color="whiteAlpha.800">
                        Učitavanje…
                    </Text>
                </Flex>
            </FullscreenShell>
        )
    }

    return (
        <FullscreenShell>
            {/* Exit X — top-right */}
            <Box
                as="button"
                position="fixed"
                top={{ base: "4", md: "6" }}
                right={{ base: "4", md: "6" }}
                w="48px"
                h="48px"
                rounded="full"
                bg="rgba(255,255,255,0.1)"
                color="white"
                display="grid"
                css={{ placeItems: "center" }}
                onClick={exitFullscreen}
                aria-label="Izađi iz fullscreena"
                cursor="pointer"
                _hover={{ bg: "rgba(255,255,255,0.2)" }}
                zIndex={10}
            >
                <FiX size={24} />
            </Box>

            <Flex direction="column" h="100vh" px={{ base: "6", md: "10" }} py={{ base: "6", md: "8" }}>
                {/* Tournament name strip */}
                <VStack align="stretch" gap="2" mb="8">
                    <Text
                        fontFamily="mono"
                        fontSize={{ base: "14px", md: "16px" }}
                        fontWeight={700}
                        letterSpacing="0.2em"
                        color="pitch.400"
                    >
                        FUTSAL TURNIRI · HRVATSKA
                    </Text>
                    <Text
                        fontSize={{ base: "32px", md: "48px", lg: "64px" }}
                        fontWeight={800}
                        letterSpacing="-0.03em"
                        color="white"
                        lineHeight={1.05}
                    >
                        {tournament.name}
                    </Text>
                </VStack>

                {/* Centerpiece: huge live scoreboard, or empty-state */}
                <Flex flex="1" align="center" justify="center">
                    {live ? <BigScoreboard match={live} /> : <NoLiveMessage />}
                </Flex>

                {/* Bottom strip: recent results + upcoming */}
                <Flex
                    gap={{ base: "6", md: "10" }}
                    pt="6"
                    borderTopWidth="1px"
                    borderColor="whiteAlpha.200"
                    direction={{ base: "column", md: "row" }}
                >
                    <MatchStrip
                        title="ZAVRŠENO"
                        matches={finishedRecent}
                        emptyLabel="Nema završenih utakmica"
                    />
                    <MatchStrip
                        title="SLJEDEĆE"
                        matches={upcomingNext}
                        emptyLabel="Nema zakazanih utakmica"
                    />
                </Flex>
            </Flex>
        </FullscreenShell>
    )
}

/* ── Dark high-contrast shell used by all states. */
function FullscreenShell({ children }: { children: React.ReactNode }) {
    return (
        <Box
            position="fixed"
            inset="0"
            bg="linear-gradient(135deg, #0a1610 0%, #0e1f15 60%, #0a1f12 100%)"
            color="white"
            overflow="hidden"
            zIndex={9999}
        >
            {children}
        </Box>
    )
}

/* ── Huge live-match scoreboard — the visual focal point. */
function BigScoreboard({ match }: { match: LiveMatch }) {
    return (
        <Box
            w="full"
            maxW="1600px"
            mx="auto"
            position="relative"
            borderWidth="3px"
            borderColor="rgba(220,38,38,0.55)"
            rounded="3xl"
            p={{ base: "6", md: "10", lg: "14" }}
            bg="rgba(220,38,38,0.06)"
            css={{
                boxShadow: "0 0 80px rgba(220,38,38,0.25)",
                animation: "pitchPulse 1.6s infinite",
            }}
        >
            {/* Live tag */}
            <Flex
                justify="center"
                mb={{ base: "6", md: "10" }}
                gap="3"
                align="center"
            >
                <Box
                    w="14px"
                    h="14px"
                    rounded="full"
                    bg="accent.red"
                    css={{
                        boxShadow: "0 0 16px var(--chakra-colors-accent-red)",
                        animation: "pitchPulse 1s infinite",
                    }}
                />
                <Text
                    fontFamily="mono"
                    fontSize={{ base: "16px", md: "20px" }}
                    fontWeight={800}
                    letterSpacing="0.3em"
                    color="accent.red"
                >
                    UŽIVO · {match.tournamentName ?? ""}
                </Text>
            </Flex>

            {/* Scoreboard row */}
            <Flex
                align="center"
                justify="space-between"
                gap={{ base: "4", md: "10" }}
                direction={{ base: "column", lg: "row" }}
            >
                <BigTeamName name={match.team1Name ?? "—"} align="right" />
                <Flex
                    fontFamily="mono"
                    fontSize={{ base: "80px", md: "120px", lg: "180px" }}
                    fontWeight={800}
                    color="white"
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
                <BigTeamName name={match.team2Name ?? "—"} align="left" />
            </Flex>
        </Box>
    )
}

function BigTeamName({ name, align }: { name: string; align: "left" | "right" }) {
    return (
        <Box flex="1" textAlign={{ base: "center", lg: align }} minW="0">
            <Text
                fontSize={{ base: "36px", md: "56px", lg: "72px" }}
                fontWeight={800}
                color="white"
                letterSpacing="-0.02em"
                lineHeight={1.05}
                truncate
            >
                {name}
            </Text>
        </Box>
    )
}

/* ── No live match — show a friendly waiting message. */
function NoLiveMessage() {
    return (
        <VStack gap="6">
            <Text
                fontFamily="mono"
                fontSize={{ base: "16px", md: "20px" }}
                fontWeight={700}
                letterSpacing="0.3em"
                color="whiteAlpha.600"
            >
                NEMA UTAKMICE U TIJEKU
            </Text>
            <Text
                fontSize={{ base: "28px", md: "40px" }}
                fontWeight={600}
                color="whiteAlpha.400"
            >
                Čekamo sljedeći termin…
            </Text>
        </VStack>
    )
}

/* ── Bottom strip — recent results / upcoming. */
function MatchStrip({
    title,
    matches,
    emptyLabel,
}: {
    title: string
    matches: ScheduledMatch[]
    emptyLabel: string
}) {
    return (
        <Box flex="1">
            <Text
                fontFamily="mono"
                fontSize={{ base: "12px", md: "14px" }}
                fontWeight={800}
                letterSpacing="0.2em"
                color="pitch.400"
                mb="3"
            >
                {title}
            </Text>
            {matches.length === 0 ? (
                <Text fontSize="lg" color="whiteAlpha.400">
                    {emptyLabel}
                </Text>
            ) : (
                <VStack align="stretch" gap="2">
                    {matches.map((m) => (
                        <Flex
                            key={m.matchId}
                            justify="space-between"
                            align="center"
                            gap="3"
                            px="4"
                            py="3"
                            bg="whiteAlpha.50"
                            rounded="lg"
                            borderLeftWidth="3px"
                            borderColor={
                                m.status === "FINISHED"
                                    ? "pitch.400"
                                    : "whiteAlpha.300"
                            }
                        >
                            <Flex align="center" gap="3" flex="1" minW="0">
                                <FiClock size={14} opacity={0.4} />
                                <Text
                                    fontFamily="mono"
                                    fontSize="14px"
                                    color="whiteAlpha.500"
                                    fontWeight={600}
                                >
                                    {formatKickoff(m.kickoffAt)}
                                </Text>
                                <Text
                                    fontSize={{ base: "15px", md: "18px" }}
                                    fontWeight={600}
                                    color="white"
                                    truncate
                                    minW="0"
                                >
                                    {m.team1Name ?? "—"} vs {m.team2Name ?? "—"}
                                </Text>
                            </Flex>
                            {m.status === "FINISHED" && (
                                <Text
                                    fontFamily="mono"
                                    fontSize={{ base: "16px", md: "20px" }}
                                    fontWeight={800}
                                    color="white"
                                    bg="whiteAlpha.100"
                                    px="3"
                                    py="1"
                                    rounded="md"
                                >
                                    {m.score1 ?? 0}:{m.score2 ?? 0}
                                </Text>
                            )}
                        </Flex>
                    ))}
                </VStack>
            )}
        </Box>
    )
}

function formatKickoff(iso: string | null | undefined): string {
    if (!iso) return "—"
    try {
        const d = new Date(iso)
        return d.toLocaleTimeString("hr-HR", {
            hour: "2-digit",
            minute: "2-digit",
        })
    } catch {
        return "—"
    }
}
