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
    type PresetClaimPreviewDto,
    fetchPresetClaimPreview,
    claimPreset,
} from "../api/presetClaim"
import { useAuth } from "../auth/AuthContext"
import { useTranslation } from "../i18n"

/**
 * Landing page for the preset share URL: /claim-name/{token}.
 *
 * Friend sees the team name + which user is sharing, taps Preuzmi, and
 * becomes co-owner of the preset. After that, every tournament where
 * the primary played as that name shows up on the friend's profile too
 * (the backend backfills coSubmittedByUid on every matching Team so
 * push notifications and bill access also apply).
 */
export default function ClaimNamePage() {
    const { token = "" } = useParams<{ token: string }>()
    const navigate = useNavigate()
    const { user, loading: authLoading } = useAuth()
    const t = useTranslation()

    const [preview, setPreview] = useState<PresetClaimPreviewDto | null>(null)
    const [loading, setLoading] = useState(true)
    const [notFound, setNotFound] = useState(false)
    const [claiming, setClaiming] = useState(false)
    const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null)

    useEffect(() => {
        if (!token) {
            setNotFound(true)
            setLoading(false)
            return
        }
        let cancelled = false
        ;(async () => {
            try {
                const data = await fetchPresetClaimPreview(token)
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
        setMessage(null)
        try {
            await claimPreset(token)
            setMessage({ kind: "ok", text: t.pages.claimNamePage.claimSuccess })
            setTimeout(() => navigate("/profil", { replace: true }), 1200)
        } catch (err: any) {
            const status = err?.response?.status
            const body = err?.response?.data
            if (status === 409 && body === "OWNER_SAME") {
                setMessage({
                    kind: "err",
                    text: t.pages.claimNamePage.errorOwnerSame,
                })
            } else if (status === 409 && body === "ALREADY_CLAIMED") {
                setMessage({
                    kind: "err",
                    text: t.pages.claimNamePage.errorAlreadyClaimed,
                })
            } else if (status === 401) {
                setMessage({ kind: "err", text: t.pages.claimNamePage.errorLoginRequired })
            } else {
                setMessage({ kind: "err", text: t.pages.claimNamePage.errorGeneric })
            }
        } finally {
            setClaiming(false)
        }
    }

    if (loading || authLoading) {
        return (
            <VStack py="16" gap="3">
                <Spinner />
                <Text color="fg.muted" fontSize="sm">{t.common.loading}</Text>
            </VStack>
        )
    }

    if (notFound || !preview) {
        return (
            <Card.Root maxW="md" mx="auto" mt="6" variant="outline" rounded="xl">
                <Card.Body p="6">
                    <VStack gap="3" align="stretch">
                        <Heading size="md">{t.pages.claimNamePage.notFoundTitle}</Heading>
                        <Text fontSize="sm" color="fg.muted">
                            {t.pages.claimNamePage.notFoundBody}
                        </Text>
                        <Button asChild variant="outline" size="sm" mt="2">
                            <RouterLink to="/turniri">{t.pages.claimNamePage.backToTournaments}</RouterLink>
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
                        <Text fontSize="xs" color="fg.muted">{t.pages.claimNamePage.claimTeamLabel}</Text>
                        <Heading size="lg" mt="1">{preview.name}</Heading>
                    </Box>

                    {preview.primaryName && (
                        <Box>
                            <Text fontSize="sm" color="fg.muted">{t.pages.claimNamePage.sharedByLabel}</Text>
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
                                <Badge colorPalette="orange" variant="subtle">{t.pages.claimNamePage.alreadyClaimedBadge}</Badge>
                                {preview.coOwnerName && (
                                    <Text fontSize="sm">{preview.coOwnerName}</Text>
                                )}
                            </HStack>
                            <Text fontSize="xs" color="fg.muted" mt="2">
                                {t.pages.claimNamePage.alreadyClaimedNote}
                            </Text>
                        </Box>
                    )}

                    {message && (
                        <Box
                            p="3"
                            rounded="md"
                            bg={message.kind === "ok" ? "green.50" : "red.50"}
                            borderWidth="1px"
                            borderColor={message.kind === "ok" ? "green.200" : "red.200"}
                        >
                            <Text fontSize="sm">{message.text}</Text>
                        </Box>
                    )}

                    {!user?.uid ? (
                        <Button asChild colorPalette="pitch" variant="solid" size="md">
                            <RouterLink to={`/prijava?next=${encodeURIComponent(`/preuzmi-ime/${token}`)}`}>
                                {t.pages.claimNamePage.loginToClaimCta}
                            </RouterLink>
                        </Button>
                    ) : (
                        <Button
                            colorPalette="pitch"
                            variant="solid"
                            size="md"
                            loading={claiming}
                            disabled={claiming || preview.alreadyClaimed || message?.kind === "ok"}
                            onClick={handleClaim}
                        >
                            {t.pages.claimNamePage.claimButton}
                        </Button>
                    )}
                </VStack>
            </Card.Body>
        </Card.Root>
    )
}
