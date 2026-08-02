import { useState } from "react"
import type { FormEvent } from "react"
import { useSearchParams } from "react-router-dom"
import {
    Box,
    Button,
    Card,
    Field,
    HStack,
    Icon,
    Input,
    Link,
    NativeSelect,
    Text,
    Textarea,
    VStack,
    chakra,
} from "@chakra-ui/react"
import { LuCheck, LuMail, LuSend } from "react-icons/lu"
import { PageTitle } from "../ui/pitch"
import { useDocumentHead } from "../hooks/useDocumentHead"
import { submitContactMessage, CONTACT_REASONS, type ContactReason } from "../api/contact"
import { showError } from "../toaster"
import { useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   ContactPage - „Kontaktiraj nas" (/kontakt).

   The generic public channel next to the structured ones (recording
   requests, camera-package quotes, player claims). Reachable without login,
   like everything else user-facing; the backend records the sender's uid
   only when they happen to be signed in.

   On success the page swaps the whole form for an INLINE confirmation block
   rather than firing a toast: it has to state two separate things (the
   message arrived, and a confirmation email went out), which is more than a
   toast should carry - and the sender should still see it after clicking
   away. Errors keep using the global interceptor's toast, including the
   backend's 429 when the spam guard trips.
   ────────────────────────────────────────────────────────────────────── */

const CONTACT_EMAIL = "mihael.rodek1@gmail.com"

/** Mirrors the backend's simple, non-exhaustive pattern (ContactController)
 *  so obviously-fake input gets caught before a round-trip. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/

const NAME_MIN = 3
const NAME_MAX = 120
const SUBJECT_MAX = 160
const MESSAGE_MIN = 10
const MESSAGE_MAX = 4000

type SendState = "idle" | "sending" | "sent"

/** `?razlog=` preselects the reason - the "Kontaktiraj nas" button on the
 *  recording-request status page arrives with `PLACANJE` already chosen, so a
 *  person with a payment problem never has to classify it themselves. An
 *  unknown value is ignored rather than trusted. */
function reasonFromQuery(raw: string | null): ContactReason {
    const key = (raw ?? "").trim().toUpperCase()
    return (CONTACT_REASONS as readonly string[]).includes(key) ? (key as ContactReason) : "OSTALO"
}

export default function ContactPage() {
    const t = useTranslation()
    const p = t.pages.contactPage

    useDocumentHead({
        title: p.documentTitle,
        description: p.documentDescription,
        canonical: "https://futsal-turniri.com/kontakt",
    })

    const [searchParams] = useSearchParams()
    // `?ref=` carries the thing the visitor is writing about (today: a
    // recording-request uuid). Not a form field - it is appended to the
    // message so the admin can find the row without asking.
    const reference = searchParams.get("ref")

    const [reason, setReason] = useState<ContactReason>(() => reasonFromQuery(searchParams.get("razlog")))
    const [name, setName] = useState("")
    const [email, setEmail] = useState("")
    const [subject, setSubject] = useState("")
    const [message, setMessage] = useState("")
    const [state, setState] = useState<SendState>("idle")

    const trimmedName = name.trim()
    const trimmedEmail = email.trim()
    const trimmedMessage = message.trim()

    const nameOk = trimmedName.length >= NAME_MIN && trimmedName.length <= NAME_MAX
    const emailOk = EMAIL_RE.test(trimmedEmail)
    const subjectOk = subject.trim().length <= SUBJECT_MAX
    const messageOk = trimmedMessage.length >= MESSAGE_MIN && trimmedMessage.length <= MESSAGE_MAX
    const canSubmit = nameOk && emailOk && subjectOk && messageOk

    async function onSubmit(e: FormEvent) {
        e.preventDefault()
        if (!canSubmit) {
            showError(p.missingDataTitle, p.missingDataDesc)
            return
        }
        try {
            setState("sending")
            const trimmedSubject = subject.trim()
            await submitContactMessage({
                name: trimmedName,
                email: trimmedEmail,
                reason,
                // Omitted entirely when blank - the column is nullable.
                ...(trimmedSubject ? { subject: trimmedSubject } : {}),
                message: reference
                    ? `${trimmedMessage}\n\n${p.referenceLine(reference)}`
                    : trimmedMessage,
            })
            setState("sent")
        } catch {
            setState("idle")
        }
    }

    return (
        <VStack align="stretch" gap="6" maxW="760px" mx="auto" pb="8">
            <PageTitle kicker={p.kicker} title={p.title} subtitle={p.subtitle} />

            <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
                <Card.Body p={{ base: "4", md: "6" }}>
                    {state === "sent" ? <SentPanel /> : (
                        <chakra.form onSubmit={onSubmit}>
                            <VStack align="stretch" gap="4">
                                <HStack gap="3" align="start" wrap="wrap">
                                    <Field.Root
                                        required
                                        flex="1"
                                        minW="220px"
                                        invalid={trimmedName.length > 0 && !nameOk}
                                    >
                                        <Field.Label>
                                            {p.nameLabel} <Field.RequiredIndicator />
                                        </Field.Label>
                                        <Input
                                            size="sm"
                                            value={name}
                                            maxLength={NAME_MAX}
                                            autoComplete="name"
                                            onChange={(e) => setName(e.target.value)}
                                            placeholder={p.namePlaceholder}
                                        />
                                        {trimmedName.length > 0 && !nameOk && (
                                            <Field.ErrorText>{p.nameInvalid}</Field.ErrorText>
                                        )}
                                    </Field.Root>
                                    <Field.Root
                                        required
                                        flex="1"
                                        minW="220px"
                                        invalid={trimmedEmail.length > 0 && !emailOk}
                                    >
                                        <Field.Label>
                                            {p.emailLabel} <Field.RequiredIndicator />
                                        </Field.Label>
                                        <Input
                                            size="sm"
                                            type="email"
                                            value={email}
                                            maxLength={255}
                                            autoComplete="email"
                                            onChange={(e) => setEmail(e.target.value)}
                                            placeholder={p.emailPlaceholder}
                                        />
                                        {trimmedEmail.length > 0 && !emailOk && (
                                            <Field.ErrorText>{p.emailInvalid}</Field.ErrorText>
                                        )}
                                    </Field.Root>
                                </HStack>

                                <Field.Root required>
                                    <Field.Label>
                                        {p.reasonLabel} <Field.RequiredIndicator />
                                    </Field.Label>
                                    <NativeSelect.Root size="sm">
                                        <NativeSelect.Field
                                            value={reason}
                                            onChange={(e) => setReason(e.currentTarget.value as ContactReason)}
                                        >
                                            {CONTACT_REASONS.map((key) => (
                                                <option key={key} value={key}>
                                                    {p.reasons[key]}
                                                </option>
                                            ))}
                                        </NativeSelect.Field>
                                        <NativeSelect.Indicator />
                                    </NativeSelect.Root>
                                    <Field.HelperText>{p.reasonHelper}</Field.HelperText>
                                </Field.Root>

                                <Field.Root>
                                    <Field.Label>{p.subjectLabel}</Field.Label>
                                    <Input
                                        size="sm"
                                        value={subject}
                                        maxLength={SUBJECT_MAX}
                                        onChange={(e) => setSubject(e.target.value)}
                                        placeholder={p.subjectPlaceholder}
                                    />
                                    <Field.HelperText>{p.subjectHelper}</Field.HelperText>
                                </Field.Root>

                                <Field.Root
                                    required
                                    invalid={trimmedMessage.length > 0 && !messageOk}
                                >
                                    <Field.Label>
                                        {p.messageLabel} <Field.RequiredIndicator />
                                    </Field.Label>
                                    <Textarea
                                        size="sm"
                                        rows={7}
                                        value={message}
                                        maxLength={MESSAGE_MAX}
                                        onChange={(e) => setMessage(e.target.value)}
                                        placeholder={p.messagePlaceholder}
                                    />
                                    {trimmedMessage.length > 0 && !messageOk ? (
                                        <Field.ErrorText>{p.messageInvalid}</Field.ErrorText>
                                    ) : (
                                        <Field.HelperText>
                                            {p.messageCounter(trimmedMessage.length, MESSAGE_MAX)}
                                        </Field.HelperText>
                                    )}
                                </Field.Root>

                                <HStack justify="space-between" gap="3" wrap="wrap">
                                    <Text fontSize="xs" color="fg.muted">
                                        {p.privacyNote}
                                    </Text>
                                    <Button
                                        type="submit"
                                        size="sm"
                                        colorPalette="pitch"
                                        loading={state === "sending"}
                                        disabled={!canSubmit}
                                    >
                                        <LuSend /> {p.submitButton}
                                    </Button>
                                </HStack>
                            </VStack>
                        </chakra.form>
                    )}
                </Card.Body>
            </Card.Root>

            <HStack gap="2" fontSize="sm" color="fg.muted" justify="center" wrap="wrap">
                <Icon as={LuMail} boxSize="4" />
                <Text>{p.directEmailPrefix}</Text>
                <Link href={`mailto:${CONTACT_EMAIL}`} color="pitch.600" fontWeight={600}>
                    {CONTACT_EMAIL}
                </Link>
            </HStack>
        </VStack>
    )
}

/** Inline confirmation that replaces the form once the message is stored. */
function SentPanel() {
    const t = useTranslation()
    const p = t.pages.contactPage
    return (
        <VStack align="stretch" gap="3" py="2">
            <HStack gap="2.5" align="center">
                <Box
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    boxSize="9"
                    rounded="full"
                    bg="pitch.subtle"
                    color="pitch.600"
                    flexShrink={0}
                >
                    <LuCheck size={18} />
                </Box>
                <Text fontWeight={700} fontSize="lg">{p.sentTitle}</Text>
            </HStack>
            <Text fontSize="sm" color="fg.muted" lineHeight="1.6">
                {p.sentDesc}
            </Text>
            <Text fontSize="sm" color="fg.muted" lineHeight="1.6">
                {p.sentMailNote}
            </Text>
        </VStack>
    )
}
