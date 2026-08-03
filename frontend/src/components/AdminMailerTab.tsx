import { useEffect, useMemo, useState } from "react"
import {
    Badge,
    Box,
    Button,
    Card,
    Field,
    HStack,
    Input,
    NativeSelect,
    Spinner,
    Text,
    Textarea,
    VStack,
} from "@chakra-ui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"
import { isAxiosError } from "axios"
import { FiAlertCircle, FiCheck, FiMail, FiSend, FiX } from "react-icons/fi"
import {
    ADMIN_MAIL_LOG_KEY,
    ADMIN_MAIL_TEMPLATES_KEY,
    adminMailRecordingPickKey,
    fetchAdminMailLog,
    fetchAdminMailRecordingRequests,
    fetchAdminMailTemplates,
    sendAdminMail,
    type AdminMailTemplateKey,
} from "../api/adminMail"
import { showError, showSuccess } from "../toaster"
import { useTranslation } from "../i18n"

/**
 * Admin "Pošalji mail" module - the manual escape hatch for transactional
 * email (backend: AdminMailController).
 *
 * <p>Every automatic mail in the platform is fire-and-forget, so a message
 * that never arrived leaves no trace and offers no retry. Here an admin picks
 * a recording request, gets the recipient pre-filled from it, and re-sends the
 * exact same copy the automatic notifier would have sent - or writes a
 * free-form message. Every attempt lands in the log below, which is the only
 * way to tell a second attempt from a first one.
 *
 * <p>The preview deliberately describes what will be sent rather than
 * rendering it: the body is built on the backend, in the recipient's language,
 * so a client-side reproduction of it would be a second source of truth that
 * silently drifts.
 *
 * <p>Mounted prop-less by the admin module registry (src/admin/modules.tsx).
 *
 * <p>Deep-linkable: {@code /admin/posalji-mail?to=…&naslov=…} pre-fills the
 * free-form recipient and subject. That is how "Odgovori" on a recording
 * request lands here - the registry mounts every admin screen without props,
 * so the URL is the only channel a sibling module can hand something over.
 * Read once, on mount: the fields stay freely editable afterwards, and
 * re-applying them on every render would fight the admin's own typing.
 */
