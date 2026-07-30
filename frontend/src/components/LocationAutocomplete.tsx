import React, { useEffect, useMemo, useRef, useState } from "react"
import { Box, chakra, HStack, Input, Spinner, Text, VStack } from "@chakra-ui/react"
import { FiMapPin } from "react-icons/fi"
import { useTranslation } from "../i18n"

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

/** Subset of a Places API (New) autocomplete `placePrediction` we consume. */
type GooglePrediction = {
    placeId: string
    text?: { text?: string }
    structuredFormat?: {
        mainText?: { text?: string }
        secondaryText?: { text?: string }
    }
}

/**
 * Provider-neutral suggestion the dropdown renders. Nominatim results carry
 * coordinates directly; Google predictions carry a `googlePlaceId` and need
 * one Place Details round-trip on pick to resolve lat/lng.
 */
type Suggestion = {
    key: string
    /** Top line in the dropdown (place name). */
    primary: string
    /** Muted second line (full address for disambiguation). */
    secondary?: string
    /** What the input is filled with on pick. */
    fill: string
    latitude?: number
    longitude?: number
    googlePlaceId?: string
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

// Google Places API (New). The key is optional: when it's absent the
// component silently runs on Nominatim exactly as before. A browser key is
// public by design - it must be locked down by HTTP referrer (and to the
// Places API (New) only) in the Google Cloud console, not treated as a
// secret.
const GOOGLE_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
const GOOGLE_PLACE_URL = "https://places.googleapis.com/v1/places"
const GOOGLE_REGION_CODES = ["hr", "ba", "si", "rs", "me"]
const GOOGLE_API_KEY: string =
    (import.meta.env.VITE_GOOGLE_PLACES_API_KEY as string | undefined)?.trim() ?? ""

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

    // No usable structured fields - fall back to the first 2 segments of
    // the long display_name, which still trims country/postcode tail.
    const parts = r.display_name.split(",").map((s) => s.trim()).filter(Boolean)
    return parts.slice(0, 2).join(", ") || r.display_name
}

function fromNominatim(r: NominatimResult): Suggestion {
    const lat = parseFloat(r.lat)
    const lng = parseFloat(r.lon)
    return {
        key: `n:${r.place_id}`,
        primary: formatNominatimAddress(r),
        secondary: r.display_name,
        // Fill the input with Nominatim's full display_name - postcode,
        // county, country and all. Restored after a brief stint with a
        // shorter formatted label: the verbose form gives WhatsApp shares
        // and the map pin enough context to be unambiguous, and the user
        // can always trim it manually afterwards.
        fill: r.display_name,
        latitude: Number.isFinite(lat) ? lat : undefined,
        longitude: Number.isFinite(lng) ? lng : undefined,
    }
}

function fromGoogle(p: GooglePrediction): Suggestion {
    // `text.text` is the full prediction string the user saw - use it both
    // as the input fill and as the displayName reported to the parent, so
    // what's picked is exactly what's stored.
    const full = p.text?.text ?? p.structuredFormat?.mainText?.text ?? ""
    return {
        key: `g:${p.placeId}`,
        primary: p.structuredFormat?.mainText?.text ?? full,
        secondary: p.structuredFormat?.secondaryText?.text ?? full,
        fill: full,
        googlePlaceId: p.placeId,
    }
}

async function searchNominatim(
    query: string,
    signal?: AbortSignal,
): Promise<Suggestion[]> {
    const url =
        `${NOMINATIM_URL}?format=json&limit=5` +
        `&addressdetails=1` +
        `&countrycodes=${encodeURIComponent(COUNTRY_CODES)}` +
        `&accept-language=hr` +
        `&q=${encodeURIComponent(query)}`

    const r = await fetch(url, { signal, headers: { "Accept": "application/json" } })
    if (!r.ok) throw new Error(`Nominatim ${r.status}`)
    const data = (await r.json()) as NominatimResult[]
    return data.map(fromNominatim)
}

async function searchGoogle(
    query: string,
    sessionToken: string,
    signal?: AbortSignal,
): Promise<Suggestion[]> {
    const r = await fetch(GOOGLE_AUTOCOMPLETE_URL, {
        method: "POST",
        signal,
        headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_API_KEY,
            // Only the prediction fields we actually render.
            "X-Goog-FieldMask":
                "suggestions.placePrediction.placeId," +
                "suggestions.placePrediction.text," +
                "suggestions.placePrediction.structuredFormat",
        },
        body: JSON.stringify({
            input: query,
            languageCode: "hr",
            includedRegionCodes: GOOGLE_REGION_CODES,
            sessionToken,
        }),
    })
    if (!r.ok) throw new Error(`Places autocomplete ${r.status}`)
    const data = (await r.json()) as {
        suggestions?: { placePrediction?: GooglePrediction }[]
    }
    return (data.suggestions ?? [])
        .map((s) => s.placePrediction)
        .filter((p): p is GooglePrediction => Boolean(p?.placeId))
        .slice(0, 5)
        .map(fromGoogle)
}

