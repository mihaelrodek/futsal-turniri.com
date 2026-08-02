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
import { useTranslation } from "../i18n"

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
    const t = useTranslation()
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

    // Mandatory for everyone, signed in or not: every step after this dialog -
    // approval, the payment link, the download link - is delivered by e-mail,
    // so a request without one is a request that can never be fulfilled. A
    // signed-in user gets theirs prefilled, so it costs them nothing.
    const emailRequired = true

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
                    isGoal ? t.recordingRequest.dialog.toastSuccessGoal : t.recordingRequest.dialog.toastSuccessMatch,
                    t.recordingRequest.dialog.toastSuccessDescription,
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
                const d = t.recordingRequest.dialog
                toaster.create({
                    type: "info",
                    title:
                        code === "GOAL_REQUESTS_DISABLED"
                            ? d.duplicateGoalDisabled
                            : code === "MATCH_NOT_FINISHED"
                                ? d.duplicateMatchNotFinished
                                : isGoal
                                    ? user
                                        ? d.duplicateGoalUser
                                        : d.duplicateGoalAnon
                                    : user
                                        ? d.duplicateMatchUser
                                        : d.duplicateMatchAnon,
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
                                <Text>{t.recordingRequest.dialog.sentTitle}</Text>
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
                                    {t.recordingRequest.dialog.sentEmailPrefix}{" "}
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
                                        {t.recordingRequest.dialog.statusPageNotice}
                                    </Text>
                                    <ChakraLink asChild color="pitch.600" fontWeight={600} fontSize="sm">
                                        <RouterLink to={`/snimke/zahtjev/${createdUuid}`} onClick={onClose}>
                                            {t.recordingRequest.dialog.statusPageLink}
                                        </RouterLink>
                                    </ChakraLink>
                                </Box>
                            </VStack>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button variant="solid" colorPalette="pitch" onClick={onClose}>
                                {t.common.close}
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
                                    {isGoal ? t.recordingRequest.dialog.titleGoal : t.recordingRequest.dialog.titleMatch}
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
                                                ? t.recordingRequest.dialog.howItWorksGoal
                                                : t.recordingRequest.dialog.howItWorksMatch}
                                        </Text>
                                        <Text fontSize="sm" color="fg.muted">
                                            {t.recordingRequest.dialog.flowSummary}
                                        </Text>
                                        <Text fontSize="sm" fontWeight={700}>
                                            {t.recordingRequest.dialog.priceLabel}{" "}
                                            <chakra.span color="pitch.600">
                                                {isGoal ? t.recordingRequest.dialog.priceGoal : t.recordingRequest.dialog.priceMatch}
                                            </chakra.span>
                                        </Text>
                                    </VStack>
                                </Box>

                                <Field.Root invalid={showEmailError}>
                                    <Field.Label>
                                        {t.recordingRequest.dialog.emailLabel}{" "}
                                        {emailRequired ? (
                                            <chakra.span color="red.500" fontSize="xs">{t.common.requiredTag}</chakra.span>
                                        ) : (
                                            <chakra.span color="fg.muted" fontSize="xs">{t.common.optionalTag}</chakra.span>
                                        )}
                                    </Field.Label>
                                    <Input
                                        size="sm"
                                        type="email"
                                        placeholder={t.recordingRequest.dialog.emailPlaceholder}
                                        value={contactEmail}
                                        onChange={(e) => setContactEmail(e.target.value)}
                                        onBlur={() => setEmailTouched(true)}
                                    />
                                    {showEmailError ? (
                                        <Field.ErrorText>{t.recordingRequest.dialog.emailInvalid}</Field.ErrorText>
                                    ) : (
                                        <Field.HelperText>
                                            {emailRequired
                                                ? t.recordingRequest.dialog.emailHelperAnonymous
                                                : t.recordingRequest.dialog.emailHelperUser}
                                        </Field.HelperText>
                                    )}
                                </Field.Root>

                                <Field.Root>
                                    <Field.Label>
                                        {t.recordingRequest.dialog.noteLabel}{" "}
                                        <chakra.span color="fg.muted" fontSize="xs">{t.common.optionalTag}</chakra.span>
                                    </Field.Label>
                                    <Textarea
                                        size="sm"
                                        rows={3}
                                        placeholder={
                                            isGoal
                                                ? t.recordingRequest.dialog.notePlaceholderGoal
                                                : t.recordingRequest.dialog.notePlaceholderMatch
                                        }
                                        value={note}
                                        onChange={(e) => setNote(e.target.value)}
                                    />
                                </Field.Root>

                                {/* Signed-in: the request lands in "Moje snimke".
                                    Anonymous: say plainly that signing in is what
                                    puts it there - the old copy promised a profile
                                    tab to people who have no profile. The link
                                    returns to this exact page after login. */}
                                <Text fontSize="xs" color="fg.muted">
                                    {user ? (
                                        t.recordingRequest.dialog.footerHintUser
                                    ) : (
                                        <>
                                            {t.recordingRequest.dialog.footerHintAnonymous}{" "}
                                            <ChakraLink asChild color="pitch.600" fontWeight={700}>
                                                <RouterLink
                                                    to={`/prijava?next=${encodeURIComponent(
                                                        window.location.pathname + window.location.search,
                                                    )}`}
                                                >
                                                    {t.recordingRequest.dialog.signInToTrack}
                                                </RouterLink>
                                            </ChakraLink>
                                        </>
                                    )}
                                </Text>
                            </VStack>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button variant="ghost" type="button" onClick={onClose} disabled={saving}>
                                {t.common.cancel}
                            </Button>
                            <Button
                                variant="solid"
                                colorPalette="pitch"
                                type="submit"
                                loading={saving}
                                disabled={showEmailError || (isGoal && matchEventId == null)}
                            >
                                {t.recordingRequest.dialog.submit}
                            </Button>
                        </Dialog.Footer>
                    </form>
                </Dialog.Content>
            </Dialog.Positioner>
        </Dialog.Root>
    )
}
