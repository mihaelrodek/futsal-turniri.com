import { useEffect, useRef, useState, type ReactNode } from "react"
import {
    Badge,
    Box,
    Button,
    Card,
    HStack,
    Input,
    NativeSelect,
    Stack,
    Text,
    chakra,
} from "@chakra-ui/react"
import {
    FiCheckCircle,
    FiEye,
    FiMonitor,
    FiPause,
    FiPlay,
    FiPower,
    FiTrash2,
    FiUpload,
    FiVideo,
} from "react-icons/fi"
import { adminListTournaments, type AdminTournamentDto } from "../api/admin"
import { fetchStreamBanner, setStreamBanner, type StreamState } from "../api/streamBanner"
import {
    deleteStreamAd,
    fetchStreamAds,
    uploadStreamAd,
    type AdMedia,
    type AdPurpose,
} from "../api/streamAds"

/* ──────────────────────────────────────────────────────────────────────────
   LiveStreamAdminTab - the admin-profile "Live stream" tab. Controls the
   site-wide home-page stream banner: its state (STREAMING | PAUSED | ADS |
   OFF), the linked tournament, an ad library (shown in ADS mode) and an
   overlay library (media drawn CENTRED over the live video, toggled by the
   admin - e.g. a halftime graphic). The active ad + overlay are references on
   the banner; both media libraries live in MinIO.
   ────────────────────────────────────────────────────────────────────────── */

const STATE_META: Record<
    StreamState,
    { label: string; badge: string; palette: string; solid: boolean; desc: string }
> = {
    STREAMING: {
        label: "Prijenos uživo",
        badge: "● UŽIVO",
        palette: "red",
        solid: true,
        desc: "Video kamere zamjenjuje promo bannere na vrhu glavne stranice.",
    },
    PAUSED: {
        label: "Pauzirano",
        badge: "Pauzirano",
        palette: "orange",
        solid: false,
        desc: "Gledatelji vide poruku da je stream trenutno pauziran. Prijenos se uskoro nastavlja.",
    },
    ADS: {
        label: "Reklame",
        badge: "Reklama",
        palette: "purple",
        solid: false,
        desc: "Umjesto prijenosa prikazuje se odabrana aktivna reklama iz baze (slika ili video).",
    },
    OFF: {
        label: "Ugašen",
        badge: "Ugašen",
        palette: "gray",
        solid: false,
        desc: "Prijenos je ugašen — prikazuju se zadani promo baneri. URL ostaje spremljen.",
    },
}

