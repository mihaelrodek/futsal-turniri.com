import { useCallback, useEffect, useMemo, useState } from "react"
import { Box, Flex, HStack, IconButton, Text, VStack } from "@chakra-ui/react"
import { Navigate, useNavigate, useParams } from "react-router-dom"
import { FiArrowLeft } from "react-icons/fi"
import { useQueryClient } from "@tanstack/react-query"

import { qk } from "../queryClient"
import { fetchTournamentDetails, fetchTournamentAccess } from "../api/tournaments"
import type { TournamentDetails } from "../types/tournaments"
import { fetchLiveMatches, type LiveMatch } from "../api/live"
import { useAuth } from "../auth/AuthContext"
import { usePolling } from "../hooks/usePolling"
import { useLiveSocket } from "../hooks/useLiveSocket"
import { Loader } from "../ui/primitives"
import { LiveClock } from "../components/liveMatch"
import { PulseDot } from "../ui/pitch"
import LiveControlTab from "../components/LiveControlTab"

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

export default function ZapisnikModePage() {
    const { uuid } = useParams<{ uuid: string }>()
    const navigate = useNavigate()
    const { user, isAdmin, loading: authLoading } = useAuth()
    const queryClient = useQueryClient()

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
                    gridTemplateColumns="1fr auto 1fr"
                    alignItems="center"
                    gap="2"
                    maxW="min(1600px, 96vw)"
                    mx="auto"
                    px={{ base: "3", md: "6" }}
                    py="2"
                >
                    <Flex align="center" gap="2" minW="0" justifySelf="start" maxW="full">
                        <IconButton
                            aria-label="Natrag na turnir"
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
                                ZAPISNIK
                            </Text>
                        </VStack>
                    </Flex>

                    {/* Centre: the LIVE match's running clock (pause-aware);
                        a plain pulsing UŽIVO pill for score-only matches;
                        empty while nothing is live. */}
                    <Box justifySelf="center">
                        {clockArgs ? (
                            <LiveClock {...clockArgs} size="md" showLabel />
                        ) : liveMatch?.liveMode === "TIMER" && liveMatch.liveStartedAt ? (
                            <LiveClock
                                liveStartedAt={liveMatch.liveStartedAt}
                                firstHalfEndedAt={liveMatch.firstHalfEndedAt ?? null}
                                secondHalfStartedAt={liveMatch.secondHalfStartedAt ?? null}
                                livePausedAt={liveMatch.livePausedAt ?? null}
                                halfLengthMin={liveMatch.halfLengthMin}
                                halfCount={liveMatch.halfCount}
                                size="md"
                                showLabel
                            />
                        ) : liveMatch ? (
                            <HStack
                                gap="1.5"
                                color="accent.red"
                                fontFamily="mono"
                                fontSize="11px"
                                fontWeight={800}
                                letterSpacing="0.1em"
                            >
                                <PulseDot color="accent.red" size={6} />
                                UŽIVO
                            </HStack>
                        ) : null}
                    </Box>

                    {/* Right column intentionally empty - balances the grid. */}
                    <Box />
                </Box>
            </Box>

            <Box
                maxW="min(1600px, 96vw)"
                mx="auto"
                px={{ base: "3", md: "6" }}
                py={{ base: "3", md: "5" }}
            >
                <LiveControlTab uuid={uuid} onClockArgs={setClockArgs} />
            </Box>
        </>
    )
}
