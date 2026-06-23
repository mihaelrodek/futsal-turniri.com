import React, { useEffect, useMemo, useRef, useState } from "react"
import { Box, chakra, HStack, Input, Spinner, Text, VStack } from "@chakra-ui/react"
import { FiMapPin } from "react-icons/fi"

type NominatimAddress = {
    village?: string
    hamlet?: string
    suburb?: string
    neighbourhood?: string
    town?: string
    city?: string
    municipality?: string
    county?: string
    state?: string
    country?: string
    postcode?: string
}

type NominatimResult = {
    place_id: number
    display_name: string
    lat: string
    lon: string
    type?: string
    addresstype?: string
    address?: NominatimAddress
}

export type LocationSuggestion = {
    displayName: string
    latitude: number
    longitude: number
}

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
const COUNTRY_CODES = "hr,ba,si,rs,me"
const MIN_CHARS = 3
const DEBOUNCE_MS = 350

/**
 * Build a short, human-friendly label from a Nominatim address. We deliberately
 * drop postcode, county, and country because:
 *  - Tournament locations are within HR/BA/SI/RS/ME (already filtered) so the
 *    country is redundant.
 *  - Postcodes and counties bloat the label without helping a player decide
 *    whether they want to attend ("Kamenica, Grad Lepoglava" is enough).
 *  - The same string ends up in WhatsApp shares (og:title), where length
 *    matters even more.
 *
 * Order of preference for the "place" part:
 *   village → hamlet → suburb → neighbourhood → town → city
 * Then we append the municipality (or city/town as fallback) when it's
 * different from the place itself.
 */
export function formatNominatimAddress(r: NominatimResult): string {
    const a = r.address
    if (!a) return r.display_name

    const place =
        a.village ?? a.hamlet ?? a.suburb ?? a.neighbourhood ?? a.town ?? a.city
    const region = a.municipality ?? a.city ?? a.town

    if (place && region && place.toLowerCase() !== region.toLowerCase()) {
        return `${place}, ${region}`
    }
    if (place) return place
    if (region) return region

    // No usable structured fields — fall back to the first 2 segments of
    // the long display_name, which still trims country/postcode tail.
    const parts = r.display_name.split(",").map((s) => s.trim()).filter(Boolean)
    return parts.slice(0, 2).join(", ") || r.display_name
}

/**
 * Free-form text input with location suggestions powered by OpenStreetMap
 * Nominatim. The user can either pick a suggestion (which fills the input
 * with the formatted address and reports lat/lng to the parent) or keep
 * typing freely and submit any string — picking is not required.
 */
