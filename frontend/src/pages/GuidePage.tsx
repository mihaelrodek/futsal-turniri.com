import { Box, Flex, Grid, Heading, HStack, Icon, Text, VStack, chakra } from "@chakra-ui/react"
import { useNavigate } from "react-router-dom"
import { createContext, useContext, useState } from "react"
import type { ElementType, ReactNode } from "react"
import {
    LuTrophy,
    LuShuffle,
    LuTimer,
    LuRadioTower,
    LuBellRing,
    LuChartColumn,
    LuMonitorPlay,
    LuSparkles,
    LuMap,
    LuCirclePlus,
    LuUserRound,
    LuMoon,
} from "react-icons/lu"
import { FiArrowDown, FiArrowRight } from "react-icons/fi"
import { useDocumentHead } from "../hooks/useDocumentHead"
import { MonoLabel, PitchBackdrop, PrimaryButton, GhostButton } from "../ui/pitch"
import { Logo } from "../components/Logo"

/* ──────────────────────────────────────────────────────────────────────────
   Vodič / "Što nudimo" - marketing-style tour of the app, reached from the
   floating "?" button. Structure: hero (+ quick-overview panel) → five
   numbered chapters that follow the organizer's journey → final CTA.
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
 * Real app screenshot in a browser-window frame (title bar with traffic-dot
 * trio + a caption bar below). The shots live in /public/vodic and show the
 * actual product with real match data - captured at 2x for retina crispness.
 * Explicit width/height (the intrinsic px of the webp) prevents layout shift;
 * everything below the fold is lazy-loaded.
 */
function Shot({
    src,
    alt,
    width,
    height,
    caption,
    maxW,
    cropAspect,
}: {
    src: string
    alt: string
    width: number
    height: number
    caption: string
    /** Cap the frame width so screenshots stay compact on large screens. */
    maxW?: string
    /** Display-crop the image to this aspect ratio (top-anchored). The hover
     *  zoom still shows the FULL image - handy for tall shots like brackets. */
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
        >
            {/* Faux browser title bar */}
            <HStack gap="1.5" px="3.5" py="2.5" bg="bg.surfaceTint" borderBottomWidth="1px" borderColor="border">
                <Box w="9px" h="9px" rounded="full" bg="#f87171" />
                <Box w="9px" h="9px" rounded="full" bg="#fbbf24" />
                <Box w="9px" h="9px" rounded="full" bg="#34d399" />
                <Text fontFamily="mono" fontSize="10.5px" color="fg.soft" ml="2" letterSpacing="0.04em">
                    futsal-turniri.com
                </Text>
            </HStack>
            <Box
                {...zoomHandlers}
                cursor="zoom-in"
                aspectRatio={cropAspect}
                overflow={cropAspect ? "hidden" : undefined}
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
                    objectFit={cropAspect ? "cover" : undefined}
                    objectPosition={cropAspect ? "center top" : undefined}
                />
            </Box>
            <Text
                px="4"
                py="2.5"
                fontSize="12.5px"
                color="fg.muted"
                borderTopWidth="1px"
                borderColor="border"
                bg="bg.surfaceTint"
            >
                {caption}
            </Text>
        </Box>
    )
}

/** Bare screenshot in a light frame (no browser bar / caption) - for the
 *  compact process-flow steps where a full Shot frame would be too heavy. */
function MiniShot({
    src,
    alt,
    width,
    height,
    cropAspect,
}: {
    src: string
    alt: string
    width: number
    height: number
    /** Display-crop to this aspect (top-anchored); hover zoom shows it all. */
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
            boxShadow="sm"
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
                objectFit={cropAspect ? "cover" : undefined}
                objectPosition={cropAspect ? "center top" : undefined}
            />
        </Box>
    )
}

/** Numbered green dot badge shared by the nav legend + flow steps. */
function NumBadge({ n, size = "18px", fontSize = "10px" }: { n: number | string; size?: string; fontSize?: string }) {
    return (
        <Flex
            w={size}
            h={size}
            rounded="full"
            bg="pitch.500"
            color="white"
            fontFamily="mono"
            fontSize={fontSize}
            fontWeight={800}
            align="center"
            justify="center"
            flexShrink={0}
        >
            {n}
        </Flex>
    )
}

/* Main-menu items for the interactive menu demo. `live` flags the "Uživo"
   item (red dot); `right` flags items that live in the navbar's right cluster
   (Prijava) rather than the centre capsule. */
