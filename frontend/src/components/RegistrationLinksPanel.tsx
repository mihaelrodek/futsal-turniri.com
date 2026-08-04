import { useEffect, useState } from "react"
import { Badge, Box, Button, HStack, IconButton, Input, Stack, Text } from "@chakra-ui/react"
import { FiChevronDown, FiChevronRight, FiCopy, FiLink, FiPlus, FiSlash, FiTrash2 } from "react-icons/fi"

import {
    createRegistrationLink,
    deleteRegistrationLink,
    fetchRegistrationLinks,
    registrationLinkUrl,
    setRegistrationLinkActive,
    type RegistrationLink,
} from "../api/teamRegistration"
import { showError, showSuccess } from "../toaster"
import { Panel } from "../ui/primitives"
import { useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   RegistrationLinksPanel - the organizer half of team registration.

   Generates a link per club ("NK Sokol"), copies it, and switches it off when
   the club has entered. Whoever holds an active link can file ONE registration
   without an account; nothing they file is public until the organizer approves
   the team, so a leaked link costs a line in the review queue and nothing more.

   Collapsed by default: most tournaments are run without ever sending a link,
   and this must not push the team list down the page for them.
   ────────────────────────────────────────────────────────────────────── */

export default function RegistrationLinksPanel({ uuid }: { uuid: string }) {
    const t = useTranslation()
    const r = t.components.registrationLinks

    const [open, setOpen] = useState(false)
    const [links, setLinks] = useState<RegistrationLink[] | null>(null)
    const [label, setLabel] = useState("")
    const [busy, setBusy] = useState(false)

    // Loaded on first expand, not on mount: the panel is closed for the common
    // case and a request nobody asked for is a request nobody needs.
    useEffect(() => {
        if (!open || links !== null) return
        let cancelled = false
        fetchRegistrationLinks(uuid)
            .then((rows) => { if (!cancelled) setLinks(rows) })
            .catch(() => { if (!cancelled) setLinks([]) })
        return () => { cancelled = true }
    }, [open, links, uuid])

    async function create() {
        if (busy) return
        try {
            setBusy(true)
            const created = await createRegistrationLink(uuid, label.trim() || null)
            setLinks((prev) => [created, ...(prev ?? [])])
            setLabel("")
            // Straight to the clipboard - the next thing an organizer does with
            // a link they just made is paste it into a message.
            await copy(registrationLinkUrl(created.token), r.copied, r.copyFailed)
        } finally {
            setBusy(false)
        }
    }

    async function remove(link: RegistrationLink) {
        if (busy) return
        // Deleting loses only the "which link did this team come through"
        // trail, never a registration - but say so before doing it, because
        // that trail is the whole reason revoking exists as a softer option.
        if (!window.confirm(r.deletePrompt(link.label || r.unlabeled))) return
        try {
            setBusy(true)
            await deleteRegistrationLink(link.id)
            setLinks((prev) => (prev ?? []).filter((x) => x.id !== link.id))
        } finally {
            setBusy(false)
        }
    }

    async function toggleActive(link: RegistrationLink) {
        if (busy) return
        try {
            setBusy(true)
            const updated = await setRegistrationLinkActive(link.id, !link.active)
            setLinks((prev) => (prev ?? []).map((x) => (x.id === updated.id ? updated : x)))
        } finally {
            setBusy(false)
        }
    }

    return (
        <Panel p={{ base: "4", md: "5" }}>
            <HStack justify="space-between" align="center" mb={open ? "3" : "0"}>
                <HStack gap="2" align="center" minW="0">
                    <Box color="pitch.fg"><FiLink /></Box>
                    <Text fontWeight="semibold" fontSize="sm">{r.title}</Text>
                    {links && links.length > 0 && (
                        <Badge variant="subtle" colorPalette="pitch" size="sm">{links.length}</Badge>
                    )}
                </HStack>
                <IconButton
                    aria-label={open ? r.collapse : r.expand}
                    size="xs"
                    variant="ghost"
                    onClick={() => setOpen((v) => !v)}
                >
                    {open ? <FiChevronDown /> : <FiChevronRight />}
                </IconButton>
            </HStack>

            {open && (
                <Stack gap="3">
                    <Text fontSize="xs" color="fg.muted">{r.hint}</Text>

                    <HStack gap="2" wrap={{ base: "wrap", sm: "nowrap" }}>
                        <Input
                            size="sm"
                            maxLength={200}
                            placeholder={r.labelPlaceholder}
                            value={label}
                            onChange={(e) => setLabel(e.target.value)}
                        />
                        <Button
                            size="sm"
                            colorPalette="pitch"
                            loading={busy}
                            flexShrink={0}
                            onClick={create}
                        >
                            <FiPlus /> {r.create}
                        </Button>
                    </HStack>

                    {links === null ? null : links.length === 0 ? (
                        <Text fontSize="sm" color="fg.muted">{r.empty}</Text>
                    ) : (
                        <Stack gap="1.5">
                            {links.map((link) => (
                                <Box
                                    key={link.id}
                                    p="2.5"
                                    bg="bg.subtle"
                                    rounded="md"
                                    borderWidth="1px"
                                    borderColor="border.subtle"
                                    opacity={link.active ? 1 : 0.6}
                                >
                                    <HStack justify="space-between" gap="2" wrap="wrap" align="flex-start">
                                        <Box minW="0" flex="1">
                                            <HStack gap="2" wrap="wrap">
                                                <Text fontSize="sm" fontWeight={700} truncate>
                                                    {link.label || r.unlabeled}
                                                </Text>
                                                {!link.active && (
                                                    <Badge size="sm" variant="subtle" colorPalette="gray">
                                                        {r.revoked}
                                                    </Badge>
                                                )}
                                                {link.teamCount > 0 && (
                                                    <Badge size="sm" variant="subtle" colorPalette="green">
                                                        {r.teamCount(link.teamCount)}
                                                    </Badge>
                                                )}
                                            </HStack>
                                            <Text
                                                fontSize="xs"
                                                color="fg.muted"
                                                fontFamily="mono"
                                                css={{ overflowWrap: "anywhere" }}
                                            >
                                                {registrationLinkUrl(link.token)}
                                            </Text>
                                        </Box>
                                        <HStack gap="1.5" flexShrink={0}>
                                            <Button
                                                size="xs"
                                                variant="outline"
                                                colorPalette="pitch"
                                                onClick={() => copy(registrationLinkUrl(link.token), r.copied, r.copyFailed)}
                                            >
                                                <FiCopy /> {r.copy}
                                            </Button>
                                            <Button
                                                size="xs"
                                                variant="ghost"
                                                colorPalette={link.active ? "orange" : "gray"}
                                                disabled={busy}
                                                onClick={() => toggleActive(link)}
                                            >
                                                <FiSlash /> {link.active ? r.revoke : r.restore}
                                            </Button>
                                            <IconButton
                                                aria-label={r.delete}
                                                title={r.delete}
                                                size="xs"
                                                variant="ghost"
                                                colorPalette="red"
                                                disabled={busy}
                                                onClick={() => remove(link)}
                                            >
                                                <FiTrash2 />
                                            </IconButton>
                                        </HStack>
                                    </HStack>
                                </Box>
                            ))}
                        </Stack>
                    )}
                </Stack>
            )}
        </Panel>
    )
}

async function copy(text: string, okMsg: string, failMsg: string) {
    try {
        await navigator.clipboard.writeText(text)
        showSuccess(okMsg)
    } catch {
        // Clipboard permission is the only local failure worth naming - the
        // URL is on screen and selectable either way.
        showError(failMsg)
    }
}
