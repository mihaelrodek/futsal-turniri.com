import { useEffect, useState } from "react"
import { Box, Button, HStack, Input, NativeSelect, Spinner, Text, VStack } from "@chakra-ui/react"
import { FiCheck, FiClock, FiLink, FiPause, FiPlay, FiRadio, FiSlash, FiSquare, FiUsers } from "react-icons/fi"

import {
    fetchSpectoBroadcast,
    fetchSpectoConnection,
    fetchSpectoStatus,
    linkSpectoStream,
    saveSpectoConnection,
    sendSpectoLineup,
    startSpectoBroadcast,
    startSpectoTimer,
    stopSpectoBroadcast,
    stopSpectoTimer,
    verifySpectoStream,
    type SpectoBroadcast,
    type SpectoConnection,
} from "../api/spectoStream"
import { adminListTournaments, type AdminTournamentDto } from "../api/admin"
import SpectoEmbed from "./SpectoEmbed"
import { MonoLabel, SectionCard, StatusChip } from "../ui/pitch"
import { showError } from "../toaster"

/* ──────────────────────────────────────────────────────────────────────────
   SpectoConnectionCard - the admin "Live stream" tab.

   Connects the app to an EXISTING SpectoStream broadcast - nothing is ever
   created or provisioned here. Three inputs, one flow:

     1. Platform URL + API key → saved SITE-WIDE (app_settings). They win over
        the server's .env (`specto.base-url` / `specto.api-key`) and apply
        immediately - the key can be set/rotated here without a restart.
     2. Stream ID (from the platform's dashboard) → attached to the CHOSEN
        tournament. The zapisnik then relays its live events to that stream,
        and "Poveži i prikaži" mounts the platform player right below.

   Picking a tournament that is already linked prefills its stream id and
   mounts the player immediately, so the admin can see what's live at a
   glance. The API key is WRITE-ONLY: the server never returns it, only
   whether one is set, its source and the last four characters; an empty
   field on save KEEPS the stored key.
   ────────────────────────────────────────────────────────────────────── */

