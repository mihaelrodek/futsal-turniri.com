import { useEffect, useMemo, useRef, useState } from "react"
import {
    Box,
    Flex,
    Grid,
    HStack,
    IconButton,
    Slider,
    Text,
    VStack,
} from "@chakra-ui/react"
import { Link as RouterLink } from "react-router-dom"
import { FiCalendar, FiChevronRight, FiDollarSign, FiEyeOff, FiMapPin, FiNavigation } from "react-icons/fi"

import "leaflet/dist/leaflet.css"
import L from "leaflet"
import {
    Circle,
    MapContainer,
    Marker,
    Popup,
    TileLayer,
    useMap,
} from "react-leaflet"

import type { TournamentCard } from "../types/tournaments"
import { fetchTournaments } from "../api/tournaments"
import { useUserLocation } from "../hooks/useUserLocation"
import { haversineKm } from "../utils/distance"
import { GhostButton, MonoLabel, PulseDot } from "../ui/pitch"
import { useDocumentHead } from "../hooks/useDocumentHead"
import { useColorMode } from "../color-mode"

/* ──────────────────────────────────────────────────────────────────────────
   MapPage - "Pitch" theme /karta.

   Behaviour:
     • Geolocated tournaments are pinned on a Leaflet map (CARTO Voyager
       tiles). Pins are coloured by classification:
         today    → brand cyan (#2AD4C8)
         soon     → accent.amber
         later    → accent.red
         live     → accent.red + pulsing `!` badge
     • A sidebar (desktop) or horizontal pill rail (mobile) lists the
       same tournaments. Clicking an entry FLIES the map to that pin and
       opens its popup. The active row is highlighted in pitch-tint.
     • Radius slider filters to a circle around the user's position when
       location is granted; the right-edge value ("Sve") disables the
       filter.

   Mobile layout: the sidebar becomes a horizontally scrollable chip row
   above a 60vh map. Tapping a chip flies the map to that pin so the
   user can find a tournament without opening a separate sidebar.
   ────────────────────────────────────────────────────────────────────── */

type TournamentWithCoords = TournamentCard & {
    uuid: string
    latitude: number
    longitude: number
}

type Bucket = "today" | "soon" | "later" | "live"

const PIN_COLORS: Record<Bucket, string> = {
    today: "#2AD4C8",
    soon: "#d97706",
    later: "#dc2626",
    live: "#dc2626",
}

function endOfNextWeek(now: Date): Date {
    const d = new Date(now)
    d.setHours(23, 59, 59, 999)
    const jsDay = d.getDay()
    const daysToThisSunday = jsDay === 0 ? 0 : 7 - jsDay
    d.setDate(d.getDate() + daysToThisSunday + 7)
    return d
}

/** Build the map pin SVG as a DivIcon. The SVG is centred so the `iconAnchor`
 *  (16,40) lands at the tip of the pin and the popup opens above the head. */
function makePinIcon(color: string, isUser = false, live = false): L.DivIcon {
    const liveBadge = live
        ? `<g transform="translate(22, 4)">
                <circle r="7" fill="#dc2626" stroke="white" stroke-width="1.5"/>
                <text text-anchor="middle" y="3" font-size="9" fill="#fff" font-weight="800">!</text>
           </g>`
        : ""
    // Pulsing "radar ping" ring behind the pin head - only for live
    // tournaments. Sits under the SVG (z-index/order) so the pin stays crisp.
    const livePing = live ? `<span class="map-live-ping"></span>` : ""
    const html = isUser
        ? `<div style="
              width: 18px; height: 18px; border-radius: 50%;
              background: #2AD4C8; border: 3px solid white;
              box-shadow: 0 0 0 2px rgba(42,212,200,0.4), 0 1px 4px rgba(0,0,0,0.4);">
           </div>`
        : `<div style="position:relative;width:32px;height:42px;">
             ${livePing}
             <svg width="32" height="42" viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg" style="position:relative;display:block;overflow:visible;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.35));">
               <path d="M16 0C9.4 0 4 5.4 4 12c0 9 12 30 12 30s12-21 12-30c0-6.6-5.4-12-12-12z"
                     fill="${color}" stroke="white" stroke-width="2"/>
               <circle cx="16" cy="12" r="5" fill="white"/>
               ${liveBadge}
             </svg>
           </div>`
    return L.divIcon({
        html,
        className: "map-pin-icon",
        iconSize: isUser ? [18, 18] : [32, 42],
        iconAnchor: isUser ? [9, 9] : [16, 40],
        popupAnchor: isUser ? [0, -12] : [0, -36],
    })
}

