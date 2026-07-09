import { useCallback, useEffect, useMemo, useState } from "react"
import { Box, Flex, HStack, IconButton, Spinner, Text, VStack } from "@chakra-ui/react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { FiArrowLeft, FiShare2 } from "react-icons/fi"
import { fetchSchedule } from "../api/schedule"
import { fetchLiveMatches, matchPhaseLabel, type LiveMatch } from "../api/live"
import { fetchTournamentDetails } from "../api/tournaments"
import { GoalscorersPanel, LiveClock } from "../components/liveMatch"
import { usePolling } from "../hooks/usePolling"
import { useLiveSocket } from "../hooks/useLiveSocket"
import { showSuccess } from "../toaster"
import type { Schedule, ScheduledMatch } from "../types/schedule"

/* ──────────────────────────────────────────────────────────────────────────
   MatchLivePage - a single match's own "page" (route /turniri/:uuid/utakmica/
   :matchId). Think SofaScore match screen: a spectator opens this URL on their
   phone and follows one game live.

   Rendered as a normal in-chrome page (NOT a full-screen overlay), so the app
   navigation stays put - the top NavBar on the web and the bottom nav on
   mobile. A faint logo watermark sits behind the teams + score header and the
   timeline (goals + cards, oldest → newest, split into 1./2. poluvrijeme).

   Data (no dedicated endpoint - same sources the fullscreen display uses):
     • fetchSchedule(uuid)  → the match's teams (+ ids), status, half config,
       stage and finished score.
     • fetchLiveMatches()   → the live overlay (running clock, live score) while
       the match is in progress.
     • events              → GoalscorersPanel fetches + polls them itself.
   A WebSocket live-update refetches instantly; polling is the fallback.
   ────────────────────────────────────────────────────────────────────────── */

const POLL_MS = 5_000