export default function AdminMailerTab() {
    const t = useTranslation()
    const queryClient = useQueryClient()
    const [searchParams] = useSearchParams()

    const [templateKey, setTemplateKey] = useState<AdminMailTemplateKey>("FREEFORM")
    const [toEmail, setToEmail] = useState(() => searchParams.get("to")?.trim() ?? "")
    const [subject, setSubject] = useState(() => searchParams.get("naslov")?.trim() ?? "")
    const [bodyText, setBodyText] = useState("")
    const [requestUuid, setRequestUuid] = useState("")
    const [search, setSearch] = useState("")
    const [debouncedSearch, setDebouncedSearch] = useState("")
    const [confirming, setConfirming] = useState(false)

    // One request per pause in typing, not per keystroke - the picker feed is
    // an unindexed scan on the backend.
    useEffect(() => {
        const id = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
        return () => window.clearTimeout(id)
    }, [search])

    const { data: templates, isLoading: templatesLoading } = useQuery({
        queryKey: ADMIN_MAIL_TEMPLATES_KEY,
        queryFn: fetchAdminMailTemplates,
    })

    const template = useMemo(
        () => templates?.find((tpl) => tpl.key === templateKey),
        [templates, templateKey],
    )
    const needsRequest = template?.needsRecordingRequest ?? templateKey !== "FREEFORM"
    const isFreeform = templateKey === "FREEFORM"

    const { data: picks, isLoading: picksLoading } = useQuery({
        queryKey: adminMailRecordingPickKey(debouncedSearch),
        queryFn: () => fetchAdminMailRecordingRequests(debouncedSearch),
        enabled: needsRequest,
    })

    const { data: log, isLoading: logLoading } = useQuery({
        queryKey: ADMIN_MAIL_LOG_KEY,
        queryFn: fetchAdminMailLog,
    })

    const emailValid = isValidEmail(toEmail)
    const canSend =
        emailValid &&
        (!needsRequest || requestUuid !== "") &&
        (!isFreeform || (subject.trim() !== "" && bodyText.trim() !== ""))

    // Any change to what would be sent invalidates a pending confirmation.
    useEffect(() => {
        setConfirming(false)
    }, [templateKey, toEmail, subject, bodyText, requestUuid])

    const send = useMutation({
        mutationFn: () =>
            sendAdminMail({
                templateKey,
                toEmail: toEmail.trim(),
                subject: isFreeform ? subject.trim() : null,
                bodyText: isFreeform ? bodyText.trim() : null,
                recordingRequestUuid: needsRequest ? requestUuid : null,
            }),
        onSuccess: () => {
            showSuccess(t.components.adminMailerTab.sentToast)
            setConfirming(false)
            if (isFreeform) {
                setSubject("")
                setBodyText("")
            }
            queryClient.invalidateQueries({ queryKey: ADMIN_MAIL_LOG_KEY })
        },
        onError: (err) => {
            setConfirming(false)
            const code = errorCode(err)
            const errors = t.components.adminMailerTab.errors
            showError(
                (code && code in errors ? errors[code as keyof typeof errors] : undefined) ??
                    errors.generic,
            )
        },
    })

    const pickedRequest = picks?.find((p) => p.uuid === requestUuid)

    return (
        <VStack align="stretch" gap="4">
            <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
                <Card.Body p={{ base: "4", md: "6" }}>
                    <VStack align="stretch" gap="4">
                        <Text fontSize="sm" color="fg.muted">
                            {t.components.adminMailerTab.intro}
                        </Text>

                        <Field.Root>
                            <Field.Label>{t.components.adminMailerTab.templateLabel}</Field.Label>
                            {templatesLoading ? (
                                <HStack gap="2" color="fg.muted">
                                    <Spinner size="xs" />
                                    <Text fontSize="sm">{t.components.adminMailerTab.templateLoading}</Text>
                                </HStack>
                            ) : (
                                <NativeSelect.Root size="sm">
                                    <NativeSelect.Field
                                        value={templateKey}
                                        onChange={(e) => {
                                            setTemplateKey(
                                                (e.target as HTMLSelectElement).value as AdminMailTemplateKey,
                                            )
                                            setRequestUuid("")
                                        }}
                                    >
                                        {(templates ?? []).map((tpl) => (
                                            <option key={tpl.key} value={tpl.key}>
                                                {tpl.label}
                                            </option>
                                        ))}
                                    </NativeSelect.Field>
                                </NativeSelect.Root>
                            )}
                        </Field.Root>

                        {needsRequest && (
                            <Field.Root>
                                <Field.Label>{t.components.adminMailerTab.requestLabel}</Field.Label>
                                <VStack align="stretch" gap="2" w="full">
                                    <Input
                                        size="sm"
                                        placeholder={t.components.adminMailerTab.requestSearchPlaceholder}
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                    />
                                    {picksLoading ? (
                                        <HStack gap="2" color="fg.muted">
                                            <Spinner size="xs" />
                                            <Text fontSize="sm">{t.components.adminMailerTab.requestLoading}</Text>
                                        </HStack>
                                    ) : (picks ?? []).length === 0 ? (
                                        <Text fontSize="sm" color="fg.muted">
                                            {t.components.adminMailerTab.requestEmpty}
                                        </Text>
                                    ) : (
                                        <NativeSelect.Root size="sm">
                                            <NativeSelect.Field
                                                value={requestUuid}
                                                onChange={(e) => {
                                                    const uuid = (e.target as HTMLSelectElement).value
                                                    setRequestUuid(uuid)
                                                    // The contact email is the whole
                                                    // point of picking a request - it
                                                    // stays editable afterwards.
                                                    const pick = picks?.find((p) => p.uuid === uuid)
                                                    if (pick?.contactEmail) setToEmail(pick.contactEmail)
                                                }}
                                            >
                                                <option value="">
                                                    {t.components.adminMailerTab.requestPickPlaceholder}
                                                </option>
                                                {(picks ?? []).map((pick) => (
                                                    <option key={pick.uuid} value={pick.uuid}>
                                                        {pickLabel(
                                                            pick.matchLabel,
                                                            pick.tournamentName,
                                                            pick.status,
                                                            pick.paid
                                                                ? t.components.adminMailerTab.requestPaid
                                                                : t.components.adminMailerTab.requestUnpaid,
                                                        )}
                                                    </option>
                                                ))}
                                            </NativeSelect.Field>
                                        </NativeSelect.Root>
                                    )}
                                    {requestUuid === "" && (
                                        <Field.HelperText>
                                            {t.components.adminMailerTab.requestRequired}
                                        </Field.HelperText>
                                    )}
                                </VStack>
                            </Field.Root>
                        )}

                        <Field.Root invalid={toEmail.trim() !== "" && !emailValid}>
                            <Field.Label>{t.components.adminMailerTab.recipientLabel}</Field.Label>
                            <Input
                                size="sm"
                                type="email"
                                placeholder={t.components.adminMailerTab.recipientPlaceholder}
                                value={toEmail}
                                onChange={(e) => setToEmail(e.target.value)}
                            />
                            {toEmail.trim() !== "" && !emailValid && (
                                <Field.ErrorText>
                                    {t.components.adminMailerTab.recipientInvalid}
                                </Field.ErrorText>
                            )}
                        </Field.Root>

                        {isFreeform && (
                            <>
                                <Field.Root>
                                    <Field.Label>{t.components.adminMailerTab.subjectLabel}</Field.Label>
                                    <Input
                                        size="sm"
                                        maxLength={255}
                                        placeholder={t.components.adminMailerTab.subjectPlaceholder}
                                        value={subject}
                                        onChange={(e) => setSubject(e.target.value)}
                                    />
                                </Field.Root>
                                <Field.Root>
                                    <Field.Label>{t.components.adminMailerTab.bodyLabel}</Field.Label>
                                    <Textarea
                                        size="sm"
                                        rows={6}
                                        maxLength={5000}
                                        placeholder={t.components.adminMailerTab.bodyPlaceholder}
                                        value={bodyText}
                                        onChange={(e) => setBodyText(e.target.value)}
                                    />
                                </Field.Root>
                            </>
                        )}

                        {/* Preview - describes the send, never re-renders the
                            backend's HTML (see the component doc). */}
                        <Box
                            bg="bg.subtle"
                            borderWidth="1px"
                            borderColor="border"
                            rounded="lg"
                            p="3"
                        >
                            <VStack align="stretch" gap="1.5">
                                <HStack gap="2" color="fg.muted">
                                    <FiMail size={13} />
                                    <Text fontSize="xs" fontWeight={700} textTransform="uppercase">
                                        {t.components.adminMailerTab.previewTitle}
                                    </Text>
                                </HStack>
                                <PreviewRow
                                    label={t.components.adminMailerTab.previewTo}
                                    value={toEmail.trim() || "-"}
                                />
                                <PreviewRow
                                    label={t.components.adminMailerTab.previewSubject}
                                    value={
                                        isFreeform
                                            ? subject.trim() || "-"
                                            : t.components.adminMailerTab.previewAuto
                                    }
                                />
                                <PreviewRow
                                    label={t.components.adminMailerTab.previewContent}
                                    value={
                                        isFreeform
                                            ? bodyText.trim() ||
                                              t.components.adminMailerTab.templateDescriptions.FREEFORM
                                            : t.components.adminMailerTab.templateDescriptions[templateKey]
                                    }
                                />
                                {pickedRequest && (
                                    <PreviewRow
                                        label={t.components.adminMailerTab.requestLabel}
                                        value={pickedRequest.matchLabel}
                                    />
                                )}
                            </VStack>
                        </Box>

                        {confirming ? (
                            <VStack align="stretch" gap="2">
                                <Text fontSize="sm" color="fg.muted">
                                    {t.components.adminMailerTab.confirmHint(toEmail.trim())}
                                </Text>
                                <HStack gap="2" justify="flex-end" wrap="wrap">
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() => setConfirming(false)}
                                        disabled={send.isPending}
                                    >
                                        <FiX />
                                        {t.components.adminMailerTab.cancelAction}
                                    </Button>
                                    <Button
                                        size="sm"
                                        colorPalette="pitch"
                                        loading={send.isPending}
                                        onClick={() => send.mutate()}
                                    >
                                        <FiCheck />
                                        {t.components.adminMailerTab.confirmAction}
                                    </Button>
                                </HStack>
                            </VStack>
                        ) : (
                            <HStack justify="flex-end">
                                <Button
                                    size="sm"
                                    colorPalette="pitch"
                                    disabled={!canSend}
                                    onClick={() => setConfirming(true)}
                                >
                                    <FiSend />
                                    {t.components.adminMailerTab.sendAction}
                                </Button>
                            </HStack>
                        )}
                    </VStack>
                </Card.Body>
            </Card.Root>

            <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
                <Card.Body p={{ base: "4", md: "6" }}>
                    <VStack align="stretch" gap="3">
                        <Text fontSize="sm" fontWeight={700}>
                            {t.components.adminMailerTab.logTitle}
                        </Text>

                        {logLoading ? (
                            <HStack justify="center" py="6">
                                <Spinner />
                            </HStack>
                        ) : !log || log.length === 0 ? (
                            <Text color="fg.muted" fontSize="sm" py="2" textAlign="center">
                                {t.components.adminMailerTab.logEmpty}
                            </Text>
                        ) : (
                            <VStack align="stretch" gap="2">
                                {log.map((row) => (
                                    <Card.Root
                                        key={row.id}
                                        variant="outline"
                                        borderColor="border"
                                        rounded="lg"
                                    >
                                        <Card.Body p="3">
                                            <VStack align="stretch" gap="1.5">
                                                <HStack justify="space-between" wrap="wrap" gap="2">
                                                    <Text fontWeight={700} fontSize="sm">
                                                        {row.toEmail}
                                                    </Text>
                                                    <Text fontSize="xs" color="fg.muted">
                                                        {formatDateTime(row.createdAt)}
                                                    </Text>
                                                </HStack>
                                                <HStack gap="2" wrap="wrap">
                                                    <Badge
                                                        variant="subtle"
                                                        colorPalette={row.ok ? "green" : "red"}
                                                    >
                                                        {row.ok ? (
                                                            <FiCheck size={11} />
                                                        ) : (
                                                            <FiAlertCircle size={11} />
                                                        )}
                                                        {row.ok
                                                            ? t.components.adminMailerTab.logOk
                                                            : t.components.adminMailerTab.logFailed}
                                                    </Badge>
                                                    <Badge variant="subtle" colorPalette="pitch">
                                                        {templates?.find((tpl) => tpl.key === row.templateKey)
                                                            ?.label ?? row.templateKey}
                                                    </Badge>
                                                </HStack>
                                                <Text fontSize="sm">{row.subject}</Text>
                                                {row.bodyPreview && (
                                                    <Text fontSize="xs" color="fg.muted" lineClamp={3}>
                                                        {row.bodyPreview}
                                                    </Text>
                                                )}
                                                {row.errorMessage && (
                                                    <Text fontSize="xs" color="red.500">
                                                        {row.errorMessage}
                                                    </Text>
                                                )}
                                            </VStack>
                                        </Card.Body>
                                    </Card.Root>
                                ))}
                            </VStack>
                        )}
                    </VStack>
                </Card.Body>
            </Card.Root>
        </VStack>
    )
}

