import { useCallback, useEffect, useState } from "react"
import {
    Box,
    Button,
    Flex,
    HStack,
    Input,
    NativeSelect,
    Spinner,
    Text,
    VStack,
} from "@chakra-ui/react"
import { Link as RouterLink, useNavigate } from "react-router-dom"
import { FiChevronRight, FiLink, FiPlus, FiSlash, FiX } from "react-icons/fi"

import {
    fetchSpectoBroadcast,
    fetchSpectoConnection,
    fetchSpectoStatus,
    linkSpectoStream,
    saveSpectoConnection,
    verifySpectoStream,
    type SpectoBroadcast,
    type SpectoConnection,
} from "../api/spectoStream"
import { adminListTournaments, type AdminTournamentDto } from "../api/admin"
import { MonoLabel, SectionCard, StatusChip } from "../ui/pitch"
import { showError } from "../toaster"
import { useTranslation } from "../i18n"

type LinkedStream = {
    tournament: AdminTournamentDto
    streamId: string
    broadcast: SpectoBroadcast | null
}

/* ──────────────────────────────────────────────────────────────────────────
   SpectoConnectionCard - the admin "Live stream" module's LIST screen.

   Two things live here and nothing else:

     1. The site-wide connection (platform URL + API key, saved to
        app_settings; they win over the server's .env and apply immediately,
        so the key can be rotated without a restart).
     2. Every tournament that currently has a stream attached - as rows that
        OPEN, not rows with an edit button. One stream, one screen:
        /admin/stream/{tournamentUuid} (AdminStreamDetailPage) carries the
        player, the on-air controls and the technical handles.

   Attaching a stream is still done here, in the "Dodaj novi" form, because it
   is the one action that belongs to no stream yet. On success it navigates
   straight into the new stream's screen.

   The API key is WRITE-ONLY: the server never returns it, only whether one is
   set, where it comes from and its last four characters. The field therefore
   shows a MASK of the stored key rather than sitting empty - an empty box
   reads as "no key", which was exactly the wrong impression. Typing replaces
   it; leaving it untouched keeps the stored secret.
   ────────────────────────────────────────────────────────────────────── */

