import { useEffect, useState } from "react"
import { useNavigate, useParams, Link as RouterLink } from "react-router-dom"
import {
    Badge,
    Box,
    Button,
    Card,
    Heading,
    HStack,
    Spinner,
    Text,
    VStack,
} from "@chakra-ui/react"
import {
    type ClaimPreviewDto,
    fetchClaimPreview,
    claimTeam,
} from "../api/teamClaim"
import { useAuth } from "../auth/AuthContext"

/**
 * Landing page for the team-sharing URL: /claim-team/{token}.
 *
 * Shows a preview of the team (which tournament, which primary
 * submitter) and a Preuzmi button. If the visitor isn't logged in,
 * we surface a "Prijavi se da preuzmeš" CTA instead.
 *
 * On successful claim we redirect to the visitor's profile so they
 * can see the team show up in their tournament history.
 */
export default function ClaimTeamPage() {
    const { token = "" } = useParams<{ token: string }>()
    const navigate = useNavigate()
    const { user, loading: authLoading } = useAuth()

    const [preview, setPreview] = useState<ClaimPreviewDto | null>(null)
    const [loading, setLoading] = useState(true)
    const [notFound, setNotFound] = useState(false)
    const [claiming, setClaiming] = useState(false)
    const [claimMessage, setClaimMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null)

    // Initial preview load.
    useEffect(() => {
        if (!token) {
            setNotFound(true)
            setLoading(false)
            return
        }
        let cancelled = false
        ;(async () => {
            try {
                const data = await fetchClaimPreview(token)
                if (!cancelled) setPreview(data)
            } catch {
                if (!cancelled) setNotFound(true)
            } finally {
                if (!cancelled) setLoading(false)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [token])

    const handleClaim = async () => {
        if (!user?.uid) return
        setClaiming(true)
        setClaimMessage(null)
        try {
            await claimTeam(token)
            setClaimMessage({
                kind: "ok",
                text: "Ekipa je dodana na tvoj profil.",
            })
            // Short delay so the user sees confirmation, then jump to their profile.
            setTimeout(() => {
                navigate("/profil", { replace: true })
            }, 1200)
        } catch (err: any) {
            const status = err?.response?.status
            const body = err?.response?.data
            if (status === 409 && body === "OWNER_SAME") {
                setClaimMessage({
                    kind: "err",
                    text: "Već si vlasnik ove ekipe - ne možeš preuzeti vlastitu ekipu.",
                })
            } else if (status === 409 && body === "ALREADY_CLAIMED") {
                setClaimMessage({
                    kind: "err",
                    text: "Ovu ekipu je već preuzeo netko drugi.",
                })
            } else if (status === 401) {
                setClaimMessage({
                    kind: "err",
                    text: "Prijavi se da preuzmeš ekipu.",
                })
            } else {
                setClaimMessage({
                    kind: "err",
                    text: "Preuzimanje nije uspjelo.",
                })
            }
        } finally {
            setClaiming(false)
        }
    }

    if (loading || authLoading) {
        return (
            <VStack py="16" gap="3">
                <Spinner />
                <Text color="fg.muted" fontSize="sm">Učitavanje…</Text>
            </VStack>
        )
    }

    if (notFound || !preview) {
        return (
            <Card.Root maxW="md" mx="auto" mt="6" variant="outline" rounded="xl">
                <Card.Body p="6">
                    <VStack gap="3" align="stretch">
                        <Heading size="md">Veza nije pronađena</Heading>
                        <Text fontSize="sm" color="fg.muted">
                            Poveznica za preuzimanje ekipe nije valjana ili je ekipa
                            obrisana. Pitaj svojeg suigrača da ti pošalje novu vezu.
                        </Text>
                        <Button asChild variant="outline" size="sm" mt="2">
                            <RouterLink to="/turniri">Natrag na turnire</RouterLink>
                        </Button>
                    </VStack>
                </Card.Body>
            </Card.Root>
        )
    }

    return (
        <Card.Root maxW="md" mx="auto" mt="6" variant="outline" rounded="xl">
            <Card.Body p="6">
                <VStack gap="4" align="stretch">
                    <Box>
                        <Text fontSize="xs" color="fg.muted">PREUZMI EKIPU</Text>
                        <Heading size="lg" mt="1">{preview.teamName}</Heading>
                    </Box>

                    <Box>
                        <Text fontSize="sm" color="fg.muted">Turnir:</Text>
                        <Text fontWeight="medium">
                            {preview.tournamentRef ? (
                                <RouterLink
                                    to={`/turniri/${preview.tournamentRef}`}
                                    style={{ color: "var(--chakra-colors-blue-fg)" }}
                                >
                                    {preview.tournamentName}
                                </RouterLink>
                            ) : (
                                preview.tournamentName
                            )}
                        </Text>
                        {preview.tournamentStartAt && (
                            <Text fontSize="xs" color="fg.muted" mt="1">
                                {new Date(preview.tournamentStartAt).toLocaleString("hr-HR", {
                                    day: "2-digit",
                                    month: "short",
                                    year: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                })}
                            </Text>
                        )}
                    </Box>

                    {preview.primaryName && (
                        <Box>
                            <Text fontSize="sm" color="fg.muted">Prijavio:</Text>
                            <Text fontWeight="medium">
                                {preview.primarySlug ? (
                                    <RouterLink
                                        to={`/profil/${preview.primarySlug}`}
                                        style={{ color: "var(--chakra-colors-blue-fg)" }}
                                    >
                                        {preview.primaryName}
                                    </RouterLink>
                                ) : (
                                    preview.primaryName
                                )}
                            </Text>
                        </Box>
                    )}

                    {preview.alreadyClaimed && (
                        <Box
                            p="3"
                            rounded="md"
                            bg="orange.50"
                            borderWidth="1px"
                            borderColor="orange.200"
                        >
                            <HStack gap="2">
                                <Badge colorPalette="orange" variant="subtle">Već preuzet</Badge>
                                {preview.coOwnerName && (
                                    <Text fontSize="sm">
                                        {preview.coOwnerName}
                                    </Text>
                                )}
                            </HStack>
                            <Text fontSize="xs" color="fg.muted" mt="2">
                                Ekipu je već preuzeo netko drugi i ne može se ponovno preuzeti.
                            </Text>
                        </Box>
                    )}

                    {claimMessage && (
                        <Box
                            p="3"
                            rounded="md"
                            bg={claimMessage.kind === "ok" ? "green.50" : "red.50"}
                            borderWidth="1px"
                            borderColor={claimMessage.kind === "ok" ? "green.200" : "red.200"}
                        >
                            <Text fontSize="sm">{claimMessage.text}</Text>
                        </Box>
                    )}

                    {!user?.uid ? (
                        <Button
                            asChild
                            colorPalette="pitch"
                            variant="solid"
                            size="md"
                        >
                            <RouterLink
                                to={`/prijava?next=${encodeURIComponent(`/preuzmi-ekipu/${token}`)}`}
                            >
                                Prijavi se da preuzmeš
                            </RouterLink>
                        </Button>
                    ) : (
                        <Button
                            colorPalette="pitch"
                            variant="solid"
                            size="md"
                            loading={claiming}
                            disabled={
                                claiming ||
                                preview.alreadyClaimed ||
                                claimMessage?.kind === "ok"
                            }
                            onClick={handleClaim}
                        >
                            Preuzmi ekipu
                        </Button>
                    )}
                </VStack>
            </Card.Body>
        </Card.Root>
    )
}