export default function LiveStreamAdminTab() {
    const [url, setUrl] = useState("")
    const [state, setState] = useState<StreamState>("OFF")
    const [tournamentUuid, setTournamentUuid] = useState("")
    const [tournaments, setTournaments] = useState<AdminTournamentDto[]>([])
    const [loaded, setLoaded] = useState(false)
    const [busy, setBusy] = useState<string | null>(null)
    const [err, setErr] = useState<string | null>(null)

    // The two media libraries + the active selections referenced by the banner.
    const [ads, setAds] = useState<AdMedia[]>([])
    const [overlays, setOverlays] = useState<AdMedia[]>([])
    const [adId, setAdId] = useState<number | null>(null)
    const [overlayId, setOverlayId] = useState<number | null>(null)

    useEffect(() => {
        let cancelled = false
        fetchStreamBanner()
            .then((b) => {
                if (cancelled) return
                setUrl(b.url ?? "")
                setState(b.state)
                setTournamentUuid(b.tournamentUuid ?? "")
                setAdId(b.adId)
                setOverlayId(b.overlayId)
            })
            .catch(() => { /* toast via interceptor */ })
            .finally(() => { if (!cancelled) setLoaded(true) })
        adminListTournaments()
            .then((rows) => { if (!cancelled) setTournaments(rows) })
            .catch(() => { /* handled by http toaster */ })
        fetchStreamAds("AD").then((r) => { if (!cancelled) setAds(r) }).catch(() => {})
        fetchStreamAds("OVERLAY").then((r) => { if (!cancelled) setOverlays(r) }).catch(() => {})
        return () => { cancelled = true }
    }, [])

    /** Persist the banner with a patch (state / active ad / active overlay);
     *  everything not in the patch keeps its current value. */
    async function save(patch: { state?: StreamState; adId?: number | null; overlayId?: number | null; busyKey: string }) {
        const s = patch.state ?? state
        const a = patch.adId !== undefined ? patch.adId : adId
        const o = patch.overlayId !== undefined ? patch.overlayId : overlayId
        const trimmed = url.trim()
        if (s === "STREAMING" && !trimmed) {
            setErr("Zalijepi URL prijenosa prije pokretanja.")
            return
        }
        if (trimmed && !/^https?:\/\//i.test(trimmed)) {
            setErr("URL mora počinjati s http:// ili https://")
            return
        }
        setErr(null)
        setBusy(patch.busyKey)
        try {
            const b = await setStreamBanner(trimmed || null, s, tournamentUuid || null, a, o)
            setUrl(b.url ?? "")
            setState(b.state)
            setTournamentUuid(b.tournamentUuid ?? "")
            setAdId(b.adId)
            setOverlayId(b.overlayId)
        } catch {
            // Error toasted by the http interceptor.
        } finally {
            setBusy(null)
        }
    }

    async function uploadMedia(purpose: AdPurpose, file: File, label: string) {
        setBusy(`up:${purpose}`)
        try {
            await uploadStreamAd(file, label, purpose)
            const list = await fetchStreamAds(purpose)
            if (purpose === "AD") setAds(list)
            else setOverlays(list)
        } catch {
            // Error toasted by the http interceptor.
        } finally {
            setBusy(null)
        }
    }

    async function deleteMedia(purpose: AdPurpose, id: number) {
        if (!window.confirm(purpose === "OVERLAY" ? "Obrisati ovaj overlay?" : "Obrisati ovu reklamu?")) return
        setBusy(`del:${id}`)
        try {
            await deleteStreamAd(id)
            const list = await fetchStreamAds(purpose)
            if (purpose === "AD") {
                setAds(list)
                if (adId === id) setAdId(null)
            } else {
                setOverlays(list)
                if (overlayId === id) setOverlayId(null)
            }
        } catch {
            // Error toasted by the http interceptor.
        } finally {
            setBusy(null)
        }
    }

    const meta = STATE_META[state]
    const stateButtons: { key: StreamState; label: string; icon: ReactNode; palette: string }[] = [
        { key: "STREAMING", label: state === "STREAMING" ? "Spremi promjene" : "Pokreni prijenos", icon: <FiPlay />, palette: "green" },
        { key: "PAUSED", label: "Pauziraj", icon: <FiPause />, palette: "orange" },
        { key: "ADS", label: "Reklame", icon: <FiMonitor />, palette: "purple" },
        { key: "OFF", label: "Ugasi", icon: <FiPower />, palette: "gray" },
    ]

    return (
        <Stack gap="4">
            <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
                <Card.Body p={{ base: "4", md: "6" }}>
                    <Stack gap="4">
                        <HStack justify="space-between" align="flex-start" wrap="wrap" gap="2">
                            <Box>
                                <HStack gap="2">
                                    <Box color="fg.muted" display="inline-flex"><FiVideo size={16} /></Box>
                                    <Text fontSize="lg" fontWeight="semibold">Live stream - banner na glavnoj</Text>
                                </HStack>
                                <Text fontSize="sm" color="fg.muted" mt="1">
                                    Upravljaj prijenosom uživo na vrhu glavne stranice. Podržano: YouTube
                                    link, HLS .m3u8, MP4 ili embed stranica.
                                </Text>
                            </Box>
                            <Badge colorPalette={meta.palette} variant={meta.solid ? "solid" : "surface"} rounded="full" px="2.5">
                                {meta.badge}
                            </Badge>
                        </HStack>

                        <Box>
                            <Text fontSize="xs" fontWeight="medium" color="fg.muted" mb="1">URL prijenosa</Text>
                            <Input
                                placeholder="https://…"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                disabled={busy != null || !loaded}
                            />
                        </Box>

                        <Box>
                            <Text fontSize="xs" fontWeight="medium" color="fg.muted" mb="1">
                                Poveži s turnirom (za tijek utakmice + tablicu skupine)
                            </Text>
                            <NativeSelect.Root size="sm" disabled={busy != null || !loaded}>
                                <NativeSelect.Field
                                    value={tournamentUuid}
                                    onChange={(e) => setTournamentUuid(e.currentTarget.value)}
                                >
                                    <option value="">Bez povezanog turnira</option>
                                    {tournaments.map((t) => (
                                        <option key={t.id} value={t.uuid ?? ""}>
                                            {t.name}
                                            {t.location ? ` · ${t.location}` : ""}
                                        </option>
                                    ))}
                                </NativeSelect.Field>
                                <NativeSelect.Indicator />
                            </NativeSelect.Root>
                        </Box>

                        {err && <Text fontSize="xs" color="red.fg" fontWeight={600}>{err}</Text>}

                        <Box p="3" bg="bg.muted" rounded="md" borderWidth="1px" borderColor="border.subtle">
                            <Text fontSize="xs" color="fg.muted">TRENUTNO STANJE</Text>
                            <Text fontSize="sm" fontWeight="medium">{meta.label}</Text>
                            <Text fontSize="xs" color="fg.muted" mt="1" lineHeight="1.4">{meta.desc}</Text>
                        </Box>

                        <HStack gap="2" wrap="wrap">
                            {stateButtons.map((b) => {
                                const active = b.key === state
                                const disabled = !loaded || busy != null || (b.key === "STREAMING" && !url.trim())
                                return (
                                    <Button
                                        key={b.key}
                                        size="sm"
                                        variant={active ? "solid" : "outline"}
                                        colorPalette={b.palette}
                                        disabled={disabled}
                                        loading={busy === b.key}
                                        onClick={() => save({ state: b.key, busyKey: b.key })}
                                    >
                                        {b.icon} {b.label}
                                    </Button>
                                )
                            })}
                        </HStack>
                    </Stack>
                </Card.Body>
            </Card.Root>

            {/* Ad library - shown in ADS mode. */}
            <MediaLibrary
                icon={<FiMonitor size={16} />}
                title="Baza reklama"
                desc="Dodaj sliku ili kratki video. Označi jednu kao aktivnu - prikazuje se na glavnoj u stanju Reklame (slika stalno, video u petlji)."
                purpose="AD"
                items={ads}
                activeId={adId}
                palette="purple"
                inactiveVerb="Postavi"
                inactiveIcon={<FiCheckCircle />}
                activeVerb="Ukloni aktivnu"
                activeBadge="aktivna"
                busy={busy}
                onUpload={(f, l) => uploadMedia("AD", f, l)}
                onToggle={(id) => save({ adId: id, busyKey: "ad" })}
                toggleBusyKey="ad"
                onDelete={(id) => deleteMedia("AD", id)}
            />

            {/* Overlay library - drawn centred OVER the live video. */}
            <MediaLibrary
                icon={<FiEye size={16} />}
                title="Baza overlaya"
                desc="Slika ili video koji se prikazuje PREKO videa (utakmica ostaje u pozadini) - npr. na poluvremenu. Klikni Prikaži da se pojavi svima uživo, a Sakrij da nestane. Radi dok je prijenos aktivan."
                purpose="OVERLAY"
                items={overlays}
                activeId={overlayId}
                palette="blue"
                inactiveVerb="Prikaži"
                inactiveIcon={<FiEye />}
                activeVerb="Sakrij"
                activeBadge="prikazano"
                busy={busy}
                onUpload={(f, l) => uploadMedia("OVERLAY", f, l)}
                onToggle={(id) => save({ overlayId: id, busyKey: "overlay" })}
                toggleBusyKey="overlay"
                onDelete={(id) => deleteMedia("OVERLAY", id)}
            />
        </Stack>
    )
}

