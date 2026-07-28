import React, { useEffect, useState } from "react"
import { isAxiosError } from "axios"
import {
    Box,
    Button,
    chakra,
    Dialog,
    Field,
    HStack,
    Input,
    Link as ChakraLink,
    Text,
    Textarea,
    VStack,
} from "@chakra-ui/react"
import { Link as RouterLink } from "react-router-dom"
import { FiCheckCircle, FiVideo } from "react-icons/fi"
import { GiSoccerBall } from "react-icons/gi"
import { useQueryClient } from "@tanstack/react-query"
import {
    createGoalRecordingRequest,
    createRecordingRequest,
    type RecordingRequestKind,
} from "../api/recordingRequests"
import { qk } from "../queryClient"
import { useAuth } from "../auth/AuthContext"
import { showSuccess, toaster } from "../toaster"

/* ──────────────────────────────────────────────────────────────────────────
   Dialog to request paid video of a match. Two modes, same flow (explained
   to the user inline): zahtjev → odobrenje admina (email obavijest) →
   plaćanje karticom (Stripe) → preuzimanje poveznice na snimku.

     - kind="FULL_MATCH" (default): the whole match, 20 €.
     - kind="GOAL": a clip of ONE goal, 5 €. Needs `matchEventId`; `goalLabel`
       is shown so the user sees exactly which goal is being ordered.

   On 409 DUPLICATE (this match / this goal already requested) an info toast
   points the user to their profile instead of a red error. Anonymous
   visitors can also file a request - the contact email becomes mandatory
   for them (no profile to track status on) and, on success, the dialog
   shows a small success screen linking to the public status page
   `/snimke/zahtjev/{uuid}` instead of the signed-in "check your profile"
   toast. Opened from the match page header, from the match timeline (per
   goal) and from the "Moje snimke" profile tab.
   ────────────────────────────────────────────────────────────────────── */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/

