import { useCallback, useEffect, useState } from "react"
import {
    Box,
    Button,
    Flex,
    Heading,
    HStack,
    IconButton,
    Menu,
    Portal,
    Text,
    VStack,
} from "@chakra-ui/react"
import { useNavigate, useParams } from "react-router-dom"
import {
    FiAward,
    FiCopy,
    FiEye,
    FiEyeOff,
    FiMoreVertical,
    FiPlay,
    FiSlash,
    FiSquare,
    FiUsers,
} from "react-icons/fi"

import {
    fetchSpectoBroadcast,
    fetchSpectoConnection,
    fetchSpectoStatus,
    hideSpectoBroadcast,
    sendSpectoLineup,
    sendSpectoStandings,
    showSpectoBroadcast,
    startSpectoBroadcast,
    stopSpectoBroadcast,
    unlinkSpecto,
    type SpectoBroadcast,
} from "../api/spectoStream"
import { fetchTournamentDetails } from "../api/tournaments"
import SpectoEmbed from "../components/SpectoEmbed"
import { BackLink, MonoLabel, StatusChip } from "../ui/pitch"
import { ConfirmDialog, EmptyState, Loader, Panel } from "../ui/primitives"
import { showSuccess } from "../toaster"
import { useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   AdminStreamDetailPage - /admin/stream/{tournamentUuid}.

   One linked SpectoStream broadcast, on its own screen: the platform player,
   the on-air controls, the technical handles (stream id, HLS manifest, embed
   snippet) and the disconnect.

   Deliberately NOT an inline expander under the list. Everything here is
   either destructive (disconnect), live to viewers (start/stop broadcasting)
   or something to copy carefully - actions that deserve a screen of their own
   rather than a panel that can be scrolled past while another stream's row is
   still in view.

   The overlay tools (lineups, top 3) live in a menu, not as buttons: they are
   one-shot pushes used a few times per tournament, and as full-width rows they
   competed with the on-air controls, which are what an admin actually reaches
   for mid-broadcast.
   ────────────────────────────────────────────────────────────────────── */

/** Copy-to-clipboard row for a technical value (stream id, m3u8, snippet). */
function CopyRow({
    label,
    value,
    copiedLabel,
    multiline = false,
}: {
    label: string
    value: string
    copiedLabel: string
    multiline?: boolean
}) {
    async function copy() {
        try {
            await navigator.clipboard.writeText(value)
            showSuccess(copiedLabel)
        } catch {
            /* Clipboard blocked (insecure origin / permission) - the value is
               on screen and selectable, so there is nothing to report. */
        }
    }

    return (
        <Box>
            <MonoLabel display="block" mb="1.5">{label}</MonoLabel>
            <HStack align="flex-start" gap="2">
                <Box
                    flex="1"
                    minW="0"
                    px="2.5"
                    py="2"
                    bg="bg.subtle"
                    borderWidth="1px"
                    borderColor="border"
                    rounded="md"
                    fontFamily="mono"
                    fontSize="12px"
                    color="fg.ink"
                    css={multiline
                        ? { whiteSpace: "pre-wrap", wordBreak: "break-all" }
                        : { whiteSpace: "nowrap", overflowX: "auto" }}
                >
                    {value}
                </Box>
                <IconButton aria-label={label} size="sm" variant="outline" onClick={copy}>
                    <FiCopy />
                </IconButton>
            </HStack>
        </Box>
    )
}

export default function AdminStreamDetailPage() {
    const t = useTranslation()
    const c = t.components.spectoConnectionCard
    const p = t.pages.adminStreamDetail
    const navigate = useNavigate()
    const { uuid = "" } = useParams<{ uuid: string }>()

    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState(false)
    const [tournamentName, setTournamentName] = useState<string | null>(null)
    const [streamId, setStreamId] = useState<string | null>(null)
    const [broadcast, setBroadcast] = useState<SpectoBroadcast | null>(null)
    const [baseUrl, setBaseUrl] = useState("")
    const [disconnectOpen, setDisconnectOpen] = useState(false)

    const load = useCallback(async () => {
        if (!uuid) return
        const [details, status, bc, conn] = await Promise.all([
            fetchTournamentDetails(uuid).catch(() => null),
            fetchSpectoStatus(uuid).catch(() => null),
            fetchSpectoBroadcast(uuid).catch(() => null),
            fetchSpectoConnection().catch(() => null),
        ])
        setTournamentName(details?.name ?? null)
        setStreamId(status?.streamId ?? null)
        setBroadcast(bc)
        setBaseUrl(conn?.baseUrl ?? "")
    }, [uuid])

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        load().finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [load])

    /** Every control here is "do it, then re-read the truth from the server" -
     *  the broadcast state lives in app_settings and can be changed from
     *  another admin's screen just as well. */
    async function run(action: () => Promise<unknown>) {
        setBusy(true)
        try {
            await action()
            await load()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setBusy(false)
        }
    }

    async function disconnect() {
        setDisconnectOpen(false)
        setBusy(true)
        try {
            await unlinkSpecto(uuid)
            navigate("/admin/stream")
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setBusy(false)
        }
    }

    if (loading) return <Loader />

    if (!streamId) {
        return (
            <Box>
                <BackLink to="/admin/stream" onClick={() => navigate("/admin/stream")} label={p.back} />
                <EmptyState
                    icon={FiSlash}
                    title={p.notLinkedTitle}
                    description={p.notLinkedDesc}
                    action={
                        <Button size="sm" variant="outline" colorPalette="pitch" onClick={() => navigate("/admin/stream")}>
                            {p.back}
                        </Button>
                    }
                />
            </Box>
        )
    }

    const live = !!broadcast?.broadcasting
    // The platform's own snippet, verbatim - this is what goes on a FOREIGN
    // site. Inside this app the player is mounted by SpectoEmbed instead.
    const embedSnippet =
        `<div data-spectostream="${streamId}"></div>\n` +
        `<script src="${baseUrl}/player/player.js" async></script>`
    const manifestUrl = broadcast?.playbackUrl ?? `${baseUrl}/v1/streams/${streamId}/master.m3u8`

    return (
        <Box>
            <BackLink to="/admin/stream" onClick={() => navigate("/admin/stream")} label={p.back} />

            <Flex align="center" justify="space-between" gap="3" wrap="wrap" mb="4">
                <Box minW="0">
                    <Heading as="h1" size="lg" lineHeight="1.2" letterSpacing="-0.02em" color="fg.ink">
                        {tournamentName ?? p.unknownTournament}
                    </Heading>
                    <HStack gap="2" mt="1.5">
                        <StatusChip
                            size="sm"
                            status={live ? "active" : "draft"}
                            label={live ? c.live : c.connected}
                        />
                        <Text fontSize="xs" fontFamily="mono" color="fg.muted">{streamId}</Text>
                    </HStack>
                </Box>

                {/* Overlay one-shots. A menu, so the on-air controls below stay
                    the only large targets on the screen. */}
                <Menu.Root>
                    <Menu.Trigger asChild>
                        <Button size="sm" variant="outline" colorPalette="gray" disabled={busy}>
                            <FiMoreVertical /> {p.toolsMenu}
                        </Button>
                    </Menu.Trigger>
                    <Portal>
                        <Menu.Positioner>
                            <Menu.Content minW="220px">
                                <Menu.Item value="lineup" onSelect={() => run(() => sendSpectoLineup(uuid))}>
                                    <FiUsers /> {c.sendLineup}
                                </Menu.Item>
                                <Menu.Item value="standings" onSelect={() => run(() => sendSpectoStandings(uuid))}>
                                    <FiAward /> {c.sendStandings}
                                </Menu.Item>
                            </Menu.Content>
                        </Menu.Positioner>
                    </Portal>
                </Menu.Root>
            </Flex>

            <VStack align="stretch" gap="4">
                {/* Player first: on this screen the question is almost always
                    "is the picture actually there right now". */}
                <Panel p="0" overflow="hidden">
                    <SpectoEmbed streamId={streamId} />
                </Panel>

                <Panel p={{ base: "3", md: "4" }}>
                    <VStack align="stretch" gap="3">
                        <HStack justify="space-between" gap="3" wrap="wrap">
                            <Box>
                                <MonoLabel display="block" mb="0.5">{c.emittingLabel}</MonoLabel>
                                <Text fontSize="sm" fontWeight={600} color={live ? "accent.red" : "fg.muted"}>
                                    {live ? c.broadcastingOnHome : c.notBroadcastingOnHome}
                                </Text>
                            </Box>
                            <HStack gap="2">
                                <Button
                                    size="sm"
                                    colorPalette="pitch"
                                    loading={busy}
                                    onClick={() => run(() => startSpectoBroadcast(uuid))}
                                >
                                    <FiPlay /> {c.startAndShow}
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    colorPalette="gray"
                                    loading={busy}
                                    onClick={() => run(() => stopSpectoBroadcast(uuid))}
                                >
                                    <FiSquare /> {c.stopAndHide}
                                </Button>
                            </HStack>
                        </HStack>

                        <HStack
                            justify="space-between"
                            gap="3"
                            wrap="wrap"
                            pt="3"
                            borderTopWidth="1px"
                            borderColor="border.subtle"
                        >
                            <Box>
                                <Text fontSize="sm" fontWeight={700} color="fg.ink">{c.homeOnlyTitle}</Text>
                                <Text fontSize="xs" color="fg.muted">{c.homeOnlyDesc}</Text>
                            </Box>
                            <HStack gap="2">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    colorPalette="pitch"
                                    loading={busy}
                                    disabled={live}
                                    onClick={() => run(() => showSpectoBroadcast(uuid))}
                                >
                                    <FiEye /> {c.showOnHome}
                                </Button>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    colorPalette="gray"
                                    loading={busy}
                                    disabled={!live}
                                    onClick={() => run(() => hideSpectoBroadcast(uuid))}
                                >
                                    <FiEyeOff /> {c.hideFromHome}
                                </Button>
                            </HStack>
                        </HStack>
                    </VStack>
                </Panel>

                {/* Technical handles - everything an admin ever has to paste
                    somewhere else. */}
                <Panel p={{ base: "3", md: "4" }}>
                    <VStack align="stretch" gap="3">
                        <MonoLabel display="block">{p.technicalLabel}</MonoLabel>
                        <CopyRow label={c.streamIdLabel} value={streamId} copiedLabel={p.copied} />
                        <CopyRow label={p.manifestLabel} value={manifestUrl} copiedLabel={p.copied} />
                        <CopyRow label={p.embedLabel} value={embedSnippet} copiedLabel={p.copied} multiline />
                        <Text fontSize="xs" color="fg.muted">{p.embedHint}</Text>
                    </VStack>
                </Panel>

                <Panel p={{ base: "3", md: "4" }}>
                    <HStack justify="space-between" gap="3" wrap="wrap">
                        <Box>
                            <Text fontSize="sm" fontWeight={700} color="fg.ink">{p.disconnectTitle}</Text>
                            <Text fontSize="xs" color="fg.muted">{p.disconnectDesc}</Text>
                        </Box>
                        <Button
                            size="sm"
                            variant="outline"
                            colorPalette="red"
                            disabled={busy}
                            onClick={() => setDisconnectOpen(true)}
                        >
                            <FiSlash /> {c.disconnect}
                        </Button>
                    </HStack>
                </Panel>
            </VStack>

            <ConfirmDialog
                open={disconnectOpen}
                title={p.disconnectConfirmTitle}
                description={p.disconnectConfirmDesc}
                confirmLabel={c.disconnect}
                danger
                busy={busy}
                onConfirm={disconnect}
                onClose={() => setDisconnectOpen(false)}
            />
        </Box>
    )
}
