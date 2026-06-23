import { useEffect, useMemo, useState } from "react"
import { Box, Text } from "@chakra-ui/react"
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet"
import L from "leaflet"
// Leaflet's stylesheet — required for tiles to position correctly.
// MapPage imports this too but only on /karta; the create-tournament
// page mounts LocationMapPicker directly so we must own the import
// here, otherwise tiles render as unstyled <img> stacks at coord 0,0
// and the map looks completely broken.
import "leaflet/dist/leaflet.css"

/**
 * Build the same teardrop pin as the /karta page so the picker and the
 * public map are visually consistent. The shape lives in a DivIcon (not
 * a raster) so it scales crisply and we don't depend on Leaflet's
 * bundled marker PNGs (which Vite doesn't resolve cleanly). The pin
 * tip lands at iconAnchor (16, 40), matching MapPage.makePinIcon.
 */
const PICKER_PIN_COLOR = "#dc2626"
function makePickerPinIcon(): L.DivIcon {
    const html = `<svg width="32" height="42" viewBox="0 0 32 42" xmlns="http://www.w3.org/2000/svg" style="display:block;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.35));">
            <path d="M16 0C9.4 0 4 5.4 4 12c0 9 12 30 12 30s12-21 12-30c0-6.6-5.4-12-12-12z"
                  fill="${PICKER_PIN_COLOR}" stroke="white" stroke-width="2"/>
            <circle cx="16" cy="12" r="5" fill="white"/>
          </svg>`
    return L.divIcon({
        html,
        className: "map-pin-icon",
        iconSize: [32, 42],
        iconAnchor: [16, 40],
        popupAnchor: [0, -36],
    })
}

/**
 * Small Leaflet map for picking a location by clicking the map. Used as
 * a companion to {@link LocationAutocomplete} on the create-tournament
 * form: the user can either type and pick from suggestions, OR click
 * somewhere on the map and let us reverse-geocode the point into an
 * address. Both flows ultimately fill the same `location` string in
 * the parent form.
 *
 * <p>Reverse geocoding goes through OSM Nominatim, same as the forward
 * autocomplete, so picks here look identical to picks from the dropdown
 * (same Nominatim display_name format, same coordinate accuracy).
 */
export default function LocationMapPicker({
    value,
    onPick,
    height = "220px",
    minH,
}: {
    /** Pin position. When null/undefined no marker is drawn. */
    value?: { lat: number; lng: number } | null
    /** Fires when the user clicks the map AND the reverse geocode resolves. */
    onPick: (picked: { displayName: string; lat: number; lng: number }) => void
    /**
     * Chakra height value — accepts plain strings like "220px" or responsive
     * objects like {@code { base: "220px", md: "100%" }}. Defaults to a
     * fixed 220px which is the right size for the mobile create-form
     * layout; the parent passes a responsive value when the map needs to
     * fill a side column on desktop.
     */
    height?: string | { base?: string; sm?: string; md?: string; lg?: string }
    /** Optional minimum height — only needed when {@code height="100%"}
     *  to ensure the map doesn't collapse if its parent has no height. */
    minH?: string | number | { base?: string; sm?: string; md?: string; lg?: string }
}) {
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState<string | null>(null)

    // Single shared icon instance — divIcon is cheap to construct but
    // keeping it stable means React's <Marker icon=...> prop doesn't
    // trip its reconciler into rebuilding the underlying L.Marker.
    const pinIcon = useMemo(() => makePickerPinIcon(), [])

    // Default view: Croatia center + a country-wide zoom so the user
    // sees something familiar before they click. Once a `value` exists
    // we zoom in to street level.
    const center: [number, number] = value
        ? [value.lat, value.lng]
        : [44.5, 16.5]
    const zoom = value ? 14 : 7

    async function handleClick(lat: number, lng: number) {
        if (busy) return
        setBusy(true)
        setErr(null)
        try {
            const displayName = await reverseGeocode(lat, lng)
            onPick({ displayName, lat, lng })
        } catch {
            setErr("Greška pri dohvaćanju adrese.")
        } finally {
            setBusy(false)
        }
    }

    return (
        <Box
            position="relative"
            h={height as any}
            minH={minH as any}
            rounded="md"
            overflow="hidden"
            borderWidth="1px"
            borderColor="border.subtle"
        >
            <MapContainer
                center={center}
                zoom={zoom}
                style={{ height: "100%", width: "100%" }}
                // Scroll-wheel zoom enabled to match the /karta map. The
                // +/- control buttons and pinch-zoom on touch work too.
                scrollWheelZoom
            >
                {/* CARTO Voyager basemap — matches the /karta page so the
                    picker and the public map share one visual language
                    (warm beige land, muted blue water, clean labels)
                    instead of the harsher raw OSM tile set. */}
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
                />
                <ClickHandler onClick={handleClick} />
                {/* RecenterOnValue keeps the map's view in sync with the
                    pin position. Without this, react-leaflet only uses
                    `center`/`zoom` on first mount — picking a suggestion
                    from LocationAutocomplete would move the marker
                    off-screen and the user would have to pan manually
                    to find it. */}
                <RecenterOnValue value={value ?? null} />
                {value && (
                    <Marker position={[value.lat, value.lng]} icon={pinIcon} />
                )}
            </MapContainer>

            {/* Click-prompt overlay — small hint at the top so the user
                knows the map is interactive without crowding the tiles.
                Auto-hides once a pin is set. */}
            {!value && (
                <Box
                    position="absolute"
                    top="2"
                    left="2"
                    right="2"
                    bg="bg"
                    px="2.5"
                    py="1.5"
                    rounded="md"
                    shadow="sm"
                    fontSize="xs"
                    fontWeight={600}
                    color="fg.muted"
                    pointerEvents="none"
                    textAlign="center"
                    zIndex={400}
                    css={{
                        backdropFilter: "blur(8px)",
                    }}
                >
                    Klikni na kartu za odabir lokacije
                </Box>
            )}

            {busy && (
                <Box
                    position="absolute"
                    inset="0"
                    bg="blackAlpha.300"
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    pointerEvents="none"
                    zIndex={500}
                >
                    <Text bg="bg" px="3" py="1" rounded="md" fontSize="sm" shadow="md">
                        Tražim adresu…
                    </Text>
                </Box>
            )}
            {err && (
                <Box
                    position="absolute"
                    bottom="2"
                    left="2"
                    right="2"
                    bg="red.subtle"
                    color="red.fg"
                    px="3"
                    py="1"
                    rounded="md"
                    fontSize="xs"
                    zIndex={500}
                >
                    {err}
                </Box>
            )}
        </Box>
    )
}

