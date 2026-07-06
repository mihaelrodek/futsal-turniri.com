import { useEffect, useMemo, useState } from "react"
import { Box, Flex, HStack, Link, Spinner, Text, VStack } from "@chakra-ui/react"
import { useParams } from "react-router-dom"
import { fetchTournamentDetails } from "../api/tournaments"
import { fetchSchedule } from "../api/schedule"
import { fetchLiveMatches } from "../api/live"
import { usePolling } from "../hooks/usePolling"
import type { TournamentDetails } from "../types/tournaments"
import type { ScheduledMatch } from "../types/schedule"
import type { LiveMatch } from "../api/live"

/* ──────────────────────────────────────────────────────────────────────────
   EmbedTournamentPage — iframe-friendly scoreboard widget.

   Use case: a tournament organizer copies an <iframe> snippet into their
   own website (club page, sponsor portal, etc.) and the live state of
   the tournament stays in sync — no manual updates.

   This route is rendered without NavBar / MobileBottomNav (see App.tsx
   path detection on /embed/*), with a transparent body so the iframe
   blends into the host page's background.

   What it shows, in priority order:
     1. Live match (if any) — big scoreboard with pulsing red dot
     2. Last finished match — final score
     3. Next scheduled match — kickoff time
     4. Empty state — "Nema utakmica"

   Polls every 15 s so the embed stays current without consuming the host
   site's CPU.
   ────────────────────────────────────────────────────────────────────── */

const POLL_MS = 15_000

export default function EmbedTournamentPage() {
    const { uuid } = useParams<{ uuid: string }>()

    const [tournament, setTournament] = useState<TournamentDetails | null>(null)
    const [matches, setMatches] = useState<ScheduledMatch[]>([])
    const [liveMatches, setLiveMatches] = useState<LiveMatch[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        // Transparent body so host page background shows through.
        const prev = document.body.style.background
        document.body.style.background = "transparent"
        return () => {
            document.body.style.background = prev
        }
    }, [])

    // Tournament details only need fetching once.
    useEffect(() => {
        if (!uuid) return
        let cancelled = false
        fetchTournamentDetails(uuid)
            .then((t) => { if (!cancelled) setTournament(t) })
            .catch(() => { /* ignore */ })
        return () => { cancelled = true }
    }, [uuid])

    // Live state (schedule + live matches) polled every POLL_MS, paused
    // while the tab/iframe is hidden.
    usePolling(() => {
        if (!uuid) return
        Promise.all([
            fetchSchedule(uuid).catch(() => null),
            fetchLiveMatches().catch(() => []),
        ])
            .then(([sched, live]) => {
                if (sched) setMatches(sched.matches ?? [])
                setLiveMatches(live.filter((m) => m.tournamentUuid === uuid))
            })
            .finally(() => setLoading(false))
    }, POLL_MS)

    const live = liveMatches[0] ?? null

    const lastFinished = useMemo(
        () =>
            [...matches]
                .filter((m) => m.status === "FINISHED")
                .sort(
                    (a, b) =>
                        new Date(b.kickoffAt ?? 0).getTime() -
                        new Date(a.kickoffAt ?? 0).getTime(),
                )[0] ?? null,
        [matches],
    )

    const nextUpcoming = useMemo(
        () =>
            [...matches]
                .filter((m) => m.status === "SCHEDULED")
                .sort(
                    (a, b) =>
                        new Date(a.kickoffAt ?? 0).getTime() -
                        new Date(b.kickoffAt ?? 0).getTime(),
                )[0] ?? null,
        [matches],
    )

    if (loading) {
        return (
            <Shell>
                <Flex h="180px" align="center" justify="center">
                    <Spinner color="pitch.500" />
                </Flex>
            </Shell>
        )
    }

    if (!tournament) {
        return (
            <Shell>
                <Flex h="180px" align="center" justify="center">
                    <Text fontSize="sm" color="fg.muted">
                        Turnir nije pronađen.
                    </Text>
                </Flex>
            </Shell>
        )
    }

    return (
        <Shell>
            <VStack align="stretch" gap="3" w="full">
                <HStack justify="space-between" align="center">
                    <Text
                        fontFamily="mono"
                        fontSize="11px"
                        fontWeight={800}
                        letterSpacing="0.15em"
                        color="pitch.600"
                        truncate
                    >
                        {tournament.name.toUpperCase()}
                    </Text>
                    {live && <LivePill />}
                </HStack>

                {live ? (
                    <EmbedScoreboard match={live} />
                ) : lastFinished ? (
                    <EmbedFinished match={lastFinished} />
                ) : nextUpcoming ? (
                    <EmbedUpcoming match={nextUpcoming} />
                ) : (
                    <Text
                        textAlign="center"
                        py="6"
                        color="fg.muted"
                        fontSize="sm"
                    >
                        Nema utakmica
                    </Text>
                )}

                <Link
                    href={`https://futsal-turniri.com/turniri/${uuid}`}
                    target="_blank"
                    rel="noopener"
                    textAlign="center"
                    fontFamily="mono"
                    fontSize="10px"
                    fontWeight={700}
                    letterSpacing="0.15em"
                    color="fg.muted"
                    css={{
                        textDecoration: "none",
                        "&:hover": { color: "var(--chakra-colors-pitch-600)" },
                    }}
                >
                    POWERED BY FUTSAL-TURNIRI.COM
                </Link>
            </VStack>
        </Shell>
    )
}

