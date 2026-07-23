import { useEffect, useState, type ReactNode } from "react"
import { Box, Button, Flex, HStack, IconButton, Input, Spinner, Text, VStack } from "@chakra-ui/react"
import { FiCopy, FiEye, FiEyeOff, FiLink, FiRadio, FiSend, FiSlash } from "react-icons/fi"

import {
    fetchSpectoStatus,
    provisionSpecto,
    sendSpectoMessage,
    unlinkSpecto,
    type SpectoProvisionInfo,
    type SpectoStatus,
} from "../api/spectoStream"
import { GhostButton, MonoLabel, SectionCard, StatusChip } from "../ui/pitch"
import { showError, showSuccess } from "../toaster"

/* ──────────────────────────────────────────────────────────────────────────
   SpectoStreamCard - organizer-only panel on the "Detalji" tab that lets the
   organizer link the tournament to the SpectoStream platform (OBS camera
   source + overlay), reveal the OBS credentials, push a short message onto
   the stream overlay, and unlink. Rendered by the parent ONLY for organizers
   - no extra permission check here.

   Fully self-contained: fetches its own status on mount and owns all of its
   busy/error state. Every mutation's success/error toast comes from the
   shared axios interceptor (see api/http.ts) via each call's `successMessage`
   - the only manual toasts here are for the (non-HTTP) clipboard copies.
   ────────────────────────────────────────────────────────────────────── */

/** Fixed-width mask - doesn't leak the real stream key's length. */
const MASKED_KEY = "•".repeat(10)

export default function SpectoStreamCard({ uuid }: { uuid: string }) {
    const [status, setStatus] = useState<SpectoStatus | null>(null)
    const [loading, setLoading] = useState(true)
    const [loadFailed, setLoadFailed] = useState(false)

    const [provisionInfo, setProvisionInfo] = useState<SpectoProvisionInfo | null>(null)
    const [keyVisible, setKeyVisible] = useState(false)
    const [provisioning, setProvisioning] = useState(false)
    const [unlinking, setUnlinking] = useState(false)

    const [messageText, setMessageText] = useState("")
    const [sending, setSending] = useState(false)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setLoadFailed(false)
        setProvisionInfo(null)
        setKeyVisible(false)
        fetchSpectoStatus(uuid)
            .then((s) => {
                if (!cancelled) setStatus(s)
            })
            .catch(() => {
                if (!cancelled) setLoadFailed(true)
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [uuid])

    /** Link (or, when already linked, idempotently re-reveal) the OBS data.
     *  Shared by both the "Poveži stream" and "Prikaži OBS podatke" buttons -
     *  only one of the two is ever mounted at a time. */
    async function handleProvision() {
        setProvisioning(true)
        try {
            const info = await provisionSpecto(uuid)
            setProvisionInfo(info)
            setStatus((prev) => (prev ? { ...prev, linked: true, streamId: info.streamId } : prev))
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setProvisioning(false)
        }
    }

    async function handleUnlink() {
        if (!window.confirm("Odspojiti stream? Eventi se više neće slati.")) return
        setUnlinking(true)
        try {
            await unlinkSpecto(uuid)
            setStatus((prev) => (prev ? { ...prev, linked: false, streamId: null } : prev))
            setProvisionInfo(null)
            setKeyVisible(false)
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setUnlinking(false)
        }
    }

    async function handleSendMessage() {
        const text = messageText.trim()
        if (!text) return
        setSending(true)
        try {
            await sendSpectoMessage(uuid, text)
            setMessageText("")
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setSending(false)
        }
    }

    async function copyText(value: string) {
        try {
            await navigator.clipboard.writeText(value)
            showSuccess("Kopirano.")
        } catch {
            showError("Kopiranje nije uspjelo.")
        }
    }

    // Mono kicker + naslov, shared by every render branch below.
    const titleNode = (
        <Box>
            <MonoLabel color="pitch.500" letterSpacing="0.14em">SPECTOSTREAM</MonoLabel>
            <Box mt="0.5">Live stream overlay</Box>
        </Box>
    )

    if (loading) {
        return (
            <SectionCard title={titleNode} icon={FiRadio}>
                <HStack color="fg.muted" gap="2">
                    <Spinner size="sm" />
                    <Text fontSize="sm">Učitavanje…</Text>
                </HStack>
            </SectionCard>
        )
    }

    if (loadFailed || !status) {
        return (
            <SectionCard title={titleNode} icon={FiRadio}>
                <Text fontSize="sm" color="fg.muted">
                    Trenutno nije moguće dohvatiti SpectoStream status.
                </Text>
            </SectionCard>
        )
    }

    if (!status.configured) {
        return (
            <SectionCard title={titleNode} icon={FiRadio}>
                <Text fontSize="sm" color="fg.muted">
                    Integracija nije konfigurirana na serveru.
                </Text>
            </SectionCard>
        )
    }

    if (!status.linked) {
        return (
            <SectionCard title={titleNode} icon={FiRadio}>
                <VStack align="stretch" gap="3">
                    <Text fontSize="13px" color="fg.soft" lineHeight="1.5">
                        Poveži turnir sa SpectoStream platformom - dobit ćeš OBS podatke za
                        kameru, a zapisnik automatski šalje rezultat i sat na stream.
                    </Text>
                    <Button
                        colorPalette="pitch"
                        size="sm"
                        alignSelf="flex-start"
                        loading={provisioning}
                        onClick={handleProvision}
                    >
                        <FiLink /> Poveži stream
                    </Button>
                </VStack>
            </SectionCard>
        )
    }

    // Linked.
    return (
        <SectionCard
            title={titleNode}
            icon={FiRadio}
            action={<StatusChip status="active" label="Povezan" size="sm" />}
        >
            <VStack align="stretch" gap="4">
                {status.streamId && (
                    <HStack gap="1.5" color="fg.muted">
                        <FiRadio size={11} />
                        <Text fontFamily="mono" fontSize="12px">{status.streamId}</Text>
                    </HStack>
                )}

                {!provisionInfo ? (
                    <Button
                        colorPalette="pitch"
                        variant="outline"
                        size="sm"
                        alignSelf="flex-start"
                        loading={provisioning}
                        onClick={handleProvision}
                    >
                        <FiEye /> Prikaži OBS podatke
                    </Button>
                ) : (
                    <VStack align="stretch" gap="2">
                        {provisionInfo.obsServer && (
                            <CopyRow
                                label="OBS SERVER"
                                display={provisionInfo.obsServer}
                                copyAria="Kopiraj OBS server"
                                onCopy={() => copyText(provisionInfo.obsServer!)}
                            />
                        )}
                        {provisionInfo.obsStreamKey && (
                            <CopyRow
                                label="STREAM KEY"
                                display={keyVisible ? provisionInfo.obsStreamKey : MASKED_KEY}
                                copyAria="Kopiraj stream key"
                                onCopy={() => copyText(provisionInfo.obsStreamKey!)}
                                extraAction={
                                    <IconButton
                                        aria-label={keyVisible ? "Sakrij stream key" : "Prikaži stream key"}
                                        title={keyVisible ? "Sakrij stream key" : "Prikaži stream key"}
                                        size="xs"
                                        variant="ghost"
                                        colorPalette="pitch"
                                        onClick={() => setKeyVisible((v) => !v)}
                                    >
                                        {keyVisible ? <FiEyeOff size={13} /> : <FiEye size={13} />}
                                    </IconButton>
                                }
                            />
                        )}
                        {/* The link that matters inside this app: the stream
                            banner / hero player takes exactly this m3u8. */}
                        {provisionInfo.playbackUrl && (
                            <CopyRow
                                label="LINK ZA PRIKAZ (M3U8)"
                                display={provisionInfo.playbackUrl}
                                copyAria="Kopiraj link za prikaz"
                                onCopy={() => copyText(provisionInfo.playbackUrl!)}
                            />
                        )}
                        {provisionInfo.embedSnippet && (
                            <CopyRow
                                label="EMBED KOD (za vanjske stranice)"
                                display={provisionInfo.embedSnippet}
                                copyButtonLabel="Kopiraj embed kod"
                                onCopy={() => copyText(provisionInfo.embedSnippet!)}
                            />
                        )}
                    </VStack>
                )}

                {/* Poruka na stream - short overlay message. */}
                <Box>
                    <MonoLabel fontSize="9px">PORUKA NA STREAM</MonoLabel>
                    <HStack mt="1.5" gap="2">
                        <Input
                            size="sm"
                            placeholder="Kratka poruka za gledatelje…"
                            maxLength={200}
                            value={messageText}
                            onChange={(e) => setMessageText(e.target.value)}
                            disabled={sending}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleSendMessage()
                            }}
                        />
                        <Button
                            size="sm"
                            colorPalette="pitch"
                            flexShrink={0}
                            loading={sending}
                            disabled={!messageText.trim()}
                            onClick={handleSendMessage}
                        >
                            <FiSend /> Pošalji
                        </Button>
                    </HStack>
                </Box>

                <GhostButton
                    danger
                    icon={<FiSlash size={14} />}
                    disabled={unlinking}
                    onClick={handleUnlink}
                    alignSelf="flex-start"
                    px="3.5"
                    py="2"
                    fontSize="13px"
                >
                    {unlinking ? "Odspajanje…" : "Odspoji"}
                </GhostButton>
            </VStack>
        </SectionCard>
    )
}