type NavItem = { label: string; icon: ElementType; desc: string; live?: boolean; right?: boolean }
const NAV_ITEMS: NavItem[] = [
    { label: "Turniri", icon: LuTrophy, desc: "Popis svih turnira. Pretražuj i filtriraj po lokaciji, kotizaciji i ukupnoj nagradi, pa otvori bilo koji turnir." },
    { label: "Uživo", icon: LuRadioTower, live: true, desc: "Utakmice koje se upravo igraju - rezultati, mjerač i strijelci osvježavaju se u stvarnom vremenu." },
    { label: "Kreiraj turnir", icon: LuCirclePlus, desc: "Pokreni novi turnir u par minuta - uneseš osnovne podatke i format. Potpuno besplatno." },
    { label: "Karta", icon: LuMap, desc: "Svi turniri prikazani na karti - pronađi one najbliže sebi jednim pogledom." },
    { label: "Statistika", icon: LuChartColumn, desc: "Vječna lista strijelaca kroz sve turnire - tko je zabio najviše golova." },
    { label: "Prijava", icon: LuUserRound, right: true, desc: "Google prijava - potrebna je samo organizatorima. Gledatelji sve prate bez prijave." },
]

/** One clickable pill in the demo navbar. Mirrors the real PillNavLink look:
 *  filled pitch-green when selected, ghost otherwise. */
function DemoPill({
    item,
    index,
    active,
    onSelect,
}: {
    item: NavItem
    index: number
    active: number
    onSelect: (i: number) => void
}) {
    const isActive = active === index
    return (
        <chakra.button
            type="button"
            aria-pressed={isActive}
            onClick={() => onSelect(index)}
            display="inline-flex"
            alignItems="center"
            gap="1.5"
            px={{ base: "3", md: "4" }}
            py="2"
            rounded="full"
            fontSize="13px"
            fontWeight={600}
            whiteSpace="nowrap"
            border="none"
            cursor="pointer"
            color={isActive ? "white" : "fg.ink"}
            bg={isActive ? "pitch.500" : "transparent"}
            _hover={!isActive ? { bg: "bg.panel" } : undefined}
            transition="background 150ms, box-shadow 150ms"
            boxShadow={isActive ? "0 6px 16px -8px var(--chakra-colors-pitch-500)" : undefined}
        >
            {item.live && (
                <Box w="7px" h="7px" rounded="full" bg={isActive ? "white" : "#e5484d"} flexShrink={0} />
            )}
            {item.label}
            {item.live && (
                <Box as="span" fontFamily="mono" fontSize="10px" opacity={0.85}>1</Box>
            )}
        </chakra.button>
    )
}

/** Interactive menu demo - a live facsimile of the app navbar. Click any item
 *  (or use Prethodno / Sljedeće) to highlight it, just like navigating in the
 *  app, and see what it does in the panel below. Real DOM, so it's crisp and
 *  follows the theme; nothing here navigates. */
