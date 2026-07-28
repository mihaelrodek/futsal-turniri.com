import { useCallback, useEffect, useRef, useState } from "react"
import { isAxiosError } from "axios"
import { Link as RouterLink, useParams, useSearchParams } from "react-router-dom"
import {
    Badge,
    Box,
    Button,
    Card,
    HStack,
    Spinner,
    Text,
    VStack,
} from "@chakra-ui/react"
import { FiCreditCard, FiDownload, FiVideo } from "react-icons/fi"
import {
    createRecordingCheckout,
    fetchPublicRecordingRequest,
    fetchRecordingDownloadLink,
    type PublicRecordingRequest,
    type RecordingRequestStatus,
} from "../api/recordingRequests"
import { useDocumentHead } from "../hooks/useDocumentHead"

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

const STATUS_LABEL: Record<RecordingRequestStatus, string> = {
    REQUESTED: "Zatraženo",
    APPROVED: "Odobreno",
    REJECTED: "Odbijeno",
    DELIVERED: "Isporučeno",
    CANCELLED: "Otkazano",
}

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

/** Pull `{"code": "..."}` out of a 409 response body, if present. */
function errorCode(err: unknown): string | undefined {
    if (!isAxiosError(err) || err.response?.status !== 409) return undefined
    const data = err.response.data as { code?: string } | undefined
    return data?.code
}

export default function RecordingRequestStatusPage() {
    const { uuid = "" } = useParams<{ uuid: string }>()
    const [searchParams] = useSearchParams()
    const placanje = searchParams.get("placanje")

    const [data, setData] = useState<PublicRecordingRequest | null>(null)
    const [loading, setLoading] = useState(true)
    const [notFound, setNotFound] = useState(false)

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
        } catch {
            setNotFound(true)
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
        title: "Zahtjev za snimku - futsal-turniri.com",
        description: "Status zahtjeva za video snimku utakmice.",
    })

    async function onCheckout() {
        if (checkoutBusy) return
        setCheckoutError(null)
        try {
            setCheckoutBusy(true)
            const { url } = await createRecordingCheckout(uuid)
            window.location.href = url
        } catch (err) {
            const code = errorCode(err)
            if (code === "NOT_CONFIGURED") {
                setCheckoutError("Plaćanje trenutno nije dostupno, pokušaj kasnije.")
            } else if (code === "ALREADY_PAID") {
                setCheckoutError("Ova snimka je već plaćena.")
                load()
            } else if (code === "NOT_APPROVED") {
                setCheckoutError("Zahtjev još nije odobren.")
            } else {
                setCheckoutError("Plaćanje trenutno nije moguće.")
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
            const code = errorCode(err)
            if (code === "NOT_PAID") {
                setDownloadError("Snimka još nije plaćena.")
            } else {
                setDownloadError("Snimka još nije spremna za preuzimanje.")
            }
        } finally {
            setDownloadBusy(false)
        }
    }

    if (loading) {
        return (
            <VStack py="16" gap="3">
                <Spinner />
                <Text color="fg.muted" fontSize="sm">Učitavanje…</Text>
            </VStack>
        )
    }

    if (notFound || !data) {
        return (
            <Card.Root maxW="md" mx="auto" mt="6" variant="outline" rounded="xl">
                <Card.Body p="6">
                    <VStack gap="3" align="stretch">
                        <HStack gap="2">
                            <FiVideo />
                            <Text fontWeight={700}>Zahtjev nije pronađen</Text>
                        </HStack>
                        <Text fontSize="sm" color="fg.muted">
                            Poveznica za zahtjev nije valjana ili je zahtjev obrisan.
                        </Text>
                        <Button asChild variant="outline" size="sm" mt="2">
                            <RouterLink to="/turniri">Natrag na turnire</RouterLink>
                        </Button>
                    </VStack>
                </Card.Body>
            </Card.Root>
        )
    }

    const matchLabel =
        data.team1Name && data.team2Name ? `${data.team1Name} — ${data.team2Name}` : "Utakmica"
    const kickoff = formatKickoff(data.kickoffAt)
    const price = formatPrice(data.priceEurCents)

    // Payment is due whenever a request has moved past REQUESTED but hasn't
    // been paid yet - covers both the normal APPROVED-then-pay step and a
    // DELIVERED-before-paid edge (video linked ahead of payment).
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
                                Plaćanje uspješno! Hvala.
                            </Text>
                        </Box>
                    )}
                    {placanje === "odustao" && (
                        <Box borderWidth="1px" borderColor="border.emphasized" bg="bg.subtle" rounded="md" p="3">
                            <Text fontSize="sm">
                                Plaćanje je prekinuto — možeš pokušati ponovno.
                            </Text>
                        </Box>
                    )}

                    <Box>
                        <Text fontSize="xs" color="fg.muted">ZAHTJEV ZA SNIMKU</Text>
                        <Text fontSize="lg" fontWeight={700} mt="1">{matchLabel}</Text>
                        <Text fontSize="sm" color="fg.muted" mt="0.5">
                            {data.tournamentName}
                            {kickoff ? ` · ${kickoff}` : ""}
                        </Text>
                    </Box>

                    <HStack justify="space-between" wrap="wrap" gap="2">
                        <Badge variant="solid" colorPalette={STATUS_PALETTE[data.status] ?? "gray"} size="sm">
                            {STATUS_LABEL[data.status] ?? data.status}
                        </Badge>
                        <HStack gap="2">
                            {data.paid && (
                                <Badge variant="subtle" colorPalette="green" size="sm">
                                    Plaćeno
                                </Badge>
                            )}
                            {price && (
                                <Text fontFamily="mono" fontWeight={700} fontSize="sm">{price}</Text>
                            )}
                        </HStack>
                    </HStack>

                    {data.status === "REQUESTED" && (
                        <Text fontSize="sm" color="fg.muted">
                            Zahtjev čeka odobrenje. Obavijest stiže na email.
                        </Text>
                    )}

                    {data.status === "REJECTED" && (
                        <Text fontSize="sm" color="fg.muted">Zahtjev je odbijen.</Text>
                    )}

                    {data.status === "CANCELLED" && (
                        <Text fontSize="sm" color="fg.muted">Zahtjev je otkazan.</Text>
                    )}

                    {paymentDue && (
                        <VStack align="stretch" gap="2">
                            <Button
                                size="lg"
                                colorPalette="pitch"
                                variant="solid"
                                loading={checkoutBusy}
                                onClick={onCheckout}
                            >
                                <FiCreditCard /> Plati snimku {price ? `(${price})` : ""}
                            </Button>
                            {checkoutError && (
                                <Text fontSize="sm" color="red.500">{checkoutError}</Text>
                            )}
                        </VStack>
                    )}

                    {!paymentDue && processing && (
                        <Text fontSize="sm" color="fg.muted">
                            Plaćanje zaprimljeno. Snimka stiže uskoro — obavijest dolazi emailom.
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
                                <FiDownload /> Preuzmi snimku
                            </Button>
                            <Text fontSize="xs" color="fg.muted">Poveznica vrijedi 48 sati.</Text>
                            {downloadError && (
                                <Text fontSize="sm" color="red.500">{downloadError}</Text>
                            )}
                        </VStack>
                    )}
                </VStack>
            </Card.Body>
        </Card.Root>
    )
}