/**
 * Free-form text input with location suggestions powered by Google Places
 * API (New) when `VITE_GOOGLE_PLACES_API_KEY` is configured, with OpenStreetMap
 * Nominatim as the automatic fallback (no key, or a failed Google request).
 * The user can either pick a suggestion (which fills the input with the
 * suggestion text and reports lat/lng to the parent) or keep typing freely
 * and submit any string - picking is not required.
 *
 * Google cost control: all autocomplete keystrokes of one typing "session"
 * share a random UUID session token, and the same token is passed to the
 * Place Details call fired on pick - that terminates the session, so the
 * keystrokes are covered by session pricing and only Details is billed.
 * A fresh token starts on the first keystroke after a pick.
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
    const t = useTranslation()
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [results, setResults] = useState<Suggestion[]>([])
    const [activeIndex, setActiveIndex] = useState<number>(-1)

    // Keyed `google:{q}` / `nominatim:{q}` so a query answered by the
    // fallback provider never masquerades as a Google result set.
    const cache = useRef<Map<string, Suggestion[]>>(new Map())
    const wrapperRef = useRef<HTMLDivElement | null>(null)
    const abortRef = useRef<AbortController | null>(null)
    // Lazily created on the first Google request of a typing session,
    // cleared when a pick terminates the session via Place Details.
    const sessionTokenRef = useRef<string | null>(null)

    const query = useMemo(() => value.trim(), [value])

    useEffect(() => {
        if (query.length < MIN_CHARS) {
            setResults([])
            setError(null)
            return
        }
        const key = query.toLowerCase()
        const cached =
            (GOOGLE_API_KEY ? cache.current.get(`google:${key}`) : undefined) ??
            cache.current.get(`nominatim:${key}`)
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

            const run = async (): Promise<void> => {
                let data: Suggestion[]
                if (GOOGLE_API_KEY) {
                    sessionTokenRef.current ??= crypto.randomUUID()
                    try {
                        data = await searchGoogle(
                            query, sessionTokenRef.current, controller.signal)
                        cache.current.set(`google:${key}`, data)
                    } catch (e) {
                        if ((e as Error)?.name === "AbortError") throw e
                        // Google down / quota / bad key - degrade to
                        // Nominatim so the field never goes dead.
                        data = await searchNominatim(query, controller.signal)
                        cache.current.set(`nominatim:${key}`, data)
                    }
                } else {
                    data = await searchNominatim(query, controller.signal)
                    cache.current.set(`nominatim:${key}`, data)
                }
                setResults(data)
                setActiveIndex(-1)
            }

            run()
                .catch((e) => {
                    if (e?.name === "AbortError") return
                    setError(t.components.locationAutocomplete.fetchError)
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

    /**
     * Resolve a picked Google prediction to coordinates via Place Details
     * (New). Passing the session token here terminates the autocomplete
     * session (see the component doc comment). The minimal field mask
     * keeps the call on the cheapest Details SKU.
     */
    async function resolveGooglePlace(s: Suggestion) {
        const token = sessionTokenRef.current
        sessionTokenRef.current = null // next keystroke starts a new session
        try {
            const url =
                `${GOOGLE_PLACE_URL}/${encodeURIComponent(s.googlePlaceId!)}` +
                (token ? `?sessionToken=${encodeURIComponent(token)}` : "")
            const r = await fetch(url, {
                headers: {
                    "X-Goog-Api-Key": GOOGLE_API_KEY,
                    "X-Goog-FieldMask": "location,formattedAddress",
                },
            })
            if (!r.ok) throw new Error(`Places details ${r.status}`)
            const data = (await r.json()) as {
                location?: { latitude?: number; longitude?: number }
            }
            const lat = data.location?.latitude
            const lng = data.location?.longitude
            if (typeof lat !== "number" || typeof lng !== "number") {
                throw new Error("Places details: no location")
            }
            onPickSuggestion?.({ displayName: s.fill, latitude: lat, longitude: lng })
        } catch {
            // Details failed - geocode the picked text via Nominatim so
            // the parent still gets coordinates instead of a dead pick.
            try {
                const fallback = await searchNominatim(s.fill)
                const first = fallback[0]
                if (first?.latitude != null && first.longitude != null) {
                    onPickSuggestion?.({
                        displayName: s.fill,
                        latitude: first.latitude,
                        longitude: first.longitude,
                    })
                }
            } catch {
                // Both providers failed - the free-text value still stands.
            }
        }
    }

    function pick(s: Suggestion) {
        onChange(s.fill)
        setOpen(false)
        if (s.googlePlaceId) {
            void resolveGooglePlace(s)
        } else if (s.latitude != null && s.longitude != null) {
            onPickSuggestion?.({
                displayName: s.fill,
                latitude: s.latitude,
                longitude: s.longitude,
            })
        }
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
                            <Text>{t.components.locationAutocomplete.searching}</Text>
                        </HStack>
                    )}

                    {!loading && error && (
                        <Text px="3" py="2" color="red.fg" fontSize="sm">{error}</Text>
                    )}

                    {!loading && !error && results.length === 0 && (
                        <Text px="3" py="2" color="fg.muted" fontSize="sm">
                            {t.components.locationAutocomplete.noResults}
                        </Text>
                    )}

                    {!loading && !error && results.length > 0 && (
                        <VStack align="stretch" gap="0">
                            {results.map((s, i) => (
                                <chakra.button
                                    key={s.key}
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => pick(s)}
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
                                                {s.primary}
                                            </Text>
                                            {s.secondary && (
                                                <Text
                                                    fontSize="2xs"
                                                    color="fg.muted"
                                                    lineHeight="short"
                                                    truncate
                                                >
                                                    {s.secondary}
                                                </Text>
                                            )}
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