/** One media library card (upload + list + active-toggle + delete). Shared by
 *  the ad and overlay sections; the parent owns the actual mutations. */
function MediaLibrary({
    icon,
    title,
    desc,
    purpose,
    items,
    activeId,
    palette,
    inactiveVerb,
    inactiveIcon,
    activeVerb,
    activeBadge,
    busy,
    toggleBusyKey,
    onUpload,
    onToggle,
    onDelete,
}: {
    icon: ReactNode
    title: string
    desc: string
    purpose: AdPurpose
    items: AdMedia[]
    activeId: number | null
    palette: string
    inactiveVerb: string
    inactiveIcon: ReactNode
    activeVerb: string
    activeBadge: string
    busy: string | null
    toggleBusyKey: string
    onUpload: (file: File, label: string) => Promise<void>
    onToggle: (id: number | null) => void
    onDelete: (id: number) => void
}) {
    const [label, setLabel] = useState("")
    const fileRef = useRef<HTMLInputElement>(null)
    const uploadKey = `up:${purpose}`

    async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
        const f = e.target.files?.[0]
        e.target.value = ""
        if (!f) return
        await onUpload(f, label)
        setLabel("")
    }

    return (
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Body p={{ base: "4", md: "6" }}>
                <Stack gap="4">
                    <Box>
                        <HStack gap="2">
                            <Box color="fg.muted" display="inline-flex">{icon}</Box>
                            <Text fontSize="lg" fontWeight="semibold">{title}</Text>
                        </HStack>
                        <Text fontSize="sm" color="fg.muted" mt="1">{desc}</Text>
                    </Box>

                    <HStack gap="2" wrap="wrap">
                        <Input
                            size="sm"
                            flex="1"
                            minW="180px"
                            placeholder="Naziv (opcionalno)"
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                            disabled={busy != null}
                        />
                        <chakra.input
                            ref={fileRef}
                            type="file"
                            accept="image/*,video/*"
                            display="none"
                            onChange={handleFile}
                        />
                        <Button
                            size="sm"
                            colorPalette={palette}
                            loading={busy === uploadKey}
                            disabled={busy != null}
                            onClick={() => fileRef.current?.click()}
                        >
                            <FiUpload /> Dodaj
                        </Button>
                    </HStack>

                    {items.length === 0 ? (
                        <Text fontSize="sm" color="fg.muted">Još nema dodanih.</Text>
                    ) : (
                        <Stack gap="2">
                            {items.map((m) => {
                                const active = m.id === activeId
                                return (
                                    <HStack
                                        key={m.id}
                                        gap="3"
                                        p="2"
                                        rounded="md"
                                        borderWidth="1px"
                                        borderColor={active ? `${palette}.emphasized` : "border.subtle"}
                                        bg={active ? `${palette}.subtle` : "transparent"}
                                    >
                                        <Box w="72px" h="48px" rounded="sm" overflow="hidden" bg="bg.muted" flexShrink={0}>
                                            {m.mediaType === "VIDEO" ? (
                                                <chakra.video src={m.url} muted playsInline preload="metadata" w="full" h="full" css={{ objectFit: "cover" }} />
                                            ) : (
                                                <chakra.img src={m.url} alt={m.label ?? ""} w="full" h="full" css={{ objectFit: "cover" }} />
                                            )}
                                        </Box>
                                        <Box minW="0" flex="1">
                                            <HStack gap="2">
                                                <Text fontSize="sm" fontWeight="medium" truncate>
                                                    {m.label || (m.mediaType === "VIDEO" ? "Video" : "Slika")}
                                                </Text>
                                                {active && (
                                                    <Badge size="xs" colorPalette={palette} variant="solid">{activeBadge}</Badge>
                                                )}
                                            </HStack>
                                            <Text fontSize="xs" color="fg.muted">
                                                {m.mediaType === "VIDEO" ? "Video" : "Slika"}
                                            </Text>
                                        </Box>
                                        {active ? (
                                            <Button size="xs" variant="ghost" colorPalette="gray" loading={busy === toggleBusyKey} disabled={busy != null} onClick={() => onToggle(null)}>
                                                {activeVerb}
                                            </Button>
                                        ) : (
                                            <Button size="xs" variant="outline" colorPalette={palette} loading={busy === toggleBusyKey} disabled={busy != null} onClick={() => onToggle(m.id)}>
                                                {inactiveIcon} {inactiveVerb}
                                            </Button>
                                        )}
                                        <Button size="xs" variant="ghost" colorPalette="red" loading={busy === `del:${m.id}`} disabled={busy != null} onClick={() => onDelete(m.id)}>
                                            <FiTrash2 />
                                        </Button>
                                    </HStack>
                                )
                            })}
                        </Stack>
                    )}
                </Stack>
            </Card.Body>
        </Card.Root>
    )
}