function PreviewRow({ label, value }: { label: string; value: string }) {
    return (
        <HStack align="start" gap="2" fontSize="sm">
            <Text color="fg.muted" minW="4.5rem" flexShrink={0}>
                {label}
            </Text>
            <Text whiteSpace="pre-wrap" wordBreak="break-word">
                {value}
            </Text>
        </HStack>
    )
}

/** "Ekipa A - Ekipa B · Turnir · APPROVED · neplaćeno" - one <option> line. */
function pickLabel(
    matchLabel: string,
    tournamentName: string | null,
    status: string,
    paidLabel: string,
): string {
    return [matchLabel, tournamentName, status, paidLabel].filter(Boolean).join(" · ")
}

/** Same deliberately simple check the backend uses - the backend is authoritative. */
function isValidEmail(email: string): boolean {
    const trimmed = email.trim()
    return trimmed.length > 0 && trimmed.length <= 255 && /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(trimmed)
}

/** Pull `{"code": "..."}` out of a 409 response body, if present. */
function errorCode(err: unknown): string | undefined {
    if (!isAxiosError(err) || err.response?.status !== 409) return undefined
    const data = err.response.data as { code?: string } | undefined
    return data?.code
}

function formatDateTime(iso: string | null | undefined): string {
    if (!iso) return "-"
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return String(iso)
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
