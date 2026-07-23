import { useEffect, useMemo, useState } from "react"
import { Box, Button, Flex, HStack, Text, VStack, chakra } from "@chakra-ui/react"
import { useLocation, useNavigate, useParams } from "react-router-dom"
import { FiShare2, FiVideoOff, FiX } from "react-icons/fi"
import { useQueryClient } from "@tanstack/react-query"

import StreamPlayer from "../components/StreamPlayer"
import { StreamSidePanel, buildScoreBug, buildStreamOverlay, useNextMatch } from "../components/StreamHero"
import { useTeamColors } from "../components/jersey"
import { fetchStreamBanner, readStreamBannerHint, type StreamBanner } from "../api/streamBanner"
import { fetchLiveMatches, type LiveMatch } from "../api/live"
import { fetchTournamentDetails } from "../api/tournaments"
import { useStreamPresence } from "../hooks/useStreamPresence"
import { usePolling } from "../hooks/usePolling"
import { useDocumentHead } from "../hooks/useDocumentHead"
import { showSuccess } from "../toaster"
import { qk } from "../queryClient"

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
    const scoreBug = buildScoreBug(match, colors, nextMatch)

    const shareUrl = `${ORIGIN}/turniri/${slug ?? param ?? ""}/uzivo`

    useDocumentHead({
        title: name ? `Uživo prijenos — ${name} | futsal-turniri.com` : "Uživo prijenos turnira | futsal-turniri.com",
        description: name
            ? `Gledaj uživo prijenos turnira ${name} putem kamere - rezultati, tijek utakmice i tablica u stvarnom vremenu.`
            : "Gledaj uživo prijenos turnira putem kamere - rezultati, tijek utakmice i tablica u stvarnom vremenu.",
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
        const title = name ? `Uživo prijenos — ${name}` : "Uživo prijenos turnira"
        const text = name
            ? `Uživo prijenos turnira ${name} putem kamere.`
            : "Uživo prijenos turnira putem kamere."
        if (navigator.share) {
            try { await navigator.share({ title, text, url: shareUrl }) } catch { /* dismissed */ }
            return
        }
        try {
            await navigator.clipboard.writeText(shareUrl)
            showSuccess("Poveznica kopirana.")
        } catch { /* clipboard blocked - nothing more we can do */ }
    }

    return (
        <Box position="fixed" inset="0" zIndex={2000} bg="#0a0c0f">
            {/* Top-right controls: share + exit. */}
            <Flex position="absolute" top={{ base: "2", md: "3" }} right={{ base: "2", md: "3" }} zIndex={2} gap="2">
                <ControlButton onClick={share} label="Podijeli poveznicu">
                    <FiShare2 size={15} /> Podijeli
                </ControlButton>
                <ControlButton onClick={goExit} label="Izađi iz prijenosa">
                    <FiX size={16} /> Izađi
                </ControlButton>
            </Flex>

            {streamOn ? (
                <Flex
                    h="100dvh"
                    w="100vw"
                    p={{ base: "2", md: "4" }}
                    gap={{ base: "2", md: "3" }}
                    direction={{ base: "column", lg: "row" }}
                >
                    {/* Left ~80%: the stream, letterboxed to 16:9. */}
                    <Flex
                        flex={{ base: "0 0 auto", lg: "0 0 79%" }}
                        minW="0"
                        align="center"
                        justify="center"
                        minH={{ base: "34vh", lg: "0" }}
                    >
                        <Box w="full" h={{ base: "auto", lg: "full" }}>
                            <StreamPlayer
                                url={banner!.url!}
                                overlay={scoreBug}
                                centerOverlay={buildStreamOverlay(banner?.overlayUrl, banner?.overlayMediaType)}
                                viewers={viewers}
                                tournamentUuid={uuid}
                            />
                        </Box>
                    </Flex>

                    {/* Right: the combined Utakmica | Tablica panel (same as home).
                        pt on lg reserves room for the top-right buttons. */}
                    <Flex flex="1" minW="0" minH="0" direction="column" pt={{ base: 0, lg: "12" }}>
                        <Box flex="1" minH="0">
                            <StreamSidePanel match={match} uuid={uuid} nextMatch={nextMatch} tournamentName={name} />
                        </Box>
                    </Flex>
                </Flex>
            ) : (
                <NoStream name={name} notFound={notFound} slug={slug ?? param ?? ""} onExit={goExit} />
            )}
        </Box>
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
}: {
    name: string | null
    notFound: boolean
    slug: string
    onExit: () => void
}) {
    const navigate = useNavigate()
    return (
        <Flex h="100dvh" w="100vw" align="center" justify="center" px="6">
            <VStack gap="4" textAlign="center" maxW="sm" color="white">
                <Box color="whiteAlpha.700"><FiVideoOff size={40} /></Box>
                <Text fontSize="lg" fontWeight={800}>
                    {notFound ? "Turnir nije pronađen" : "Trenutno nema prijenosa uživo"}
                </Text>
                <Text fontSize="sm" color="whiteAlpha.700">
                    {notFound
                        ? "Poveznica možda nije točna ili je turnir uklonjen."
                        : `${name ? `${name} – p` : "P"}rijenos uživo trenutno nije aktivan. Provjeri kasnije ili otvori stranicu turnira.`}
                </Text>
                <HStack gap="2">
                    {!notFound && slug && (
                        <Button size="sm" colorPalette="pitch" onClick={() => navigate(`/turniri/${slug}`)}>
                            Otvori turnir
                        </Button>
                    )}
                    <Button size="sm" variant="ghost" color="white" _hover={{ bg: "whiteAlpha.200" }} onClick={onExit}>
                        Natrag
                    </Button>
                </HStack>
            </VStack>
        </Flex>
    )
}
