import { useCallback, useEffect, useMemo, useState } from "react"
import { Box, Flex, HStack, IconButton, Text, VStack } from "@chakra-ui/react"
import { Navigate, useNavigate, useParams } from "react-router-dom"
import { FiArrowLeft } from "react-icons/fi"
import { useQueryClient } from "@tanstack/react-query"

import { qk } from "../queryClient"
import { fetchTournamentDetails, fetchTournamentAccess, finishTournament } from "../api/tournaments"
import type { TournamentDetails } from "../types/tournaments"
import { fetchLiveMatches, type LiveMatch } from "../api/live"
import { useAuth } from "../auth/AuthContext"
import { usePolling } from "../hooks/usePolling"
import { useLiveSocket } from "../hooks/useLiveSocket"
import { Loader } from "../ui/primitives"
import { LiveClock } from "../components/liveMatch"
import { TeamKitChip, useTeamColors } from "../components/jersey"
import { PulseDot } from "../ui/pitch"
import LiveControlTab from "../components/LiveControlTab"
import TournamentResults from "../components/TournamentResults"
import { useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   ZapisnikModePage - the organizer's standalone scorekeeper view at
   /turniri/:uuid/zapisnik.

   A distraction-free, per-tournament mirror of the "Zapisnik" tab: a slim
   header (back to the tournament) over the full-width LiveControlTab console.
   That console already runs the whole loop - it surfaces the LIVE match (else
   the next on-deck one), lets the organizer jump to any other scheduled game,
   and auto-advances to the next match as each finishes.

   ORGANIZER-ONLY. Same rule as the tab: admin, the creator, or a granted
   co-editor. Anyone else (or a signed-out visitor) is redirected back to the
   public tournament page. The :uuid param may be a slug - that's fine, every
   data call here accepts slug-or-uuid.
   ────────────────────────────────────────────────────────────────────────── */

/** The live clock instants lifted up from the console (LiveMatchPanel) so the
 *  header clock ticks from the SAME truth and freezes together on pause. */
type HeaderClockArgs = {
    liveStartedAt: string | null | undefined
    firstHalfEndedAt: string | null
    secondHalfStartedAt: string | null
    livePausedAt: string | null
    halfLengthMin: number | null
    halfCount: number | null
}


/** The match the sticky header describes - lifted from the console's picker. */
type HeaderMatch = {
    team1Id: number | null
    team1Name: string | null
    team2Id: number | null
    team2Name: string | null
    score1: number | null
    score2: number | null
    status: string | null
}

export default function ZapisnikModePage() {
    const { uuid } = useParams<{ uuid: string }>()
    const navigate = useNavigate()
    const { user, isAdmin, loading: authLoading } = useAuth()
    const queryClient = useQueryClient()
    const t = useTranslation()

    // Seed from the react-query cache (warmed by the detail page / card
    // prefetch) so a warm open paints instantly instead of a cold spinner.
    const cached = uuid
        ? queryClient.getQueryData<TournamentDetails>(qk.tournamentDetails(uuid))
        : undefined
    const [details, setDetails] = useState<TournamentDetails | null>(cached ?? null)
    const [detailsLoading, setDetailsLoading] = useState(!cached)
    const [notFound, setNotFound] = useState(false)

    // canManage from the backend (granted co-editors aren't in the details
    // payload); null until it resolves. Only the co-editor path needs it -
    // owner/admin are decided locally, so their access is instant.
    const [canManageAccess, setCanManageAccess] = useState<boolean | null>(null)

    useEffect(() => {
        if (!uuid) return
        let cancelled = false
        queryClient
            .fetchQuery({
                queryKey: qk.tournamentDetails(uuid),
                queryFn: () => fetchTournamentDetails(uuid),
                staleTime: 30_000,
            })
            .then((t) => { if (!cancelled) setDetails(t) })
            .catch(() => { if (!cancelled) setNotFound(true) })
            .finally(() => { if (!cancelled) setDetailsLoading(false) })
        return () => { cancelled = true }
    }, [uuid, queryClient])

    /** Re-pull the tournament after a result was entered. Cheap and rare (only
     *  when the finished-match count moves), and it's the only way the console
     *  learns that the final produced a champion - `winnerName` / `status` are
     *  set backend-side when the last knockout match is closed. */
    const refreshDetails = useCallback(() => {
        if (!uuid) return
        fetchTournamentDetails(uuid)
            .then((d) => {
                setDetails(d)
                queryClient.setQueryData(qk.tournamentDetails(uuid), d)
            })
            .catch(() => { /* keep the last known tournament - not fatal here */ })
    }, [uuid, queryClient])

    /** The final has been recorded (reported by the console, which owns the
     *  fixtures). NOT derivable from `details`: the backend writes `winnerName`
     *  only on FINISH, which is exactly the step organizers forget - so the
     *  prompt has to key off the match, not off the tournament row. */
    const [finalDecided, setFinalDecided] = useState(false)
    const onFixturesSettled = useCallback(
        ({ finalDecided: decided, initial }: { finalDecided: boolean; initial: boolean }) => {
            setFinalDecided(decided)
            // A result moved - the tournament row may have changed with it
            // (e.g. finished from another device). The load call reports what
            // we already fetched, so it needs no re-pull.
            if (!initial) refreshDetails()
        },
        [refreshDetails],
    )

    /** Mark the tournament FINISHED straight from the console. */
    const [finishing, setFinishing] = useState(false)
    async function runFinishTournament() {
        if (!uuid) return
        try {
            setFinishing(true)
            const updated = await finishTournament(uuid)
            setDetails(updated)
            queryClient.setQueryData(qk.tournamentDetails(uuid), updated)
        } catch {
            /* error toasted by the http interceptor */
        } finally {
            setFinishing(false)
        }
    }

    useEffect(() => {
        if (!uuid || !user?.uid) { setCanManageAccess(false); return }
        let cancelled = false
        fetchTournamentAccess(uuid)
            .then((a) => { if (!cancelled) setCanManageAccess(a.canManage) })
            .catch(() => { if (!cancelled) setCanManageAccess(false) })
        return () => { cancelled = true }
    }, [uuid, user?.uid])

    // The tournament's current LIVE match - feeds the big timer in the sticky
    // header. The FULL live list is fetched unconditionally (seeded from the
    // shared cache for an instant paint) and the tournament filter is applied
    // afterwards via useMemo - so nothing here depends on `details` having
    // resolved yet. The previous version gated the fetch on the canonical uuid,
    // and on a cold refresh (empty cache) that ordering left the header clock
    // blank until the next poll tick. Polling + the socket keep it true.
    const [liveList, setLiveList] = useState<LiveMatch[]>(
        () => queryClient.getQueryData<LiveMatch[]>(qk.liveMatches) ?? [],
    )
    const loadLive = useCallback(() => {
        fetchLiveMatches()
            .then((list) => {
                setLiveList(list)
                queryClient.setQueryData(qk.liveMatches, list)
            })
            .catch(() => { /* keep last known - next tick retries */ })
    }, [queryClient])
    usePolling(loadLive, 5_000)
    useLiveSocket(() => loadLive())
    // Kit chips for the scoreboard in the sticky header (shared cached fetch).
    const kitColors = useTeamColors(details?.uuid)

    const liveMatch = useMemo(
        () => liveList.find((m) => m.tournamentUuid === details?.uuid) ?? null,
        [liveList, details?.uuid],
    )

    // The console lifts its OWN clock instants up here (via LiveControlTab →
    // LiveMatchPanel). When present, the header clock ticks from these exact
    // instants and freezes the instant the console pauses - no drift from the
    // fetchLiveMatches poll. Falls back to the liveMatch-derived render below
    // for the brief window before the first callback fires.
    const [clockArgs, setClockArgs] = useState<HeaderClockArgs | null>(null)

    // The console portals its match picker into this node (see LiveControlTab's
    // `selectorSlot`), so the picker sits in the sticky header instead of
    // scrolling away with the console.
    const [selectorSlot, setSelectorSlot] = useState<HTMLElement | null>(null)

    /**
     * The match the console is CURRENTLY on, lifted from the picker.
     *
     * The header used to render `liveMatch` - the tournament's live match -
     * which is right only while that is also the selected one. Pick a finished
     * fixture from the header and the scoreboard kept showing the live game's
     * teams and score, i.e. the wrong match entirely.
     */
    const [headerMatch, setHeaderMatch] = useState<HeaderMatch | null>(null)

    /** Live score lifted from the console - moves the instant a goal is entered,
     *  unlike the fixtures snapshot behind `headerMatch`. Cleared when the
     *  selection changes so a stale score never rides onto another match. */
    const [liveScore, setLiveScore] = useState<{ s1: number; s2: number } | null>(null)
    const onScore = useCallback((s1: number, s2: number) => setLiveScore({ s1, s2 }), [])

    /**
     * MUST be stable. The console reports the selection from an effect that
     * lists this callback in its dependencies, so an inline arrow - a new
     * function every render - re-ran the effect, which set state, which
     * rendered again: a loop that pinned the page and swallowed the back
     * button's navigation.
     */
    const onSelectedMatch = useCallback((m: HeaderMatch | null) => {
        // Drop the previous match's live score with the selection, or it would
        // flash on the new one.
        setLiveScore(null)
        setHeaderMatch(m)
    }, [])

    // The tournament's live clock belongs in the header only while the console
    // is actually ON that match. Pick a finished fixture and the live game's
    // clock kept ticking up there, over another match's score.
    const headerFollowsLive = headerMatch === null || headerMatch.status === "LIVE"

    // What the header shows: the selection when the console has one, else the
    // tournament's live match (the brief window before the console mounts).
    const headerScore = headerMatch ?? (liveMatch
        ? {
            team1Id: liveMatch.team1Id ?? null,
            team1Name: liveMatch.team1Name,
            team2Id: liveMatch.team2Id ?? null,
            team2Name: liveMatch.team2Name,
            score1: liveMatch.score1,
            score2: liveMatch.score2,
            status: "LIVE",
        }
        : null)

    // organizer = admin OR creator OR granted co-editor. Owner/admin resolve
    // locally; the co-editor path waits for the access probe above.
    const ownerOrAdmin =
        !!details && (isAdmin || (!!user?.uid && user.uid === details.createdByUid))
    const accessResolved = ownerOrAdmin || !user?.uid || canManageAccess !== null
    const stillLoading = authLoading || detailsLoading || !accessResolved
    const canEdit = ownerOrAdmin || canManageAccess === true

    // Bad/empty param or a dead slug → bounce to the tournaments list / page.
    if (!uuid) return <Navigate to="/turniri" replace />
    if (notFound) return <Navigate to={`/turniri/${uuid}`} replace />

    // Wait for auth + details + (when signed in) the access probe before
    // deciding - so we never flash the console or a wrong redirect.
    if (stillLoading || !details) return <Loader />

    // Known and NOT allowed → back to the public tournament page.
    if (!canEdit) return <Navigate to={`/turniri/${uuid}`} replace />

    return (
        // The app Container is gone in zapisnik mode (this page owns the whole
        // viewport). The header is STICKY (pins to the top of the app-level
        // scroll box while the console scrolls under it); the content re-
        // supplies fluid gutters and stretches with the screen - wide monitors
        // get a wide console (capped at 1600px) instead of the old 1100px box.
        <>
            <Box
                position="sticky"
                top="0"
                zIndex={20}
                bg="bg.canvas"
                borderBottomWidth="1px"
                borderColor="border.subtle"
            >
                {/* 3-column header grid: back + tournament name LEFT, the
                    running match timer dead-CENTRE, symmetric right spacer.
                    `1fr auto 1fr` keeps the clock at the true middle no
                    matter how long the tournament name is. */}
                <Box
                    display="grid"
                    // `minmax(0, 1fr)`, not a bare `1fr`: a plain fr track is
                    // floored at min-content, so the wide left column (the
                    // tournament name, and the match picker in the row below)
                    // and the empty right one never came out equal - and the
                    // centred clock/scoreboard drifted left with them.
                    gridTemplateColumns="minmax(0, 1fr) auto minmax(0, 1fr)"
                    alignItems="center"
                    gap="2"
                    maxW="min(1600px, 96vw)"
                    mx="auto"
                    px={{ base: "3", md: "6" }}
                    py="2"
                >
                    <Flex align="center" gap="2" minW="0" justifySelf="start" maxW="full">
                        <IconButton
                            aria-label={t.pages.zapisnikModePage.backToTournamentAria}
                            variant="ghost"
                            size="md"
                            onClick={() => navigate(`/turniri/${uuid}?tab=live`)}
                            flexShrink={0}
                        >
                            <FiArrowLeft />
                        </IconButton>
                        <VStack gap="0" minW="0" align="flex-start">
                            <Text
                                fontSize={{ base: "md", md: "lg" }}
                                fontWeight={800}
                                color="fg.ink"
                                lineHeight="1.2"
                                truncate
                                maxW="full"
                            >
                                {details.name}
                            </Text>
                            <Text
                                fontFamily="mono"
                                fontSize="10px"
                                fontWeight={800}
                                letterSpacing="0.16em"
                                color="fg.muted"
                            >
                                {t.pages.zapisnikModePage.zapisnikLabel}
                            </Text>
                        </VStack>
                    </Flex>

                    {/* Centre: the LIVE match's running clock (pause-aware);
                        a plain pulsing UŽIVO pill for score-only matches;
                        empty while nothing is live. */}
                    <Box justifySelf="center">
                        {clockArgs ? (
                            <LiveClock {...clockArgs} size="md" clockOnly />
                        ) : headerFollowsLive && liveMatch?.liveMode === "TIMER" && liveMatch.liveStartedAt ? (
                            <LiveClock
                                liveStartedAt={liveMatch.liveStartedAt}
                                firstHalfEndedAt={liveMatch.firstHalfEndedAt ?? null}
                                secondHalfStartedAt={liveMatch.secondHalfStartedAt ?? null}
                                livePausedAt={liveMatch.livePausedAt ?? null}
                                halfLengthMin={liveMatch.halfLengthMin}
                                halfCount={liveMatch.halfCount}
                                size="md"
                                clockOnly
                            />
                        ) : headerFollowsLive && liveMatch ? (
                            <HStack
                                gap="1.5"
                                color="accent.red"
                                fontFamily="mono"
                                fontSize="11px"
                                fontWeight={800}
                                letterSpacing="0.1em"
                            >
                                <PulseDot color="accent.red" size={6} />
                                {t.pages.zapisnikModePage.liveLabel}
                            </HStack>
                        ) : null}
                    </Box>

                    {/* Right column intentionally empty - balances the grid. */}
                    <Box />
                </Box>

                {/* Live scoreboard, pinned under the header row.
                    The console has no score of its own: it is a data-entry
                    screen, and the running result only existed at the bottom of
                    the page, inside "tijek utakmice" - teams standing at the
                    table were adding goals up by hand. Here it rides along with
                    the sticky header, so it stays on screen while the organizer
                    scrolls through rosters and actions. */}
                {(headerScore || selectorSlot !== null) && (
                    <Box
                        borderTopWidth="1px"
                        borderColor="border.subtle"
                        maxW="min(1600px, 96vw)"
                        mx="auto"
                        px={{ base: "3", md: "6" }}
                        py="1.5"
                    >
                        {/* Row: picker LEFT, scoreboard centred, empty right
                            column of the same 1fr width to keep it centred.

                            In normal flow, NOT absolutely positioned: as an
                            overlay the picker's button overflowed the short row
                            and sat over the header above it, swallowing clicks
                            on the back arrow. */}
                        <Box
                            display="grid"
                            // The middle track gets a DEFINITE share (2fr), not
                            // `auto`: an auto track is sized by its content, so
                            // the scoreboard inside it could not split itself
                            // evenly and the score drifted with whichever team
                            // name was longer.
                            gridTemplateColumns="minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr)"
                            alignItems="center"
                            gap={{ base: "2", md: "3" }}
                        >
                        <Box ref={setSelectorSlot} justifySelf="start" minW="0" />
                        <Box
                            display="grid"
                            // Equal halves either side of the score, so the
                            // score itself sits on the centre line - directly
                            // under the clock above it.
                            gridTemplateColumns="minmax(0, 1fr) auto minmax(0, 1fr)"
                            alignItems="center"
                            gap={{ base: "2", md: "3" }}
                            minW="0"
                            w="full"
                        >
                            {headerScore ? (<>
                            <HStack gap="2" minW="0" justify="flex-end">
                                <Text
                                    fontSize={{ base: "xs", md: "sm" }}
                                    fontWeight={800}
                                    color="fg.ink"
                                    textAlign="right"
                                    truncate
                                    minW="0"
                                >
                                    {headerScore.team1Name ?? "-"}
                                </Text>
                                <TeamKitChip colors={kitColors} teamId={headerScore.team1Id} size={11} />
                            </HStack>

                            <Text
                                fontFamily="mono"
                                fontSize={{ base: "lg", md: "xl" }}
                                fontWeight={800}
                                color="fg.ink"
                                fontVariantNumeric="tabular-nums"
                                whiteSpace="nowrap"
                                px="1"
                            >
                                {liveScore?.s1 ?? headerScore.score1 ?? 0} : {liveScore?.s2 ?? headerScore.score2 ?? 0}
                            </Text>

                            <HStack gap="2" minW="0">
                                <TeamKitChip colors={kitColors} teamId={headerScore.team2Id} size={11} />
                                <Text
                                    fontSize={{ base: "xs", md: "sm" }}
                                    fontWeight={800}
                                    color="fg.ink"
                                    truncate
                                    minW="0"
                                >
                                    {headerScore.team2Name ?? "-"}
                                </Text>
                            </HStack>
                            </>) : <Box minH="7" />}
                        </Box>
                        {/* Balances the picker column so the scoreboard sits on
                            the true centre, in line with the clock above. */}
                        <Box />
                        </Box>
                    </Box>
                )}
            </Box>

            <Box
                maxW="min(1600px, 96vw)"
                mx="auto"
                px={{ base: "3", md: "6" }}
                py={{ base: "3", md: "5" }}
            >
                {/* Tournament decided (the final set a champion) but not yet
                    marked finished - organizers regularly walk away here, not
                    realising the awards are still unassigned and the tournament
                    is formally still running. The same compact results card the
                    tournament page shows in its sidebar, hoisted ABOVE the
                    console so it's the first thing seen after the final result
                    goes in. Independent of HOW the result was entered (timer or
                    score-only): it keys off the tournament, not the match.
                    Centred, because the console below is a full-width
                    workspace and a 420px card pinned left read as a leftover -
                    the card's own rows stay left-aligned. */}
                {(finalDecided || !!details.winnerName || details.status === "FINISHED") && (
                    <Box maxW={{ base: "full", md: "420px" }} mx="auto" mb={{ base: "3", md: "5" }}>
                        {details.status !== "FINISHED" && (
                            <Box mb="2" textAlign="center">
                                <Text fontSize="sm" fontWeight={800} color="fg.ink">
                                    {t.pages.zapisnikModePage.tournamentOverTitle}
                                </Text>
                                <Text fontSize="xs" color="fg.muted">
                                    {t.pages.zapisnikModePage.tournamentOverHint}
                                </Text>
                            </Box>
                        )}
                        <TournamentResults
                            t={details}
                            canEdit={canEdit}
                            onSaved={(updated) => {
                                setDetails(updated)
                                queryClient.setQueryData(qk.tournamentDetails(uuid), updated)
                            }}
                            onFinish={details.status !== "FINISHED" ? runFinishTournament : undefined}
                            finishing={finishing}
                            compact
                        />
                    </Box>
                )}

                <LiveControlTab
                    // The CANONICAL uuid, not the route param - that may be a
                    // slug. Every data call accepts either, but the console
                    // also compares this against the stream banner's
                    // `tournamentUuid`, which is always the uuid: with a slug
                    // in hand that test failed, so the fullscreen zapisnik did
                    // not know its own tournament was streaming and kept
                    // offering the start modes ("bez mjerača", "samo
                    // rezultat") that cannot drive the overlay clock - while
                    // the embedded tab, which passes t.uuid, hid them.
                    uuid={details.uuid}
                    onClockArgs={setClockArgs}
                    onFixturesSettled={onFixturesSettled}
                    selectorSlot={selectorSlot}
                    onSelectedMatch={onSelectedMatch}
                    onScore={onScore}
                />
            </Box>
        </>
    )
}