export function LocationAutocomplete({
    value,
    onChange,
    onPickSuggestion,
    placeholder,
    disabled,
}: {
    value: string
    onChange: (value: string) => void
    onPickSuggestion?: (s: LocationSuggestion) => void
    placeholder?: string
    disabled?: boolean
}) {
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [results, setResults] = useState<NominatimResult[]>([])
    const [activeIndex, setActiveIndex] = useState<number>(-1)

    const cache = useRef<Map<string, NominatimResult[]>>(new Map())
    const wrapperRef = useRef<HTMLDivElement | null>(null)
    const abortRef = useRef<AbortController | null>(null)

    const query = useMemo(() => value.trim(), [value])

    useEffect(() => {
        if (query.length < MIN_CHARS) {
            setResults([])
            setError(null)
            return
        }
        const key = query.toLowerCase()
        const cached = cache.current.get(key)
        if (cached) {
            setResults(cached)
            setError(null)
            return
        }

        const handle = setTimeout(() => {
            abortRef.current?.abort()
            const controller = new AbortController()
            abortRef.current = controller

            setLoading(true)
            setError(null)

            const url =
                `${NOMINATIM_URL}?format=json&limit=5` +
                `&addressdetails=1` +
                `&countrycodes=${encodeURIComponent(COUNTRY_CODES)}` +
                `&accept-language=hr` +
                `&q=${encodeURIComponent(query)}`

            fetch(url, {
                signal: controller.signal,
                headers: { "Accept": "application/json" },
            })
                .then((r) => {
                    if (!r.ok) throw new Error(`Nominatim ${r.status}`)
                    return r.json() as Promise<NominatimResult[]>
                })
                .then((data) => {
                    cache.current.set(key, data)
                    setResults(data)
                    setActiveIndex(-1)
                })
                .catch((e) => {
                    if (e?.name === "AbortError") return
                    setError("Greška pri dohvaćanju prijedloga.")
                    setResults([])
                })
                .finally(() => setLoading(false))
        }, DEBOUNCE_MS)

        return () => clearTimeout(handle)
    }, [query])

    useEffect(() => {
        function onDocClick(e: MouseEvent) {
            if (!wrapperRef.current) return
            if (!wrapperRef.current.contains(e.target as Node)) {
                setOpen(false)
            }
        }
        document.addEventListener("mousedown", onDocClick)
        return () => document.removeEventListener("mousedown", onDocClick)
    }, [])

    function pick(r: NominatimResult) {
        const lat = parseFloat(r.lat)
        const lng = parseFloat(r.lon)
        // Fill the input with Nominatim's full display_name — postcode,
        // county, country and all. Restored after a brief stint with a
        // shorter formatted label: the verbose form gives WhatsApp shares
        // and the map pin enough context to be unambiguous, and the user
        // can always trim it manually afterwards.
        onChange(r.display_name)
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            onPickSuggestion?.({ displayName: r.display_name, latitude: lat, longitude: lng })
        }
        setOpen(false)
    }

    function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (!open || results.length === 0) return
        if (e.key === "ArrowDown") {
            e.preventDefault()
            setActiveIndex((i) => Math.min(results.length - 1, i + 1))
        } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setActiveIndex((i) => Math.max(0, i - 1))
        } else if (e.key === "Enter") {
            if (activeIndex >= 0 && activeIndex < results.length) {
                e.preventDefault()
                pick(results[activeIndex])
            }
        } else if (e.key === "Escape") {
            setOpen(false)
        }
    }

    const showDropdown =
        open &&
        query.length >= MIN_CHARS &&
        (loading || results.length > 0 || error)

    return (
        <Box position="relative" ref={wrapperRef} w="full">
            <Input
                value={value}
                onChange={(e) => {
                    onChange(e.target.value)
                    setOpen(true)
                }}
                onFocus={() => setOpen(true)}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                disabled={disabled}
                autoComplete="off"
            />

            {showDropdown && (
                <Box
                    position="absolute"
                    top="calc(100% + 4px)"
                    left="0"
                    right="0"
                    // Must beat Leaflet's internal pane stack (controls go
                    // up to 1000) so the suggestions dropdown floats over
                    // the map picker that sits next to this input on the
                    // create-tournament form. 1100 also keeps us under any
                    // application-level modal (Chakra Dialog uses ~1400),
                    // so a dialog opened from within the form still wins.
                    zIndex={1100}
                    bg="bg"
                    borderWidth="1px"
                    borderColor="border.emphasized"
                    rounded="md"
                    shadow="lg"
                    maxH="280px"
                    overflowY="auto"
                >
                    {loading && (
                        <HStack px="3" py="2" gap="2" color="fg.muted" fontSize="sm">
                            <Spinner size="xs" />
                            <Text>Tražim…</Text>
                        </HStack>
                    )}

                    {!loading && error && (
                        <Text px="3" py="2" color="red.fg" fontSize="sm">{error}</Text>
                    )}

                    {!loading && !error && results.length === 0 && (
                        <Text px="3" py="2" color="fg.muted" fontSize="sm">
                            Nema rezultata.
                        </Text>
                    )}

                    {!loading && !error && results.length > 0 && (
                        <VStack align="stretch" gap="0">
                            {results.map((r, i) => (
                                <chakra.button
                                    key={r.place_id}
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => pick(r)}
                                    onMouseEnter={() => setActiveIndex(i)}
                                    px="3"
                                    py="2"
                                    textAlign="left"
                                    width="full"
                                    bg={i === activeIndex ? "bg.muted" : "transparent"}
                                    cursor="pointer"
                                    borderTopWidth={i === 0 ? "0" : "1px"}
                                    borderColor="border.subtle"
                                    _hover={{ bg: "bg.muted" }}
                                >
                                    <HStack gap="2" align="start">
                                        <Box color="fg.muted" mt="0.5" flexShrink={0}>
                                            <FiMapPin size={12} />
                                        </Box>
                                        <VStack gap="0" align="stretch" flex="1" minW="0">
                                            <Text fontSize="sm" lineHeight="short">
                                                {formatNominatimAddress(r)}
                                            </Text>
                                            <Text
                                                fontSize="2xs"
                                                color="fg.muted"
                                                lineHeight="short"
                                                truncate
                                            >
                                                {r.display_name}
                                            </Text>
                                        </VStack>
                                    </HStack>
                                </chakra.button>
                            ))}
                        </VStack>
                    )}
                </Box>
            )}
        </Box>
    )
}