/**
 * Leaflet click listener. Has to be a child of <MapContainer> because
 * useMapEvents pulls from the map context; rendering it as a sibling
 * silently does nothing.
 */
function ClickHandler({ onClick }: { onClick: (lat: number, lng: number) => void }) {
    useMapEvents({
        click(e) {
            onClick(e.latlng.lat, e.latlng.lng)
        },
    })
    return null
}

/**
 * Imperatively re-centres the map every time {@code value} changes. The
 * {@code <MapContainer>} `center` prop is only honoured on first mount
 * — react-leaflet specifically does NOT reactively call setView when
 * the prop updates, to avoid fighting with user-driven pans. We get
 * around that by reaching into the map instance via {@link useMap} and
 * calling {@code setView} ourselves whenever the picked location moves.
 *
 * <p>Triggers when:
 *   - user picks an autocomplete suggestion (parent updates pickedCoords),
 *   - user clicks the map (we already pan via the click handler's
 *     reverse-geocode flow; this just keeps the two paths consistent).
 *
 * <p>Zoom is bumped to 14 only when transitioning from "no pin" → "pin"
 * so a user who picks something halfway-zoomed-in doesn't get yanked
 * back to street-level after every drag.
 */
function RecenterOnValue({ value }: { value: { lat: number; lng: number } | null }) {
    const map = useMap()
    useEffect(() => {
        if (!value) return
        const currentZoom = map.getZoom()
        // Keep the user's current zoom unless they're at the default
        // "no pin yet" zoom level — then jump to a sensible street-level
        // view so the marker isn't a needle in a country-wide haystack.
        const targetZoom = currentZoom < 10 ? 14 : currentZoom
        map.setView([value.lat, value.lng], targetZoom, { animate: true })
    }, [map, value?.lat, value?.lng])
    return null
}

/**
 * Reverse geocode lat/lng to a Nominatim display_name. Matches the
 * forward-search Accept-Language + addressdetails so the resulting
 * string formats the same way as picks from {@link LocationAutocomplete}.
 *
 * <p>Nominatim's usage policy asks for ≤ 1 request/second per user. The
 * picker is throttled implicitly because the user has to click + wait
 * for the reverse geocode to resolve before they can click again, so
 * we don't need an explicit rate limiter.
 */
async function reverseGeocode(lat: number, lng: number): Promise<string> {
    const url =
        `https://nominatim.openstreetmap.org/reverse?format=json` +
        `&lat=${lat}&lon=${lng}` +
        `&accept-language=hr` +
        `&zoom=18&addressdetails=1`
    const res = await fetch(url, { headers: { Accept: "application/json" } })
    if (!res.ok) throw new Error(`Nominatim reverse ${res.status}`)
    const data = await res.json()
    return (data?.display_name as string) ?? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}