export default function SpectoConnectionCard() {
    const t = useTranslation()
    const c = t.components.spectoConnectionCard
    const navigate = useNavigate()

    const [conn, setConn] = useState<SpectoConnection | null>(null)
    const [loading, setLoading] = useState(true)
    const [baseUrl, setBaseUrl] = useState("")
    /** Empty = "keep the stored key". Only a typed value ever replaces it. */
    const [apiKey, setApiKey] = useState("")
    const [busy, setBusy] = useState(false)

    const [tournaments, setTournaments] = useState<AdminTournamentDto[]>([])
    const [linkedStreams, setLinkedStreams] = useState<LinkedStream[]>([])
    const [loadingLinkedStreams, setLoadingLinkedStreams] = useState(true)

    /* "Dodaj novi" form. */
    const [formOpen, setFormOpen] = useState(false)
    const [tournamentUuid, setTournamentUuid] = useState("")
    const [streamId, setStreamId] = useState("")

    const refreshLinkedStreams = useCallback(async (rows: AdminTournamentDto[]) => {
        setLoadingLinkedStreams(true)
        try {
            const statuses = await Promise.all(
                rows
                    .filter((row) => !!row.uuid)
                    .map(async (row) => ({ tournament: row, status: await fetchSpectoStatus(row.uuid!) })),
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
            /* The form below stays usable if the overview cannot load. */
        } finally {
            setLoadingLinkedStreams(false)
        }
    }, [])

    useEffect(() => {
        let cancelled = false
        fetchSpectoConnection()
            .then((cn) => {
                if (cancelled) return
                setConn(cn)
                setBaseUrl(cn.baseUrl)
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

    /** Save the connection only (no stream involved). */
    async function saveConnection() {
        setBusy(true)
        try {
            const saved = await saveSpectoConnection({
                baseUrl: baseUrl.trim(),
                // Empty → keep whatever is stored (never wipes the secret).
                apiKey: apiKey.trim() || undefined,
            })
            setConn(saved)
            setApiKey("")
        } catch {
            /* interceptor toasts */
        } finally {
            setBusy(false)
        }
    }

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

    /** Attach a stream to a tournament, then open its screen. */
    async function connect() {
        const id = streamId.trim()
        if (!id) {
            showError(c.missingStreamIdTitle, c.missingStreamIdDesc)
            return
        }
        if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
            showError(c.invalidStreamIdTitle, c.invalidStreamIdDesc)
            return
        }
        if (!tournamentUuid) {
            showError(c.missingTournamentTitle, c.missingTournamentDesc)
            return
        }
        setBusy(true)
        try {
            const saved = await saveSpectoConnection({
                baseUrl: baseUrl.trim(),
                apiKey: apiKey.trim() || undefined,
            })
            setConn(saved)
            setApiKey("")

            const check = await verifySpectoStream(id)
            if (!check.ok) {
                showError(c.streamUnavailableTitle, check.reason ?? c.streamUnavailableDesc)
                return
            }
            await linkSpectoStream(tournamentUuid, id)
            navigate(`/admin/stream/${tournamentUuid}`)
        } catch {
            /* interceptor toasts */
        } finally {
            setBusy(false)
        }
    }

    if (loading) {
        return (
            <SectionCard>
                <HStack gap="2" color="fg.muted"><Spinner size="sm" /><Text fontSize="sm">{c.loading}</Text></HStack>
            </SectionCard>
        )
    }

    /** What the stored key looks like without revealing it: a fixed run of
     *  dots plus the hint the server does return. Never derived from the real
     *  length - that would leak it. */
    const maskedKey = conn?.apiKeySet ? `••••••••••••${conn.apiKeyHint ?? ""}` : ""
    const keySource = conn?.apiKeySet
        ? (conn.apiKeyFromDb ? c.keyStoredHere : c.keyFromEnv)
        : c.keyNotSet

    return (
        <VStack align="stretch" gap="4">
            {/* ── Streams ─────────────────────────────────────────────────── */}
            <SectionCard>
                <VStack align="stretch" gap="3">
                    <HStack justify="space-between" align="center" gap="3" wrap="wrap">
                        <MonoLabel display="block">{c.activeStreamsLabel}</MonoLabel>
                        <Button
                            size="sm"
                            colorPalette="pitch"
                            onClick={() => setFormOpen((v) => !v)}
                            disabled={busy}
                        >
                            {formOpen ? <FiX /> : <FiPlus />} {formOpen ? c.close : c.addNew}
                        </Button>
                    </HStack>

                    {loadingLinkedStreams ? (
                        <HStack gap="2" color="fg.muted">
                            <Spinner size="xs" />
                            <Text fontSize="sm">{c.loadingStreams}</Text>
                        </HStack>
                    ) : linkedStreams.length === 0 ? (
                        <Text fontSize="sm" color="fg.muted">{c.noStreams}</Text>
                    ) : (
                        <VStack align="stretch" gap="2">
                            {linkedStreams.map((link) => (
                                /* The whole row opens the stream. No "Uredi"
                                   button: with one action per row, a button is
                                   just a smaller version of the row. */
                                <Flex
                                    key={link.tournament.uuid}
                                    asChild
                                    align="center"
                                    justify="space-between"
                                    gap="3"
                                    p="3"
                                    borderWidth="1px"
                                    borderColor="border"
                                    rounded="lg"
                                    transition="border-color 0.15s ease, background 0.15s ease"
                                    _hover={{ borderColor: "pitch.500", bg: "bg.surfaceTint" }}
                                >
                                    <RouterLink to={`/admin/stream/${link.tournament.uuid}`}>
                                        <Box minW="0">
                                            <Text fontSize="sm" fontWeight={700} color="fg.ink" truncate>
                                                {link.tournament.name}
                                            </Text>
                                            <HStack gap="2" mt="1">
                                                <Text fontSize="xs" fontFamily="mono" color="fg.muted">
                                                    {link.streamId}
                                                </Text>
                                                <StatusChip
                                                    size="sm"
                                                    status={link.broadcast?.broadcasting ? "active" : "draft"}
                                                    label={link.broadcast?.broadcasting ? c.live : c.connected}
                                                />
                                            </HStack>
                                        </Box>
                                        <Box color="fg.muted" flexShrink={0}>
                                            <FiChevronRight />
                                        </Box>
                                    </RouterLink>
                                </Flex>
                            ))}
                        </VStack>
                    )}

                    {formOpen && (
                        <Box p="3" bg="bg.subtle" borderWidth="1px" borderColor="border.emphasized" rounded="lg">
                            <VStack align="stretch" gap="3">
                                <Box>
                                    <Text fontSize="sm" fontWeight={800} color="fg.ink">{c.addStream}</Text>
                                    <Text fontSize="xs" color="fg.muted">{c.editHint}</Text>
                                </Box>

                                <Box>
                                    <MonoLabel mb="1.5" display="block">{c.tournamentLabel}</MonoLabel>
                                    <NativeSelect.Root size="sm" disabled={busy}>
                                        <NativeSelect.Field
                                            value={tournamentUuid}
                                            onChange={(e) => setTournamentUuid(e.currentTarget.value)}
                                        >
                                            <option value="">{c.tournamentPlaceholder}</option>
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
                                    <MonoLabel mb="1.5" display="block">{c.streamIdLabel}</MonoLabel>
                                    <Input
                                        size="sm"
                                        value={streamId}
                                        onChange={(e) => setStreamId(e.target.value)}
                                        placeholder={c.streamIdPlaceholder}
                                        fontFamily="mono"
                                        fontSize="13px"
                                    />
                                </Box>

                                <HStack gap="2">
                                    <Button size="sm" colorPalette="pitch" onClick={connect} loading={busy}>
                                        <FiLink /> {c.connectAndShow}
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        colorPalette="gray"
                                        onClick={() => setFormOpen(false)}
                                        disabled={busy}
                                    >
                                        {c.close}
                                    </Button>
                                </HStack>
                            </VStack>
                        </Box>
                    )}
                </VStack>
            </SectionCard>

            {/* ── Connection ──────────────────────────────────────────────── */}
            <SectionCard>
                <VStack align="stretch" gap="3">
                    <HStack justify="space-between" gap="3" wrap="wrap">
                        <MonoLabel display="block">{c.connectionLabel}</MonoLabel>
                        <StatusChip
                            status={conn?.apiKeySet ? "active" : "draft"}
                            label={conn?.apiKeySet ? c.keyStatusSet : c.keyStatusUnset}
                            size="sm"
                        />
                    </HStack>

                    <Box>
                        <MonoLabel mb="1.5" display="block">{c.baseUrlLabel}</MonoLabel>
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
                        <MonoLabel mb="1.5" display="block">{c.apiKeyLabel}</MonoLabel>
                        <Input
                            size="sm"
                            type="password"
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            // The mask goes in the PLACEHOLDER, never in the
                            // value: as a value it would be posted back as if
                            // it were the key itself.
                            placeholder={maskedKey || c.apiKeyPlaceholder}
                            autoComplete="off"
                            fontFamily="mono"
                            fontSize="13px"
                        />
                        <HStack justify="space-between" mt="1.5" gap="2" wrap="wrap">
                            <Text fontSize="xs" color="fg.muted">{c.keyCurrentPrefix}{keySource}</Text>
                            {conn?.apiKeyFromDb && (
                                <Button size="2xs" variant="ghost" colorPalette="gray" onClick={clearKey} disabled={busy}>
                                    <FiSlash /> {c.clearKey}
                                </Button>
                            )}
                        </HStack>
                    </Box>

                    <HStack>
                        <Button size="sm" variant="outline" colorPalette="pitch" onClick={saveConnection} loading={busy}>
                            {c.saveChanges}
                        </Button>
                    </HStack>
                </VStack>
            </SectionCard>
        </VStack>
    )
}
