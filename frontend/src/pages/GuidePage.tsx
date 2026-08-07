import { Box, Flex, Grid, Heading, HStack, Icon, Text, VStack, chakra } from "@chakra-ui/react"
import { useNavigate } from "react-router-dom"
import { createContext, useContext, useEffect, useState } from "react"
import type { ElementType, ReactNode } from "react"
import {
    LuTrophy,
    LuShuffle,
    LuTimer,
    LuRadioTower,
    LuChartColumn,
    LuMonitorPlay,
    LuSparkles,
    LuUsers,
    LuCalendarClock,
    LuCalendarCheck,
    LuTable,
    LuListOrdered,
} from "react-icons/lu"
import { FiArrowRight } from "react-icons/fi"
import { useDocumentHead } from "../hooks/useDocumentHead"
import { PitchBackdrop, PrimaryButton, GhostButton } from "../ui/pitch"
import { useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   Vodič / "Što nudimo" - marketing-style tour of the app, reached from the
   floating "?" button and from the nav menus.

   Structure: a SLIM hero (copy + two CTAs only) → three numbered chapters
   that follow the organizer's journey (kreiranje → zapisnik → rezultati) →
   final CTA. Each chapter is an interactive FeatureShowcase: a clickable,
   auto-advancing left-hand list of 2-3 features, with the matching
   screenshot on the right. No chapter carries a separate subtitle paragraph
   any more - the showcase's own per-feature copy already explains it, so a
   paragraph above it was just the same sentence read twice. There's no
   "Brzi pregled" strip either, for the same reason.

   Purely presentational; no data fetching.
   ────────────────────────────────────────────────────────────────────── */

type Feature = { icon: ElementType; title: string; desc: string }

/* ── Hover zoom ─────────────────────────────────────────────────────────
   Hovering any guide screenshot shows a large centered preview; moving the
   mouse away hides it. The overlay is pointer-events:none so it can never
   steal the hover from the thumbnail (no flicker), and it stays mounted so
   opacity/scale transitions run smoothly both ways. Hover-only devices -
   touch screens never trigger it. */
type ZoomData = { src: string; alt: string }
const ZoomCtx = createContext<{ show: (d: ZoomData) => void; hide: () => void } | null>(null)

/** Hover handlers for a zoomable image - spread onto the <img>'s wrapper. */
function useZoomHandlers(d: ZoomData) {
    const zoom = useContext(ZoomCtx)
    return {
        onMouseEnter: () => {
            // Only real hover devices (mouse/trackpad) - a tap on touch
            // screens must not open an un-dismissable overlay.
            if (typeof window !== "undefined" && !window.matchMedia("(hover: hover)").matches) return
            zoom?.show(d)
        },
        onMouseLeave: () => zoom?.hide(),
    }
}

/**
 * Real app screenshot, just the image in a bordered rounded frame - no faux
 * browser chrome, no caption bar. The shots live in /public/vodic and show
 * the actual product with real match data - captured at 2x for retina
 * crispness. Explicit width/height (the intrinsic px of the webp) prevents
 * layout shift; everything below the fold is lazy-loaded.
 */
function Shot({
    src,
    alt,
    width,
    height,
    maxW,
    cropAspect,
}: {
    src: string
    alt: string
    width: number
    height: number
    /** Cap the frame width so screenshots stay compact on large screens. */
    maxW?: string
    /** Pin the frame to this aspect ratio - same physical box for every
     *  showcase slide no matter how tall/wide/square the source webp is.
     *  Uses `object-fit: contain` (letterboxed, never cropped): the source
     *  webps range from near-square (0.97) to very wide (2.7), and `cover`
     *  at one shared ratio was slicing content off the sides of the wide
     *  ones. The hover zoom still shows the full source image regardless. */
    cropAspect?: number
}) {
    const zoomHandlers = useZoomHandlers({ src, alt })
    return (
        <Box
            rounded="xl"
            overflow="hidden"
            borderWidth="1px"
            borderColor="border"
            bg="bg.panel"
            boxShadow="0 12px 32px -18px rgba(11, 21, 34, 0.35)"
            maxW={maxW}
            mx={maxW ? "auto" : undefined}
            w="full"
            {...zoomHandlers}
            cursor="zoom-in"
            aspectRatio={cropAspect}
        >
            <chakra.img
                src={src}
                alt={alt}
                width={width}
                height={height}
                loading="lazy"
                decoding="async"
                display="block"
                w="full"
                h={cropAspect ? "full" : "auto"}
                objectFit={cropAspect ? "contain" : undefined}
                objectPosition={cropAspect ? "center" : undefined}
            />
        </Box>
    )
}

/** Image behind one showcase feature - dimensions are the intrinsic px of the
 *  webp, same role as Shot's own width/height (layout-shift prevention). */
type ShowcaseImage = { src: string; width: number; height: number }
type ShowcaseFeature = Feature & { shotAlt: string; image: ShowcaseImage }

/** How long each slide stays up before auto-advancing. */
const SHOWCASE_ROTATE_MS = 3000

/** Every showcase screenshot is display-cropped to this SAME ratio (top-
 *  anchored, hover zoom still reveals the full source image) - the source
 *  webps range from near-square to very wide, and without a shared ratio the
 *  right-hand box changed size on every auto-advance. */
const SHOWCASE_IMAGE_ASPECT = 1.5

/** Thin progress line under the active card, filling over one rotation - the
 *  visible "this is about to change" cue. Keyed by the parent on the active
 *  index, so a fresh mount is exactly what restarts the fill: it starts at 0%
 *  and one rAF later flips to 100%, letting the CSS transition actually
 *  animate instead of snapping straight to full. */
function ShowcaseProgress({ paused }: { paused: boolean }) {
    const [go, setGo] = useState(false)
    useEffect(() => {
        const raf = requestAnimationFrame(() => setGo(true))
        return () => cancelAnimationFrame(raf)
    }, [])
    return (
        <Box h="2px" bg="bg.surfaceTint" rounded="full" overflow="hidden" ml="50px" mt="1">
            <Box
                h="full"
                bg="pitch.500"
                rounded="full"
                w={go ? "100%" : "0%"}
                // Setting `transition: none` mid-flight halts the running CSS
                // transition at its current width, which is what a hover-pause
                // needs to actually look paused rather than jumping ahead.
                transition={paused ? "none" : `width ${SHOWCASE_ROTATE_MS}ms linear`}
            />
        </Box>
    )
}

/**
 * Left: a clickable list of features, one always "active" (bordered, with a
 * filling progress line). Right: the screenshot for the active feature.
 * Auto-advances to the next feature every SHOWCASE_ROTATE_MS, pauses on
 * hover, and a click jumps straight to that feature and restarts the clock
 * from there - a single effect keyed on `active` covers both the auto-tick
 * and the "user clicked" case, since a click changes `active` the same way a
 * tick does.
 */
function FeatureShowcase({ features }: { features: ShowcaseFeature[] }) {
    const [active, setActive] = useState(0)
    const [paused, setPaused] = useState(false)

    useEffect(() => {
        if (paused) return
        const id = setTimeout(() => setActive((a) => (a + 1) % features.length), SHOWCASE_ROTATE_MS)
        return () => clearTimeout(id)
    }, [active, paused, features.length])

    const current = features[active]

    return (
        <Grid
            templateColumns={{ base: "1fr", lg: "1fr 1.35fr" }}
            gap="4"
            alignItems="stretch"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
        >
            <VStack align="stretch" gap="2">
                {features.map((f, i) => {
                    const isActive = i === active
                    return (
                        <chakra.button
                            key={f.title}
                            type="button"
                            aria-pressed={isActive}
                            onClick={() => setActive(i)}
                            textAlign="left"
                            display="block"
                            bg={isActive ? "bg.panel" : "transparent"}
                            borderWidth="1px"
                            borderColor={isActive ? "pitch.400" : "transparent"}
                            rounded="xl"
                            p="4"
                            cursor="pointer"
                            transition="border-color .15s, background .15s"
                            _hover={!isActive ? { bg: "bg.subtle" } : undefined}
                        >
                            <HStack gap="3" align="start">
                                <Flex
                                    w="38px"
                                    h="38px"
                                    rounded="lg"
                                    bg={isActive ? "pitch.500" : "bg.surfaceTint"}
                                    color={isActive ? "white" : "pitch.500"}
                                    align="center"
                                    justify="center"
                                    flexShrink={0}
                                    transition="background .15s, color .15s"
                                >
                                    <Icon as={f.icon} boxSize="4.5" />
                                </Flex>
                                <Box minW="0">
                                    <Text fontWeight={700} fontSize="14.5px" color="fg.ink" lineHeight="1.3">
                                        {f.title}
                                    </Text>
                                    <Text fontSize="13px" color="fg.muted" lineHeight="1.5" mt="0.5">
                                        {f.desc}
                                    </Text>
                                </Box>
                            </HStack>
                            {isActive && <ShowcaseProgress key={active} paused={paused} />}
                        </chakra.button>
                    )
                })}
            </VStack>
            <Shot
                src={current.image.src}
                alt={current.shotAlt}
                width={current.image.width}
                height={current.image.height}
                cropAspect={SHOWCASE_IMAGE_ASPECT}
            />
        </Grid>
    )
}

/** Numbered chapter: a filled square badge + title + a hairline rule running
 *  to the right edge, then the chapter body. No subtitle line any more - the
 *  showcase's own feature copy carries the explanation now, a paragraph above
 *  it just repeated the same thing at a slower reading pace. */
function Chapter({
    n,
    title,
    children,
}: {
    n: number
    title: string
    children: ReactNode
}) {
    return (
        <Box as="section">
            <HStack gap="3" align="center" mb="4">
                <Flex
                    w="30px"
                    h="30px"
                    rounded="lg"
                    bg="pitch.500"
                    color="white"
                    fontFamily="mono"
                    fontSize="14px"
                    fontWeight={800}
                    align="center"
                    justify="center"
                    flexShrink={0}
                >
                    {n}
                </Flex>
                <Heading
                    fontFamily="heading"
                    fontSize={{ base: "19px", md: "23px" }}
                    fontWeight={700}
                    letterSpacing="-0.02em"
                    color="fg.ink"
                >
                    {title}
                </Heading>
                <Box flex="1" h="1px" bg="border" minW="6" />
            </HStack>
            {children}
        </Box>
    )
}

/** Icon + image per showcase feature, zipped by index with the translated
 *  text in each chapter's `g.chapterX.features` array. Order matters. */
const CREATE_SHOWCASE_META: { icon: ElementType; image: ShowcaseImage }[] = [
    { icon: LuUsers, image: { src: "/vodic/ekipe-poredak.webp", width: 1828, height: 1466 } },
    { icon: LuShuffle, image: { src: "/vodic/zdrijeb.webp", width: 2024, height: 1528 } },
    { icon: LuCalendarClock, image: { src: "/vodic/raspored-pregled.webp", width: 1252, height: 1208 } },
    { icon: LuCalendarCheck, image: { src: "/vodic/raspored.webp", width: 2036, height: 1398 } },
]

const ZAPISNIK_SHOWCASE_META: { icon: ElementType; image: ShowcaseImage }[] = [
    { icon: LuTimer, image: { src: "/vodic/zapisnik-vodjenje.webp", width: 2912, height: 1804 } },
    { icon: LuListOrdered, image: { src: "/vodic/utakmica.webp", width: 1638, height: 1698 } },
    { icon: LuMonitorPlay, image: { src: "/vodic/uzivo.webp", width: 1600, height: 1000 } },
    { icon: LuRadioTower, image: { src: "/vodic/prijenos.webp", width: 1231, height: 449 } },
]

const RESULTS_SHOWCASE_META: { icon: ElementType; image: ShowcaseImage }[] = [
    { icon: LuTable, image: { src: "/vodic/grupe.webp", width: 1930, height: 1386 } },
    { icon: LuTrophy, image: { src: "/vodic/bracket.webp", width: 1246, height: 1022 } },
    { icon: LuChartColumn, image: { src: "/vodic/statistika.webp", width: 1858, height: 1244 } },
]

export default function GuidePage() {
    const navigate = useNavigate()
    const t = useTranslation()
    const g = t.pages.guidePage
    useDocumentHead({
        title: g.documentTitle,
        description: g.documentDescription,
    })

    const createFeatures: ShowcaseFeature[] = g.chapterCreate.features.map((f, i) => ({
        ...f,
        icon: CREATE_SHOWCASE_META[i].icon,
        image: CREATE_SHOWCASE_META[i].image,
    }))
    const zapisnikFeatures: ShowcaseFeature[] = g.chapterZapisnik.features.map((f, i) => ({
        ...f,
        icon: ZAPISNIK_SHOWCASE_META[i].icon,
        image: ZAPISNIK_SHOWCASE_META[i].image,
    }))
    const resultsFeatures: ShowcaseFeature[] = g.chapterResults.features.map((f, i) => ({
        ...f,
        icon: RESULTS_SHOWCASE_META[i].icon,
        image: RESULTS_SHOWCASE_META[i].image,
    }))

    // Hover-zoom overlay state. `zoom` keeps the last image so the fade-out
    // animates on the same picture; `zoomOpen` drives opacity/scale.
    const [zoom, setZoom] = useState<ZoomData | null>(null)
    const [zoomOpen, setZoomOpen] = useState(false)
    const zoomApi = {
        show: (d: ZoomData) => { setZoom(d); setZoomOpen(true) },
        hide: () => setZoomOpen(false),
    }

    return (
        <ZoomCtx.Provider value={zoomApi}>
        <VStack align="stretch" gap={{ base: 9, md: 12 }} pb="4">
            {/* Enlarged hover preview - pointer-events:none so it can never
                steal the hover from the thumbnail below it (no flicker). */}
            <Box
                position="fixed"
                inset="0"
                zIndex={1400}
                pointerEvents="none"
                display="flex"
                alignItems="center"
                justifyContent="center"
                p={{ base: "4", md: "10" }}
                bg="rgba(11, 21, 34, 0.45)"
                opacity={zoomOpen ? 1 : 0}
                transition="opacity 180ms ease"
            >
                {zoom && (
                    <chakra.img
                        src={zoom.src}
                        alt={zoom.alt}
                        maxW="min(1120px, 94vw)"
                        maxH="88vh"
                        w="auto"
                        h="auto"
                        rounded="xl"
                        boxShadow="0 24px 80px rgba(0,0,0,0.45)"
                        bg="white"
                        transform={zoomOpen ? "scale(1)" : "scale(0.94)"}
                        transition="transform 200ms cubic-bezier(0.2, 0.8, 0.3, 1)"
                    />
                )}
            </Box>

            {/* ── Hero - slim, single column, centred ──────────────────────
                 Copy + CTAs only. The quick-overview cards moved out to the
                 strip below so this block stays roughly half its old height. */}
            <Box
                position="relative"
                rounded="2xl"
                overflow="hidden"
                color="white"
                bgImage="linear-gradient(135deg, #132A3E, #0B1522)"
            >
                <PitchBackdrop opacity={0.15} variant="guide-hero" tone="pitch" />
                <VStack
                    position="relative"
                    align="center"
                    textAlign="center"
                    gap="0"
                    px={{ base: 5, md: 10 }}
                    py={{ base: 7, md: 9 }}
                >
                    <HStack
                        gap="1.5"
                        bg="rgba(255,255,255,0.12)"
                        borderWidth="1px"
                        borderColor="rgba(255,255,255,0.2)"
                        rounded="full"
                        px="3"
                        py="1"
                        w="fit-content"
                    >
                        <Icon as={LuSparkles} boxSize="3.5" />
                        <Text fontSize="12px" fontWeight={700} letterSpacing="0.04em">
                            {g.heroKicker}
                        </Text>
                    </HStack>
                    <Heading
                        fontFamily="heading"
                        fontSize={{ base: "26px", md: "36px" }}
                        fontWeight={800}
                        letterSpacing="-0.02em"
                        lineHeight="1.12"
                        mt="3.5"
                        mb="3"
                    >
                        <Box as="span" color="#ffd54a">
                            {g.heroHeadingHighlight}
                        </Box>{" "}
                        {g.heroHeadingRest}
                    </Heading>
                    <Text
                        fontSize={{ base: "14.5px", md: "16px" }}
                        color="rgba(255,255,255,0.85)"
                        maxW="620px"
                        lineHeight="1.6"
                    >
                        {g.heroSubtitle}
                    </Text>
                    <HStack gap="3" mt="6" wrap="wrap" justify="center">
                        <PrimaryButton icon={<LuTrophy size={16} />} onClick={() => navigate("/turniri/novi")}>
                            {g.ctaCreateTournament}
                        </PrimaryButton>
                        <GhostButton
                            icon={<LuRadioTower size={15} />}
                            onClick={() => navigate("/uzivo")}
                            css={{
                                color: "#fff",
                                borderColor: "rgba(255,255,255,0.35)",
                                background: "rgba(255,255,255,0.08)",
                            }}
                        >
                            {g.ctaWatchLive}
                        </GhostButton>
                    </HStack>
                </VStack>
            </Box>

            {/* ── 1. Kreiranje turnira - ekipe → ždrijeb → skica → raspored ── */}
            <Chapter n={1} title={g.chapterCreate.title}>
                <FeatureShowcase features={createFeatures} />
            </Chapter>

            {/* ── 2. Zapisnik + semafor ────────────────────────────────── */}
            <Chapter n={2} title={g.chapterZapisnik.title}>
                <FeatureShowcase features={zapisnikFeatures} />
            </Chapter>

            {/* ── 3. Rezultati, tablice i statistika ───────────────────── */}
            <Chapter n={3} title={g.chapterResults.title}>
                <FeatureShowcase features={resultsFeatures} />
            </Chapter>

            {/* ── Final CTA ────────────────────────────────────────────── */}
            <Box
                bg="bg.panel"
                borderWidth="1px"
                borderColor="border"
                rounded="2xl"
                px={{ base: 5, md: 10 }}
                py={{ base: 8, md: 10 }}
                textAlign="center"
            >
                <Heading
                    fontFamily="heading"
                    fontSize={{ base: "22px", md: "28px" }}
                    fontWeight={800}
                    letterSpacing="-0.02em"
                    color="fg.ink"
                >
                    {g.finalCtaHeading}
                </Heading>
                <Text fontSize="15px" color="fg.muted" maxW="480px" mx="auto" mt="2">
                    {g.finalCtaSubtitle}
                </Text>
                <HStack gap="3" wrap="wrap" justify="center" mt="6">
                    <PrimaryButton icon={<LuTrophy size={16} />} onClick={() => navigate("/turniri/novi")}>
                        {g.ctaCreateTournament}
                    </PrimaryButton>
                    <GhostButton icon={<FiArrowRight size={15} />} onClick={() => navigate("/turniri")}>
                        {g.ctaBrowseTournaments}
                    </GhostButton>
                </HStack>
            </Box>
        </VStack>
        </ZoomCtx.Provider>
    )
}
