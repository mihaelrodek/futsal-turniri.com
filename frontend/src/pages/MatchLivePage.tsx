import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Box, chakra, Flex, Grid, HStack, IconButton, Spinner, Text, VStack } from "@chakra-ui/react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { FiArrowLeft, FiDownload, FiFileText, FiShare2, FiVideo } from "react-icons/fi"
import { BracketBoard, ZoomableBracket, ZoomControls, type ZoomableBracketHandle } from "../components/BracketBoard"
import { fetchSchedule } from "../api/schedule"
import { fetchLiveMatches, matchPhaseLabel, type LiveMatch } from "../api/live"
import { fetchTournamentDetails } from "../api/tournaments"
import { fetchPlayers } from "../api/players"
import { fetchGroups } from "../api/groups"
import { fetchBracket } from "../api/bracket"
import { fetchStreamBanner, readStreamBannerHint, type StreamBanner } from "../api/streamBanner"
import type { TournamentDetails, TournamentFormat } from "../types/tournaments"
import { ExportDialog, type ExportMeta, type MatchExportData } from "../components/TournamentExport"
import { ZapisnikExportDialog } from "../export/zapisnik/ZapisnikExportDialog"
import RecordingRequestDialog from "../components/RecordingRequestDialog"
import { useQueryClient } from "@tanstack/react-query"
import { qk } from "../queryClient"
import { GoalscorersPanel, LiveClock } from "../components/liveMatch"
import { useRawMatchEvents } from "../components/StreamHero"
import { useBroadcastDelayMs, useTick, visibleScore } from "../hooks/useBroadcastDelay"
import { useTeamColors, teamColor, teamShorts, teamKit, KitSwatch } from "../components/jersey"
import { buildKoMatchCodes } from "../utils/knockoutCodes"
import { usePolling } from "../hooks/usePolling"
import { useLiveSocket } from "../hooks/useLiveSocket"
import { showSuccess } from "../toaster"
import type { TeamKit } from "../api/tournaments"
import type { Schedule, ScheduledMatch } from "../types/schedule"
import type { PlayerDto } from "../types/players"
import type { Group } from "../types/groups"
import type { Bracket, BracketMatch } from "../types/bracket"

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

/** Payment flow (Stripe Checkout) is live end-to-end - the request-a-
 *  recording entry point is shown on the match page. Anonymous visitors
 *  can request too (the dialog collects a mandatory contact email for
 *  them instead of gating on login). */
const RECORDING_REQUEST_ENABLED = true

/** Tournament meta the poster header uses (not carried by the schedule). */
type PosterMetaBits = {
    organizerName: string | null
    location: string | null
    startAt: string | null
    slug: string | null
    format: TournamentFormat | null
}

type MatchInfoTab = "timeline" | "lineups" | "context"

