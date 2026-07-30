import { useEffect, useMemo, useRef, useState } from "react"
import { Box, Button, Flex, Grid, HStack, IconButton, Text, VStack, chakra } from "@chakra-ui/react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { FiChevronLeft, FiChevronRight, FiShare2, FiVideoOff, FiX } from "react-icons/fi"
import { useQueryClient } from "@tanstack/react-query"

import StreamPlayer from "../components/StreamPlayer"
import { buildScoreBug, buildStreamOverlay, StreamSidePanel, useNextMatch } from "../components/StreamHero"
import { useTeamColors } from "../components/jersey"
import { fetchStreamBanner, readStreamBannerHint, type StreamBanner } from "../api/streamBanner"
import { fetchLiveMatches, type LiveMatch } from "../api/live"
import { fetchTournamentDetails } from "../api/tournaments"
import { fetchSchedule } from "../api/schedule"
import type { ScheduledMatch } from "../types/schedule"
import { useStreamPresence } from "../hooks/useStreamPresence"
import { usePolling } from "../hooks/usePolling"
import { useDocumentHead } from "../hooks/useDocumentHead"
import { showSuccess } from "../toaster"
import { qk } from "../queryClient"
import { useTranslation, type Dictionary } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   TournamentLivePage - the shareable "turnir mode" at /turniri/:uuid/uzivo.

   An immersive, distraction-free view of a tournament's live camera stream:
   the video fills ~80% on the left, the combined "Utakmica | Tablica" side
   panel (identical to the home hero) on the right. Because it's a real route
   (not an overlay), the URL can be shared - a spectator opens the link and
   watches the stream directly, and social crawlers get a proper "uživo
   prijenos … putem kamere" preview via useDocumentHead.

   The camera itself is a GLOBAL admin switch (one stream at a time, optionally
   linked to a tournament). This page shows the video only while that switch is
   ON and points at THIS tournament; otherwise it shows a graceful
   "no live stream" state that still keeps the link valid for when it starts.
   ────────────────────────────────────────────────────────────────────────── */

const ORIGIN = "https://futsal-turniri.com"