function classify(startAt?: string | null, live?: boolean): Bucket {
    if (live) return "live"
    if (!startAt) return "later"
    const start = new Date(startAt).setHours(0, 0, 0, 0)
    const today = new Date().setHours(0, 0, 0, 0)
    const cutoff = endOfNextWeek(new Date()).getTime()
    if (start === today) return "today"
    if (start >= today && start <= cutoff) return "soon"
    return "later"
}

function formatDateShort(iso?: string | null): string {
    if (!iso) return "-"
    return new Intl.DateTimeFormat("hr-HR", {
        weekday: "short",
        day: "2-digit",
        month: "short",
    }).format(new Date(iso))
}
function formatTime(iso?: string | null): string {
    if (!iso) return ""
    return new Intl.DateTimeFormat("hr-HR", {
        hour: "2-digit",
        minute: "2-digit",
    }).format(new Date(iso))
}

/**
 * Camera controller - runs inside <MapContainer> via `useMap`. Two phases:
 *
 * 1. Initial focus (once): if the user's location is available, centre on it
 *    at zoom 10. Otherwise, fit to all visible pins. Past this point the
 *    initial branch is locked off via a ref.
 *
 * 2. Selection follow: whenever `selectedUuid` changes, fly to that pin's
 *    coords at zoom 12 and open its popup (popup opening is driven by the
 *    parent via `markersRef`). When `selectedUuid` becomes null the camera
 *    stays put.
 *
 * 3. Radius follow: when the slider moves below max, fit to the radius
 *    circle. Runs only after the initial focus has landed.
 */
function MapController({
    userPos,
    allPoints,
    radiusKm,
    radiusMax,
    selectedTournament,
}: {
    userPos: [number, number] | null
    allPoints: [number, number][]
    radiusKm: number
    radiusMax: number
    selectedTournament: TournamentWithCoords | null
}) {
    const map = useMap()
    const initialRef = useRef<"pending" | "done">("pending")

    useEffect(() => {
        if (initialRef.current === "done") return
        if (userPos) {
            map.setView(userPos, 10, { animate: false })
            initialRef.current = "done"
            return
        }
        if (allPoints.length > 0) {
            map.fitBounds(L.latLngBounds(allPoints), {
                padding: [40, 40],
                maxZoom: 12,
            })
            initialRef.current = "done"
        }
    }, [userPos, allPoints, map])

    // Selection follow - fly to the chosen tournament with a smooth animation.
    useEffect(() => {
        if (!selectedTournament) return
        map.flyTo(
            [selectedTournament.latitude, selectedTournament.longitude],
            Math.max(map.getZoom(), 12),
            { duration: 0.6 },
        )
    }, [selectedTournament, map])

    // Radius follow.
    useEffect(() => {
        if (initialRef.current !== "done") return
        if (!userPos) return
        if (radiusKm >= radiusMax) return
        if (selectedTournament) return // selection takes precedence
        const bounds = L.latLngBounds([userPos, ...circleBoxCorners(userPos, radiusKm)])
        map.fitBounds(bounds, { padding: [40, 40] })
    }, [radiusKm, userPos, radiusMax, map, selectedTournament])

    // Invalidate size on mount + when the container's parent toggles between
    // mobile (chip rail above) and desktop (sidebar beside) layouts. Leaflet
    // caches the container rect, so a CSS-driven flex flip leaves grey tiles
    // until invalidateSize is called.
    useEffect(() => {
        const t = setTimeout(() => map.invalidateSize(), 50)
        return () => clearTimeout(t)
    }, [map])

    return null
}