export default function MatchLivePage() {
    const { uuid, matchId: matchIdParam } = useParams<{ uuid: string; matchId: string }>()
    const matchId = Number(matchIdParam)
    const navigate = useNavigate()
    const location = useLocation()

    const [schedule, setSchedule] = useState<Schedule | null>(null)
    const [live, setLive] = useState<LiveMatch | null>(null)
    const [tournamentName, setTournamentName] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    // Bumped on every relevant WebSocket live-update so the timeline refetches
    // instantly (GoalscorersPanel refreshSignal).
    const [scorerTick, setScorerTick] = useState(0)

    // Tournament name - fetched once (rarely changes); the schedule doesn't
    // carry it. Falls back to the live DTO's name below if this hasn't landed.
    useEffect(() => {
        if (!uuid) return
        let cancelled = false
        fetchTournamentDetails(uuid)
            .then((t) => { if (!cancelled) setTournamentName(t.name) })
            .catch(() => { /* name is non-critical */ })
        return () => { cancelled = true }
    }, [uuid])

    const loadAll = useCallback(() => {
        if (!uuid || !Number.isFinite(matchId)) return
        Promise.all([
            fetchSchedule(uuid).catch(() => null),
            fetchLiveMatches().catch(() => [] as LiveMatch[]),
        ])
            .then(([sched, liveList]) => {
                if (sched) setSchedule(sched)
                setLive(liveList.find((m) => m.matchId === matchId) ?? null)
            })
            .finally(() => setLoading(false))
    }, [uuid, matchId])

    // Fallback poll (paused while the tab is hidden).
    usePolling(loadAll, POLL_MS)

    // Realtime: refetch the instant the backend pushes a change for THIS match
    // (or a tournament-wide update with no matchId).
    useLiveSocket((msg) => {
        if (msg.matchId != null && msg.matchId !== matchId) return
        loadAll()
        setScorerTick((t) => t + 1)
    })

    const scheduled = useMemo<ScheduledMatch | null>(
        () => schedule?.matches.find((m) => m.matchId === matchId) ?? null,
        [schedule, matchId],
    )

    // Prefer a real "back" (returns to /uzivo, the tournament, wherever they
    // came from); on a cold open (shared link, no history) fall back to the
    // tournament page so the button is never a dead end.
    const goBack = () => {
        if (location.key !== "default") navigate(-1)
        else navigate(`/turniri/${uuid}`)
    }

    async function share() {
        const url = window.location.href
        const t1 = scheduled?.team1Name ?? live?.team1Name ?? ""
        const t2 = scheduled?.team2Name ?? live?.team2Name ?? ""
        const title = t1 && t2 ? `${t1} vs ${t2}` : "Utakmica uživo"
        if (navigator.share) {
            try {
                await navigator.share({ title, url })
            } catch {
                /* user dismissed the share sheet */
            }
            return
        }
        try {
            await navigator.clipboard.writeText(url)
            showSuccess("Poveznica kopirana.")
        } catch {
            /* clipboard blocked - nothing more we can do */
        }
    }

    if (loading && !scheduled) {
        return (
            <Flex h="100%" align="center" justify="center" gap="3">
                <Spinner size="lg" color="brand.solid" />
                <Text color="fg.muted">Učitavanje…</Text>
            </Flex>
        )
    }

    if (!scheduled) {
        return (
            <VStack h="100%" justify="center" gap="4" px="6">
                <Text color="fg.muted" textAlign="center">Utakmica nije pronađena.</Text>
                <IconButton aria-label="Natrag" variant="outline" onClick={goBack}>
                    <FiArrowLeft />
                </IconButton>
            </VStack>
        )
    }

    const isLive = !!live
    const isFinished = !isLive && scheduled.status === "FINISHED"
    const isScheduled = !isLive && scheduled.status === "SCHEDULED"
    const isTimer = live?.liveMode === "TIMER"
    const score1 = live?.score1 ?? scheduled.score1 ?? 0
    const score2 = live?.score2 ?? scheduled.score2 ?? 0
    const team1Name = scheduled.team1Name ?? live?.team1Name ?? "-"
    const team2Name = scheduled.team2Name ?? live?.team2Name ?? "-"
    const halfLengthMin = schedule?.halfLengthMin ?? live?.halfLengthMin ?? null
    const halfCount = schedule?.halfCount ?? live?.halfCount ?? null
    const phaseLbl = matchPhaseLabel({ stage: scheduled.stage, groupName: scheduled.groupName })
    const title = tournamentName ?? live?.tournamentName ?? null
    const hasPens = scheduled.penalties1 != null && scheduled.penalties2 != null

    // Shrink the team-name font when a club name is long, so it stays readable
    // and fits (wrapping to at most two lines) instead of truncating hard.
    const maxNameLen = Math.max(team1Name.length, team2Name.length)
    const teamFont =
        maxNameLen > 34
            ? { base: "xs", md: "sm" }
            : maxNameLen > 22
                ? { base: "sm", md: "md" }
                : { base: "md", md: "lg" }

    // (Status pill/clock, the big score and the penalty line are rendered
    // inline in the header below - the status sits ABOVE the teams+score row so
    // the team names and the score share ONE horizontal line.)

    return (
        <Flex direction="column" h="100%" position="relative" bg="bg.canvas">
            {/* Faint centred logo watermark behind the content. */}
            <Box
                position="absolute"
                inset="0"
                zIndex={0}
                pointerEvents="none"
                opacity={0.05}
                css={{
                    backgroundImage: "url(/futsal-turniri-symbol.svg)",
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "center",
                    backgroundSize: "min(60vw, 360px)",
                }}
            />

            {/* PINNED header: back · tournament · share, then teams + score. */}
            <Box
                flexShrink={0}
                position="relative"
                zIndex={1}
                px={{ base: 4, md: 6 }}
                pt="2"
                pb="3"
                borderBottomWidth="1px"
                borderColor="border"
                bg="bg.panel"
            >
                {/* Slim top bar: back · tournament name (→ tournament page) · share. */}
                <Flex align="center" gap="2" mb="2">
                    <IconButton aria-label="Natrag" variant="ghost" size="sm" onClick={goBack}>
                        <FiArrowLeft />
                    </IconButton>
                    <VStack gap="0" flex="1" minW="0" align="center">
                        {title && (
                            <Text
                                as="button"
                                onClick={() => navigate(`/turniri/${uuid}`)}
                                fontSize="sm"
                                fontWeight={700}
                                color="fg"
                                lineClamp={1}
                                maxW="full"
                                cursor="pointer"
                                _hover={{ textDecoration: "underline" }}
                            >
                                {title}
                            </Text>
                        )}
                        {phaseLbl && (
                            <Text fontSize="2xs" color="fg.muted" lineClamp={1} maxW="full">
                                {phaseLbl}
                            </Text>
                        )}
                    </VStack>
                    <IconButton aria-label="Podijeli" variant="ghost" size="sm" onClick={share}>
                        <FiShare2 />
                    </IconButton>
                </Flex>

                {/* Status line (centred) ABOVE the teams+score row so the
                    pill/clock never pushes the score off the team-name line. */}
                <Flex justify="center" align="center" minH="5" mb="1">
                    {isLive ? (
                        <HStack gap="2">
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
                                Uživo
                            </Box>
                            {isTimer && (
                                <LiveClock
                                    liveStartedAt={live?.liveStartedAt}
                                    firstHalfEndedAt={live?.firstHalfEndedAt}
                                    secondHalfStartedAt={live?.secondHalfStartedAt}
                                    livePausedAt={live?.livePausedAt}
                                    halfLengthMin={halfLengthMin}
                                    halfCount={halfCount}
                                    showLabel
                                />
                            )}
                        </HStack>
                    ) : (
                        <Text fontSize="2xs" fontWeight={800} letterSpacing="wider" textTransform="uppercase" color="fg.muted">
                            {isFinished ? "Završeno" : "Nije počelo"}
                        </Text>
                    )}
                </Flex>

                {/* Teams + score - the team name and the score sit on ONE
                    horizontal line (grid is vertically centred and the score is
                    the only thing in the centre cell). */}
                <Box display="grid" gridTemplateColumns="1fr auto 1fr" alignItems="center" gap="3" w="full">
                    <Text fontSize={teamFont} fontWeight={800} color="fg.ink" textAlign="right" lineClamp="2" minW="0">
                        {team1Name}
                    </Text>
                    {isScheduled ? (
                        <Text fontFamily="mono" fontSize="xl" fontWeight={800} color="fg.ink" whiteSpace="nowrap" flexShrink={0}>
                            {formatKickoff(scheduled.kickoffAt)}
                        </Text>
                    ) : (
                        <Text
                            fontFamily="mono"
                            fontSize="3xl"
                            fontWeight={800}
                            fontVariantNumeric="tabular-nums"
                            lineHeight="1"
                            color={isLive ? "red.fg" : "fg.ink"}
                            whiteSpace="nowrap"
                            flexShrink={0}
                        >
                            {score1} : {score2}
                        </Text>
                    )}
                    <Text fontSize={teamFont} fontWeight={800} color="fg.ink" textAlign="left" lineClamp="2" minW="0">
                        {team2Name}
                    </Text>
                </Box>

                {/* Penalty shootout result under the score (centred). */}
                {hasPens && (
                    <Text fontSize="2xs" fontWeight={700} color="fg.muted" textAlign="center" mt="1" whiteSpace="nowrap">
                        ({scheduled.penalties1} : {scheduled.penalties2} penali)
                    </Text>
                )}
            </Box>

            {/* SCROLLABLE timeline - the ONLY scrolling region on the page. */}
            <Box
                flex="1"
                minH="0"
                overflowY="auto"
                position="relative"
                zIndex={1}
                px={{ base: 4, md: 6 }}
                pt="4"
                pb="6"
                css={{ WebkitOverflowScrolling: "touch" }}
            >
                <Box maxW="640px" mx="auto" w="full">
                    <Box bg="bg.panel" rounded="xl" borderWidth="1px" borderColor="border" p="4">
                        <Text
                            fontFamily="mono"
                            fontSize="10px"
                            fontWeight={800}
                            letterSpacing="0.12em"
                            color="fg.muted"
                            mb="3"
                            textAlign="center"
                        >
                            TIJEK UTAKMICE
                        </Text>
                        <GoalscorersPanel
                            tournamentUuid={uuid!}
                            matchId={matchId}
                            team1Id={scheduled.team1Id}
                            team2Id={scheduled.team2Id}
                            halfLengthMin={halfLengthMin}
                            pollMs={isLive ? POLL_MS : undefined}
                            refreshSignal={scorerTick}
                            emptyNote={
                                isFinished
                                    ? "Prikazan samo krajnji rezultat bez strijelca."
                                    : isScheduled
                                        ? "Utakmica još nije počela."
                                        : "Još nema događaja."
                            }
                        />
                    </Box>
                </Box>
            </Box>
        </Flex>
    )
}

function formatKickoff(iso: string | null | undefined): string {
    if (!iso) return "-"
    try {
        return new Date(iso).toLocaleString("hr-HR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        })
    } catch {
        return "-"
    }
}