function splitPlayerDisplayName(name: string): { first: string; rest: string } {
    const parts = name.trim().split(/\s+/).filter(Boolean)
    if (parts.length <= 1) return { first: name.trim(), rest: "" }
    return { first: parts[0], rest: parts.slice(1).join(" ") }
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
        format: t.format ?? null,
    })

    const [schedule, setSchedule] = useState<Schedule | null>(cachedSchedule ?? null)
    const [live, setLive] = useState<LiveMatch | null>(cachedLive)
    const [tournamentName, setTournamentName] = useState<string | null>(cachedName)
    const [tMeta, setTMeta] = useState<PosterMetaBits | null>(cachedDetails ? toMetaBits(cachedDetails) : null)
    const [exportOpen, setExportOpen] = useState(false)
    const [zapisnikOpen, setZapisnikOpen] = useState(false)
    const [recordingOpen, setRecordingOpen] = useState(false)
    const [loading, setLoading] = useState(!cachedSchedule)
    const [tab, setTab] = useState<MatchInfoTab>("timeline")
    const [lineups, setLineups] = useState<{ team1: PlayerDto[] | null; team2: PlayerDto[] | null }>({
        team1: null,
        team2: null,
    })
    const [groups, setGroups] = useState<Group[]>([])
    const [bracket, setBracket] = useState<Bracket | null>(null)
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
    const matchEvents = useRawMatchEvents(
        uuid ?? null,
        Number.isFinite(matchId) ? matchId : null,
        !!uuid && Number.isFinite(matchId),
    )
    const bcDelayMs = useBroadcastDelayMs(uuid ?? null)
    const bcNow = useTick(bcDelayMs > 0)

    useEffect(() => {
        setLineups({ team1: null, team2: null })
        if (!uuid || !scheduled) return
        const tournamentUuid = uuid
        const team1Id = scheduled.team1Id
        const team2Id = scheduled.team2Id
        let cancelled = false
        async function loadLineups() {
            const [team1, team2] = await Promise.all([
                team1Id != null ? fetchPlayers(tournamentUuid, team1Id).catch(() => []) : Promise.resolve([]),
                team2Id != null ? fetchPlayers(tournamentUuid, team2Id).catch(() => []) : Promise.resolve([]),
            ])
            if (!cancelled) setLineups({ team1, team2 })
        }
        void loadLineups()
        return () => { cancelled = true }
    }, [uuid, scheduled?.team1Id, scheduled?.team2Id])

    useEffect(() => {
        setGroups([])
        setBracket(null)
        if (!uuid) return
        let cancelled = false
        Promise.all([
            fetchGroups(uuid, { silent: true }).catch(() => []),
            fetchBracket(uuid, { silent: true }).catch(() => null),
        ]).then(([g, b]) => {
            if (cancelled) return
            setGroups(g)
            setBracket(b)
            queryClient.setQueryData(qk.groups(uuid), g)
            if (b) queryClient.setQueryData(qk.bracket(uuid), b)
        })
        return () => { cancelled = true }
    }, [uuid, queryClient])

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
    const rawScore1 = live?.score1 ?? scheduled.score1 ?? 0
    const rawScore2 = live?.score2 ?? scheduled.score2 ?? 0
    // Broadcast hold: the timeline below already withholds a just-scored goal
    // until the stream reaches it, so the score above it has to wait too -
    // otherwise the number spoils the goal the viewer hasn't seen yet. Goals
    // still on hold are subtracted from the real score; no stream = no change.
    // RAW on purpose: we need the goals that are still withheld in order to
    // subtract them - the delayed list has them removed already.
    const bcEvents = matchEvents
    const score1 = visibleScore(rawScore1, scheduled.team1Id, bcEvents, bcDelayMs, bcNow) ?? rawScore1
    const score2 = visibleScore(rawScore2, scheduled.team2Id, bcEvents, bcDelayMs, bcNow) ?? rawScore2
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
    const groupForMatch = scheduled.groupName
        ? groups.find((g) => g.name === scheduled.groupName) ?? null
        : null
    const hasGroupContext = !!groupForMatch && (tMeta?.format ?? cachedDetails?.format ?? null) === "GROUPS_KNOCKOUT"
    const contextLabel = hasGroupContext ? "Grupa" : "Završnica"
    const infoTabs: Array<{ key: MatchInfoTab; label: string }> = [
        { key: "timeline", label: "Tijek utakmice" },
        { key: "lineups", label: "Sastavi" },
        { key: "context", label: contextLabel },
    ]
    const infoMaxW = tab === "context" && !hasGroupContext ? "1280px" : "640px"

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
        isScheduled && maxNameLen > 18
            ? { base: "sm", md: "md" }
            : maxNameLen > 44
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
                {/* Slim top bar: side actions are independent of the title. The
                    title block is pinned to the viewport centre, so download /
                    share never pull it off-axis. */}
                <Box position="relative" minH="44px" mb="2">
                    <Flex position="absolute" left="0" top="50%" transform="translateY(-50%)" zIndex={2}>
                        <IconButton aria-label="Natrag" variant="ghost" size="sm" onClick={goBack}>
                            <FiArrowLeft />
                        </IconButton>
                    </Flex>
                    <VStack
                        gap="0"
                        position="absolute"
                        left="50%"
                        top="50%"
                        transform="translate(-50%, -50%)"
                        w="max-content"
                        maxW={{ base: "calc(100% - 112px)", md: "min(720px, calc(100% - 180px))" }}
                        align="center"
                    >
                        {title && (
                            <Text
                                as="button"
                                onClick={() => navigate(`/turniri/${uuid}`)}
                                fontSize="sm"
                                fontWeight={700}
                                color="fg"
                                // Wraps onto a SECOND line before it could reach
                                // the icons; `anywhere` keeps a single very long
                                // word from overflowing instead of breaking.
                                lineClamp={2}
                                lineHeight="1.25"
                                textAlign="center"
                                maxW="full"
                                css={{ overflowWrap: "anywhere" }}
                                cursor="pointer"
                                _hover={{ textDecoration: "underline" }}
                            >
                                {title}
                            </Text>
                        )}
                        {phaseLbl && (
                            <Text fontSize="2xs" color="fg.muted" lineClamp={1} maxW="full" textAlign="center">
                                {phaseLbl}
                            </Text>
                        )}
                    </VStack>
                    <Flex position="absolute" right="0" top="50%" transform="translateY(-50%)" gap="2" zIndex={2}>
                        {RECORDING_REQUEST_ENABLED && (
                            <IconButton
                                aria-label="Zatraži snimku"
                                title="Zatraži snimku utakmice"
                                variant="ghost"
                                size="sm"
                                onClick={() => setRecordingOpen(true)}
                            >
                                <FiVideo />
                            </IconButton>
                        )}
                        <IconButton aria-label="Podijeli" variant="ghost" size="sm" onClick={share}>
                            <FiShare2 />
                        </IconButton>
                    </Flex>
                </Box>

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
                <Box display="grid" gridTemplateColumns="minmax(0, 1fr) auto minmax(0, 1fr)" alignItems="center" gap={{ base: "2", md: "3" }} w="full">
                    <HStack gap="2" justify="flex-end" minW="0">
                        <KitSwatch jersey={jerseyC1} shorts={shortsC1} size={12} />
                        <Text
                            fontSize={teamFont}
                            fontWeight={800}
                            color="fg.ink"
                            textAlign="right"
                            lineClamp="3"
                            minW="0"
                            css={{ overflowWrap: "normal", wordBreak: "normal", hyphens: "none" }}
                        >
                            {team1Name}
                        </Text>
                    </HStack>
                    {isScheduled ? (
                        <Text fontFamily="mono" fontSize={{ base: "md", md: "xl" }} fontWeight={800} color="fg.ink" whiteSpace="nowrap" flexShrink={0}>
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
                        <Text
                            fontSize={teamFont}
                            fontWeight={800}
                            color="fg.ink"
                            textAlign="left"
                            lineClamp="3"
                            minW="0"
                            css={{ overflowWrap: "normal", wordBreak: "normal", hyphens: "none" }}
                        >
                            {team2Name}
                        </Text>
                        <KitSwatch jersey={jerseyC2} shorts={shortsC2} size={12} />
                    </HStack>
                </Box>

                {/* Status line (centred) BELOW the teams+score row: the running
                    clock + half/pause label while live, else the plain state.
                    It sits here (not above) so the clock reads as a caption of
                    the scoreline; the live-stream pill stays up top. */}
                <Box position="relative" minH="8" mt="2">
                    <Flex justify="center" align="center" minH="8">
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
                    <HStack
                        gap="0"
                        position="absolute"
                        right="0"
                        top="50%"
                        transform="translateY(-50%)"
                    >
                        <IconButton
                            aria-label="Preuzmi zapisnik"
                            title="Zapisnik"
                            variant="ghost"
                            size="sm"
                            onClick={() => setZapisnikOpen(true)}
                        >
                            <FiFileText />
                        </IconButton>
                        <IconButton
                            aria-label="Preuzmi"
                            variant="ghost"
                            size="sm"
                            onClick={() => setExportOpen(true)}
                        >
                            <FiDownload />
                        </IconButton>
                    </HStack>
                </Box>

                {/* Penalty shootout result under the score (centred). */}
                {hasPens && (
                    <Text fontSize="2xs" fontWeight={700} color="fg.muted" textAlign="center" mt="1" whiteSpace="nowrap">
                        ({scheduled.penalties1} : {scheduled.penalties2} penali)
                    </Text>
                )}
            </Box>

            {/* SCROLLABLE match info - the ONLY scrolling region on the page. */}
            <Box
                flex="1"
                minH="0"
                overflowY="auto"
                position="relative"
                zIndex={1}
                px={{ base: 4, md: 6 }}
                pt="0"
                pb="6"
                css={{ WebkitOverflowScrolling: "touch" }}
            >
                <Box maxW={infoMaxW} mx="auto" w="full">
                    <Box position="relative">
                        <Box
                            position="sticky"
                            top="0"
                            zIndex={20}
                            bg="bg.canvas"
                            pt="4"
                            pb="3"
                            mx={{ base: "-4", md: "-6" }}
                            px={{ base: "4", md: "6" }}
                            borderBottomWidth="1px"
                            borderColor="transparent"
                        >
                            <HStack
                                gap="1"
                                bg="bg.muted"
                                rounded="full"
                                p="1"
                                mx="auto"
                                w="fit-content"
                                maxW="full"
                                overflowX="auto"
                                justify="center"
                                boxShadow="0 10px 18px rgba(15, 23, 42, 0.08)"
                            >
                                {infoTabs.map((it) => (
                                    <chakra.button
                                        key={it.key}
                                        type="button"
                                        onClick={() => setTab(it.key)}
                                        display="inline-flex"
                                        alignItems="center"
                                        justifyContent="center"
                                        px="3.5"
                                        py="1.5"
                                        rounded="full"
                                        fontSize="12px"
                                        fontWeight={800}
                                        whiteSpace="nowrap"
                                        flexShrink={0}
                                        cursor="pointer"
                                        bg={tab === it.key ? "brand.solid" : "transparent"}
                                        color={tab === it.key ? "white" : "fg.muted"}
                                        boxShadow={tab === it.key ? "sm" : undefined}
                                        _hover={tab === it.key ? undefined : { color: "fg.ink" }}
                                    >
                                        {it.label}
                                    </chakra.button>
                                ))}
                            </HStack>
                        </Box>

                        {tab === "timeline" && (
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
                        )}

                        {tab === "lineups" && (
                            <LineupsPanel
                                team1Name={team1Name}
                                team2Name={team2Name}
                                team1Players={lineups.team1}
                                team2Players={lineups.team2}
                                events={matchEvents}
                            />
                        )}

                        {tab === "context" && (
                            hasGroupContext ? (
                                <GroupContextPanel group={groupForMatch} />
                            ) : (
                                <BracketContextPanel bracket={bracket} matchId={matchId} colors={teamColors} />
                            )
                        )}
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

            {/* FIFA-style zapisnik form (XLSX / PDF) for this match. */}
            <ZapisnikExportDialog
                open={zapisnikOpen}
                onClose={() => setZapisnikOpen(false)}
                uuid={uuid!}
                matchId={matchId}
            />

            {/* Request a paid video recording of this match (~20 €). */}
            {RECORDING_REQUEST_ENABLED && (
                <RecordingRequestDialog
                    open={recordingOpen}
                    onClose={() => setRecordingOpen(false)}
                    matchId={matchId}
                    team1Name={scheduled?.team1Name ?? live?.team1Name ?? null}
                    team2Name={scheduled?.team2Name ?? live?.team2Name ?? null}
                />
            )}
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

function LineupsPanel({
    team1Name,
    team2Name,
    team1Players,
    team2Players,
    events,
}: {
    team1Name: string
    team2Name: string
    team1Players: PlayerDto[] | null
    team2Players: PlayerDto[] | null
    events: ReturnType<typeof useRawMatchEvents>
}) {
    return (
        <Grid templateColumns="minmax(0, 1fr) minmax(0, 1fr)" gap="0">
            <TeamLineupCard teamName={team1Name} players={team1Players} events={events} align="left" />
            <TeamLineupCard teamName={team2Name} players={team2Players} events={events} align="right" withDivider />
        </Grid>
    )
}

function TeamLineupCard({
    teamName,
    players,
    events,
    align,
    withDivider = false,
}: {
    teamName: string
    players: PlayerDto[] | null
    events: ReturnType<typeof useRawMatchEvents>
    align: "left" | "right"
    withDivider?: boolean
}) {
    const sorted = [...(players ?? [])].sort((a, b) => {
        const an = a.number ?? 10_000
        const bn = b.number ?? 10_000
        if (an !== bn) return an - bn
        return a.name.localeCompare(b.name, "hr")
    })
    return (
        <Box
            minW="0"
            px={{ base: "2.5", md: "4" }}
            borderLeftWidth={withDivider ? "1px" : undefined}
            borderColor="border"
        >
            <Flex
                h={{ base: "68px", md: "46px" }}
                pb="2"
                align="center"
                justify={align === "left" ? "flex-start" : "flex-end"}
                borderBottomWidth="1px"
                borderColor="border"
            >
                <Text fontSize={{ base: "xs", md: "sm" }} fontWeight={900} color="fg.ink" textAlign={align} lineClamp={2} lineHeight="1.25">
                    {teamName}
                </Text>
            </Flex>
            {players == null ? (
                <Flex minH="96px" align="center" justify="center" px="2">
                    <Spinner size="sm" color="brand.solid" />
                </Flex>
            ) : sorted.length === 0 ? (
                <Flex minH="96px" align="center" justify="center" px="2">
                    <Text fontSize="sm" color="fg.muted" textAlign="center">
                        Nema unesenih sastava za ekipu.
                    </Text>
                </Flex>
            ) : (
                <VStack align="stretch" gap="0">
                    {sorted.map((p) => {
                        const stat = playerMatchStats(events, p.id)
                        const displayName = splitPlayerDisplayName(p.name)
                        const marks = (
                            <HStack
                                as="span"
                                gridColumn={align === "right" ? 1 : 3}
                                gridRow={1}
                                gap="1"
                                align="center"
                                justify="center"
                                w="full"
                                flexShrink={0}
                            >
                                {stat.goals > 0 && <PlayerGoalMark count={stat.goals} />}
                                {stat.yellow > 0 && <PlayerCardMark tone="yellow" count={stat.yellow} />}
                                {stat.red > 0 && <PlayerCardMark tone="red" count={stat.red} />}
                                {p.captain && (
                                    <Box as="span" px="1.5" py="0.5" rounded="full" bg="brand.subtle" color="brand.fg" fontSize="9px" fontWeight={900}>
                                        K
                                    </Box>
                                )}
                            </HStack>
                        )
                        return (
                            <Grid
                                key={p.id}
                                templateColumns={
                                    align === "right"
                                        ? {
                                            base: "24px minmax(0, 1fr) 34px",
                                            md: "34px minmax(0, 1fr) 40px",
                                        }
                                        : {
                                            base: "34px minmax(0, 1fr) 24px",
                                            md: "40px minmax(0, 1fr) 34px",
                                        }
                                }
                                alignItems="center"
                                gap="2.5"
                                minH={{ base: "46px", md: "50px" }}
                                py={{ base: "2", md: "2.5" }}
                                borderTopWidth="1px"
                                borderColor="border"
                            >
                                {align === "right" && marks}
                                <Flex
                                    w={{ base: "34px", md: "40px" }}
                                    h={{ base: "34px", md: "40px" }}
                                    rounded="md"
                                    align="center"
                                    justify="center"
                                    bg="bg.muted"
                                    color="fg.ink"
                                    fontFamily="mono"
                                    fontSize={{ base: "xs", md: "sm" }}
                                    fontWeight={900}
                                    flexShrink={0}
                                    gridColumn={align === "right" ? 3 : 1}
                                    gridRow={1}
                                >
                                    {p.number ?? "-"}
                                </Flex>
                                <VStack
                                    gridColumn={2}
                                    gridRow={1}
                                    align={align === "right" ? "flex-end" : "flex-start"}
                                    gap="0"
                                    minW="0"
                                    textAlign={align}
                                >
                                    <Text
                                        fontSize={{ base: "xs", md: "sm" }}
                                        fontWeight={800}
                                        color="fg.ink"
                                        lineHeight="1.12"
                                        lineClamp={1}
                                        maxW="full"
                                    >
                                        {displayName.first || p.name}
                                    </Text>
                                    {displayName.rest && (
                                        <Text
                                            fontSize={{ base: "xs", md: "sm" }}
                                            fontWeight={800}
                                            color="fg.ink"
                                            lineHeight="1.12"
                                            lineClamp={1}
                                            maxW="full"
                                        >
                                            {displayName.rest}
                                        </Text>
                                    )}
                                </VStack>
                                {align === "left" && marks}
                            </Grid>
                        )
                    })}
                </VStack>
            )}
        </Box>
    )
}

function playerMatchStats(events: ReturnType<typeof useRawMatchEvents>, playerId: number) {
    let goals = 0
    let yellow = 0
    let red = 0
    for (const e of events) {
        if (e.playerId !== playerId) continue
        if (e.type === "GOAL" || e.type === "PENALTY_GOAL") goals++
        else if (e.type === "YELLOW_CARD") yellow++
        else if (e.type === "RED_CARD") red++
    }
    return { goals, yellow, red }
}

function PlayerGoalMark({ count }: { count: number }) {
    return (
        <Box
            as="span"
            position="relative"
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
            w="22px"
            h="18px"
            color="fg.ink"
            fontSize="12px"
            fontWeight={900}
            lineHeight="1"
            flexShrink={0}
        >
            <Box as="span" aria-label="Gol">⚽</Box>
            {count > 1 && (
                <Box
                    as="span"
                    position="absolute"
                    right="-2px"
                    top="-5px"
                    minW="12px"
                    h="12px"
                    px="0.5"
                    rounded="full"
                    bg="fg.ink"
                    color="white"
                    fontFamily="mono"
                    fontSize="8px"
                    fontWeight={900}
                    lineHeight="12px"
                    textAlign="center"
                >
                    {count}
                </Box>
            )}
        </Box>
    )
}

function PlayerCardMark({ tone, count }: { tone: "yellow" | "red"; count: number }) {
    return (
        <HStack as="span" gap="0.5" align="center" flexShrink={0}>
            {Array.from({ length: Math.min(count, 2) }).map((_, i) => (
                <Box
                    key={i}
                    as="span"
                    aria-label={tone === "yellow" ? "Žuti karton" : "Crveni karton"}
                    w="8px"
                    h="12px"
                    rounded="1px"
                    bg={tone === "yellow" ? "#facc15" : "#ef4444"}
                    borderWidth="1px"
                    borderColor={tone === "yellow" ? "#d4a90d" : "#dc2626"}
                    boxShadow="xs"
                />
            ))}
            {count > 2 && (
                <Text as="span" fontSize="10px" fontWeight={900} color="fg.muted" lineHeight="1">
                    x{count}
                </Text>
            )}
        </HStack>
    )
}

function GroupContextPanel({
    group,
}: {
    group: Group | null
}) {
    if (!group) {
        return <EmptyContext title="Grupa nije dostupna" note="Grupna faza još nije izvučena." />
    }
    const gridCols = {
        base: "minmax(0, 1fr) 28px 28px 28px 42px 42px",
        md: "34px minmax(0,1fr) 34px 34px 34px 34px 58px 46px 42px",
    }
    return (
        <Box borderWidth="1px" borderColor="border" rounded="lg" overflow="hidden">
            <Grid templateColumns={gridCols} gap="1" px="3" py="2" bg="bg.muted">
                {["#", "Ekipa", "UT", "P", "N", "I", "Gol", "GR", "Bod"].map((h, i) => (
                    <Text
                        key={h}
                        display={
                            h === "#" || h === "UT" || h === "Gol"
                                ? { base: "none", md: "block" }
                                : undefined
                        }
                        fontFamily="mono"
                        fontSize="10px"
                        fontWeight={900}
                        color="fg.muted"
                        textAlign={i >= 2 ? "right" : "left"}
                        textTransform="uppercase"
                    >
                        {h}
                    </Text>
                ))}
            </Grid>
            {group.standings.map((row, i) => {
                const advancing = i < group.effectiveAdvance
                return (
                    <Grid
                        key={row.teamId}
                        templateColumns={gridCols}
                        gap="1"
                        alignItems="center"
                        px="3"
                        py="2.5"
                        borderTopWidth="1px"
                        borderColor="border"
                        bg={advancing ? "brand.subtle" : "bg.panel"}
                        borderLeftWidth="3px"
                        borderLeftColor={advancing ? "brand.solid" : "transparent"}
                    >
                        <Text
                            display={{ base: "none", md: "block" }}
                            fontFamily="mono"
                            fontWeight={900}
                            color={advancing ? "brand.fg" : "fg.muted"}
                        >
                            {i + 1}
                        </Text>
                        <Text fontSize="sm" fontWeight={advancing ? 900 : 800} color="fg.ink" truncate>
                            {row.teamName}
                        </Text>
                        <StandingsCell>{row.played}</StandingsCell>
                        <StandingsCell>{row.won}</StandingsCell>
                        <StandingsCell>{row.drawn}</StandingsCell>
                        <StandingsCell>{row.lost}</StandingsCell>
                        <StandingsCell display={{ base: "none", md: "block" }}>{row.goalsFor}:{row.goalsAgainst}</StandingsCell>
                        <StandingsCell>{row.goalDiff > 0 ? `+${row.goalDiff}` : row.goalDiff}</StandingsCell>
                        <StandingsCell bold>{row.points}</StandingsCell>
                    </Grid>
                )
            })}
        </Box>
    )
}

function StandingsCell({
    children,
    bold = false,
    display,
}: {
    children: React.ReactNode
    bold?: boolean
    display?: any
}) {
    return (
        <Text display={display} fontFamily="mono" fontSize="sm" fontWeight={bold ? 900 : 700} color="fg.ink" textAlign="right">
            {children}
        </Text>
    )
}

function BracketContextPanel({
    bracket,
    matchId,
    colors,
}: {
    bracket: Bracket | null
    matchId: number
    colors: Record<string, TeamKit>
}) {
    const zoomRef = useRef<ZoomableBracketHandle>(null)
    const activeRef = useRef<HTMLDivElement | null>(null)
    const rounds = bracket?.rounds ?? []
    useEffect(() => {
        if (!bracket || rounds.length === 0) return
        // One tick so the freshly-rendered card is mounted before we centre
        // on it (mirrors the Eliminacija tab's own auto-focus defer).
        const timer = window.setTimeout(() => {
            zoomRef.current?.centerOn(activeRef.current)
        }, 120)
        return () => window.clearTimeout(timer)
    }, [bracket, matchId, rounds.length])

    if (!bracket || rounds.length === 0) {
        return <EmptyContext title="Završnica nije dostupna" note="Eliminacijska ljestvica još nije generirana." />
    }
    const koCodes = buildKoMatchCodes(rounds.flatMap((r) => r.matches))

    /* Read-only mini-bracket - same BracketBoard layout as the Eliminacija
       tab, so the two never drift apart, with the same zoom/pan. Auto-centres
       on the match being watched. */
    return (
        <Box position="relative">
            <ZoomableBracket ref={zoomRef} wrapperStyle={{ maxHeight: "65vh" }} contentPadding="12px">
                <BracketBoard
                    rounds={rounds}
                    renderMatch={(m) => {
                        const active = m.matchId === matchId
                        return (
                            <Box ref={active ? activeRef : undefined}>
                                <ReadOnlyBracketMatch
                                    match={m}
                                    active={active}
                                    code={m.knockoutCode ?? koCodes.get(m.matchId) ?? null}
                                    colors={colors}
                                />
                            </Box>
                        )
                    }}
                    thirdPlace={bracket.thirdPlace}
                    renderThirdPlace={(m) => (
                        <Box ref={m.matchId === matchId ? activeRef : undefined}>
                            <Text
                                fontSize="xs"
                                fontWeight={900}
                                color="fg.muted"
                                mb="2"
                                textTransform="uppercase"
                            >
                                Za 3. mjesto
                            </Text>
                            <ReadOnlyBracketMatch
                                match={m}
                                active={m.matchId === matchId}
                                code={m.knockoutCode ?? null}
                                colors={colors}
                            />
                        </Box>
                    )}
                />
            </ZoomableBracket>
            <Box position="absolute" bottom="2" right="2" zIndex={2}>
                <ZoomControls
                    onZoomOut={() => zoomRef.current?.zoomOut()}
                    onZoomIn={() => zoomRef.current?.zoomIn()}
                    onReset={() => zoomRef.current?.reset()}
                />
            </Box>
        </Box>
    )
}

function ReadOnlyBracketMatch({
    match,
    active,
    code,
    colors,
}: {
    match: BracketMatch
    active: boolean
    code: string | null
    colors: Record<string, TeamKit>
}) {
    const showScore = match.score1 != null && match.score2 != null
    const headerLabel = code ?? (match.stage === "FINAL" ? "FINALE" : match.stage === "THIRD_PLACE" ? "ZA 3. MJESTO" : null)
    return (
        <Box
            w="100%"
            borderWidth="1px"
            borderColor={active ? "accent.amber" : "border"}
            borderLeftWidth="3px"
            rounded="lg"
            overflow="hidden"
            bg={active ? "yellow.subtle" : "bg.panel"}
            boxShadow={active ? "0 0 0 2px color-mix(in srgb, var(--chakra-colors-accent-amber) 24%, transparent)" : undefined}
        >
            {headerLabel && (
                <Flex
                    align="center"
                    minH="24px"
                    px="2.5"
                    bg={active ? "yellow.subtle" : "bg.muted"}
                    borderBottomWidth="1px"
                    borderColor="border"
                >
                    <Text fontFamily="mono" fontSize="11px" fontWeight={900} color={active ? "accent.amber" : "fg.muted"}>
                        {headerLabel}
                    </Text>
                </Flex>
            )}
            <BracketTeamLine
                name={match.team1Name ?? match.slot1PredictedName ?? match.slot1Label ?? "-"}
                slotLabel={match.team1Name == null && match.slot1PredictedName != null ? match.slot1Label : null}
                score={showScore ? match.score1 : null}
                penalty={match.penalties1}
                winner={match.winnerTeamId != null && match.winnerTeamId === match.team1Id}
                kit={teamKit(colors, match.team1Id)}
            />
            <Box borderTopWidth="1px" borderColor="border" />
            <BracketTeamLine
                name={match.team2Name ?? match.slot2PredictedName ?? match.slot2Label ?? "-"}
                slotLabel={match.team2Name == null && match.slot2PredictedName != null ? match.slot2Label : null}
                score={showScore ? match.score2 : null}
                penalty={match.penalties2}
                winner={match.winnerTeamId != null && match.winnerTeamId === match.team2Id}
                kit={teamKit(colors, match.team2Id)}
            />
        </Box>
    )
}

function BracketTeamLine({
    name,
    slotLabel,
    score,
    penalty,
    winner,
    kit,
}: {
    name: string
    slotLabel?: string | null
    score: number | null
    penalty: number | null
    winner: boolean
    kit?: TeamKit
}) {
    const jersey = kit?.jersey ?? kit?.shorts ?? "#E8EEF3"
    const shorts = kit?.shorts ?? kit?.jersey ?? "#DCE4EA"
    return (
        <Flex align="center" gap="2" px="2.5" py="2" bg={winner ? "brand.subtle" : "transparent"}>
            <KitSwatch jersey={jersey} shorts={shorts} size={12} />
            <HStack gap="1.5" minW="0" flex="1">
                <Text fontSize="sm" fontWeight={winner ? 900 : 700} color={winner ? "fg.ink" : "fg.muted"} truncate>
                    {name}
                </Text>
                {slotLabel && (
                    <Box
                        as="span"
                        flexShrink={0}
                        fontFamily="mono"
                        fontSize="9px"
                        fontWeight={800}
                        color="fg.muted"
                        bg="bg.surfaceTint"
                        borderWidth="1px"
                        borderColor="border"
                        rounded="sm"
                        px="1"
                        py="0.5"
                        lineHeight="1.1"
                    >
                        {slotLabel}
                    </Box>
                )}
            </HStack>
            {score != null && (
                <HStack gap="1" flexShrink={0} align="baseline">
                    <Text fontFamily="mono" fontSize="sm" fontWeight={900} color={winner ? "brand.fg" : "fg.ink"}>
                        {score}
                    </Text>
                    {penalty != null && (
                        <Text fontFamily="mono" fontSize="2xs" fontWeight={900} color={winner ? "brand.fg" : "fg.muted"}>
                            ({penalty})
                        </Text>
                    )}
                </HStack>
            )}
        </Flex>
    )
}

function EmptyContext({ title, note }: { title: string; note: string }) {
    return (
        <Flex minH="180px" align="center" justify="center" textAlign="center" px="4">
            <Box>
                <Text fontSize="sm" fontWeight={900} color="fg.ink">
                    {title}
                </Text>
                <Text fontSize="sm" color="fg.muted" mt="1">
                    {note}
                </Text>
            </Box>
        </Flex>
    )
}