function circleBoxCorners(center: [number, number], radiusKm: number): [number, number][] {
    const [lat, lng] = center
    const dLat = radiusKm / 111
    const dLng = radiusKm / (111 * Math.max(0.0001, Math.cos((lat * Math.PI) / 180)))
    return [
        [lat + dLat, lng + dLng],
        [lat - dLat, lng - dLng],
    ]
}

const MAP_RADIUS_MAX_KM = 100

/** Desktop height shared by the map and the tournament list, derived from the
 *  viewport so the whole /karta screen fits WITHOUT page scroll: 100dvh minus
 *  the chrome above and below it - navbar (57) + container padding (28 top,
 *  52 bottom for the sticky footer) + the filter strip (60) + the gap and the
 *  map's top offset (40) + a small margin. Measured against the real layout,
 *  not guessed. The list then scrolls inside itself, as before. */
const MAP_DESKTOP_H = "calc(100dvh - 265px)"

/** Pin colour legend - rendered in the filter bar on desktop and as a small
 *  overlay pill on the map itself on phones (where the bar is a single row). */
const PIN_LEGEND = [
    { label: "Danas", color: "pitch.400" },
    { label: "Tjedan", color: "accent.amber" },
    { label: "Kasnije", color: "accent.red" },
] as const

/** Desktop sidebar list item - coloured pin glyph + name + city/date + chev. */
function SidebarItem({
    t,
    active,
    onClick,
}: {
    t: TournamentWithCoords
    active: boolean
    onClick: () => void
}) {
    const cls = classify(t.startAt, t.liveMatch)
    const color = PIN_COLORS[cls]
    return (
        <Flex
            align="center"
            gap="3"
            px="4"
            py="3"
            rounded="lg"
            bg={active ? "bg.surfaceTint" : "bg.panel"}
            borderWidth="1px"
            borderColor={active ? "pitch.400" : "border"}
            cursor="pointer"
            onClick={onClick}
            _hover={{ bg: "bg.surfaceTint2" }}
            transition="background 150ms, border-color 150ms"
        >
            <Flex
                w="36px"
                h="36px"
                rounded="full"
                bg={`color-mix(in srgb, ${color} 15%, transparent)`}
                align="center"
                justify="center"
                flexShrink={0}
            >
                <svg width="16" height="16" viewBox="0 0 24 24">
                    <path
                        fill={color}
                        d="M12 2C7.6 2 4 5.6 4 10c0 5.4 8 12 8 12s8-6.6 8-12c0-4.4-3.6-8-8-8zm0 11a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"
                    />
                </svg>
            </Flex>
            <Box flex="1" minW="0">
                <HStack gap="2">
                    <Text fontSize="14px" fontWeight={700} color="fg.ink" truncate>
                        {t.name}
                    </Text>
                    {cls === "live" && (
                        <HStack
                            gap="1"
                            px="1.5"
                            py="0.5"
                            bg="rgba(220,38,38,0.1)"
                            rounded="sm"
                            fontFamily="mono"
                            fontSize="9px"
                            fontWeight={800}
                            color="accent.red"
                            letterSpacing="0.1em"
                            flexShrink={0}
                        >
                            <PulseDot color="accent.red" size={4} />
                            UŽIVO
                        </HStack>
                    )}
                </HStack>
                <Text fontSize="12px" color="fg.muted" truncate mt="0.5">
                    {[t.location, formatDateShort(t.startAt)].filter(Boolean).join(" · ")}
                </Text>
            </Box>
            <Box color="fg.muted" flexShrink={0}>
                <FiChevronRight />
            </Box>
        </Flex>
    )
}