export default function TournamentLivePage() {
    const t = useTranslation()
    const { uuid: param } = useParams<{ uuid: string }>()
    const navigate = useNavigate()
    const location = useLocation()
    const queryClient = useQueryClient()

    // Tournament identity (name + canonical uuid + pretty slug). Seed from the
    // shared cache so a warm open paints instantly.
    const cached = param
        ? queryClient.getQueryData<{ name: string; uuid: string; slug?: string | null }>(qk.tournamentDetails(param))
        : undefined
    const [name, setName] = useState<string | null>(cached?.name ?? null)
    const [tUuid, setTUuid] = useState<string | null>(cached?.uuid ?? null)
    const [slug, setSlug] = useState<string | null>(cached?.slug ?? param ?? null)
    const [notFound, setNotFound] = useState(false)

    useEffect(() => {
        if (!param) return
        let cancelled = false
        queryClient
            .fetchQuery({ queryKey: qk.tournamentDetails(param), queryFn: () => fetchTournamentDetails(param), staleTime: 30_000 })
            .then((t) => {
                if (cancelled) return
                setName(t.name)
                setTUuid(t.uuid)
                setSlug(t.slug ?? param)
            })
            .catch(() => { if (!cancelled) setNotFound(true) })
        return () => { cancelled = true }
    }, [param, queryClient])

    // Global stream banner (may be linked to this tournament) - polled.
    const [banner, setBanner] = useState<StreamBanner | null>(() => readStreamBannerHint())
    usePolling(() => {
        fetchStreamBanner().then(setBanner).catch(() => { /* silent */ })
        // Fast while streaming so an admin-toggled overlay appears promptly.
    }, banner?.state === "STREAMING" && !!banner?.url ? 7_000 : 20_000)

    // Live matches → this tournament's live game (drives the side panel + bug).
    const [liveList, setLiveList] = useState<LiveMatch[]>(
        () => queryClient.getQueryData<LiveMatch[]>(qk.liveMatches) ?? [],
    )
    usePolling(() => {
        fetchLiveMatches()
            .then((l) => { queryClient.setQueryData(qk.liveMatches, l); setLiveList(l) })
            .catch(() => { /* silent */ })
    }, 15_000)

    const uuid = tUuid ?? param ?? null
    const match = useMemo(
        () => liveList.find((m) => m.tournamentUuid === uuid) ?? null,
        [liveList, uuid],
    )

    // Show the video only while the global camera is ON, has a url, and is
    // linked to THIS tournament (or unlinked but this tournament is the one
    // with a live game right now).
    const streamOn =
        !!banner?.live && !!banner?.url &&
        (banner.tournamentUuid === uuid || (!banner.tournamentUuid && !!match))

    const viewers = useStreamPresence(streamOn)
    const colors = useTeamColors(uuid)
    const nextMatch = useNextMatch(uuid, null, !match)
    const scoreBug = buildScoreBug(match, colors, nextMatch, t)

    const shareUrl = `${ORIGIN}/turniri/${slug ?? param ?? ""}/uzivo`

    useDocumentHead({
        title: t.pages.tournamentLivePage.documentTitle(name),
        description: t.pages.tournamentLivePage.documentDescription(name),
        canonical: shareUrl,
    })

    // Lock body scroll while the immersive view is mounted.
    useEffect(() => {
        const prev = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => { document.body.style.overflow = prev }
    }, [])

    function goExit() {
        // Back to where we came from; on a cold open (shared link) fall back to
        // the tournament page so exit is never a dead end.
        if (location.key !== "default") navigate(-1)
        else navigate(`/turniri/${slug ?? param ?? ""}`)
    }

    async function share() {
        const title = t.pages.tournamentLivePage.shareTitle(name)
        const text = t.pages.tournamentLivePage.shareText(name)
        if (navigator.share) {
            try { await navigator.share({ title, text, url: shareUrl }) } catch { /* dismissed */ }
            return
        }
        try {
            await navigator.clipboard.writeText(shareUrl)
            showSuccess(t.common.linkCopied)
        } catch { /* clipboard blocked - nothing more we can do */ }
    }

    return (
        <Box position="fixed" inset="0" zIndex={2000} bg="#0a0c0f">
            {!streamOn && (
                /* No-stream state: unchanged - just the exit/share pair,
                   floating top-right (NoStream below has its own Natrag /
                   Otvori turnir buttons for the rest). */
                <Flex position="absolute" top={{ base: "2", md: "3" }} right={{ base: "2", md: "3" }} zIndex={2} gap="2">
                    <ControlButton onClick={share} label={t.pages.tournamentLivePage.shareAria}>
                        <FiShare2 size={15} /> {t.common.share}
                    </ControlButton>
                    <ControlButton onClick={goExit} label={t.pages.tournamentLivePage.exitAria}>
                        <FiX size={16} /> {t.pages.tournamentLivePage.exitButton}
                    </ControlButton>
                </Flex>
            )}

            {streamOn && (
                /* Mobile only: no room for Podijeli/Izađi in the header row
                   next to the name, so they float top-right as icon-only
                   buttons instead (md+ keeps them inline in the row below). */
                <HStack
                    display={{ base: "flex", md: "none" }}
                    position="absolute"
                    top="2"
                    right="2"
                    zIndex={2}
                    gap="1.5"
                >
                    <IconButton
                        aria-label={t.pages.tournamentLivePage.shareAria}
                        title={t.pages.tournamentLivePage.shareAria}
                        onClick={share}
                        size="sm"
                        rounded="full"
                        bg="whiteAlpha.200"
                        color="white"
                        _hover={{ bg: "whiteAlpha.300" }}
                        css={{ backdropFilter: "blur(6px)" }}
                    >
                        <FiShare2 size={14} />
                    </IconButton>
                    <IconButton
                        aria-label={t.pages.tournamentLivePage.exitAria}
                        title={t.pages.tournamentLivePage.exitAria}
                        onClick={goExit}
                        size="sm"
                        rounded="full"
                        bg="whiteAlpha.200"
                        color="white"
                        _hover={{ bg: "whiteAlpha.300" }}
                        css={{ backdropFilter: "blur(6px)" }}
                    >
                        <FiX size={15} />
                    </IconButton>
                </HStack>
            )}

            {streamOn ? (
                <Flex
                    h="100dvh"
                    w="100vw"
                    px={{ base: "2", md: "4" }}
                    // Small at the top (was stacking with the Grid's own pt
                    // below into a visibly bigger gap than the bottom got) -
                    // a bit more at the bottom, now that the capped-height
                    // player above leaves the panel real room instead of
                    // pushing everything past 100dvh.
                    pt={{ base: "2", md: "3" }}
                    pb={{ base: "4", md: "6" }}
                    gap={{ base: "2", md: "3" }}
                    direction="column"
                >
                    {/* Top row: tournament name (big) TRULY centred - a 3-column
                        grid with equal 1fr side tracks, so the name centres on
                        the full width regardless of the button group's own
                        width, with Podijeli/Izađi anchored to the end of the
                        same row on md+ (no room for them there on mobile -
                        those float top-right instead, see above). */}
                    <Grid
                        templateColumns={{ base: "1fr", md: "1fr auto 1fr" }}
                        alignItems="center"
                        gap="2"
                        flexShrink={0}
                    >
                        <Box display={{ base: "none", md: "block" }} />
                        {/* justifySelf+mx="auto": on mobile the grid has one
                            "1fr" track, and a maxW-capped block box doesn't
                            self-centre in a wider track just from textAlign
                            (that only centres the text INSIDE the box) - it
                            needs its own centring too, or it hugs the left
                            edge under the floating share/exit icons. */}
                        <Text
                            color="white"
                            fontWeight={800}
                            fontSize={{ base: "lg", md: "2xl" }}
                            textAlign="center"
                            truncate
                            maxW={{ base: "60vw", md: "40vw" }}
                            justifySelf="center"
                            mx="auto"
                        >
                            {name ?? t.pages.tournamentLivePage.tournamentFallback}
                        </Text>
                        <HStack display={{ base: "none", md: "flex" }} justifySelf="end" gap="2">
                            <ControlButton onClick={share} label={t.pages.tournamentLivePage.shareAria}>
                                <FiShare2 size={15} /> {t.common.share}
                            </ControlButton>
                            <ControlButton onClick={goExit} label={t.pages.tournamentLivePage.exitAria}>
                                <FiX size={16} /> {t.pages.tournamentLivePage.exitButton}
                            </ControlButton>
                        </HStack>
                    </Grid>

                    {/* Match stepper, centred, right under the name - md+
                        only. On mobile there's no room for it (and it was
                        asked to go), so the header is just the name there. */}
                    <Flex display={{ base: "none", md: "flex" }} justify="center" flexShrink={0}>
                        <MatchStepper uuid={uuid} t={t} />
                    </Flex>

                    {/* The stream. On md+ it fills all remaining height
                        (flex:1) - no side/bottom panel, just the player,
                        StreamPlayer letterboxing via object-fit as needed.
                        On mobile there's no room for that AND the
                        tijek/sastavi/tablica panel below, so the player is
                        capped to its native 16:9 instead and the panel takes
                        the rest of the space. */}
                    <Box
                        w="full"
                        aspectRatio={{ base: 16 / 9, md: undefined }}
                        flex={{ base: "0 0 auto", md: "1" }}
                        minH={{ base: undefined, md: "0" }}
                    >
                        <StreamPlayer
                            url={banner!.url!}
                            overlay={scoreBug}
                            centerOverlay={buildStreamOverlay(banner?.overlayUrl, banner?.overlayMediaType)}
                            viewers={viewers}
                            tournamentUuid={uuid}
                        />
                    </Box>

                    {/* Mobile only: tijek utakmice / sastavi / tablica panel
                        below the video (md+ deliberately omits it - the
                        full-height player is the whole point there). */}
                    <Box w="full" flex="1" minH="0" display={{ base: "block", md: "none" }}>
                        <StreamSidePanel match={match} uuid={uuid} nextMatch={nextMatch} />
                    </Box>
                </Flex>
            ) : (
                <NoStream name={name} notFound={notFound} slug={slug ?? param ?? ""} onExit={goExit} t={t} />
            )}
        </Box>
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

/** One team name, falling back to a knockout feeder label ("Pobjednik ČF1")
 *  when the slot isn't decided yet - mirrors how the bracket renders it. */
function stepperTeamName(name: string | null, predicted: string | null, slotLabel: string | null): string {
    return name ?? predicted ?? slotLabel ?? "?"
}

/**
 * Small "‹ Match name · time ›" bar above the live-camera player - lets a
 * viewer browse the tournament's full schedule (past results + upcoming
 * kickoffs, in order) without leaving the stream page. Purely a schedule
 * browser: the camera below is one continuous feed, so stepping through
 * matches here does not change what's playing - it answers "what's on this
 * stream, and what's coming up next" independently of it.
 */
function MatchStepper({ uuid, t }: { uuid: string | null; t: Dictionary }) {
    const [matches, setMatches] = useState<ScheduledMatch[]>([])
    const [index, setIndex] = useState<number | null>(null)
    // Auto-pick the on-deck match (LIVE, else the earliest upcoming
    // SCHEDULED one) exactly once, the first time the schedule loads - after
    // that the viewer's own left/right browsing is never overridden by a poll.
    const autoPickedRef = useRef(false)

    usePolling(() => {
        if (!uuid) return
        fetchSchedule(uuid)
            .then((s) => {
                const sorted = [...s.matches].sort((a, b) => {
                    const ka = a.kickoffAt ? new Date(a.kickoffAt).getTime() : Number.POSITIVE_INFINITY
                    const kb = b.kickoffAt ? new Date(b.kickoffAt).getTime() : Number.POSITIVE_INFINITY
                    return ka - kb
                })
                setMatches(sorted)
                if (!autoPickedRef.current && sorted.length > 0) {
                    autoPickedRef.current = true
                    // Default to the first UPCOMING match, not whatever's
                    // live right now - "sljedeća utakmica", not "trenutna".
                    const next = sorted.findIndex((m) => m.status === "SCHEDULED")
                    setIndex(next >= 0 ? next : sorted.length - 1)
                }
            })
            .catch(() => { /* silent - the bar just stays hidden/stale */ })
    }, 20_000, !!uuid)

    if (matches.length === 0 || index == null) return null
    const m = matches[index]
    const label =
        m.status === "LIVE"
            ? t.pages.tournamentLivePage.stepperLiveLabel
            : m.status === "FINISHED"
                ? `${m.score1 ?? 0} : ${m.score2 ?? 0}`
                : formatKickoff(m.kickoffAt)

    return (
        <Flex align="center" justify="center" gap="2.5">
            <IconButton
                aria-label={t.pages.tournamentLivePage.prevMatchAria}
                size="md"
                rounded="full"
                bg="whiteAlpha.200"
                color="white"
                _hover={{ bg: "whiteAlpha.300" }}
                css={{ backdropFilter: "blur(6px)" }}
                disabled={index <= 0}
                onClick={() => setIndex((i) => Math.max(0, (i ?? 0) - 1))}
            >
                <FiChevronLeft />
            </IconButton>
            {/* Bigger box, and the team-name line WRAPS instead of truncating
                (no more `truncate`) - a long team name pair stays fully
                readable instead of ending in an ellipsis. rounded="2xl"
                (not "full") so a wrapped 2-line name still looks like a
                clean box rather than a stretched-out stadium pill. */}
            <VStack
                gap="0.5"
                minW={{ base: "220px", md: "300px" }}
                maxW={{ base: "80vw", md: "480px" }}
                px="5"
                py="2.5"
                rounded="2xl"
                bg="whiteAlpha.200"
                css={{ backdropFilter: "blur(6px)" }}
                color="white"
            >
                {/* Each team on its own line - a single "Team1 – Team2" line
                    read badly with long names (the dash could land anywhere,
                    mid-wrap). Stacked with a small "VS" between, who's
                    playing whom stays unambiguous at any name length. */}
                <Text fontSize={{ base: "sm", md: "md" }} fontWeight={800} textAlign="center" lineHeight="1.25">
                    {stepperTeamName(m.team1Name, m.slot1PredictedName, m.slot1Label)}
                </Text>
                <Text fontSize="2xs" fontWeight={700} color="whiteAlpha.600" letterSpacing="0.08em" my="0.5">
                    {t.pages.tournamentLivePage.stepperVsLabel}
                </Text>
                <Text fontSize={{ base: "sm", md: "md" }} fontWeight={800} textAlign="center" lineHeight="1.25">
                    {stepperTeamName(m.team2Name, m.slot2PredictedName, m.slot2Label)}
                </Text>
                <Text
                    fontSize="xs"
                    fontFamily="mono"
                    fontWeight={700}
                    letterSpacing="0.06em"
                    color={m.status === "LIVE" ? "#ff6b6b" : "whiteAlpha.700"}
                >
                    {label}
                </Text>
            </VStack>
            <IconButton
                aria-label={t.pages.tournamentLivePage.nextMatchAria}
                size="md"
                rounded="full"
                bg="whiteAlpha.200"
                color="white"
                _hover={{ bg: "whiteAlpha.300" }}
                css={{ backdropFilter: "blur(6px)" }}
                disabled={index >= matches.length - 1}
                onClick={() => setIndex((i) => Math.min(matches.length - 1, (i ?? 0) + 1))}
            >
                <FiChevronRight />
            </IconButton>
        </Flex>
    )
}

/** Frosted pill button used for the top-right share / exit controls. */
function ControlButton({
    onClick,
    label,
    children,
}: {
    onClick: () => void
    label: string
    children: React.ReactNode
}) {
    return (
        <chakra.button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={label}
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
            gap="1.5"
            px="3"
            h="9"
            rounded="full"
            bg="whiteAlpha.200"
            color="white"
            fontSize="sm"
            fontWeight={700}
            cursor="pointer"
            _hover={{ bg: "whiteAlpha.300" }}
            css={{ backdropFilter: "blur(6px)" }}
        >
            {children}
        </chakra.button>
    )
}

/** Shown when the camera is off for this tournament (or the link is stale). The
 *  page stays valid so the same URL works once the stream starts. */
function NoStream({
    name,
    notFound,
    slug,
    onExit,
    t,
}: {
    name: string | null
    notFound: boolean
    slug: string
    onExit: () => void
    t: Dictionary
}) {
    const navigate = useNavigate()
    return (
        <Flex h="100dvh" w="100vw" align="center" justify="center" px="6">
            <VStack gap="4" textAlign="center" maxW="sm" color="white">
                <Box color="whiteAlpha.700"><FiVideoOff size={40} /></Box>
                <Text fontSize="lg" fontWeight={800}>
                    {notFound ? t.pages.tournamentLivePage.noStreamNotFoundTitle : t.pages.tournamentLivePage.noStreamOfflineTitle}
                </Text>
                <Text fontSize="sm" color="whiteAlpha.700">
                    {notFound
                        ? t.pages.tournamentLivePage.noStreamNotFoundDesc
                        : t.pages.tournamentLivePage.noStreamOfflineDesc(name)}
                </Text>
                <HStack gap="2">
                    {!notFound && slug && (
                        <Button size="sm" colorPalette="pitch" onClick={() => navigate(`/turniri/${slug}`)}>
                            {t.pages.tournamentLivePage.openTournamentButton}
                        </Button>
                    )}
                    <Button size="sm" variant="ghost" color="white" _hover={{ bg: "whiteAlpha.200" }} onClick={onExit}>
                        {t.common.back}
                    </Button>
                </HStack>
            </VStack>
        </Flex>
    )
}
