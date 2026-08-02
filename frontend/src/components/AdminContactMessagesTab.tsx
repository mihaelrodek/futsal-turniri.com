import { Badge, Button, Card, HStack, Spinner, Text, VStack, chakra } from "@chakra-ui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FiCalendar, FiCheck, FiCornerUpLeft, FiMail, FiRotateCcw } from "react-icons/fi"
import {
    ADMIN_CONTACT_MESSAGES_KEY,
    fetchContactMessages,
    setContactMessageHandled,
    type ContactMessageDto,
} from "../api/contact"
import { ADMIN_PENDING_COUNTS_KEY } from "../api/adminCounts"
import { useTranslation } from "../i18n"

/**
 * Admin-only inbox of messages sent through the public „Kontaktiraj nas"
 * form (/kontakt) - newest first. An admin replies by email (the „Odgovori"
 * button is a plain `mailto:` with the subject pre-filled); the only state a
 * message carries is `handledAt`, which exists so the admin dashboard's
 * pending badge for this module can be cleared once the message has been
 * answered (there is no other lifecycle to derive that from).
 *
 * Prop-less default export on purpose - it is mounted by the admin module
 * registry, which passes nothing.
 */
export default function AdminContactMessagesTab() {
    const t = useTranslation()
    const c = t.components.adminContactMessagesTab
    const queryClient = useQueryClient()
    const { data: messages, isLoading } = useQuery({
        queryKey: ADMIN_CONTACT_MESSAGES_KEY,
        queryFn: fetchContactMessages,
    })

    const toggleHandled = useMutation({
        mutationFn: ({ id, handled }: { id: number; handled: boolean }) =>
            setContactMessageHandled(id, handled),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ADMIN_CONTACT_MESSAGES_KEY })
            // The dashboard badge counts unhandled messages - refresh it too,
            // or it keeps showing the old number until its staleTime expires.
            queryClient.invalidateQueries({ queryKey: ADMIN_PENDING_COUNTS_KEY })
        },
    })

    return (
        <VStack align="stretch" gap="4">
            <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
                <Card.Body p={{ base: "4", md: "6" }}>
                    {/* No card title: /admin/{slug} already names the module.
                        The count is the one thing the header carried that the
                        page header can't, so it stays - on its own. */}
                    {messages && messages.length > 0 && (
                        <HStack gap="2" mb="3">
                            <Badge colorPalette="pitch" variant="subtle">{messages.length}</Badge>
                        </HStack>
                    )}

                    {isLoading ? (
                        <HStack justify="center" py="8"><Spinner /></HStack>
                    ) : !messages || messages.length === 0 ? (
                        <Text color="fg.muted" fontSize="sm" py="4" textAlign="center">
                            {c.empty}
                        </Text>
                    ) : (
                        <VStack align="stretch" gap="3">
                            {messages.map((msg) => (
                                <Card.Root key={msg.id} variant="outline" borderColor="border" rounded="lg">
                                    <Card.Body p="4">
                                        <VStack align="stretch" gap="2">
                                            <HStack justify="space-between" wrap="wrap" gap="2">
                                                <Text fontWeight={700}>{msg.name}</Text>
                                                <HStack gap="1.5" fontSize="xs" color="fg.muted">
                                                    <FiCalendar size={12} />
                                                    <Text>{formatDateTime(msg.createdAt)}</Text>
                                                </HStack>
                                            </HStack>
                                            <HStack gap="2" wrap="wrap">
                                                {/* Reason first: it decides who
                                                    picks the message up, the
                                                    subject only says what it is
                                                    about. Solid so it wins the
                                                    row at a glance. */}
                                                <Badge variant="solid" colorPalette="pitch">
                                                    {t.pages.contactPage.reasons[msg.reason]}
                                                </Badge>
                                                <Badge variant="subtle" colorPalette="pitch">
                                                    {msg.subject || c.noSubject}
                                                </Badge>
                                                <Badge
                                                    variant="subtle"
                                                    colorPalette={msg.handledAt ? "green" : "orange"}
                                                >
                                                    {msg.handledAt ? c.handledBadge : c.openBadge}
                                                </Badge>
                                                {msg.userUid && (
                                                    <Badge variant="subtle" colorPalette="gray">
                                                        {c.registeredBadge}
                                                    </Badge>
                                                )}
                                            </HStack>
                                            <HStack gap="4" wrap="wrap" fontSize="sm">
                                                <HStack gap="1.5">
                                                    <FiMail size={13} />
                                                    <chakra.a href={`mailto:${msg.email}`} style={{ textDecoration: "underline" }}>
                                                        {msg.email}
                                                    </chakra.a>
                                                </HStack>
                                            </HStack>
                                            <Text fontSize="sm" color="fg.muted" whiteSpace="pre-wrap">
                                                {msg.message}
                                            </Text>
                                            <HStack justify="flex-end" gap="2" wrap="wrap">
                                                <Button size="xs" variant="outline" colorPalette="pitch" asChild>
                                                    <chakra.a href={replyHref(msg, c.replySubjectPrefix)}>
                                                        <FiCornerUpLeft />
                                                        {c.reply}
                                                    </chakra.a>
                                                </Button>
                                                <Button
                                                    size="xs"
                                                    variant={msg.handledAt ? "ghost" : "outline"}
                                                    colorPalette={msg.handledAt ? "gray" : "green"}
                                                    loading={
                                                        toggleHandled.isPending &&
                                                        toggleHandled.variables?.id === msg.id
                                                    }
                                                    onClick={() =>
                                                        toggleHandled.mutate({
                                                            id: msg.id,
                                                            handled: !msg.handledAt,
                                                        })
                                                    }
                                                >
                                                    {msg.handledAt ? <FiRotateCcw /> : <FiCheck />}
                                                    {msg.handledAt ? c.markOpen : c.markHandled}
                                                </Button>
                                            </HStack>
                                        </VStack>
                                    </Card.Body>
                                </Card.Root>
                            ))}
                        </VStack>
                    )}
                </Card.Body>
            </Card.Root>
        </VStack>
    )
}

/** `mailto:` with the original subject pre-filled as a reply - encoded, since
 *  a raw subject may contain `&`, `#` or a newline that would break the URL. */
function replyHref(msg: ContactMessageDto, prefix: string): string {
    const subject = `${prefix}${msg.subject ?? ""}`.trim()
    return `mailto:${encodeURIComponent(msg.email)}?subject=${encodeURIComponent(subject)}`
}

function formatDateTime(iso: string | null | undefined): string {
    if (!iso) return "-"
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return String(iso)
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