/** Mobile chip - compact pill the user scrolls through above the map. */
function MobileChip({
    t,
    active,
    onClick,
}: {
    t: TournamentWithCoords
    active: boolean
    onClick: () => void
}) {
    const cls = classify(t.startAt, t.liveMatch)
    const color = PIN_COLORS[cls]
    return (
        <Flex
            onClick={onClick}
            align="center"
            gap="2"
            px="3"
            py="2"
            rounded="full"
            bg={active ? "pitch.500" : "bg.panel"}
            color={active ? "white" : "fg.ink"}
            borderWidth="1px"
            borderColor={active ? "pitch.500" : "border"}
            cursor="pointer"
            flexShrink={0}
            minW="fit-content"
            maxW="220px"
            transition="background 150ms"
        >
            <Box w="8px" h="8px" rounded="full" bg={color} flexShrink={0} />
            <Text fontSize="12px" fontWeight={600} truncate>
                {t.name}
            </Text>
            {cls === "live" && <PulseDot color={active ? "white" : "accent.red"} size={5} />}
        </Flex>
    )
}

export default function MapPage() {
    useDocumentHead({
        title: "Karta turnira - futsal-turniri.com",
        description: "Pregled svih nadolazećih futsal turnira u Hrvatskoj na karti.",
        canonical: "https://futsal-turniri.com/karta",
    })

    const [tournaments, setTournaments] = useState<TournamentCard[]>([])
    const [, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const { pos: userPos, status: geoStatus, request: requestLocation, hide: hideLocation } = useUserLocation()
    const [radiusKm, setRadiusKm] = useState<number>(MAP_RADIUS_MAX_KM)
    const [selectedUuid, setSelectedUuid] = useState<string | null>(null)

    // Map of uuid → Leaflet Marker so the parent can imperatively open a
    // popup on selection. Kept outside React state to avoid re-renders.
    const markersRef = useRef<Map<string, L.Marker>>(new Map())

    useEffect(() => {
        let cancelled = false
        ;(async () => {
            try {
                setLoading(true)
                setError(null)
                const data = await fetchTournaments("upcoming")
                if (!cancelled) setTournaments(data)
            } catch (e: any) {
                if (!cancelled) setError(e?.message ?? "Failed to load tournaments")
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [])

    const placedAll: TournamentWithCoords[] = useMemo(() => {
        return tournaments
            .filter(
                (t) =>
                    typeof t.latitude === "number" &&
                    typeof t.longitude === "number" &&
                    isFinite(t.latitude!) &&
                    isFinite(t.longitude!),
            )
            .map((t) => t as TournamentWithCoords)
    }, [tournaments])

    const placed: TournamentWithCoords[] = useMemo(() => {
        if (!userPos || radiusKm >= MAP_RADIUS_MAX_KM) return placedAll
        const me = { lat: userPos[0], lng: userPos[1] }
        return placedAll.filter(
            (t) => haversineKm(me, { lat: t.latitude, lng: t.longitude }) <= radiusKm,
        )
    }, [placedAll, userPos, radiusKm])

    const allPoints = useMemo<[number, number][]>(
        () => placed.map((t) => [t.latitude, t.longitude]),
        [placed],
    )

    const selectedTournament =
        placed.find((t) => t.uuid === selectedUuid) ?? null

    // Open the selected tournament's popup whenever selection changes. The
    // marker may not exist yet on first render (Leaflet mounts asynchronously),
    // so we retry with a short timeout - once on the same tick, then again
    // after 100ms in case the marker registered after the effect ran.
    useEffect(() => {
        if (!selectedUuid) return
        const open = () => {
            const m = markersRef.current.get(selectedUuid)
            if (m) m.openPopup()
        }
        open()
        const t = setTimeout(open, 120)
        return () => clearTimeout(t)
    }, [selectedUuid])

    const defaultCenter: [number, number] = [44.5, 16.5]
    const defaultZoom = 7

    const radiusDisabled = !userPos
    // Drives the basemap style (see the TileLayer further down).
    const { colorMode } = useColorMode()

    function selectTournament(uuid: string) {
        // Toggle off when tapping the already-selected entry - gives the user
        // a way to clear the focus without zooming out manually.
        setSelectedUuid((cur) => (cur === uuid ? null : uuid))
    }

    return (
        <VStack align="stretch" gap="3">
            {/* Compact filter bar - replaces the previous PageTitle hero
                + separate filter row. Product feedback: drop the kicker /
                title / subtitle entirely and pull the "Moja lokacija"
                button into the radius row so the whole control bar is
                one strip flush with the page top. Legend + button collapse
                to the right side on desktop; everything wraps on mobile. */}
            {/* Padding is deliberately tight on md+ too: this strip plus the
                navbar is all the chrome above the map, and every pixel here is
                a pixel the map loses from the first screen (see the viewport
                calc on the map box below). */}
            <Box bg="bg.panel" borderWidth="1px" borderColor="border" rounded="xl" p={{ base: "2.5", md: "3" }}>
                <Flex
                    // Phones: ONE row (radius + value + a round location button)
                    // so the whole map fits the first screen - the legend moves
                    // onto the map itself as an overlay and the button loses its
                    // text. The three stacked rows this used to be pushed the map
                    // ~90px below the fold.
                    direction={{ base: "row", md: "row" }}
                    justify="space-between"
                    align="center"
                    gap={{ base: "2", md: "5" }}
                >
                    <HStack gap={{ base: "2", md: "3" }} flex="1" minW="0">
                        {/* Shortened on phones - the full label alone ate a
                            third of the row's width. */}
                        <Box display={{ base: "none", sm: "block" }} flexShrink={0}>
                            <MonoLabel>U KRUGU OD</MonoLabel>
                        </Box>
                        <Box display={{ base: "block", sm: "none" }} flexShrink={0}>
                            <MonoLabel>KRUG</MonoLabel>
                        </Box>
                        <Box flex="1" minW="0">
                            <Slider.Root
                                min={1}
                                max={MAP_RADIUS_MAX_KM}
                                step={1}
                                value={[radiusKm]}
                                onValueChange={(e) => setRadiusKm(e.value[0])}
                                disabled={radiusDisabled}
                                colorPalette="pitch"
                            >
                                <Slider.Control>
                                    <Slider.Track>
                                        <Slider.Range />
                                    </Slider.Track>
                                    <Slider.Thumbs />
                                </Slider.Control>
                            </Slider.Root>
                        </Box>
                        {/* Max radius reads "∞ km" rather than "Sve" so the whole
                            scale keeps ONE shape - "12 km" … "∞ km" - instead of
                            switching to a word at the far end. */}
                        <Box fontFamily="mono" fontSize="13px" fontWeight={700} color="fg.ink" minW={{ base: "48px", md: "56px" }} textAlign="right">
                            {radiusDisabled
                                ? "-"
                                : radiusKm >= MAP_RADIUS_MAX_KM
                                    ? "∞ km"
                                    : `${radiusKm} km`}
                        </Box>
                    </HStack>
                    <HStack
                        gap={{ base: "3", md: "4" }}
                        wrap="wrap"
                        justify={{ base: "flex-end", md: "flex-end" }}
                        align="center"
                        flexShrink={0}
                    >
                        {/* Legend - desktop only; on phones it lives as an
                            overlay pill in the map's bottom-left corner. */}
                        <HStack gap="3" wrap="wrap" display={{ base: "none", md: "flex" }}>
                            {PIN_LEGEND.map((l) => (
                                <HStack key={l.label} gap="1.5">
                                    <Box w="10px" h="10px" rounded="full" bg={l.color} />
                                    <Text fontSize="12px" color="fg.ink" fontWeight={600}>
                                        {l.label}
                                    </Text>
                                </HStack>
                            ))}
                        </HStack>
                        {/* Phones get the icon alone (the label is what forced
                            this cluster onto its own row); md+ keeps the
                            labelled ghost button. */}
                        <Box display={{ base: "block", md: "none" }}>
                            <IconButton
                                aria-label={geoStatus === "granted" ? "Sakrij lokaciju" : "Moja lokacija"}
                                title={geoStatus === "granted" ? "Sakrij lokaciju" : "Moja lokacija"}
                                size="sm"
                                variant="outline"
                                rounded="full"
                                colorPalette={geoStatus === "granted" ? "gray" : "pitch"}
                                disabled={geoStatus === "asking"}
                                onClick={geoStatus === "granted" ? hideLocation : requestLocation}
                            >
                                {geoStatus === "granted" ? <FiEyeOff size={15} /> : <FiNavigation size={15} />}
                            </IconButton>
                        </Box>
                        {/* Compact paddings: this button is the tallest thing in
                            the strip, so its height sets the whole bar's. */}
                        <Box display={{ base: "none", md: "block" }}>
                            {geoStatus === "granted" ? (
                                <GhostButton px="3" py="1.5" fontSize="13px" icon={<FiEyeOff size={14} />} onClick={hideLocation}>
                                    Sakrij lokaciju
                                </GhostButton>
                            ) : (
                                <GhostButton
                                    px="3"
                                    py="1.5"
                                    fontSize="13px"
                                    icon={<FiNavigation size={14} />}
                                    onClick={requestLocation}
                                    disabled={geoStatus === "asking"}
                                >
                                    Moja lokacija
                                </GhostButton>
                            )}
                        </Box>
                    </HStack>
                </Flex>
            </Box>

            {error && (
                <Box bg="accent.red" color="white" rounded="lg" px="4" py="3">
                    <Text fontSize="sm">{error}</Text>
                </Box>
            )}
            {geoStatus === "denied" && (
                <Box bg="bg.surfaceTint2" borderWidth="1px" borderColor="border" rounded="lg" px="4" py="3">
                    <Text fontSize="sm" color="fg.soft">
                        Pristup lokaciji je odbijen. Možeš ga uključiti kasnije u postavkama preglednika.
                    </Text>
                </Box>
            )}

            {/* ── Mobile chip rail ──────────────────────────────────────
                 Horizontally scrollable list of compact tournament chips.
                 Tapping a chip flies the map to it. Hidden on md+ (the
                 sidebar takes over). */}
            {placed.length > 0 && (
                <Box display={{ base: "block", md: "none" }} mx={{ base: "-4", md: "0" }}>
                    <Flex
                        gap="2"
                        overflowX="auto"
                        px="4"
                        py="1"
                        css={{
                            scrollbarWidth: "none",
                            "&::-webkit-scrollbar": { display: "none" },
                        }}
                    >
                        {placed.map((t) => (
                            <MobileChip
                                key={t.uuid}
                                t={t}
                                active={selectedUuid === t.uuid}
                                onClick={() => selectTournament(t.uuid)}
                            />
                        ))}
                    </Flex>
                </Box>
            )}

            {/* ── Main split - sidebar + map on desktop, full-width map on mobile ── */}
            <Grid templateColumns={{ base: "1fr", md: "340px 1fr" }} gap="5">
                {/* Sidebar - desktop only */}
                <Box display={{ base: "none", md: "block" }}>
                    {/* "Poništi odabir" header - centered above the list. Its
                        fixed height (minH 20px + mb "2" = 28px) is mirrored by
                        the map column's top offset below so the two columns'
                        content tops line up. */}
                    <Flex justify="center" align="center" mb="2" minH="20px">
                        {selectedUuid && (
                            <Box
                                fontSize="12px"
                                color="pitch.500"
                                fontWeight={600}
                                cursor="pointer"
                                onClick={() => setSelectedUuid(null)}
                            >
                                Poništi odabir
                            </Box>
                        )}
                    </Flex>
                    {/* Same viewport-derived height as the map so the two columns
                        end level and neither pushes the page into a scroll; the
                        list keeps scrolling inside itself. */}
                    <VStack align="stretch" gap="2" maxH={{ base: "700px", md: MAP_DESKTOP_H }} overflowY="auto" pr="1">
                        {placed.length === 0 ? (
                            <Box
                                bg="bg.panel"
                                borderWidth="1px"
                                borderColor="border"
                                borderStyle="dashed"
                                rounded="lg"
                                p="5"
                                textAlign="center"
                            >
                                <Text fontSize="sm" color="fg.muted">
                                    Nema turnira u odabranom krugu.
                                </Text>
                            </Box>
                        ) : (
                            placed.map((t) => (
                                <SidebarItem
                                    key={t.uuid}
                                    t={t}
                                    active={selectedUuid === t.uuid}
                                    onClick={() => selectTournament(t.uuid)}
                                />
                            ))
                        )}
                    </VStack>
                </Box>

                {/* Map - on desktop, offset the top by the sidebar's
                    "Poništi odabir" header height (minH 20px + mb "2" = 28px,
                    i.e. the "7" spacing token) so the map's top edge lines up
                    with the first tournament card instead of sitting higher. No
                    offset on mobile, where the sidebar header is not rendered. */}
                <Box
                    mt={{ base: "0", md: "7" }}
                    borderWidth="1px"
                    borderColor="border"
                    rounded="xl"
                    overflow="hidden"
                    shadow="sm"
                    // Phones use dvh (the *visible* viewport, so the browser's
                    // own chrome is accounted for) and a smaller floor, so the
                    // map ends above the bottom nav on a first paint instead of
                    // forcing a scroll.
                    h={{ base: "58dvh", md: MAP_DESKTOP_H }}
                    minH={{ base: "380px", md: "360px" }}
                    bg="bg.muted"
                    position="relative"
                >
                    <MapContainer
                        center={userPos ?? defaultCenter}
                        zoom={userPos ? 10 : defaultZoom}
                        scrollWheelZoom
                        style={{ height: "100%", width: "100%" }}
                    >
                        {/* Basemap follows the app theme: CARTO Voyager (warm
                            beige land, muted blue water) on light, CARTO
                            dark_all on dark - the light tiles were a glaring
                            white slab in an otherwise navy UI. `key` remounts
                            the layer on a theme switch so no cached tiles of
                            the previous style survive. Leaflet's own chrome
                            (zoom buttons, popup, attribution) is themed in
                            system.ts. */}
                        <TileLayer
                            key={colorMode}
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                            url={
                                colorMode === "dark"
                                    ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                                    : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                            }
                        />

                        {placed.map((t) => {
                            const cls = classify(t.startAt, t.liveMatch)
                            const color = PIN_COLORS[cls]
                            return (
                                <Marker
                                    key={t.uuid}
                                    position={[t.latitude, t.longitude]}
                                    icon={makePinIcon(color, false, cls === "live")}
                                    eventHandlers={{
                                        // Capture the marker instance so the
                                        // parent can imperatively open its popup
                                        // when the sidebar selects it.
                                        add: (e) => {
                                            markersRef.current.set(t.uuid, e.target as L.Marker)
                                        },
                                        remove: () => {
                                            markersRef.current.delete(t.uuid)
                                        },
                                        click: () => {
                                            setSelectedUuid(t.uuid)
                                        },
                                    }}
                                >
                                    <Popup minWidth={220} maxWidth={280}>
                                        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 4 }}>
                                            <strong style={{ fontSize: 14, lineHeight: 1.3, fontFamily: "'Bricolage Grotesque', sans-serif" }}>
                                                {t.name}
                                            </strong>
                                            <span
                                                style={{
                                                    display: "inline-block",
                                                    alignSelf: "flex-start",
                                                    padding: "2px 8px",
                                                    borderRadius: 99,
                                                    fontSize: 10,
                                                    fontWeight: 800,
                                                    textTransform: "uppercase",
                                                    letterSpacing: "0.1em",
                                                    color: "white",
                                                    background: color,
                                                    fontFamily: "'JetBrains Mono', monospace",
                                                }}
                                            >
                                                {cls === "live"
                                                    ? "UŽIVO"
                                                    : cls === "today"
                                                        ? "Danas"
                                                        : cls === "soon"
                                                            ? "Uskoro"
                                                            : "Kasnije"}
                                            </span>
                                            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                                                <FiCalendar size={12} />
                                                <span>
                                                    {formatDateShort(t.startAt)} • {formatTime(t.startAt)}
                                                </span>
                                            </div>
                                            {t.location && (
                                                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                                                    <FiMapPin size={12} />
                                                    <span>{t.location}</span>
                                                </div>
                                            )}
                                            {(() => {
                                                const fmt = (n?: number | null) => {
                                                    if (typeof n !== "number" || !Number.isFinite(n)) return null
                                                    const s = n.toFixed(2)
                                                    return (s.endsWith(".00") ? s.slice(0, -3) : s) + "€"
                                                }
                                                const entry = fmt(t.entryPrice)
                                                if (!entry) return null
                                                return (
                                                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                                                        <FiDollarSign size={12} />
                                                        <span>
                                                            Kotizacija: <strong>{entry}</strong>
                                                        </span>
                                                    </div>
                                                )
                                            })()}
                                            <RouterLink
                                                to={`/turniri/${t.slug ?? t.uuid}`}
                                                style={{
                                                    display: "inline-block",
                                                    marginTop: 4,
                                                    padding: "6px 10px",
                                                    borderRadius: 8,
                                                    background: "#2AD4C8",
                                                    color: "#0B1522",
                                                    textAlign: "center",
                                                    textDecoration: "none",
                                                    fontSize: 13,
                                                    fontWeight: 700,
                                                }}
                                            >
                                                Više detalja →
                                            </RouterLink>
                                        </div>
                                    </Popup>
                                </Marker>
                            )
                        })}

                        {userPos && (
                            <Marker position={userPos} icon={makePinIcon("", true)}>
                                <Popup>
                                    <strong>Tvoja lokacija</strong>
                                </Popup>
                            </Marker>
                        )}

                        {userPos && radiusKm < MAP_RADIUS_MAX_KM && (
                            <Circle
                                center={userPos}
                                radius={radiusKm * 1000}
                                pathOptions={{
                                    color: "#2AD4C8",
                                    weight: 2,
                                    opacity: 0.7,
                                    fillColor: "#2AD4C8",
                                    fillOpacity: 0.08,
                                }}
                            />
                        )}

                        <MapController
                            userPos={userPos}
                            allPoints={allPoints}
                            radiusKm={radiusKm}
                            radiusMax={MAP_RADIUS_MAX_KM}
                            selectedTournament={selectedTournament}
                        />
                    </MapContainer>

                    {/* Phone-only pin legend, floated over the map's bottom-left
                        corner. Costs no layout height (that's the point) and
                        stays out of the way of taps - Leaflet's own controls sit
                        at z-index 1000, so 500 keeps it below them. */}
                    <HStack
                        display={{ base: "flex", md: "none" }}
                        position="absolute"
                        left="8px"
                        bottom="8px"
                        zIndex={500}
                        pointerEvents="none"
                        gap="2"
                        px="2"
                        py="1"
                        rounded="md"
                        bg="bg.panel"
                        borderWidth="1px"
                        borderColor="border"
                        shadow="sm"
                        opacity={0.95}
                    >
                        {PIN_LEGEND.map((l) => (
                            <HStack key={l.label} gap="1">
                                <Box w="7px" h="7px" rounded="full" bg={l.color} flexShrink={0} />
                                <Text fontSize="10px" color="fg.soft" fontWeight={700}>
                                    {l.label}
                                </Text>
                            </HStack>
                        ))}
                    </HStack>
                </Box>
            </Grid>
        </VStack>
    )
}
