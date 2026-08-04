import { useEffect, useState } from "react"
import { Box, Button, Heading, HStack, Stack, Text, VStack } from "@chakra-ui/react"
import { Link as RouterLink, useParams } from "react-router-dom"
import { isAxiosError } from "axios"
import { FiCheckCircle, FiSlash } from "react-icons/fi"

import {
    fetchRegistrationForm,
    submitRegistration,
    type RegistrationFormInfo,
    type TeamRegistrationInput,
} from "../api/teamRegistration"
import TeamRegistrationForm from "../components/TeamRegistrationForm"
import { EmptyState, Loader, Panel } from "../ui/primitives"
import { MonoLabel } from "../ui/pitch"
import { useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   TeamRegistrationPage - /prijava-ekipe/{token}.

   The public half of team registration: an organizer sends this link to a
   club, and whoever opens it files a roster WITHOUT an account. That is the
   whole point of the feature - the person holding the squad list is a club
   contact, not a user of this app, and making them sign up is exactly what
   sends the organizer back to typing rosters in by hand.

   The page is deliberately self-contained (no navbar dependency, no auth):
   it renders one of three states - the form, a "closed" explanation, or the
   filed-successfully confirmation.
   ────────────────────────────────────────────────────────────────────── */

function formatStart(iso: string | null): string {
    if (!iso) return ""
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ""
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}. ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function TeamRegistrationPage() {
    const t = useTranslation()
    const p = t.pages.teamRegistration
    const { token = "" } = useParams<{ token: string }>()

    const [info, setInfo] = useState<RegistrationFormInfo | null>(null)
    const [loading, setLoading] = useState(true)
    const [notFound, setNotFound] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [doneTeam, setDoneTeam] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        fetchRegistrationForm(token)
            .then((data) => { if (!cancelled) setInfo(data) })
            .catch(() => { if (!cancelled) setNotFound(true) })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [token])

    async function submit(payload: TeamRegistrationInput) {
        if (busy) return
        setError(null)
        try {
            setBusy(true)
            const res = await submitRegistration(token, payload)
            setDoneTeam(res.teamName)
        } catch (err) {
            setError(errorText(err, p.errors))
        } finally {
            setBusy(false)
        }
    }

    if (loading) return <Loader />

    if (notFound || !info) {
        return (
            <Box maxW="720px" mx="auto" px={{ base: "4", md: "6" }} py="8">
                <EmptyState
                    icon={FiSlash}
                    title={p.notFoundTitle}
                    description={p.notFoundDesc}
                />
            </Box>
        )
    }

    /* Filed. The team exists but is pending, and saying so plainly is the
       whole message - a club that thinks it is entered and is not will show
       up on match day. */
    if (doneTeam) {
        return (
            <Box maxW="720px" mx="auto" px={{ base: "4", md: "6" }} py="8">
                <EmptyState
                    icon={FiCheckCircle}
                    title={p.doneTitle(doneTeam)}
                    description={p.doneDesc}
                    action={
                        info.tournamentSlug ? (
                            <Button asChild size="sm" variant="outline" colorPalette="pitch">
                                <RouterLink to={`/turniri/${info.tournamentSlug}`}>
                                    {p.openTournament}
                                </RouterLink>
                            </Button>
                        ) : undefined
                    }
                />
            </Box>
        )
    }

    return (
        <Box maxW="720px" mx="auto" px={{ base: "4", md: "6" }} py={{ base: "6", md: "8" }}>
            <VStack align="stretch" gap="4">
                <Box>
                    <MonoLabel display="block">{p.eyebrow}</MonoLabel>
                    <Heading as="h1" size="lg" mt="1" lineHeight="1.2" letterSpacing="-0.02em" color="fg.ink">
                        {info.tournamentName}
                    </Heading>
                    <HStack gap="2" mt="1.5" wrap="wrap">
                        {info.location && (
                            <Text fontSize="sm" color="fg.muted">{info.location}</Text>
                        )}
                        {formatStart(info.startAt) && (
                            <Text fontSize="sm" color="fg.muted">• {formatStart(info.startAt)}</Text>
                        )}
                        {info.organizerName && (
                            <Text fontSize="sm" color="fg.muted">• {info.organizerName}</Text>
                        )}
                    </HStack>
                    {/* The organizer's label on the link, shown back so the
                        recipient can tell the link was meant for them. */}
                    {info.label && (
                        <Text fontSize="sm" color="pitch.fg" fontWeight={600} mt="1">
                            {p.forLabel(info.label)}
                        </Text>
                    )}
                </Box>

                {!info.open ? (
                    <Panel p={{ base: "4", md: "5" }}>
                        <Stack gap="1">
                            <Text fontSize="sm" fontWeight={700} color="fg.ink">{p.closedTitle}</Text>
                            <Text fontSize="sm" color="fg.muted">
                                {info.closedCode === "LINK_REVOKED" ? p.closedRevoked : p.closedStarted}
                            </Text>
                        </Stack>
                    </Panel>
                ) : (
                    <Panel p={{ base: "4", md: "5" }}>
                        <TeamRegistrationForm
                            requireContact
                            busy={busy}
                            errorText={error}
                            submitLabel={p.submit}
                            onSubmit={submit}
                        />
                    </Panel>
                )}
            </VStack>
        </Box>
    )
}

/** Map the backend's plain-text conflict codes onto copy. */
function errorText(err: unknown, errors: Record<string, string>): string {
    if (!isAxiosError(err)) return errors.generic
    const code = typeof err.response?.data === "string" ? err.response.data : null
    if (code && code in errors) return errors[code]
    return errors.generic
}