/* ──────────────────────────────────────────────────────────────────────────
   Shell — transparent outer wrapper with a single white rounded card
   inside. Sized to a typical embed slot (~360 × 220), fluid-shrinks.
   ────────────────────────────────────────────────────────────────────── */
function Shell({ children }: { children: React.ReactNode }) {
    return (
        <Box
            w="full"
            minH="100vh"
            display="flex"
            alignItems="center"
            justifyContent="center"
            p="3"
        >
            <Box
                w="full"
                maxW="420px"
                bg="bg.panel"
                borderWidth="1px"
                borderColor="border.muted"
                rounded="2xl"
                p="4"
                css={{
                    boxShadow: "0 4px 24px rgba(14, 31, 21, 0.06)",
                }}
            >
                {children}
            </Box>
        </Box>
    )
}

function LivePill() {
    return (
        <HStack gap="1.5" align="center">
            <Box
                w="6px"
                h="6px"
                rounded="full"
                bg="accent.red"
                css={{
                    boxShadow: "0 0 8px var(--chakra-colors-accent-red)",
                    animation: "pitchPulse 1s infinite",
                }}
            />
            <Text
                fontFamily="mono"
                fontSize="10px"
                fontWeight={800}
                letterSpacing="0.2em"
                color="accent.red"
            >
                UŽIVO
            </Text>
        </HStack>
    )
}

function EmbedScoreboard({ match }: { match: LiveMatch }) {
    return (
        <Flex align="center" justify="space-between" gap="3" py="2">
            <TeamName name={match.team1Name ?? "—"} align="right" />
            <HStack
                gap="2"
                fontFamily="mono"
                fontSize="40px"
                fontWeight={800}
                lineHeight={1}
                color="fg"
                letterSpacing="-0.03em"
            >
                <Box>{match.score1 ?? 0}</Box>
                <Box opacity={0.3}>:</Box>
                <Box>{match.score2 ?? 0}</Box>
            </HStack>
            <TeamName name={match.team2Name ?? "—"} align="left" />
        </Flex>
    )
}

function EmbedFinished({ match }: { match: ScheduledMatch }) {
    return (
        <VStack gap="1" py="2">
            <Text
                fontFamily="mono"
                fontSize="10px"
                fontWeight={700}
                letterSpacing="0.2em"
                color="fg.muted"
            >
                POSLJEDNJA UTAKMICA
            </Text>
            <Flex align="center" justify="space-between" gap="3" w="full">
                <TeamName name={match.team1Name ?? "—"} align="right" />
                <HStack
                    gap="2"
                    fontFamily="mono"
                    fontSize="32px"
                    fontWeight={800}
                    lineHeight={1}
                    color="fg"
                >
                    <Box>{match.score1 ?? 0}</Box>
                    <Box opacity={0.3}>:</Box>
                    <Box>{match.score2 ?? 0}</Box>
                </HStack>
                <TeamName name={match.team2Name ?? "—"} align="left" />
            </Flex>
        </VStack>
    )
}

function EmbedUpcoming({ match }: { match: ScheduledMatch }) {
    return (
        <VStack gap="1" py="2">
            <Text
                fontFamily="mono"
                fontSize="10px"
                fontWeight={700}
                letterSpacing="0.2em"
                color="fg.muted"
            >
                SLJEDEĆA UTAKMICA · {formatKickoff(match.kickoffAt)}
            </Text>
            <Flex align="center" justify="space-between" gap="3" w="full">
                <TeamName name={match.team1Name ?? "—"} align="right" />
                <Text
                    fontFamily="mono"
                    fontSize="20px"
                    fontWeight={700}
                    color="fg.muted"
                >
                    vs
                </Text>
                <TeamName name={match.team2Name ?? "—"} align="left" />
            </Flex>
        </VStack>
    )
}

function TeamName({ name, align }: { name: string; align: "left" | "right" }) {
    return (
        <Box flex="1" textAlign={align} minW="0">
            <Text
                fontSize="15px"
                fontWeight={700}
                color="fg"
                truncate
                lineHeight={1.2}
            >
                {name}
            </Text>
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
