import { useCallback, useEffect, useState } from "react"
import { Box, Button, HStack, Input, NativeSelect, Spinner, Text, VStack } from "@chakra-ui/react"
import { FiAward, FiCheck, FiClock, FiEdit2, FiEye, FiEyeOff, FiLink, FiPause, FiPlay, FiPlus, FiSlash, FiSquare, FiUsers, FiX } from "react-icons/fi"

import {
    fetchSpectoBroadcast,
    fetchSpectoConnection,
    fetchSpectoStatus,
    hideSpectoBroadcast,
    linkSpectoStream,
    saveSpectoConnection,
    sendSpectoLineup,
    sendSpectoStandings,
    showSpectoBroadcast,
    startSpectoBroadcast,
    startSpectoTimer,
    stopSpectoBroadcast,
    stopSpectoTimer,
    unlinkSpecto,
    verifySpectoStream,
    type SpectoBroadcast,
    type SpectoConnection,
} from "../api/spectoStream"
import { adminListTournaments, type AdminTournamentDto } from "../api/admin"
import SpectoEmbed from "./SpectoEmbed"
import { MonoLabel, SectionCard, StatusChip } from "../ui/pitch"
import { showError } from "../toaster"
import { useTranslation } from "../i18n"

type LinkedStream = {
    tournament: AdminTournamentDto
    streamId: string
    broadcast: SpectoBroadcast | null
}

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
    const t = useTranslation()
    const [conn, setConn] = useState<SpectoConnection | null>(null)
    const [loading, setLoading] = useState(true)
    const [baseUrl, setBaseUrl] = useState("")
    const [apiKey, setApiKey] = useState("")
    const [streamId, setStreamId] = useState("")
    const [busy, setBusy] = useState(false)
    const [formOpen, setFormOpen] = useState(false)
    /** Stream id currently mounted in the preview player (null = nothing). */
    const [preview, setPreview] = useState<string | null>(null)

    /* Tournament picker - the stream is attached to this tournament. */
    const [tournaments, setTournaments] = useState<AdminTournamentDto[]>([])
    const [tournamentUuid, setTournamentUuid] = useState("")
    /** Whether THIS tournament's stream is the live home-page banner. */
    const [broadcast, setBroadcast] = useState<SpectoBroadcast | null>(null)
    const [linkedStreams, setLinkedStreams] = useState<LinkedStream[]>([])
    const [loadingLinkedStreams, setLoadingLinkedStreams] = useState(true)

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

    /** The overview is useful before a tournament is selected. */
    const refreshLinkedStreams = useCallback(async (rows: AdminTournamentDto[]) => {
        setLoadingLinkedStreams(true)
        try {
            const statuses = await Promise.all(
                rows
                    .filter((t) => !!t.uuid)
                    .map(async (t) => ({ tournament: t, status: await fetchSpectoStatus(t.uuid!) })),
            )
            const streams = await Promise.all(
                statuses
                    .filter((row) => !!row.status.streamId)
                    .map(async ({ tournament, status }) => ({
                        tournament,
                        streamId: status.streamId!,
                        broadcast: await fetchSpectoBroadcast(tournament.uuid!).catch(() => null),
                    })),
            )
            setLinkedStreams(streams)
        } catch {
            /* The editor below remains available if the overview cannot load. */
        } finally {
            setLoadingLinkedStreams(false)
        }
    }, [])

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
            .then((rows) => {
                if (cancelled) return
                setTournaments(rows)
                void refreshLinkedStreams(rows)
            })
            .catch(() => { /* interceptor toasts */ })
        return () => { cancelled = true }
    }, [refreshLinkedStreams])

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
            await refreshLinkedStreams(tournaments)
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
            await refreshLinkedStreams(tournaments)
        } catch {
            /* interceptor toasts */
        } finally {
            setBusy(false)
        }
    }

    /** Only show this stream in the home-page hero; do not notify Specto. */
    async function showOnHome() {
        if (!tournamentUuid) return
        setBusy(true)
        try {
            setBroadcast(await showSpectoBroadcast(tournamentUuid))
            await refreshLinkedStreams(tournaments)
        } catch {
            /* interceptor toasts */
        } finally {
            setBusy(false)
        }
    }

    /** Only hide this stream from the home-page hero; do not notify Specto. */
    async function hideFromHome() {
        if (!tournamentUuid) return
        setBusy(true)
        try {
            setBroadcast(await hideSpectoBroadcast(tournamentUuid))
            await refreshLinkedStreams(tournaments)
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
            showError(t.components.spectoConnectionCard.missingStreamIdTitle, t.components.spectoConnectionCard.missingStreamIdDesc)
            return
        }
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
            showError(t.components.spectoConnectionCard.invalidStreamIdTitle, t.components.spectoConnectionCard.invalidStreamIdDesc)
            return
        }
        if (!tournamentUuid) {
            showError(t.components.spectoConnectionCard.missingTournamentTitle, t.components.spectoConnectionCard.missingTournamentDesc)
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
                showError(t.components.spectoConnectionCard.streamUnavailableTitle, check.reason ?? t.components.spectoConnectionCard.streamUnavailableDesc)
                return
            }
            await linkSpectoStream(tournamentUuid, id)
            setPreview(id)
            setBroadcast(await fetchSpectoBroadcast(tournamentUuid))
            await refreshLinkedStreams(tournaments)
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

    /** Send the tournament's final top-3 podium (400 until the final is decided). */
    async function pushStandings() {
        if (!tournamentUuid) return
        setBusy(true)
        try {
            await sendSpectoStandings(tournamentUuid)
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
            showError(t.components.spectoConnectionCard.invalidDurationTitle, t.components.spectoConnectionCard.invalidDurationDesc)
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

    /** Opens an existing tournament link in the editor. */
    function editLinkedStream(link: LinkedStream) {
        setFormOpen(true)
        setTournamentUuid(link.tournament.uuid ?? "")
        setStreamId(link.streamId)
        setPreview(link.streamId)
        setBroadcast(link.broadcast)
    }

    /** Start with an empty editor for attaching another existing stream. */
    function addNewStream() {
        setFormOpen(true)
        setTournamentUuid("")
        setStreamId("")
        setPreview(null)
        setBroadcast(null)
        setApiKey("")
    }

    function closeEditor() {
        setFormOpen(false)
        setTournamentUuid("")
        setStreamId("")
        setPreview(null)
        setBroadcast(null)
        setApiKey("")
    }

    async function disconnectStream() {
        if (!tournamentUuid || !preview) return
        if (!window.confirm(t.components.spectoConnectionCard.disconnectConfirm)) return
        setBusy(true)
        try {
            await unlinkSpecto(tournamentUuid)
            setStreamId("")
            setPreview(null)
            setBroadcast(null)
            await refreshLinkedStreams(tournaments)
        } catch {
            /* interceptor toasts the HTTP error */
        } finally {
            setBusy(false)
        }
    }

    if (loading) {
        return (
            <SectionCard>
                <HStack gap="2" color="fg.muted"><Spinner size="sm" /><Text fontSize="sm">{t.components.spectoConnectionCard.loading}</Text></HStack>
            </SectionCard>
        )
    }

    const keyStatus = conn?.apiKeySet
        ? `${conn.apiKeyFromDb ? t.components.spectoConnectionCard.keyStoredHere : t.components.spectoConnectionCard.keyFromEnv} · ${conn.apiKeyHint ?? ""}`
        : t.components.spectoConnectionCard.keyNotSet

    return (
        // No card header: /admin/stream already names the module and shows the
        // icon. The key status is the only thing the header carried that the
        // page chrome can't, so it moves to the top of the body.
        <SectionCard>
            <VStack align="stretch" gap="4">
                <HStack>
                    <StatusChip
                        status={conn?.apiKeySet ? "active" : "draft"}
                        label={conn?.apiKeySet ? t.components.spectoConnectionCard.keyStatusSet : t.components.spectoConnectionCard.keyStatusUnset}
                        size="sm"
                    />
                </HStack>

                <Box>
                    <HStack justify="space-between" align="center" gap="3" mb="2" wrap="wrap">
                        <MonoLabel display="block">{t.components.spectoConnectionCard.activeStreamsLabel}</MonoLabel>
                        <Button size="sm" colorPalette="pitch" onClick={addNewStream} disabled={busy}>
                            <FiPlus /> {t.components.spectoConnectionCard.addNew}
                        </Button>
                    </HStack>
                    {loadingLinkedStreams ? (
                        <HStack gap="2" color="fg.muted">
                            <Spinner size="xs" />
                            <Text fontSize="sm">{t.components.spectoConnectionCard.loadingStreams}</Text>
                        </HStack>
                    ) : linkedStreams.length === 0 ? (
                        <Text fontSize="sm" color="fg.muted">{t.components.spectoConnectionCard.noStreams}</Text>
                    ) : (
                        <VStack align="stretch" gap="2">
                            {linkedStreams.map((link) => (
                                <HStack
                                    key={link.tournament.uuid}
                                    justify="space-between"
                                    gap="3"
                                    p="2.5"
                                    borderWidth="1px"
                                    borderColor={link.tournament.uuid === tournamentUuid ? "pitch.400" : "border"}
                                    bg={link.tournament.uuid === tournamentUuid ? "bg.surfaceTint" : undefined}
                                    rounded="md"
                                    wrap="wrap"
                                >
                                    <Box minW="0">
                                        <Text fontSize="sm" fontWeight={700} truncate>{link.tournament.name}</Text>
                                        <HStack gap="1.5" mt="0.5" color="fg.muted">
                                            <Text fontSize="xs" fontFamily="mono">{link.streamId}</Text>
                                            <StatusChip
                                                size="sm"
                                                status={link.broadcast?.broadcasting ? "active" : "draft"}
                                                label={link.broadcast?.broadcasting ? t.components.spectoConnectionCard.live : t.components.spectoConnectionCard.connected}
                                            />
                                        </HStack>
                                    </Box>
                                    <Button size="sm" variant="outline" colorPalette="pitch" onClick={() => editLinkedStream(link)} disabled={busy}>
                                        <FiEdit2 /> {t.components.spectoConnectionCard.edit}
                                    </Button>
                                </HStack>
                            ))}
                        </VStack>
                    )}
                </Box>

                {formOpen && (
                    <Box p="3" bg="bg.panel" borderWidth="1px" borderColor="border.emphasized" rounded="lg">
                        <VStack align="stretch" gap="4">
                            <HStack justify="space-between" gap="3" wrap="wrap">
                                <Box>
                                    <Text fontSize="sm" fontWeight={800} color="fg.ink">
                                        {preview ? t.components.spectoConnectionCard.editStream : t.components.spectoConnectionCard.addStream}
                                    </Text>
                                    <Text fontSize="xs" color="fg.muted">
                                        {t.components.spectoConnectionCard.editHint}
                                    </Text>
                                </Box>
                                <Button size="sm" variant="ghost" colorPalette="gray" onClick={closeEditor} disabled={busy}>
                                    <FiX /> {t.components.spectoConnectionCard.close}
                                </Button>
                            </HStack>

                <Box>
                    <MonoLabel mb="1.5" display="block">{t.components.spectoConnectionCard.baseUrlLabel}</MonoLabel>
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
                    <MonoLabel mb="1.5" display="block">{t.components.spectoConnectionCard.apiKeyLabel}</MonoLabel>
                    <Input
                        size="sm"
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={t.components.spectoConnectionCard.apiKeyPlaceholder}
                        autoComplete="off"
                        fontFamily="mono"
                        fontSize="13px"
                    />
                    <HStack justify="space-between" mt="1.5" gap="2" wrap="wrap">
                        <Text fontSize="xs" color="fg.muted">{t.components.spectoConnectionCard.keyCurrentPrefix}{keyStatus}</Text>
                        {conn?.apiKeyFromDb && (
                            <Button size="2xs" variant="ghost" colorPalette="gray" onClick={clearKey} disabled={busy}>
                                <FiSlash /> {t.components.spectoConnectionCard.clearKey}
                            </Button>
                        )}
                    </HStack>
                </Box>

                <Box>
                    <MonoLabel mb="1.5" display="block">{t.components.spectoConnectionCard.tournamentLabel}</MonoLabel>
                    <NativeSelect.Root size="sm" disabled={busy}>
                        <NativeSelect.Field
                            value={tournamentUuid}
                            onChange={(e) => setTournamentUuid(e.currentTarget.value)}
                        >
                            <option value="">{t.components.spectoConnectionCard.tournamentPlaceholder}</option>
                            {tournaments.map((tour) => (
                                <option key={tour.id} value={tour.uuid ?? ""}>
                                    {tour.name}
                                    {tour.location ? ` · ${tour.location}` : ""}
                                </option>
                            ))}
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                    </NativeSelect.Root>
                </Box>

                <Box>
                    <MonoLabel mb="1.5" display="block">{t.components.spectoConnectionCard.streamIdLabel}</MonoLabel>
                    <Input
                        size="sm"
                        value={streamId}
                        onChange={(e) => setStreamId(e.target.value)}
                        placeholder={t.components.spectoConnectionCard.streamIdPlaceholder}
                        fontFamily="mono"
                        fontSize="13px"
                    />
                </Box>

                <HStack gap="2" wrap="wrap">
                    <Button size="sm" colorPalette="pitch" onClick={connect} loading={busy}>
                        <FiLink /> {preview ? t.components.spectoConnectionCard.saveChanges : t.components.spectoConnectionCard.connectAndShow}
                    </Button>
                    {preview && (
                        <Button size="sm" variant="outline" colorPalette="red" onClick={disconnectStream} disabled={busy}>
                            <FiSlash /> {t.components.spectoConnectionCard.disconnect}
                        </Button>
                    )}
                    {preview && (
                        <Button size="sm" variant="outline" colorPalette="gray" onClick={() => setPreview(null)} disabled={busy}>
                            {t.components.spectoConnectionCard.hidePreview}
                        </Button>
                    )}
                </HStack>

                {/* Emitiranje - full platform start/stop, plus separate silent
                    home-page visibility controls for cases where the Specto
                    stream is already running and should only appear/disappear
                    inside futsal-turniri.com. */}
                {broadcast?.streamId && (
                    <Box p="3" bg="bg.surfaceTint" rounded="lg" borderWidth="1px" borderColor="border">
                        <VStack align="stretch" gap="3">
                            <HStack justify="space-between" gap="3" wrap="wrap">
                                <Box>
                                    <MonoLabel display="block" mb="0.5">{t.components.spectoConnectionCard.emittingLabel}</MonoLabel>
                                    <Text fontSize="sm" fontWeight={600} color={broadcast.broadcasting ? "accent.red" : "fg.muted"}>
                                        {broadcast.broadcasting
                                            ? t.components.spectoConnectionCard.broadcastingOnHome
                                            : t.components.spectoConnectionCard.notBroadcastingOnHome}
                                    </Text>
                                </Box>
                                <HStack gap="2">
                                    <Button
                                        size="sm"
                                        colorPalette="pitch"
                                        onClick={startBroadcast}
                                        loading={busy}
                                    >
                                        <FiPlay /> {t.components.spectoConnectionCard.startAndShow}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        colorPalette="gray"
                                        onClick={stopBroadcast}
                                        loading={busy}
                                    >
                                        <FiSquare /> {t.components.spectoConnectionCard.stopAndHide}
                                    </Button>
                                </HStack>
                            </HStack>
                            <HStack justify="space-between" gap="3" wrap="wrap" pt="3" borderTopWidth="1px" borderColor="border.subtle">
                                <Box>
                                    <Text fontSize="sm" fontWeight={700} color="fg.ink">{t.components.spectoConnectionCard.homeOnlyTitle}</Text>
                                    <Text fontSize="xs" color="fg.muted">
                                        {t.components.spectoConnectionCard.homeOnlyDesc}
                                    </Text>
                                </Box>
                                <HStack gap="2">
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        colorPalette="pitch"
                                        onClick={showOnHome}
                                        loading={busy}
                                        disabled={broadcast.broadcasting}
                                    >
                                        <FiEye /> {t.components.spectoConnectionCard.showOnHome}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        colorPalette="gray"
                                        onClick={hideFromHome}
                                        loading={busy}
                                        disabled={!broadcast.broadcasting}
                                    >
                                        <FiEyeOff /> {t.components.spectoConnectionCard.hideFromHome}
                                    </Button>
                                </HStack>
                            </HStack>
                        </VStack>
                    </Box>
                )}

                {/* Overlay alati - sastavi + zasebno odbrojavanje. */}
                {broadcast?.streamId && (
                    <Box p="3" bg="bg.surfaceTint" rounded="lg" borderWidth="1px" borderColor="border">
                        <MonoLabel display="block" mb="2">{t.components.spectoConnectionCard.overlayLabel}</MonoLabel>
                        <VStack align="stretch" gap="3">
                            <HStack justify="space-between" gap="3" wrap="wrap">
                                <Text fontSize="sm" color="fg.muted">
                                    {t.components.spectoConnectionCard.lineupHint}
                                </Text>
                                <Button size="sm" variant="outline" colorPalette="pitch" onClick={pushLineup} loading={busy}>
                                    <FiUsers /> {t.components.spectoConnectionCard.sendLineup}
                                </Button>
                            </HStack>

                            <HStack justify="space-between" gap="3" wrap="wrap">
                                <Text fontSize="sm" color="fg.muted">
                                    {t.components.spectoConnectionCard.standingsHint}
                                </Text>
                                <Button size="sm" variant="outline" colorPalette="pitch" onClick={pushStandings} loading={busy}>
                                    <FiAward /> {t.components.spectoConnectionCard.sendStandings}
                                </Button>
                            </HStack>

                            <HStack gap="2" wrap="wrap" align="center">
                                <HStack gap="1.5" color="fg.muted" flexShrink={0}>
                                    <FiClock size={13} />
                                    <Text fontSize="sm">{t.components.spectoConnectionCard.countdownLabel}</Text>
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
                                <Text fontSize="sm" color="fg.muted">{t.components.spectoConnectionCard.minutesUnit}</Text>
                                {(timerEndsAt != null || (timerLeft ?? 0) > 0) && (
                                    <Text fontSize="sm" fontFamily="mono" fontWeight={700} color={timerEndsAt ? "accent.red" : "fg.muted"}>
                                        {String(Math.floor(remainingSecs / 60)).padStart(2, "0")}
                                        :
                                        {String(remainingSecs % 60).padStart(2, "0")}
                                        {timerEndsAt == null && t.components.spectoConnectionCard.pausedSuffix}
                                    </Text>
                                )}
                                <HStack gap="1.5" ml="auto">
                                    <Button size="xs" colorPalette="pitch" onClick={timerStart} loading={busy} disabled={timerEndsAt != null}>
                                        <FiPlay /> {(timerLeft ?? 0) > 0 ? t.components.spectoConnectionCard.resume : t.components.spectoConnectionCard.start}
                                    </Button>
                                    <Button size="xs" variant="outline" colorPalette="gray" onClick={timerPause} loading={busy} disabled={timerEndsAt == null}>
                                        <FiPause /> {t.components.spectoConnectionCard.pause}
                                    </Button>
                                    <Button size="xs" variant="ghost" colorPalette="gray" onClick={timerStop} loading={busy} disabled={timerEndsAt == null && (timerLeft ?? 0) === 0}>
                                        <FiSquare /> {t.components.spectoConnectionCard.stop}
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
                                {t.components.spectoConnectionCard.connectedStatus(preview)}
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
                    </Box>
                )}
            </VStack>
        </SectionCard>
    )
}