/** One compact copyable data row: mono caption + mono value (truncated) +
 *  a trailing copy affordance - either a bare icon button, or (when
 *  `copyButtonLabel` is set) a labelled button for the longer embed snippet.
 *  `extraAction`, when given, renders before the copy control (the stream
 *  key's show/hide toggle). */
function CopyRow({
    label,
    display,
    onCopy,
    extraAction,
    copyButtonLabel,
    copyAria,
}: {
    label: string
    display: string
    onCopy: () => void
    extraAction?: ReactNode
    copyButtonLabel?: string
    copyAria?: string
}) {
    return (
        <Flex align="center" justify="space-between" gap="2" bg="bg.subtle" rounded="md" px="3" py="2">
            <Box minW="0" flex="1">
                <MonoLabel fontSize="9px">{label}</MonoLabel>
                <Text
                    fontFamily="mono"
                    fontSize={copyButtonLabel ? "12px" : "13px"}
                    color="fg.ink"
                    truncate
                    mt="0.5"
                >
                    {display}
                </Text>
            </Box>
            <HStack gap="0.5" flexShrink={0}>
                {extraAction}
                {copyButtonLabel ? (
                    <Button size="xs" variant="ghost" colorPalette="pitch" onClick={onCopy}>
                        <FiCopy size={12} /> {copyButtonLabel}
                    </Button>
                ) : (
                    <IconButton
                        aria-label={copyAria ?? `Kopiraj - ${label}`}
                        title={copyAria ?? `Kopiraj - ${label}`}
                        size="xs"
                        variant="ghost"
                        colorPalette="pitch"
                        onClick={onCopy}
                    >
                        <FiCopy size={13} />
                    </IconButton>
                )}
            </HStack>
        </Flex>
    )
}
