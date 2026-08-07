import { useCallback, useEffect, useRef, useState } from "react"
import { isAxiosError } from "axios"
import { Link as RouterLink, useParams, useSearchParams } from "react-router-dom"
import {
    Badge,
    Box,
    Button,
    Card,
    HStack,
    Link as ChakraLink,
    Spinner,
    Text,
    VStack,
} from "@chakra-ui/react"
import { FiCreditCard, FiDownload, FiMessageSquare, FiVideo } from "react-icons/fi"
import {
    createRecordingCheckout,
    fetchPublicRecordingRequest,
    fetchRecordingDownloadLink,
    type PublicRecordingRequest,
    type RecordingRequestStatus,
} from "../api/recordingRequests"
import { useDocumentHead } from "../hooks/useDocumentHead"
import { useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   Public status page for a single recording request: /snimke/zahtjev/:uuid.
   No auth required - this is the link sent in approval/payment emails, and
   the only way an ANONYMOUS requester (no profile) can track or pay for
   their request. Signed-in users can also reach it from the same link;
   "Moje snimke" additionally surfaces the same actions inline.

   Stripe redirects back here with ?placanje=uspjeh|odustao. The webhook
   that flips `paid` can lag the redirect by a second, so on a "uspjeh"
   landing with `paid` still false we schedule ONE extra refetch ~2s later.
   ────────────────────────────────────────────────────────────────────── */

const STATUS_PALETTE: Record<RecordingRequestStatus, string> = {
    REQUESTED: "orange",
    APPROVED: "blue",
    REJECTED: "red",
    DELIVERED: "green",
    CANCELLED: "gray",
}

function formatKickoff(iso: string | null | undefined): string {
    if (!iso) return ""
    try {
        return new Date(iso).toLocaleString("hr-HR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        })
    } catch {
        return ""
    }
}

function formatPrice(cents: number | null | undefined): string {
    if (cents == null) return ""
    try {
        return new Intl.NumberFormat("hr-HR", { style: "currency", currency: "EUR" }).format(cents / 100)
    } catch {
        return `${(cents / 100).toFixed(2)} €`
    }
}

/** Pull `{"code": "..."}` out of a 409/410 response body, if present. */
function errorCode(err: unknown): string | undefined {
    if (!isAxiosError(err) || (err.response?.status !== 409 && err.response?.status !== 410)) return undefined
    const data = err.response.data as { code?: string } | undefined
    return data?.code
}

/** True for a 410 - the request's public link has aged past its 48h window
 *  since delivery (see backend RecordingRequestController#LINK_VALID_HOURS). */
function isExpiredError(err: unknown): boolean {
    return isAxiosError(err) && err.response?.status === 410
}

export default function RecordingRequestStatusPage() {
    const t = useTranslation()
    const { uuid = "" } = useParams<{ uuid: string }>()
    const [searchParams] = useSearchParams()
    const placanje = searchParams.get("placanje")

    const [data, setData] = useState<PublicRecordingRequest | null>(null)
    const [loading, setLoading] = useState(true)
    const [notFound, setNotFound] = useState(false)
    // Distinct from notFound - the request existed and was delivered, but its
    // 48h public-link window (from delivery, not from creation) has passed.
    const [expired, setExpired] = useState(false)

    const [checkoutBusy, setCheckoutBusy] = useState(false)
    const [checkoutError, setCheckoutError] = useState<string | null>(null)
    const [downloadBusy, setDownloadBusy] = useState(false)
    const [downloadError, setDownloadError] = useState<string | null>(null)

    const load = useCallback(async () => {
        if (!uuid) {
            setNotFound(true)
            setLoading(false)
            return
        }
        try {
            const d = await fetchPublicRecordingRequest(uuid)
            setData(d)
            setNotFound(false)
            setExpired(false)
        } catch (err) {
            if (isExpiredError(err)) {
                setExpired(true)
            } else {
                setNotFound(true)
            }
        } finally {
            setLoading(false)
        }
    }, [uuid])

    useEffect(() => {
        load()
    }, [load])

    // Stripe webhook may land a moment after the redirect - if we come back
    // with ?placanje=uspjeh but the row still isn't paid, try once more.
    const extraRefetchDone = useRef(false)
    useEffect(() => {
        if (placanje !== "uspjeh" || !data || data.paid) return
        if (extraRefetchDone.current) return
        extraRefetchDone.current = true
        const t = setTimeout(load, 2000)
        return () => clearTimeout(t)
    }, [placanje, data, load])

    useDocumentHead({
        title: t.recordingRequest.status.pageTitle,
        description: t.recordingRequest.status.pageDescription,
    })

    async function onCheckout() {
        if (checkoutBusy) return
        setCheckoutError(null)
        try {
            setCheckoutBusy(true)
            const { url } = await createRecordingCheckout(uuid)
            window.location.href = url
        } catch (err) {
            if (isExpiredError(err)) {
                setExpired(true)
                return
            }
            const code = errorCode(err)
            if (code === "NOT_CONFIGURED") {
                setCheckoutError(t.recordingRequest.status.checkoutErrorNotConfigured)
            } else if (code === "ALREADY_PAID") {
                setCheckoutError(t.recordingRequest.status.checkoutErrorAlreadyPaid)
                load()
            } else if (code === "NOT_APPROVED") {
                setCheckoutError(t.recordingRequest.status.checkoutErrorNotApproved)
            } else {
                setCheckoutError(t.recordingRequest.status.checkoutErrorGeneric)
            }
        } finally {
            setCheckoutBusy(false)
        }
    }

    async function onDownload() {
        if (downloadBusy) return
        setDownloadError(null)
        try {
            setDownloadBusy(true)
            const { url } = await fetchRecordingDownloadLink(uuid)
            window.open(url, "_blank")
        } catch (err) {
            if (isExpiredError(err)) {
                setExpired(true)
                return
            }
            const code = errorCode(err)
            if (code === "NOT_PAID") {
                setDownloadError(t.recordingRequest.status.downloadErrorNotPaid)
            } else {
                setDownloadError(t.recordingRequest.status.downloadErrorGeneric)
            }
        } finally {
            setDownloadBusy(false)
        }
    }

    if (loading) {
        return (
            <VStack py="16" gap="3">
                <Spinner />
                <Text color="fg.muted" fontSize="sm">{t.common.loading}</Text>
            </VStack>
        )
    }

    if (expired) {
        return (
            <Card.Root maxW="md" mx="auto" mt="6" variant="outline" rounded="xl">
                <Card.Body p="6">
                    <VStack gap="3" align="stretch">
                        <HStack gap="2">
                            <FiVideo />
                            <Text fontWeight={700}>{t.recordingRequest.status.linkExpiredTitle}</Text>
                        </HStack>
                        <Text fontSize="sm" color="fg.muted">
                            {t.recordingRequest.status.linkExpiredDescription}
                        </Text>
                        <Button size="sm" variant="outline" mt="2" asChild>
                            <RouterLink to={`/kontakt?razlog=PLACANJE&ref=${uuid}`}>
                                <FiMessageSquare /> {t.recordingRequest.status.contactButton}
                            </RouterLink>
                        </Button>
                    </VStack>
                </Card.Body>
            </Card.Root>
        )
    }

    if (notFound || !data) {
        return (
            <Card.Root maxW="md" mx="auto" mt="6" variant="outline" rounded="xl">
                <Card.Body p="6">
                    <VStack gap="3" align="stretch">
                        <HStack gap="2">
                            <FiVideo />
                            <Text fontWeight={700}>{t.recordingRequest.status.notFoundTitle}</Text>
                        </HStack>
                        <Text fontSize="sm" color="fg.muted">
                            {t.recordingRequest.status.notFoundDescription}
                        </Text>
                        <Button asChild variant="outline" size="sm" mt="2">
                            <RouterLink to="/turniri">{t.recordingRequest.status.backToTournaments}</RouterLink>
                        </Button>
                    </VStack>
                </Card.Body>
            </Card.Root>
        )
    }

    const matchLabel =
        data.team1Name && data.team2Name ? `${data.team1Name} — ${data.team2Name}` : t.recordingRequest.status.matchLabelFallback
    const kickoff = formatKickoff(data.kickoffAt)
    const price = formatPrice(data.priceEurCents)

    // Payment is due whenever a request has moved past REQUESTED but hasn't
    // been paid yet - covers both the normal APPROVED-then-pay step and a
    // DELIVERED-before-paid edge (video linked ahead of payment).
    const isGoal = data.kind === "GOAL"
    const paymentDue = !data.paid && (data.status === "APPROVED" || data.status === "DELIVERED")
    const processing = data.paid && !data.hasVideo
    const downloadReady = data.status === "DELIVERED" && data.paid && data.hasVideo

    return (
        <Card.Root maxW="md" mx="auto" mt="6" variant="outline" rounded="xl" shadow="sm">
            <Card.Body p="6">
                <VStack align="stretch" gap="4">
                    {placanje === "uspjeh" && (
                        <Box
                            colorPalette="green"
                            borderWidth="1px"
                            borderColor="colorPalette.muted"
                            bg="colorPalette.subtle"
                            rounded="md"
                            p="3"
                        >
                            <Text fontSize="sm" fontWeight={600} color="colorPalette.fg">
                                {t.recordingRequest.status.paymentSuccess}
                            </Text>
                        </Box>
                    )}
                    {placanje === "odustao" && (
                        <Box borderWidth="1px" borderColor="border.emphasized" bg="bg.subtle" rounded="md" p="3">
                            <Text fontSize="sm">
                                {t.recordingRequest.status.paymentCancelled}
                            </Text>
                        </Box>
                    )}

                    <Box>
                        <Text fontSize="xs" color="fg.muted">{t.recordingRequest.status.requestLabel}</Text>
                        <Text fontSize="lg" fontWeight={700} mt="1">{matchLabel}</Text>
                        <Text fontSize="sm" color="fg.muted" mt="0.5">
                            {data.tournamentName}
                            {kickoff ? ` · ${kickoff}` : ""}
                        </Text>
                    </Box>

                    <HStack justify="space-between" wrap="wrap" gap="2">
                        <Badge variant="solid" colorPalette={STATUS_PALETTE[data.status] ?? "gray"} size="sm">
                            {t.recordingRequest.statusLabels[data.status] ?? data.status}
                        </Badge>
                        <HStack gap="2">
                            {data.paid && (
                                <Badge variant="subtle" colorPalette="green" size="sm">
                                    {t.recordingRequest.status.paidBadge}
                                </Badge>
                            )}
                            {price && (
                                <Text fontFamily="mono" fontWeight={700} fontSize="sm">{price}</Text>
                            )}
                        </HStack>
                    </HStack>

                    {data.status === "REQUESTED" && (
                        <Text fontSize="sm" color="fg.muted">
                            {t.recordingRequest.status.awaitingApproval}
                        </Text>
                    )}

                    {data.status === "REJECTED" && (
                        <Text fontSize="sm" color="fg.muted">{t.recordingRequest.status.rejected}</Text>
                    )}

                    {data.status === "CANCELLED" && (
                        <Text fontSize="sm" color="fg.muted">{t.recordingRequest.status.cancelled}</Text>
                    )}

                    {paymentDue && (
                        <VStack align="stretch" gap="2">
                            {/* What the money buys, spelled out next to the
                                button. A price alone doesn't say what arrives,
                                and the withdrawal-right clause in the terms
                                only holds if the buyer was actually told what
                                they are ordering before they pay. */}
                            <Box borderWidth="1px" borderColor="border.emphasized" bg="bg.subtle" rounded="md" p="3">
                                <Text fontSize="sm" fontWeight={700}>
                                    {isGoal
                                        ? t.recordingRequest.status.packageTitleGoal
                                        : t.recordingRequest.status.packageTitleMatch}
                                </Text>
                                <Text fontSize="sm" color="fg.muted" mt="0.5">
                                    {isGoal
                                        ? t.recordingRequest.status.packageBodyGoal
                                        : t.recordingRequest.status.packageBodyMatch}
                                </Text>
                            </Box>
                            <Button
                                size="lg"
                                colorPalette="pitch"
                                variant="solid"
                                loading={checkoutBusy}
                                onClick={onCheckout}
                            >
                                <FiCreditCard /> {t.recordingRequest.status.payButton(price)}
                            </Button>
                            {checkoutError && (
                                <Text fontSize="sm" color="red.500">{checkoutError}</Text>
                            )}
                            <Text fontSize="xs" color="fg.muted">
                                {t.recordingRequest.status.termsNoteBefore}{" "}
                                <ChakraLink asChild color="pitch.600" fontWeight={600}>
                                    <RouterLink to="/uvjeti">
                                        {t.recordingRequest.status.termsLinkLabel}
                                    </RouterLink>
                                </ChakraLink>
                                {t.recordingRequest.status.termsNoteAfter}
                            </Text>
                        </VStack>
                    )}

                    {!paymentDue && processing && (
                        <Text fontSize="sm" color="fg.muted">
                            {t.recordingRequest.status.processing}
                        </Text>
                    )}

                    {!paymentDue && downloadReady && (
                        <VStack align="stretch" gap="2">
                            <Button
                                size="lg"
                                colorPalette="pitch"
                                variant="solid"
                                loading={downloadBusy}
                                onClick={onDownload}
                            >
                                <FiDownload /> {t.recordingRequest.status.downloadButton}
                            </Button>
                            <Text fontSize="xs" color="fg.muted">{t.recordingRequest.status.downloadLinkNote}</Text>
                            {downloadError && (
                                <Text fontSize="sm" color="red.500">{downloadError}</Text>
                            )}
                        </VStack>
                    )}

                    {/* Escape hatch. This page is where a purchase goes wrong -
                        payment refused, download dead, request stuck - and it
                        is often the ONLY page an anonymous buyer has. The
                        contact form arrives with the reason preselected and
                        this request's uuid as the reference, so nobody has to
                        explain which request they mean. */}
                    <Box borderTopWidth="1px" borderColor="border" pt="3">
                        <HStack justify="space-between" gap="2" wrap="wrap">
                            <Text fontSize="xs" color="fg.muted">
                                {t.recordingRequest.status.contactHint}
                            </Text>
                            <Button size="xs" variant="outline" asChild>
                                <RouterLink to={`/kontakt?razlog=PLACANJE&ref=${uuid}`}>
                                    <FiMessageSquare /> {t.recordingRequest.status.contactButton}
                                </RouterLink>
                            </Button>
                        </HStack>
                    </Box>
                </VStack>
            </Card.Body>
        </Card.Root>
    )
}