function InteractiveNav() {
    const [active, setActive] = useState(0)
    const item = NAV_ITEMS[active]
    const step = (dir: number) =>
        setActive((a) => (a + dir + NAV_ITEMS.length) % NAV_ITEMS.length)
    const centre = NAV_ITEMS.map((it, i) => ({ it, i })).filter(({ it }) => !it.right)
    const right = NAV_ITEMS.map((it, i) => ({ it, i })).filter(({ it }) => it.right)

    return (
        <Box>
            {/* Card entrance animation for the explanation panel. */}
            <style>{"@keyframes guidePop{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}"}</style>

            {/* ── Faux navbar ─────────────────────────────────────────── */}
            <Flex
                align="center"
                justify={{ base: "center", md: "space-between" }}
                gap="3"
                wrap="wrap"
                bg="bg.panel"
                borderWidth="1px"
                borderColor="border"
                rounded="2xl"
                px={{ base: "3", md: "4" }}
                py="3"
                boxShadow="sm"
            >
                <Box display={{ base: "none", sm: "block" }}>
                    <Logo asStatic size={32} />
                </Box>

                {/* Centre capsule - the five primary pills. */}
                <HStack
                    gap="0.5"
                    bg="bg.surfaceTint"
                    padding="1"
                    rounded="full"
                    maxW="full"
                    overflowX="auto"
                    css={{ scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}
                >
                    {centre.map(({ it, i }) => (
                        <DemoPill key={it.label} item={it} index={i} active={active} onSelect={setActive} />
                    ))}
                </HStack>

                {/* Right cluster - decorative theme toggle + the Prijava item. */}
                <HStack gap="2" flexShrink={0}>
                    <Flex
                        w="34px"
                        h="34px"
                        rounded="full"
                        borderWidth="1px"
                        borderColor="border"
                        color="pitch.500"
                        align="center"
                        justify="center"
                        aria-hidden
                    >
                        <Icon as={LuMoon} boxSize="4" />
                    </Flex>
                    {right.map(({ it, i }) => {
                        const isActive = active === i
                        return (
                            <chakra.button
                                key={it.label}
                                type="button"
                                aria-pressed={isActive}
                                onClick={() => setActive(i)}
                                px="4"
                                py="2"
                                rounded="full"
                                fontSize="13px"
                                fontWeight={700}
                                border="none"
                                cursor="pointer"
                                color="white"
                                bg="pitch.500"
                                transition="box-shadow 150ms, transform 150ms"
                                boxShadow={isActive ? "0 0 0 3px var(--chakra-colors-pitch-200)" : undefined}
                                transform={isActive ? "translateY(-1px)" : undefined}
                            >
                                {it.label}
                            </chakra.button>
                        )
                    })}
                </HStack>
            </Flex>

            {/* ── Explanation panel ───────────────────────────────────── */}
            <Box
                mt="3"
                bg="bg.panel"
                borderWidth="1px"
                borderColor="border"
                rounded="xl"
                p={{ base: "4", md: "5" }}
            >
                <Flex key={active} css={{ animation: "guidePop 240ms ease" }} gap="3.5" align="flex-start">
                    <Flex
                        w="46px"
                        h="46px"
                        rounded="lg"
                        bg="bg.surfaceTint"
                        color="pitch.500"
                        align="center"
                        justify="center"
                        flexShrink={0}
                    >
                        <Icon as={item.icon} boxSize="5.5" />
                    </Flex>
                    <Box minW="0" flex="1">
                        <HStack gap="2" mb="1">
                            <NumBadge n={active + 1} />
                            <Text fontWeight={800} fontSize="16px" color="fg.ink">{item.label}</Text>
                        </HStack>
                        <Text fontSize="14px" color="fg.muted" lineHeight="1.6">{item.desc}</Text>
                    </Box>
                </Flex>

                {/* Stepper - Prethodno / korak N od 6 / Sljedeće. */}
                <HStack justify="space-between" mt="4" pt="3" borderTopWidth="1px" borderColor="border">
                    <GhostButton onClick={() => step(-1)}>
                        ‹ Prethodno
                    </GhostButton>
                    <HStack gap="1.5">
                        {NAV_ITEMS.map((_, i) => (
                            <chakra.button
                                key={i}
                                type="button"
                                aria-label={`Korak ${i + 1}`}
                                onClick={() => setActive(i)}
                                w={i === active ? "20px" : "7px"}
                                h="7px"
                                rounded="full"
                                border="none"
                                cursor="pointer"
                                bg={i === active ? "pitch.500" : "border.emphasized"}
                                transition="width 200ms, background 200ms"
                            />
                        ))}
                    </HStack>
                    <GhostButton onClick={() => step(1)}>
                        Sljedeće ›
                    </GhostButton>
                </HStack>
            </Box>
        </Box>
    )
}

/** Right-pointing arrow between flow steps (points down when stacked). */
function FlowArrow() {
    return (
        <Flex align="center" justify="center" color="pitch.500" py={{ base: "0.5", lg: "0" }}>
            <Icon as={FiArrowRight} boxSize="6" display={{ base: "none", lg: "block" }} />
            <Icon as={FiArrowDown} boxSize="6" display={{ base: "block", lg: "none" }} />
        </Flex>
    )
}

/** One step of the "kreiranje turnira" process flow: number + title,
 *  screenshot (or placeholder), one-line description. */
function FlowStep({
    step,
    title,
    desc,
    children,
}: {
    step: number
    title: string
    desc: string
    children: ReactNode
}) {
    return (
        <VStack align="stretch" gap="2" minW="0">
            <HStack gap="2">
                <NumBadge n={step} size="22px" fontSize="12px" />
                <Text fontWeight={700} fontSize="14.5px" color="fg.ink">{title}</Text>
            </HStack>
            {children}
            <Text fontSize="13px" color="fg.muted" lineHeight="1.55">{desc}</Text>
        </VStack>
    )
}

/** One feature card (icon + title + short description). */
function FeatureCard({ f }: { f: Feature }) {
    return (
        <VStack
            align="start"
            gap="2"
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border"
            rounded="xl"
            p="5"
            h="full"
            transition="border-color .15s, box-shadow .15s"
            _hover={{ borderColor: "pitch.400", boxShadow: "sm" }}
        >
            <Flex
                w="42px"
                h="42px"
                rounded="lg"
                bg="bg.surfaceTint"
                color="pitch.500"
                align="center"
                justify="center"
                flexShrink={0}
            >
                <Icon as={f.icon} boxSize="5" />
            </Flex>
            <Text fontWeight={700} fontSize="15px" color="fg.ink" lineHeight="1.3">
                {f.title}
            </Text>
            <Text fontSize="13.5px" color="fg.muted" lineHeight="1.55">
                {f.desc}
            </Text>
        </VStack>
    )
}

/** Numbered chapter: "N. Title" heading + intro + content below. */
function Chapter({
    n,
    title,
    intro,
    children,
}: {
    n: number
    title: string
    intro: string
    children: ReactNode
}) {
    return (
        <Box as="section">
            <HStack gap="3" align="baseline" mb="2">
                <Text
                    fontFamily="mono"
                    fontSize={{ base: "20px", md: "24px" }}
                    fontWeight={800}
                    color="pitch.500"
                    lineHeight="1"
                >
                    {n}.
                </Text>
                <Heading
                    fontFamily="heading"
                    fontSize={{ base: "20px", md: "24px" }}
                    fontWeight={700}
                    letterSpacing="-0.02em"
                    color="fg.ink"
                >
                    {title}
                </Heading>
            </HStack>
            <Text fontSize="14.5px" color="fg.muted" maxW="620px" mb="4" lineHeight="1.6">
                {intro}
            </Text>
            {children}
        </Box>
    )
}

/** Small card in the hero's "Brzi pregled" side panel. */
function QuickCard({ icon, title, sub }: { icon: ElementType; title: string; sub: string }) {
    return (
        <HStack
            gap="3"
            bg="rgba(255,255,255,0.08)"
            borderWidth="1px"
            borderColor="rgba(255,255,255,0.14)"
            rounded="lg"
            px="3.5"
            py="3"
            align="center"
        >
            <Icon as={icon} boxSize="5" color="rgba(255,255,255,0.9)" flexShrink={0} />
            <Box minW="0">
                <Text fontSize="13.5px" fontWeight={700} color="white" lineHeight="1.25">
                    {title}
                </Text>
                <Text fontSize="12px" color="rgba(255,255,255,0.65)" lineHeight="1.35">
                    {sub}
                </Text>
            </Box>
        </HStack>
    )
}

export default function GuidePage() {
    const navigate = useNavigate()
    useDocumentHead({
        title: "Što nudimo - Futsal Turniri",
        description:
            "Sve što trebaš za futsal turnir na jednom mjestu: kreiranje, ždrijeb, raspored, vođenje uživo, rezultati, tablice i statistika.",
    })

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
        <VStack align="stretch" gap="12" pb="4">
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
            {/* ── Hero ─────────────────────────────────────────────────── */}
            <Box
                position="relative"
                rounded="2xl"
                overflow="hidden"
                color="white"
                bgImage="linear-gradient(135deg, #132A3E, #0B1522)"
            >
                <PitchBackdrop opacity={0.15} variant="guide-hero" tone="pitch" />
                <Grid
                    position="relative"
                    templateColumns={{ base: "1fr", lg: "1.2fr 1fr" }}
                    gap={{ base: 8, lg: 10 }}
                    px={{ base: 6, md: 12 }}
                    py={{ base: 10, md: 14 }}
                    alignItems="center"
                >
                    {/* Left: copy + CTAs */}
                    <Box>
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
                                Što nudimo?
                            </Text>
                        </HStack>
                        <Heading
                            fontFamily="heading"
                            fontSize={{ base: "30px", md: "44px" }}
                            fontWeight={800}
                            letterSpacing="-0.02em"
                            lineHeight="1.08"
                            mt="4"
                            mb="4"
                        >

                            <Box as="span" color="#ffd54a">
                               Futsal turniri
                            </Box>{" "}
                            na jednom mjestu
                        </Heading>
                        <Text
                            fontSize={{ base: "15px", md: "17px" }}
                            color="rgba(255,255,255,0.85)"
                            maxW="560px"
                            lineHeight="1.6"
                        >
                            Kreiraj turnir, izvuci ždrijeb, generiraj raspored i vodi utakmice
                            uživo - a rezultati, tablice i statistika ažuriraju se sami, u
                            stvarnom vremenu.
                        </Text>
                        <HStack gap="3" mt="7" wrap="wrap">
                            <PrimaryButton icon={<LuTrophy size={16} />} onClick={() => navigate("/turniri/novi")}>
                                Kreiraj turnir
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
                                Pogledaj uživo
                            </GhostButton>
                        </HStack>
                    </Box>

                    {/* Right: quick-overview panel */}
                    <Box
                        bg="rgba(0,0,0,0.18)"
                        borderWidth="1px"
                        borderColor="rgba(255,255,255,0.14)"
                        rounded="xl"
                        p="4"
                    >
                        <MonoLabel color="rgba(255,255,255,0.65)" letterSpacing="0.16em" mb="3" display="block">
                            BRZI PREGLED
                        </MonoLabel>
                        <VStack align="stretch" gap="2.5">
                            <QuickCard icon={LuShuffle} title="Ždrijeb" sub="Automatski ili ručni - grupe i eliminacija" />
                            <QuickCard icon={LuTimer} title="Utakmice uživo" sub="Mjerač, golovi, kartoni, prekršaji, penali" />
                            <QuickCard icon={LuChartColumn} title="Tablice i statistika" sub="Poredak, strijelci, bracket - sve samo" />
                            <QuickCard icon={LuBellRing} title="Obavijesti" sub="Push za početak, gol i kraj utakmice" />
                        </VStack>
                    </Box>
                </Grid>
            </Box>

            {/* ── 1. Izbornik ──────────────────────────────────────────── */}
            <Chapter
                n={1}
                title="Snađi se u izborniku"
                intro="Klikni stavku izbornika (ili koristi Prethodno / Sljedeće) da vidiš čemu služi."
            >
                <InteractiveNav />
            </Chapter>

            {/* ── 2. Kreiranje turnira - proces u tri koraka ───────────── */}
            <Chapter
                n={2}
                title="Kreiranje turnira"
                intro="Uneseš osnovne podatke, dodaš ekipe i igrače, izvučeš skupine - a raspored se izračuna sam."
            >
                <Box
                    display="grid"
                    gridTemplateColumns={{ base: "1fr", lg: "1fr auto 1fr auto 1fr" }}
                    gap={{ base: "2", lg: "3" }}
                    alignItems="center"
                >
                    <FlowStep
                        step={1}
                        title="Dodaj ekipe i igrače"
                        desc="Svaka ekipa ima svoj sastav - igrači s brojevima i kapetanom. Ekipa može i sama urediti sastav putem linka."
                    >
                        <MiniShot
                            src="/vodic/ekipe.webp"
                            alt="Ekipe turnira s otvorenim sastavom igrača"
                            width={1400}
                            height={875}
                        />
                    </FlowStep>
                    <FlowArrow />
                    <FlowStep
                        step={2}
                        title="Izvuci skupine"
                        desc="Povuci ekipe u skupine (ručni ždrijeb) ili ih rasporedi automatski jednim klikom."
                    >
                        {/* Screenshot dolazi naknadno - placeholder drži isti
                            omjer kao susjedne slike da red ostane poravnat. */}
                        <Flex
                            rounded="xl"
                            borderWidth="1.5px"
                            borderStyle="dashed"
                            borderColor="border.emphasized"
                            bg="bg.surfaceTint"
                            align="center"
                            justify="center"
                            direction="column"
                            gap="1.5"
                            aspectRatio={1.6}
                            px="4"
                        >
                            <Icon as={LuShuffle} boxSize="6" color="fg.muted" />
                            <Text fontSize="12.5px" color="fg.muted" textAlign="center">
                                Slika ždrijeba uskoro
                            </Text>
                        </Flex>
                    </FlowStep>
                    <FlowArrow />
                    <FlowStep
                        step={3}
                        title="Generiraj raspored"
                        desc="Odaberi trajanje poluvremena i pauze - termini svih utakmica izračunaju se sami, a preslaguješ ih povlačenjem."
                    >
                        <MiniShot
                            src="/vodic/raspored.webp"
                            alt="Raspored turnira s terminima i rezultatima"
                            width={1600}
                            height={1000}
                        />
                    </FlowStep>
                </Box>
            </Chapter>

            {/* ── 3. Zapisnik + semafor ────────────────────────────────── */}
            <Chapter
                n={3}
                title="Zapisnik - vođenje utakmica uživo"
                intro="Zapisnik na mobitelu umjesto papira: sve što upišeš odmah vide svi - kod kuće, u dvorani i na velikom ekranu."
            >
                <Grid templateColumns={{ base: "1fr", lg: "1fr 1.35fr" }} gap="4" alignItems="stretch">
                    {/* Zapisnik features (screenshot slijedi nakon redizajna). */}
                    <VStack align="stretch" gap="3">
                        <FeatureCard f={{ icon: LuTimer, title: "Mjerač po poluvremenima", desc: "1. poluvrijeme → pauza → 2. poluvrijeme → kraj. Sat se zaustavlja na isteku i čeka tebe." }} />
                        <FeatureCard f={{ icon: LuRadioTower, title: "Golovi i događaji", desc: "Gol jednim dodirom na igrača - minuta se upiše sama. Žuti/crveni kartoni, prekršaji (deveterac) i penali." }} />
                        <FeatureCard f={{ icon: LuMonitorPlay, title: "Turnir mode / TV prikaz", desc: "Fullscreen semafor za dvoranu - sve što upišeš u zapisnik odmah je na velikom ekranu." }} />
                    </VStack>
                    <Shot
                        src="/vodic/uzivo.webp"
                        alt="Turnir mode: rezultat uživo, mjerač 2. poluvremena, prekršaji i strijelci"
                        width={1600}
                        height={1000}
                        caption="Semafor uživo - rezultat, mjerač, akumulirani prekršaji i strijelci u stvarnom vremenu."
                    />
                </Grid>
            </Chapter>

            {/* ── 4. Rezultati, tablice i statistika ───────────────────── */}
            <Chapter
                n={4}
                title="Rezultati, tablice i statistika"
                intro="Nakon svakog sudačkog zvižduka sve je već izračunato - bez Excela i ručnog zbrajanja."
            >
                <Box
                    display="grid"
                    gridTemplateColumns={{ base: "1fr", lg: "1fr auto 1fr auto 1fr" }}
                    gap={{ base: "2", lg: "3" }}
                    alignItems="center"
                >
                    <FlowStep
                        step={1}
                        title="Tablice skupina"
                        desc="Bodovi, gol-razlika i forma računaju se sami nakon svake upisane utakmice."
                    >
                        <MiniShot
                            src="/vodic/grupe.webp"
                            alt="Tablice grupa s bodovima, gol-razlikom i formom"
                            width={1600}
                            height={1000}
                        />
                    </FlowStep>
                    <FlowArrow />
                    <FlowStep
                        step={2}
                        title="Završnica"
                        desc="Eliminacija od četvrtfinala do prvaka - s rezultatima i penalima. Prijeđi mišem za cijeli bracket."
                    >
                        {/* Tall bracket display-cropped to match the neighbours;
                            the hover zoom reveals the whole thing. */}
                        <MiniShot
                            src="/vodic/bracket.webp"
                            alt="Eliminacijska završnica s rezultatima, penalima i prvakom"
                            width={1400}
                            height={1845}
                            cropAspect={1.6}
                        />
                    </FlowStep>
                    <FlowArrow />
                    <FlowStep
                        step={3}
                        title="Statistika"
                        desc="Najbolji strijelci i golovi turnira - lista se puni sama iz zapisnika."
                    >
                        <MiniShot
                            src="/vodic/statistika.webp"
                            alt="Statistika turnira: najbolji strijelci s brojem golova"
                            width={1400}
                            height={875}
                        />
                    </FlowStep>
                </Box>
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
                    Spreman za turnir bez stresa?
                </Heading>
                <Text fontSize="15px" color="fg.muted" maxW="480px" mx="auto" mt="2">
                    Besplatno je i traje par minuta - ostalo aplikacija odradi za tebe.
                </Text>
                <HStack gap="3" wrap="wrap" justify="center" mt="6">
                    <PrimaryButton icon={<LuTrophy size={16} />} onClick={() => navigate("/turniri/novi")}>
                        Kreiraj turnir
                    </PrimaryButton>
                    <GhostButton icon={<FiArrowRight size={15} />} onClick={() => navigate("/turniri")}>
                        Pregledaj turnire
                    </GhostButton>
                </HStack>
            </Box>
        </VStack>
        </ZoomCtx.Provider>
    )
}
