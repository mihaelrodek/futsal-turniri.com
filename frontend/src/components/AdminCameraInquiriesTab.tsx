import { Badge, Card, HStack, Spinner, Text, VStack, chakra } from "@chakra-ui/react"
import { useQuery } from "@tanstack/react-query"
import { FiCalendar, FiMail, FiPhone } from "react-icons/fi"
import { fetchCameraInquiries } from "../api/cameraInquiry"
import { qk } from "../queryClient"
import { useTranslation } from "../i18n"

/**
 * Admin-only read list of "zatraži ponudu" leads for the custom camera
 * package (/cjenik) - newest first. No status/lifecycle, no mutations: an
 * admin follows up directly by email/phone, same as any other lead.
 */
export default function AdminCameraInquiriesTab() {
    const t = useTranslation()
    const { data: inquiries, isLoading } = useQuery({
        queryKey: qk.adminCameraInquiries,
        queryFn: fetchCameraInquiries,
    })

    return (
        <VStack align="stretch" gap="4">
            <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
                <Card.Body p={{ base: "4", md: "6" }}>
                    <VStack align="stretch" gap="1" mb="4">
                        <HStack gap="2">
                            <Text fontWeight={700} fontSize="lg">{t.components.adminCameraInquiriesTab.title}</Text>
                            {inquiries && <Badge colorPalette="pitch" variant="subtle">{inquiries.length}</Badge>}
                        </HStack>
                        <Text fontSize="sm" color="fg.muted">
                            {t.components.adminCameraInquiriesTab.description}
                        </Text>
                    </VStack>

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
                                            <Badge variant="subtle" colorPalette="pitch" alignSelf="flex-start">
                                                {inq.tournamentName}
                                            </Badge>
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
