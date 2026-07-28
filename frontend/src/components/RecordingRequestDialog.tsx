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
import { useQueryClient } from "@tanstack/react-query"
import { createRecordingRequest } from "../api/recordingRequests"
import { qk } from "../queryClient"
import { useAuth } from "../auth/AuthContext"
import { showSuccess, toaster } from "../toaster"

/* ──────────────────────────────────────────────────────────────────────────
   Dialog to request a video recording of a single match (~20 € per match).
   Flow (explained to the user inline): zahtjev → odobrenje → uplata →
   poveznica na snimku. On 409 DUPLICATE (a request for this match already
   exists) an info toast points the user to their profile instead of a red
   error. Opened from the match page header and from the "Moje snimke"
   profile tab ("Novi zahtjev").
   ────────────────────────────────────────────────────────────────────── */

export default function RecordingRequestDialog({
    open,
    onClose,
    matchId,
    team1Name,
    team2Name,
}: {
    open: boolean
    onClose: () => void
    matchId: number
    team1Name?: string | null
    team2Name?: string | null
}) {
    const { user } = useAuth()
    const queryClient = useQueryClient()
    const [contactEmail, setContactEmail] = useState("")
    const [note, setNote] = useState("")
    const [saving, setSaving] = useState(false)

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
        try {
            setSaving(true)
            await createRecordingRequest(matchId, {
                contactEmail: contactEmail.trim() || null,
                note: note.trim() || null,
            })
            queryClient.invalidateQueries({ queryKey: qk.myRecordingRequests })
            showSuccess(
                "Zahtjev za snimku je poslan.",
                "Status pratiš na svom profilu, u kartici „Moje snimke“.",
            )
            onClose()
        } catch (err) {
            if (isAxiosError(err) && err.response?.status === 409) {
                // Backend: {"code":"DUPLICATE"} - already requested this match.
                toaster.create({
                    type: "info",
                    title: "Zahtjev za ovu utakmicu već postoji — provjeri svoj profil.",
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
                                <FiVideo />
                                <Text>Zatraži snimku utakmice</Text>
                            </HStack>
                        </Dialog.Header>
                        <Dialog.Body>
                            <VStack align="stretch" gap="4">
                                {matchLabel && (
                                    <Text fontSize="sm" fontWeight={600}>
                                        {matchLabel}
                                    </Text>
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
                                            Pošalji zahtjev, a nakon odobrenja i uplate dobivaš
                                            poveznicu za preuzimanje snimke cijele utakmice.
                                        </Text>
                                        <Text fontSize="sm" color="fg.muted">
                                            Zahtjev → odobrenje → uplata → poveznica na snimku.
                                        </Text>
                                        <Text fontSize="sm" fontWeight={700}>
                                            Cijena: <chakra.span color="pitch.600">20 € po utakmici</chakra.span>
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
                                        placeholder="Npr. treba mi samo drugo poluvrijeme…"
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