export default function SpectoConnectionCard() {
    const [conn, setConn] = useState<SpectoConnection | null>(null)
    const [loading, setLoading] = useState(true)
    const [baseUrl, setBaseUrl] = useState("")
    const [apiKey, setApiKey] = useState("")
    const [streamId, setStreamId] = useState("")
    const [busy, setBusy] = useState(false)
    /** Stream id currently mounted in the preview player (null = nothing). */
    const [preview, setPreview] = useState<string | null>(null)

    /* Tournament picker - the stream is attached to this tournament. */
    const [tournaments, setTournaments] = useState<AdminTournamentDto[]>([])
    const [tournamentUuid, setTournamentUuid] = useState("")
    /** Whether THIS tournament's stream is the live home-page banner. */
    const [broadcast, setBroadcast] = useState<SpectoBroadcast | null>(null)

    /* Standalone countdown ("do početka"). The platform API only has
       start/stop, so PAUSE is done client-side: stop the chip and keep the
       remaining seconds, then restart from those on resume. `endsAt` is the
       wall-clock instant it would hit 0 while running. */
    const [timerMin, setTimerMin] = useState("12")
    const [timerEndsAt, setTimerEndsAt] = useState<number | null>(null)
    const [timerLeft, setTimerLeft] = useState<number | null>(null)
    /** Bumped once a second while the countdown runs, purely to re-render. */
    const [, setTick] = useState(0)

    /** Seconds still to run, whether the chip is running or paused. */
    const remainingSecs = timerEndsAt != null
        ? Math.max(0, Math.round((timerEndsAt - Date.now()) / 1000))
        : (timerLeft ?? 0)

    useEffect(() => {
        let cancelled = false
        fetchSpectoConnection()
            .then((c) => {
                if (cancelled) return
                setConn(c)
                setBaseUrl(c.baseUrl)
            })
            .catch(() => { /* interceptor toasts */ })
            .finally(() => { if (!cancelled) setLoading(false) })
        adminListTournaments()
            .then((rows) => { if (!cancelled) setTournaments(rows) })
            .catch(() => { /* interceptor toasts */ })
        return () => { cancelled = true }
    }, [])

    // Selecting an already-linked tournament prefills its SAVED stream id,
    // mounts the player and reflects whether it is currently broadcasting - so
    // a previously made link survives a reload instead of looking unset.
    useEffect(() => {
        if (!tournamentUuid) { setPreview(null); setBroadcast(null); return }
        let cancelled = false
        fetchSpectoStatus(tournamentUuid)
            .then((s) => {
                if (cancelled) return
                setStreamId(s.streamId ?? "")
                setPreview(s.streamId ?? null)
            })
            .catch(() => { /* interceptor toasts */ })
        fetchSpectoBroadcast(tournamentUuid)
            .then((b) => { if (!cancelled) setBroadcast(b) })
            .catch(() => { /* interceptor toasts */ })
        return () => { cancelled = true }
    }, [tournamentUuid])

    /** Start broadcasting: camera on (overlay) + this stream on the home page. */
    async function startBroadcast() {
        if (!tournamentUuid) return
        setBusy(true)
        try {
            setBroadcast(await startSpectoBroadcast(tournamentUuid))
        } catch {
            /* interceptor toasts */
        } finally {
            setBusy(false)
        }
    }

    /** Stop broadcasting: camera off + banner out of STREAMING (url is kept). */
    async function stopBroadcast() {
        if (!tournamentUuid) return
        setBusy(true)
        try {
            setBroadcast(await stopSpectoBroadcast(tournamentUuid))
        } catch {
            /* interceptor toasts */
        } finally {
            setBusy(false)
        }
    }

    /** Save settings → verify the EXISTING stream is reachable → attach it to
     *  the tournament → mount the player. No provisioning anywhere: a bad id
     *  fails the verify step instead of silently creating a new stream. */
    async function connect() {
        const id = streamId.trim()
        if (!id) {
            showError("Nedostaje Stream ID", "Upiši ID postojećeg streama s platforme.")
            return
        }
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
            showError("Neispravan Stream ID", "Upiši samo Stream ID s platforme, bez URL-a ili embed koda.")
            return
        }
        if (!tournamentUuid) {
            showError("Nedostaje turnir", "Odaberi turnir kojem se stream pridružuje.")
            return
        }
        setBusy(true)
        try {
            const saved = await saveSpectoConnection({
                baseUrl: baseUrl.trim(),
                // Empty → keep whatever is stored (never wipes the secret).
                apiKey: apiKey.trim() || undefined,
            })
            setConn(saved)
            setApiKey("")

            const check = await verifySpectoStream(id)
            if (!check.ok) {
                showError("Stream nije dostupan", check.reason ?? "Provjeri URL, ključ i Stream ID.")
                return
            }
            await linkSpectoStream(tournamentUuid, id)
            setPreview(id)
            setBroadcast(await fetchSpectoBroadcast(tournamentUuid))
        } catch {
            /* interceptor toasts the HTTP error */
        } finally {
            setBusy(false)
        }
    }

    // Re-render once a second while the countdown runs so the readout ticks;
    // when it reaches 0 settle to a stopped 0:00 (the chip freezes there too).
    useEffect(() => {
        if (timerEndsAt == null) return
        const id = window.setInterval(() => {
            if (Date.now() >= timerEndsAt) {
                setTimerEndsAt(null)
                setTimerLeft(0)
            } else {
                setTick((n) => n + 1)
            }
        }, 1000)
        return () => window.clearInterval(id)
    }, [timerEndsAt])

    /** Send the current match's squads (live match, else next scheduled). */
    async function pushLineup() {
        if (!tournamentUuid) return
        setBusy(true)
        try {
            await sendSpectoLineup(tournamentUuid)
        } catch {
            /* interceptor toasts */
        } finally {
            setBusy(false)
        }
    }

    /** START the countdown from the entered minutes (or resume the remainder). */
    async function timerStart() {
        if (!tournamentUuid) return
        const secs = timerLeft != null && timerLeft > 0
            ? timerLeft // resuming a paused countdown
            : Math.round((parseFloat(timerMin.replace(",", ".")) || 0) * 60)
        if (secs < 1 || secs > 3600) {
            showError("Neispravno trajanje", "Odbrojavanje mora biti između 1 s i 60 min.")
            return
        }
        setBusy(true)
        try {
            await startSpectoTimer(tournamentUuid, secs)
            setTimerEndsAt(Date.now() + secs * 1000)
            setTimerLeft(null)
        } catch {
            /* interceptor toasts */
        } finally {
            setBusy(false)
        }
    }

    /** PAUSE - the API has no pause, so clear the chip and keep the remainder. */
    async function timerPause() {
        if (!tournamentUuid || timerEndsAt == null) return
        const left = remainingSecs
        setBusy(true)
        try {
            await stopSpectoTimer(tournamentUuid, true)
            setTimerEndsAt(null)
            setTimerLeft(left)
        } catch {
            /* interceptor toasts */
        } finally {
            setBusy(false)
        }
    }

    /** STOP - clear the chip and forget the remainder. */
    async function timerStop() {
        if (!tournamentUuid) return
        setBusy(true)
        try {
            await stopSpectoTimer(tournamentUuid)
            setTimerEndsAt(null)
            setTimerLeft(null)
        } catch {
            /* interceptor toasts */
        } finally {
            setBusy(false)
        }
    }

    /** Drop the DB-stored key so the server falls back to its .env value. */
    async function clearKey() {
        setBusy(true)
        try {
            const saved = await saveSpectoConnection({ baseUrl: baseUrl.trim(), clearApiKey: true })
            setConn(saved)
            setApiKey("")
        } catch {
            /* interceptor toasts */
        } finally {
            setBusy(false)
        }
    }

    if (loading) {
        return (
            <SectionCard icon={FiRadio} title="Live stream - povezivanje">
                <HStack gap="2" color="fg.muted"><Spinner size="sm" /><Text fontSize="sm">Učitavam…</Text></HStack>
            </SectionCard>
        )
    }

    const keyStatus = conn?.apiKeySet
        ? `${conn.apiKeyFromDb ? "spremljen ovdje" : "iz .env-a"} · ${conn.apiKeyHint ?? ""}`
        : "nije postavljen"

    return (
        <SectionCard
            icon={FiRadio}
            title="Live stream - povezivanje"
            action={
                <StatusChip
                    status={conn?.apiKeySet ? "active" : "draft"}
                    label={conn?.apiKeySet ? "Ključ postavljen" : "Bez ključa"}
                    size="sm"
                />
            }
        >
            <VStack align="stretch" gap="4">
                <Text fontSize="sm" color="fg.muted">
                    Spaja se na <b>postojeći</b> stream s platforme - ovdje se ništa ne
                    kreira. URL i ključ vrijede za cijelu aplikaciju i primjenjuju se
                    odmah, bez restarta; Stream ID se pridružuje odabranom turniru.
                </Text>

                <Box>
                    <MonoLabel mb="1.5" display="block">URL PLATFORME</MonoLabel>
                    <Input
                        size="sm"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder="https://stream.safeflow.hr"
                        fontFamily="mono"
                        fontSize="13px"
                    />
                </Box>

                <Box>
                    <MonoLabel mb="1.5" display="block">API KLJUČ</MonoLabel>
                    <Input
                        size="sm"
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder="Ostavi prazno da zadržiš postojeći"
                        autoComplete="off"
                        fontFamily="mono"
                        fontSize="13px"
                    />
                    <HStack justify="space-between" mt="1.5" gap="2" wrap="wrap">
                        <Text fontSize="xs" color="fg.muted">Trenutno: {keyStatus}</Text>
                        {conn?.apiKeyFromDb && (
                            <Button size="2xs" variant="ghost" colorPalette="gray" onClick={clearKey} disabled={busy}>
                                <FiSlash /> Obriši spremljeni ključ
                            </Button>
                        )}
                    </HStack>
                </Box>

                <Box>
                    <MonoLabel mb="1.5" display="block">TURNIR</MonoLabel>
                    <NativeSelect.Root size="sm" disabled={busy}>
                        <NativeSelect.Field
                            value={tournamentUuid}
                            onChange={(e) => setTournamentUuid(e.currentTarget.value)}
                        >
                            <option value="">Odaberi turnir…</option>
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

                <Box>
                    <MonoLabel mb="1.5" display="block">STREAM ID</MonoLabel>
                    <Input
                        size="sm"
                        value={streamId}
                        onChange={(e) => setStreamId(e.target.value)}
                        placeholder="npr. d56e721b"
                        fontFamily="mono"
                        fontSize="13px"
                    />
                </Box>

                <HStack gap="2" wrap="wrap">
                    <Button size="sm" colorPalette="pitch" onClick={connect} loading={busy}>
                        <FiLink /> Poveži i prikaži
                    </Button>
                    {preview && (
                        <Button size="sm" variant="outline" colorPalette="gray" onClick={() => setPreview(null)} disabled={busy}>
                            Sakrij prikaz
                        </Button>
                    )}
                </HStack>

                {/* Emitiranje - the old start/stop pair. "Pokreni" also points the
                    home-page banner at this stream, so the visitor sees it. */}
                {broadcast?.streamId && (
                    <Box p="3" bg="bg.surfaceTint" rounded="lg" borderWidth="1px" borderColor="border">
                        <HStack justify="space-between" gap="3" wrap="wrap">
                            <Box>
                                <MonoLabel display="block" mb="0.5">EMITIRANJE</MonoLabel>
                                <Text fontSize="sm" fontWeight={600} color={broadcast.broadcasting ? "accent.red" : "fg.muted"}>
                                    {broadcast.broadcasting
                                        ? "UŽIVO na glavnoj stranici"
                                        : "Zaustavljeno - ne prikazuje se na glavnoj"}
                                </Text>
                            </Box>
                            <HStack gap="2">
                                <Button
                                    size="sm"
                                    colorPalette="pitch"
                                    onClick={startBroadcast}
                                    loading={busy}
                                    disabled={broadcast.broadcasting}
                                >
                                    <FiPlay /> Pokreni
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    colorPalette="gray"
                                    onClick={stopBroadcast}
                                    loading={busy}
                                    disabled={!broadcast.broadcasting}
                                >
                                    <FiSquare /> Zaustavi
                                </Button>
                            </HStack>
                        </HStack>
                    </Box>
                )}

                {/* Overlay alati - sastavi + zasebno odbrojavanje. */}
                {broadcast?.streamId && (
                    <Box p="3" bg="bg.surfaceTint" rounded="lg" borderWidth="1px" borderColor="border">
                        <MonoLabel display="block" mb="2">OVERLAY</MonoLabel>
                        <VStack align="stretch" gap="3">
                            <HStack justify="space-between" gap="3" wrap="wrap">
                                <Text fontSize="sm" color="fg.muted">
                                    Sastavi utakmice u tijeku (ili sljedeće na rasporedu)
                                </Text>
                                <Button size="sm" variant="outline" colorPalette="pitch" onClick={pushLineup} loading={busy}>
                                    <FiUsers /> Pošalji sastave
                                </Button>
                            </HStack>

                            <HStack gap="2" wrap="wrap" align="center">
                                <HStack gap="1.5" color="fg.muted" flexShrink={0}>
                                    <FiClock size={13} />
                                    <Text fontSize="sm">Odbrojavanje</Text>
                                </HStack>
                                <Input
                                    size="sm"
                                    w="16"
                                    value={timerMin}
                                    onChange={(e) => setTimerMin(e.target.value)}
                                    disabled={timerEndsAt != null || (timerLeft ?? 0) > 0}
                                    fontFamily="mono"
                                    textAlign="center"
                                />
                                <Text fontSize="sm" color="fg.muted">min</Text>
                                {(timerEndsAt != null || (timerLeft ?? 0) > 0) && (
                                    <Text fontSize="sm" fontFamily="mono" fontWeight={700} color={timerEndsAt ? "accent.red" : "fg.muted"}>
                                        {String(Math.floor(remainingSecs / 60)).padStart(2, "0")}
                                        :
                                        {String(remainingSecs % 60).padStart(2, "0")}
                                        {timerEndsAt == null && " (pauza)"}
                                    </Text>
                                )}
                                <HStack gap="1.5" ml="auto">
                                    <Button size="xs" colorPalette="pitch" onClick={timerStart} loading={busy} disabled={timerEndsAt != null}>
                                        <FiPlay /> {(timerLeft ?? 0) > 0 ? "Nastavi" : "Pokreni"}
                                    </Button>
                                    <Button size="xs" variant="outline" colorPalette="gray" onClick={timerPause} loading={busy} disabled={timerEndsAt == null}>
                                        <FiPause /> Pauza
                                    </Button>
                                    <Button size="xs" variant="ghost" colorPalette="gray" onClick={timerStop} loading={busy} disabled={timerEndsAt == null && (timerLeft ?? 0) === 0}>
                                        <FiSquare /> Stop
                                    </Button>
                                </HStack>
                            </HStack>
                        </VStack>
                    </Box>
                )}

                {preview && (
                    <Box>
                        <HStack gap="2" mb="2" color="pitch.500">
                            <FiCheck />
                            <Text fontSize="sm" fontWeight={600}>
                                Povezano · stream {preview}
                            </Text>
                        </HStack>
                        {/* The platform's own player (video + its scoreboard overlay). */}
                        <SpectoEmbed streamId={preview} rounded="lg" overflow="hidden" />
                        <HStack gap="1.5" mt="2" color="fg.muted">
                            <FiPlay size={12} />
                            <Text fontSize="xs" fontFamily="mono">
                                {conn?.baseUrl}/v1/streams/{preview}/master.m3u8
                            </Text>
                        </HStack>
                    </Box>
                )}
            </VStack>
        </SectionCard>
    )
}
