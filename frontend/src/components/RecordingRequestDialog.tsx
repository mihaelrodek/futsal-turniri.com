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
    Text,
    Textarea,
    VStack,
} from "@chakra-ui/react"
import { FiVideo } from "react-icons/fi"
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
   to the user inline): zahtjev → odobrenje → uplata → poveznica na snimku.

     - kind="FULL_MATCH" (default): the whole match, 20 €.
     - kind="GOAL": a clip of ONE goal, 5 €. Needs `matchEventId`; `goalLabel`
       is shown so the user sees exactly which goal is being ordered.

   On 409 DUPLICATE (this match / this goal already requested) an info toast
   points the user to their profile instead of a red error. Opened from the
   match page header, from the match timeline (per goal) and from the
   "Moje snimke" profile tab.
   ────────────────────────────────────────────────────────────────────── */

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

    const isGoal = kind === "GOAL"

    // Re-seed on every open - prefill the contact email from the signed-in
    // account, clear leftovers from a previous request.
    useEffect(() => {
        if (!open) return
        setContactEmail(user?.email ?? "")
        setNote("")
    }, [open, user?.email])

    async function onSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (saving) return
        // A goal request without an event id can't be filed - guarded here as
        // well as by the disabled submit button.
        if (isGoal && matchEventId == null) return
        try {
            setSaving(true)
            const payload = {
                contactEmail: contactEmail.trim() || null,
                note: note.trim() || null,
            }
            if (isGoal) {
                await createGoalRecordingRequest(matchEventId!, payload)
            } else {
                await createRecordingRequest(matchId, payload)
            }
            queryClient.invalidateQueries({ queryKey: qk.myRecordingRequests })
            showSuccess(
                isGoal ? "Zahtjev za snimku gola je poslan." : "Zahtjev za snimku je poslan.",
                "Status pratiš na svom profilu, u kartici „Moje snimke“.",
            )
            onClose()
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
                                    ? "Zahtjev za ovaj gol već postoji — provjeri svoj profil."
                                    : "Zahtjev za ovu utakmicu već postoji — provjeri svoj profil.",
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
                                                ? "Pošalji zahtjev, a nakon odobrenja i uplate dobivaš poveznicu za preuzimanje snimke ovog gola."
                                                : "Pošalji zahtjev, a nakon odobrenja i uplate dobivaš poveznicu za preuzimanje snimke cijele utakmice."}
                                        </Text>
                                        <Text fontSize="sm" color="fg.muted">
                                            Zahtjev → odobrenje → uplata → poveznica na snimku.
                                        </Text>
                                        <Text fontSize="sm" fontWeight={700}>
                                            Cijena:{" "}
                                            <chakra.span color="pitch.600">
                                                {isGoal ? "5 € po golu" : "20 € po utakmici"}
                                            </chakra.span>
                                        </Text>
                                    </VStack>
                                </Box>

                                <Field.Root>
                                    <Field.Label>
                                        Kontakt e-mail{" "}
                                        <chakra.span color="fg.muted" fontSize="xs">(opcionalno)</chakra.span>
                                    </Field.Label>
                                    <Input
                                        size="sm"
                                        type="email"
                                        placeholder="ime@example.com"
                                        value={contactEmail}
                                        onChange={(e) => setContactEmail(e.target.value)}
                                    />
                                    <Field.HelperText>
                                        Na ovu adresu javljamo status zahtjeva i upute za uplatu.
                                    </Field.HelperText>
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
                                    Sve svoje zahtjeve pratiš na profilu, u kartici „Moje snimke“.
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
                                disabled={isGoal && matchEventId == null}
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