export default function RecordingRequestDialog({
    open,
    onClose,
    matchId,
    team1Name,
    team2Name,
    kind = "FULL_MATCH",
    matchEventId,
    goalLabel,
}: {
    open: boolean
    onClose: () => void
    matchId: number
    team1Name?: string | null
    team2Name?: string | null
    /** Whole match (default) or a single goal clip. */
    kind?: RecordingRequestKind
    /** Required for kind="GOAL" - the goal's match-event id. */
    matchEventId?: number | null
    /** Readable goal label ("12' - M. Rodek"), shown for kind="GOAL". */
    goalLabel?: string | null
}) {
    const { user } = useAuth()
    const queryClient = useQueryClient()
    const [contactEmail, setContactEmail] = useState("")
    const [note, setNote] = useState("")
    const [saving, setSaving] = useState(false)
    const [emailTouched, setEmailTouched] = useState(false)
    const [submitAttempted, setSubmitAttempted] = useState(false)
    // Set only for an ANONYMOUS submission that succeeded - swaps the form
    // for a small "check your email" screen with a link to the public
    // status page (anonymous callers have no profile to check instead).
    const [createdUuid, setCreatedUuid] = useState<string | null>(null)

    const emailRequired = !user

    const isGoal = kind === "GOAL"

    // Re-seed on every open - prefill the contact email from the signed-in
    // account, clear leftovers from a previous request.
    useEffect(() => {
        if (!open) return
        setContactEmail(user?.email ?? "")
        setNote("")
        setEmailTouched(false)
        setSubmitAttempted(false)
        setCreatedUuid(null)
    }, [open, user?.email])

    const trimmedEmail = contactEmail.trim()
    const emailInvalid = emailRequired
        ? trimmedEmail === "" || !EMAIL_RE.test(trimmedEmail)
        : trimmedEmail !== "" && !EMAIL_RE.test(trimmedEmail)
    const showEmailError = emailInvalid && (emailTouched || submitAttempted)

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (saving) return
        setSubmitAttempted(true)
        if (emailInvalid) return
        // A goal request without an event id can't be filed - guarded here as
        // well as by the disabled submit button.
        if (isGoal && matchEventId == null) return
        try {
            setSaving(true)
            const payload = {
                contactEmail: trimmedEmail || null,
                note: note.trim() || null,
            }
            const created = isGoal
                ? await createGoalRecordingRequest(matchEventId!, payload)
                : await createRecordingRequest(matchId, payload)
            if (user) {
                queryClient.invalidateQueries({ queryKey: qk.myRecordingRequests })
                showSuccess(
                    isGoal ? "Zahtjev za snimku gola je poslan." : "Zahtjev za snimku je poslan.",
                    "Status pratiš na svom profilu, u kartici „Moje snimke“.",
                )
                onClose()
            } else {
                // No profile to point to - show the success screen with a
                // link to the public status page instead of closing.
                setCreatedUuid(created.uuid)
            }
        } catch (err) {
            if (isAxiosError(err) && err.response?.status === 409) {
                // Backend 409 codes: DUPLICATE (already requested) or, for a goal
                // clip, MATCH_NOT_FINISHED (match still running) /
                // GOAL_REQUESTS_DISABLED (feature not on sale yet - possible if
                // the UI flag was flipped on before the backend setting).
                const code = (err.response.data as { code?: string } | undefined)?.code
                toaster.create({
                    type: "info",
                    title:
                        code === "GOAL_REQUESTS_DISABLED"
                            ? "Zahtjevi za snimku gola trenutno nisu dostupni."
                            : code === "MATCH_NOT_FINISHED"
                                ? "Snimku gola možeš zatražiti tek kad utakmica završi."
                                : isGoal
                                    ? user
                                        ? "Zahtjev za ovaj gol već postoji — provjeri svoj profil."
                                        : "Zahtjev za ovaj gol već postoji za ovaj email."
                                    : user
                                        ? "Zahtjev za ovu utakmicu već postoji — provjeri svoj profil."
                                        : "Zahtjev za ovu utakmicu već postoji za ovaj email.",
                    duration: 5000,
                })
                onClose()
            }
            // Other errors already surfaced as a toast by the http interceptor.
        } finally {
            setSaving(false)
        }
    }

    const matchLabel =
        team1Name && team2Name ? `${team1Name} — ${team2Name}` : null

    // Anonymous submission just succeeded - swap the form for a compact
    // "check your email" screen linking to the public status page.
    if (createdUuid) {
        return (
            <Dialog.Root
                open={open}
                onOpenChange={(e) => { if (!e.open) onClose() }}
            >
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW="md">
                        <Dialog.Header>
                            <HStack gap="2">
                                <FiCheckCircle color="var(--chakra-colors-pitch-600)" />
                                <Text>Zahtjev je poslan</Text>
                            </HStack>
                        </Dialog.Header>
                        <Dialog.Body>
                            <VStack align="stretch" gap="3">
                                {matchLabel && (
                                    <Text fontSize="sm" fontWeight={600}>
                                        {matchLabel}
                                    </Text>
                                )}
                                <Text fontSize="sm">
                                    Obavijest o odobrenju i uputama za plaćanje stiže na{" "}
                                    <chakra.span fontWeight={700}>{trimmedEmail}</chakra.span>.
                                </Text>
                                <Box
                                    borderWidth="1px"
                                    borderColor="border.emphasized"
                                    bg="bg.subtle"
                                    rounded="md"
                                    p="3"
                                >
                                    <Text fontSize="sm">
                                        Status zahtjeva u svakom trenutku možeš provjeriti na
                                        javnoj stranici zahtjeva.
                                    </Text>
                                    <ChakraLink asChild color="pitch.600" fontWeight={600} fontSize="sm">
                                        <RouterLink to={`/snimke/zahtjev/${createdUuid}`} onClick={onClose}>
                                            Prati status zahtjeva ovdje
                                        </RouterLink>
                                    </ChakraLink>
                                </Box>
                            </VStack>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button variant="solid" colorPalette="pitch" onClick={onClose}>
                                Zatvori
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Dialog.Root>
        )
    }

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(e) => { if (!e.open && !saving) onClose() }}
        >
            <Dialog.Backdrop />
            <Dialog.Positioner>
                <Dialog.Content maxW="md">
                    <form onSubmit={onSubmit}>
                        <Dialog.Header>
                            <HStack gap="2">
                                {isGoal ? <GiSoccerBall /> : <FiVideo />}
                                <Text>
                                    {isGoal ? "Zatraži snimku gola" : "Zatraži snimku utakmice"}
                                </Text>
                            </HStack>
                        </Dialog.Header>
                        <Dialog.Body>
                            <VStack align="stretch" gap="4">
                                {matchLabel && (
                                    <Text fontSize="sm" fontWeight={600}>
                                        {matchLabel}
                                    </Text>
                                )}

                                {isGoal && goalLabel && (
                                    <HStack
                                        gap="2"
                                        borderWidth="1px"
                                        borderColor="pitch.500"
                                        rounded="md"
                                        px="2.5"
                                        py="1.5"
                                    >
                                        <Box as="span" color="pitch.fg" display="inline-flex">
                                            <GiSoccerBall size={14} />
                                        </Box>
                                        <Text fontSize="sm" fontWeight={600}>
                                            {goalLabel}
                                        </Text>
                                    </HStack>
                                )}

                                {/* How it works + price - compact explainer. */}
                                <Box
                                    borderWidth="1px"
                                    borderColor="border.emphasized"
                                    bg="bg.subtle"
                                    rounded="md"
                                    p="3"
                                >
                                    <VStack align="stretch" gap="1.5">
                                        <Text fontSize="sm">
                                            {isGoal
                                                ? "Pošalji zahtjev, admin ga odobrava (obavijest stiže e-mailom), zatim platiš karticom i dobivaš poveznicu za preuzimanje snimke ovog gola."
                                                : "Pošalji zahtjev, admin ga odobrava (obavijest stiže e-mailom), zatim platiš karticom i dobivaš poveznicu za preuzimanje snimke cijele utakmice."}
                                        </Text>
                                        <Text fontSize="sm" color="fg.muted">
                                            Zahtjev → odobrenje → plaćanje karticom → preuzimanje.
                                        </Text>
                                        <Text fontSize="sm" fontWeight={700}>
                                            Cijena:{" "}
                                            <chakra.span color="pitch.600">
                                                {isGoal ? "5 € po golu" : "20 € po utakmici"}
                                            </chakra.span>
                                        </Text>
                                    </VStack>
                                </Box>

                                <Field.Root invalid={showEmailError}>
                                    <Field.Label>
                                        Kontakt e-mail{" "}
                                        {emailRequired ? (
                                            <chakra.span color="red.500" fontSize="xs">(obavezno)</chakra.span>
                                        ) : (
                                            <chakra.span color="fg.muted" fontSize="xs">(opcionalno)</chakra.span>
                                        )}
                                    </Field.Label>
                                    <Input
                                        size="sm"
                                        type="email"
                                        placeholder="ime@example.com"
                                        value={contactEmail}
                                        onChange={(e) => setContactEmail(e.target.value)}
                                        onBlur={() => setEmailTouched(true)}
                                    />
                                    {showEmailError ? (
                                        <Field.ErrorText>Unesi ispravnu email adresu.</Field.ErrorText>
                                    ) : (
                                        <Field.HelperText>
                                            {emailRequired
                                                ? "Nemaš profil za praćenje statusa - obavijesti o odobrenju i plaćanju stižu isključivo na ovaj email."
                                                : "Na ovu adresu javljamo status zahtjeva i upute za plaćanje."}
                                        </Field.HelperText>
                                    )}
                                </Field.Root>

                                <Field.Root>
                                    <Field.Label>
                                        Napomena{" "}
                                        <chakra.span color="fg.muted" fontSize="xs">(opcionalno)</chakra.span>
                                    </Field.Label>
                                    <Textarea
                                        size="sm"
                                        rows={3}
                                        placeholder={
                                            isGoal
                                                ? "Npr. treba mi i asistencija prije gola…"
                                                : "Npr. treba mi samo drugo poluvrijeme…"
                                        }
                                        value={note}
                                        onChange={(e) => setNote(e.target.value)}
                                    />
                                </Field.Root>

                                <Text fontSize="xs" color="fg.muted">
                                    {user
                                        ? "Sve svoje zahtjeve pratiš na profilu, u kartici „Moje snimke“."
                                        : "Poveznicu za praćenje statusa dobivaš odmah nakon slanja zahtjeva."}
                                </Text>
                            </VStack>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button variant="ghost" type="button" onClick={onClose} disabled={saving}>
                                Odustani
                            </Button>
                            <Button
                                variant="solid"
                                colorPalette="pitch"
                                type="submit"
                                loading={saving}
                                disabled={showEmailError || (isGoal && matchEventId == null)}
                            >
                                Pošalji zahtjev
                            </Button>
                        </Dialog.Footer>
                    </form>
                </Dialog.Content>
            </Dialog.Positioner>
        </Dialog.Root>
    )
}
