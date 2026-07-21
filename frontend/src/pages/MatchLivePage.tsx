import { useCallback, useEffect, useMemo, useState } from "react"
import { Box, chakra, Flex, HStack, IconButton, Spinner, Text, VStack } from "@chakra-ui/react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { FiArrowLeft, FiDownload, FiShare2 } from "react-icons/fi"
import { fetchSchedule } from "../api/schedule"
import { fetchLiveMatches, matchPhaseLabel, type LiveMatch } from "../api/live"
import { fetchTournamentDetails } from "../api/tournaments"
import { fetchStreamBanner, readStreamBannerHint, type StreamBanner } from "../api/streamBanner"
import type { TournamentDetails } from "../types/tournaments"
import { ExportDialog, type ExportMeta, type MatchExportData } from "../components/TournamentExport"
import { useQueryClient } from "@tanstack/react-query"
import { qk } from "../queryClient"
import { GoalscorersPanel, LiveClock } from "../components/liveMatch"
import { useTeamColors, teamColor, teamShorts, KitSwatch } from "../components/jersey"
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

/** Tournament meta the poster header uses (not carried by the schedule). */
type PosterMetaBits = {
    organizerName: string | null
    location: string | null
    startAt: string | null
    slug: string | null
}

export default function MatchLivePage() {
    const { uuid, matchId: matchIdParam } = useParams<{ uuid: string; matchId: string }>()
    const matchId = Number(matchIdParam)
    const navigate = useNavigate()
    const location = useLocation()

    const queryClient = useQueryClient()
    // Seed from the shared caches (schedule + live list already warmed by the
    // tournament tabs and /uzivo, tournament name by the detail page/prefetch)
    // so opening a match paints instantly instead of a cold spinner.
    const cachedSchedule = uuid ? queryClient.getQueryData<Schedule>(qk.schedule(uuid)) : undefined
    const cachedLive =
        (queryClient.getQueryData<LiveMatch[]>(qk.liveMatches) ?? []).find((m) => m.matchId === matchId) ?? null
    const cachedDetails = uuid
        ? queryClient.getQueryData<TournamentDetails>(qk.tournamentDetails(uuid))
        : undefined
    const cachedName = cachedDetails?.name ?? null

    // Meta bits for the poster header (organizer / location / start / slug),
    // seeded from the cached detail so a shared-link open can still fill them.
    const toMetaBits = (t: TournamentDetails): PosterMetaBits => ({
        organizerName: t.organizerName ?? t.createdByName ?? null,
        location: t.location ?? null,
        startAt: t.startAt ?? null,
        slug: t.slug ?? null,
    })

    const [schedule, setSchedule] = useState<Schedule | null>(cachedSchedule ?? null)
    const [live, setLive] = useState<LiveMatch | null>(cachedLive)
    const [tournamentName, setTournamentName] = useState<string | null>(cachedName)
    const [tMeta, setTMeta] = useState<PosterMetaBits | null>(cachedDetails ? toMetaBits(cachedDetails) : null)
    const [exportOpen, setExportOpen] = useState(false)
    const [loading, setLoading] = useState(!cachedSchedule)
    // Bumped on every relevant WebSocket live-update so the timeline refetches
    // instantly (GoalscorersPanel refreshSignal).
    const [scorerTick, setScorerTick] = useState(0)

    // Jersey colours per team → a kit-colour chip next to each name.
    const teamColors = useTeamColors(uuid)

    // Tournament name - fetched once (rarely changes); the schedule doesn't
    // carry it. Falls back to the live DTO's name below if this hasn't landed.
    useEffect(() => {
        if (!uuid) return
        let cancelled = false
        // Reuse the cached tournament (from the detail page / card prefetch) -
        // the name rarely changes, so a 30 s stale window avoids a refetch.
        queryClient
            .fetchQuery({ queryKey: qk.tournamentDetails(uuid), queryFn: () => fetchTournamentDetails(uuid), staleTime: 30_000 })
            .then((t) => { if (!cancelled) { setTournamentName(t.name); setTMeta(toMetaBits(t)) } })
            .catch(() => { /* name is non-critical */ })
        return () => { cancelled = true }
    }, [uuid, queryClient])

    const loadAll = useCallback(() => {
        if (!uuid || !Number.isFinite(matchId)) return
        Promise.all([
            fetchSchedule(uuid).catch(() => null),
            fetchLiveMatches().catch(() => null),
        ])
            .then(([sched, liveList]) => {
                // Fresh each poll (this IS the live refresh) but also written to
                // the shared caches so the tabs / /uzivo stay warm.
                if (sched) {
                    setSchedule(sched)
                    queryClient.setQueryData(qk.schedule(uuid), sched)
                }
                if (liveList) {
                    queryClient.setQueryData(qk.liveMatches, liveList)
                    setLive(liveList.find((m) => m.matchId === matchId) ?? null)
                }
            })
            .finally(() => setLoading(false))
    }, [uuid, matchId, queryClient])

    // Fallback poll (paused while the tab is hidden).
    usePolling(loadAll, POLL_MS)

    // Live-stream suggestion: if this tournament currently has an active stream,
    // surface a pulsing banner in the header that jumps to the immersive /uzivo
    // view (this page otherwise gives no hint a stream exists). Polled always
    // while mounted; seeded synchronously from the first-paint hint.
    const [streamBanner, setStreamBanner] = useState<StreamBanner | null>(() => readStreamBannerHint())
    const loadStreamBanner = useCallback(() => {
        fetchStreamBanner().then(setStreamBanner).catch(() => { /* keep last known */ })
    }, [])
    usePolling(loadStreamBanner, 30000, true)

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
    // A stream is live "for this page" when the banner is STREAMING, linked to
    // THIS tournament, AND this match is the one currently being played - the
    // stream is tournament-level (no matchId), so the live match IS the streamed
    // one; without the isLive gate the pill would also show on finished /
    // upcoming matches that aren't actually on stream. The route param `uuid`
    // may be a slug, so also compare the banner's immutable tournamentUuid
    // against the cached details' real uuid.
    const streamLiveForThis =
        isLive &&
        streamBanner?.state === "STREAMING" &&
        !!uuid &&
        (streamBanner?.tournamentUuid === uuid || streamBanner?.tournamentUuid === cachedDetails?.uuid)
    const isTimer = live?.liveMode === "TIMER"
    const score1 = live?.score1 ?? scheduled.score1 ?? 0
    const score2 = live?.score2 ?? scheduled.score2 ?? 0
    // Equal-width digit boxes for the score row: both sides sized to the LONGER
    // score's digit count so the colon stays dead-centre ("10 : 5" would
    // otherwise push it right). Mono + tabular-nums makes 1 digit = 1ch exact.
    const scoreCh = `${Math.max(String(score1).length, String(score2).length)}ch`
    const team1Name = scheduled.team1Name ?? live?.team1Name ?? "-"
    const team2Name = scheduled.team2Name ?? live?.team2Name ?? "-"
    const jerseyC1 = teamColor(teamColors, scheduled.team1Id)
    const jerseyC2 = teamColor(teamColors, scheduled.team2Id)
    const shortsC1 = teamShorts(teamColors, scheduled.team1Id)
    const shortsC2 = teamShorts(teamColors, scheduled.team2Id)
    const halfLengthMin = schedule?.halfLengthMin ?? live?.halfLengthMin ?? null
    const halfCount = schedule?.halfCount ?? live?.halfCount ?? null
    const phaseLbl = matchPhaseLabel({ stage: scheduled.stage, groupName: scheduled.groupName })
    const title = tournamentName ?? live?.tournamentName ?? null
    const hasPens = scheduled.penalties1 != null && scheduled.penalties2 != null

    // Poster export - meta from the tournament detail (degrades gracefully when
    // a shared-link open hasn't fetched it yet) + the match itself, reusing the
    // exact fields the header above already derived so the two agree.
    const exportMeta: ExportMeta = {
        tournamentName: title ?? "Turnir",
        organizerName: tMeta?.organizerName ?? null,
        location: tMeta?.location ?? null,
        startAt: tMeta?.startAt ?? null,
        tournamentUrl: `${window.location.origin}/turniri/${tMeta?.slug ?? uuid ?? ""}`,
    }
    const matchExport: MatchExportData = {
        tournamentUuid: uuid!,
        matchId,
        team1Id: scheduled.team1Id,
        team2Id: scheduled.team2Id,
        team1Name,
        team2Name,
        score1: isScheduled ? null : score1,
        score2: isScheduled ? null : score2,
        penalties1: scheduled.penalties1 ?? null,
        penalties2: scheduled.penalties2 ?? null,
        isLive,
        status: isLive ? "LIVE" : scheduled.status,
        stage: scheduled.stage,
        groupName: scheduled.groupName,
        kickoffAt: scheduled.kickoffAt,
        halfLengthMin,
    }

    // Shrink the team-name font when a club name is long, so it stays readable
    // and fits (wrapping to at most three lines) instead of truncating hard.
    const maxNameLen = Math.max(team1Name.length, team2Name.length)
    const teamFont =
        maxNameLen > 44
            ? { base: "2xs", md: "xs" }
            : maxNameLen > 34
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
                {/* Slim top bar: back · tournament name (→ tournament page) · share.
                    Three clusters on ONE row, all vertically centred against each
                    other (align="center"). The left and right clusters carry equal
                    flex so the centre name+stage block sits dead-centre horizontally;
                    the centre stack owns its own alignment and is centred as a unit,
                    so the side icons line up with its vertical midpoint (not the top
                    of the name). minW="0" lets a long name wrap/clamp instead of
                    pushing the icons out of alignment. */}
                <Flex align="center" gap="2" mb="2">
                    {/* Left cluster - back arrow (equal flex to the right cluster). */}
                    <Flex flex="1" minW="0" justify="flex-start">
                        <IconButton aria-label="Natrag" variant="ghost" size="sm" onClick={goBack}>
                            <FiArrowLeft />
                        </IconButton>
                    </Flex>
                    {/* Centre cluster - tournament name + stage, centred as one unit. */}
                    <VStack gap="0" minW="0" align="center">
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
                    {/* Right cluster - download + share (equal flex to the left). */}
                    <Flex flex="1" minW="0" justify="flex-end" gap="2">
                        <IconButton aria-label="Preuzmi" variant="ghost" size="sm" onClick={() => setExportOpen(true)}>
                            <FiDownload />
                        </IconButton>
                        <IconButton aria-label="Podijeli" variant="ghost" size="sm" onClick={share}>
                            <FiShare2 />
                        </IconButton>
                    </Flex>
                </Flex>

                {/* Live-stream suggestion pill (only while a stream for THIS
                    tournament is running) → jumps to the immersive /uzivo view.
                    Renders nothing otherwise, so it never reserves space / shifts
                    the teams+score row. */}
                {streamLiveForThis && (
                    <Flex justify="center" mb="1.5">
                        <chakra.button
                            type="button"
                            onClick={() => navigate(`/turniri/${uuid}/uzivo`)}
                            display="inline-flex"
                            alignItems="center"
                            gap="2"
                            px="3"
                            py="1"
                            rounded="full"
                            fontSize="12px"
                            fontWeight={700}
                            bg="accent.red"
                            color="white"
                            cursor="pointer"
                            css={{ animation: "livePillPulse 1.6s ease-out infinite" }}
                            _hover={{ bg: "#b91c1c" }}
                        >
                            <Box w="6px" h="6px" rounded="full" bg="white" flexShrink={0} css={{ animation: "pitchPulse 1.6s infinite" }} />
                            Gledaj live stream
                        </chakra.button>
                    </Flex>
                )}

                {/* Teams + score - the team name and the score sit on ONE
                    horizontal line (grid is vertically centred and the score is
                    the only thing in the centre cell). */}
                <Box display="grid" gridTemplateColumns="1fr auto 1fr" alignItems="center" gap="3" w="full">
                    <HStack gap="2" justify="flex-end" minW="0">
                        <KitSwatch jersey={jerseyC1} shorts={shortsC1} size={12} />
                        <Text fontSize={teamFont} fontWeight={800} color="fg.ink" textAlign="right" lineClamp="3" minW="0">
                            {team1Name}
                        </Text>
                    </HStack>
                    {isScheduled ? (
                        <Text fontFamily="mono" fontSize="xl" fontWeight={800} color="fg.ink" whiteSpace="nowrap" flexShrink={0}>
                            {formatKickoff(scheduled.kickoffAt)}
                        </Text>
                    ) : (
                        /* Both digit boxes get the SAME width - that of the
                           longer score ("10" vs "5" → both 2ch, tabular mono) -
                           so the colon sits at the exact centre of the cell no
                           matter how the digit counts differ. */
                        <HStack
                            gap="1.5"
                            fontFamily="mono"
                            fontSize="3xl"
                            fontWeight={800}
                            fontVariantNumeric="tabular-nums"
                            lineHeight="1"
                            color={isLive ? "red.fg" : "fg.ink"}
                            whiteSpace="nowrap"
                            flexShrink={0}
                            justify="center"
                        >
                            <Box as="span" w={scoreCh} textAlign="right">{score1}</Box>
                            <Box as="span">:</Box>
                            <Box as="span" w={scoreCh} textAlign="left">{score2}</Box>
                        </HStack>
                    )}
                    <HStack gap="2" justify="flex-start" minW="0">
                        <Text fontSize={teamFont} fontWeight={800} color="fg.ink" textAlign="left" lineClamp="3" minW="0">
                            {team2Name}
                        </Text>
                        <KitSwatch jersey={jerseyC2} shorts={shortsC2} size={12} />
                    </HStack>
                </Box>

                {/* Status line (centred) BELOW the teams+score row: the running
                    clock + half/pause label while live, else the plain state.
                    It sits here (not above) so the clock reads as a caption of
                    the scoreline; the live-stream pill stays up top. */}
                <Flex justify="center" align="center" minH="5" mt="2">
                    {isLive ? (
                        <HStack gap="2">
                            {/* The "Uživo" pill is redundant while the pulsing
                                "Gledaj live stream" pill is shown above -
                                one red live signal is enough. */}
                            {!streamLiveForThis && (
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
                            )}
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
                            /* Live overlay first (it moves as fouls are given),
                               falling back to the scheduled record so a FINISHED
                               match - which has no live overlay - still shows
                               its accumulated per-half fouls. */
                            fouls={{
                                t1First: live?.fouls1First ?? scheduled.fouls1First ?? 0,
                                t1Second: live?.fouls1Second ?? scheduled.fouls1Second ?? 0,
                                t2First: live?.fouls2First ?? scheduled.fouls2First ?? 0,
                                t2Second: live?.fouls2Second ?? scheduled.fouls2Second ?? 0,
                            }}
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

            {/* Branded match poster (portrait PDF / JPG) - same timeline as above. */}
            <ExportDialog
                open={exportOpen}
                onClose={() => setExportOpen(false)}
                kind="match"
                meta={exportMeta}
                match={matchExport}
            />
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
