import { Badge, Button, Card, HStack, Spinner, Text, VStack, chakra } from "@chakra-ui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FiCalendar, FiCheck, FiMail, FiPhone, FiRotateCcw } from "react-icons/fi"
import { fetchCameraInquiries, setCameraInquiryHandled } from "../api/cameraInquiry"
import { ADMIN_PENDING_COUNTS_KEY } from "../api/adminCounts"
import { qk } from "../queryClient"
import { useTranslation } from "../i18n"

/**
 * Admin-only list of "zatraži ponudu" leads for the custom camera package
 * (/cjenik) - newest first. An admin still follows up by email/phone; the
 * only state a lead carries is `handledAt`, which exists so the admin
 * dashboard's pending badge for this module can be cleared once the lead has
 * been dealt with (there is no other lifecycle to derive that from).
 */
export default function AdminCameraInquiriesTab() {
    const t = useTranslation()
    const queryClient = useQueryClient()
    const { data: inquiries, isLoading } = useQuery({
        queryKey: qk.adminCameraInquiries,
        queryFn: fetchCameraInquiries,
    })

    const toggleHandled = useMutation({
        mutationFn: ({ id, handled }: { id: number; handled: boolean }) =>
            setCameraInquiryHandled(id, handled),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: qk.adminCameraInquiries })
            // The dashboard badge counts unhandled leads - refresh it too, or
            // it keeps showing the old number until its staleTime expires.
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
                    {inquiries && inquiries.length > 0 && (
                        <HStack gap="2" mb="3">
                            <Badge colorPalette="pitch" variant="subtle">{inquiries.length}</Badge>
                        </HStack>
                    )}

                    {isLoading ? (
                        <HStack justify="center" py="8"><Spinner /></HStack>
                    ) : !inquiries || inquiries.length === 0 ? (
                        <Text color="fg.muted" fontSize="sm" py="4" textAlign="center">
                            {t.components.adminCameraInquiriesTab.empty}
                        </Text>
                    ) : (
                        <VStack align="stretch" gap="3">
                            {inquiries.map((inq) => (
                                <Card.Root key={inq.id} variant="outline" borderColor="border" rounded="lg">
                                    <Card.Body p="4">
                                        <VStack align="stretch" gap="2">
                                            <HStack justify="space-between" wrap="wrap" gap="2">
                                                <Text fontWeight={700}>{inq.name}</Text>
                                                <HStack gap="1.5" fontSize="xs" color="fg.muted">
                                                    <FiCalendar size={12} />
                                                    <Text>{formatDateTime(inq.createdAt)}</Text>
                                                </HStack>
                                            </HStack>
                                            <HStack gap="2" wrap="wrap">
                                                <Badge variant="subtle" colorPalette="pitch">
                                                    {inq.tournamentName}
                                                </Badge>
                                                <Badge
                                                    variant="subtle"
                                                    colorPalette={inq.handledAt ? "green" : "orange"}
                                                >
                                                    {inq.handledAt
                                                        ? t.components.adminCameraInquiriesTab.handledBadge
                                                        : t.components.adminCameraInquiriesTab.openBadge}
                                                </Badge>
                                            </HStack>
                                            <HStack gap="4" wrap="wrap" fontSize="sm">
                                                <HStack gap="1.5">
                                                    <FiMail size={13} />
                                                    <chakra.a href={`mailto:${inq.contactEmail}`} style={{ textDecoration: "underline" }}>
                                                        {inq.contactEmail}
                                                    </chakra.a>
                                                </HStack>
                                                <HStack gap="1.5">
                                                    <FiPhone size={13} />
                                                    <chakra.a href={`tel:${inq.contactPhone.replace(/\s+/g, "")}`} style={{ textDecoration: "underline" }}>
                                                        {inq.contactPhone}
                                                    </chakra.a>
                                                </HStack>
                                            </HStack>
                                            <Text fontSize="sm" color="fg.muted" whiteSpace="pre-wrap">
                                                {inq.message}
                                            </Text>
                                            <HStack justify="flex-end">
                                                <Button
                                                    size="xs"
                                                    variant={inq.handledAt ? "ghost" : "outline"}
                                                    colorPalette={inq.handledAt ? "gray" : "green"}
                                                    loading={
                                                        toggleHandled.isPending &&
                                                        toggleHandled.variables?.id === inq.id
                                                    }
                                                    onClick={() =>
                                                        toggleHandled.mutate({
                                                            id: inq.id,
                                                            handled: !inq.handledAt,
                                                        })
                                                    }
                                                >
                                                    {inq.handledAt ? <FiRotateCcw /> : <FiCheck />}
                                                    {inq.handledAt
                                                        ? t.components.adminCameraInquiriesTab.markOpen
                                                        : t.components.adminCameraInquiriesTab.markHandled}
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

function formatDateTime(iso: string | null | undefined): string {
    if (!iso) return "-"
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return String(iso)
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
