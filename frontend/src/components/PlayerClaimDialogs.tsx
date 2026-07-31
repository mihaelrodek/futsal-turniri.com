import { useEffect, useState } from "react"
import {
    Badge,
    Box,
    Button,
    Dialog,
    HStack,
    Input,
    Portal,
    Spinner,
    Text,
    Textarea,
    VStack,
} from "@chakra-ui/react"
import { FiSearch, FiUserCheck } from "react-icons/fi"
import type { PlayerClaimSuggestion } from "../api/userMe"
import {
    cancelPlayerClaimRequest,
    createPlayerClaimRequest,
    searchClaimablePlayers,
    type PlayerClaimRequest,
} from "../api/playerClaims"
import { useTranslation } from "../i18n"
import { showError, showSuccess } from "../toaster"

/* ──────────────────────────────────────────────────────────────────────────
   The two "which roster player am I" dialogs plus the requester's own
   status list.

   Automatic path: the account's registered name folds to exactly a roster
   name on an unclaimed team. For an account that already has teams linked we
   just do it (PublicProfilePage's auto-claim). For a BRAND NEW account we ask
   first - PlayerClaimConfirmDialog - because the very first thing that
   happens after registering shouldn't be silently inheriting a stranger's
   history if two people share a name.

   Manual path: nothing matched. PlayerClaimRequestDialog lets the person
   search the rosters themselves and send a request with a comment; an admin
   approves it. No self-service, deliberately.
   ────────────────────────────────────────────────────────────────────── */

/** "Pronašli smo igrača - jesi li to ti?" on the first login after signup. */
export function PlayerClaimConfirmDialog({
    open,
    suggestions,
    busy,
    onConfirm,
    onDecline,
    onNotAPlayer,
}: {
    open: boolean
    suggestions: PlayerClaimSuggestion[]
    busy: boolean
    onConfirm: () => void
    /** "Nisam" - not this particular person; may be asked again later. */
    onDecline: () => void
    /** "Nisam igrač" - never ask again, on any device. */
    onNotAPlayer: () => void
}) {
    const t = useTranslation()
    const s = t.components.playerClaim.confirmDialog

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(e) => { if (!e.open && !busy) onDecline() }}
            placement="center"
        >
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW="md">
                        <Dialog.Header>
                            <HStack gap="2">
                                <FiUserCheck />
                                <Text>{s.title}</Text>
                            </HStack>
                        </Dialog.Header>
                        <Dialog.Body>
                            <VStack align="stretch" gap="3">
                                <Text fontSize="sm" color="fg.muted">{s.intro}</Text>
                                <VStack align="stretch" gap="2">
                                    {suggestions.map((sg) => (
                                        <Box
                                            key={sg.playerId}
                                            borderWidth="1px"
                                            borderColor="border.emphasized"
                                            rounded="md"
                                            p="3"
                                        >
                                            <Text fontWeight="semibold">{sg.playerName}</Text>
                                            <Text fontSize="xs" color="fg.muted">
                                                {[sg.teamName, sg.tournamentName].filter(Boolean).join(" · ")}
                                            </Text>
                                        </Box>
                                    ))}
                                </VStack>
                            </VStack>
                        </Dialog.Body>
                        <Dialog.Footer flexWrap="wrap" gap="2">
                            {/* Three answers, not two: "not me" is about THIS
                                suggestion, "nisam igrač" is about the whole
                                feature and is remembered server-side. */}
                            <Button variant="ghost" size="sm" onClick={onNotAPlayer} disabled={busy}>
                                {s.notAPlayerButton}
                            </Button>
                            <Button variant="ghost" onClick={onDecline} disabled={busy}>
                                {s.declineButton}
                            </Button>
                            <Button variant="solid" colorPalette="pitch" loading={busy} onClick={onConfirm}>
                                {s.confirmButton}
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}

/** Roster search + comment → a request an admin decides. */
export function PlayerClaimRequestDialog({
    open,
    onClose,
    onSubmitted,
}: {
    open: boolean
    onClose: () => void
    onSubmitted: (created: PlayerClaimRequest) => void
}) {
    const t = useTranslation()
    const s = t.components.playerClaim.requestDialog

    const [query, setQuery] = useState("")
    const [results, setResults] = useState<PlayerClaimSuggestion[]>([])
    const [searching, setSearching] = useState(false)
    const [picked, setPicked] = useState<PlayerClaimSuggestion | null>(null)
    const [comment, setComment] = useState("")
    const [submitting, setSubmitting] = useState(false)

    // Reset whenever the dialog is (re)opened - a stale search from last time
    // is worse than an empty box.
    useEffect(() => {
        if (!open) return
        setQuery("")
        setResults([])
        setPicked(null)
        setComment("")
    }, [open])

    // Debounced search. Under 2 characters the backend returns nothing, so
    // don't even ask.
    useEffect(() => {
        if (!open) return
        const q = query.trim()
        if (q.length < 2) {
            setResults([])
            setSearching(false)
            return
        }
        setSearching(true)
        let cancelled = false
        const timer = setTimeout(async () => {
            try {
                const rows = await searchClaimablePlayers(q)
                if (!cancelled) setResults(rows)
            } catch {
                if (!cancelled) setResults([])
            } finally {
                if (!cancelled) setSearching(false)
            }
        }, 300)
        return () => { cancelled = true; clearTimeout(timer) }
    }, [query, open])

    async function submit() {
        if (!picked) { showError(s.errorTitle, s.selectRequired); return }
        if (!comment.trim()) { showError(s.errorTitle, s.commentRequired); return }
        setSubmitting(true)
        try {
            const created = await createPlayerClaimRequest(picked.playerId, comment.trim())
            showSuccess(s.successTitle, s.successDescription)
            onSubmitted(created)
            onClose()
        } catch (e: any) {
            // The backend answers these with a bare marker string + 409 so the
            // copy stays localized here.
            const code = typeof e?.response?.data === "string" ? e.response.data : ""
            const message =
                code.includes("ALREADY_REQUESTED") ? s.alreadyRequested
                : code.includes("ALREADY_CLAIMED") ? s.alreadyClaimed
                : code.includes("TOO_MANY_OPEN") ? s.tooManyOpen
                : s.genericError
            showError(s.errorTitle, message)
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(e) => { if (!e.open && !submitting) onClose() }}
            placement="center"
        >
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW="lg">
                        <Dialog.Header>{s.title}</Dialog.Header>
                        <Dialog.Body>
                            <VStack align="stretch" gap="3">
                                <Text fontSize="sm" color="fg.muted">{s.intro}</Text>

                                <HStack gap="2">
                                    <Box color="fg.muted"><FiSearch /></Box>
                                    <Input
                                        size="sm"
                                        placeholder={s.searchPlaceholder}
                                        value={query}
                                        onChange={(e) => setQuery(e.target.value)}
                                    />
                                </HStack>

                                <Box maxH="260px" overflowY="auto">
                                    {searching ? (
                                        <HStack gap="2" color="fg.muted" py="3">
                                            <Spinner size="xs" />
                                            <Text fontSize="sm">{t.common.loading}</Text>
                                        </HStack>
                                    ) : query.trim().length < 2 ? (
                                        <Text fontSize="sm" color="fg.muted" py="2">{s.searchHint}</Text>
                                    ) : results.length === 0 ? (
                                        <Text fontSize="sm" color="fg.muted" py="2">{s.noResults}</Text>
                                    ) : (
                                        <VStack align="stretch" gap="1.5">
                                            {results.map((r) => {
                                                const active = picked?.playerId === r.playerId
                                                return (
                                                    <Box
                                                        as="button"
                                                        key={r.playerId}
                                                        onClick={() => setPicked(r)}
                                                        textAlign="left"
                                                        w="100%"
                                                        borderWidth="1px"
                                                        borderColor={active ? "pitch.500" : "border.emphasized"}
                                                        bg={active ? "pitch.subtle" : "bg"}
                                                        rounded="md"
                                                        px="3"
                                                        py="2"
                                                        _hover={{ bg: active ? "pitch.subtle" : "bg.subtle" }}
                                                    >
                                                        <Text fontWeight="semibold" fontSize="sm">{r.playerName}</Text>
                                                        <Text fontSize="xs" color="fg.muted">
                                                            {[r.teamName, r.tournamentName].filter(Boolean).join(" · ")}
                                                        </Text>
                                                    </Box>
                                                )
                                            })}
                                        </VStack>
                                    )}
                                </Box>

                                <VStack align="stretch" gap="1">
                                    <Text fontSize="sm" fontWeight="medium">{s.commentLabel}</Text>
                                    <Textarea
                                        size="sm"
                                        rows={3}
                                        placeholder={s.commentPlaceholder}
                                        value={comment}
                                        onChange={(e) => setComment(e.target.value)}
                                    />
                                </VStack>
                            </VStack>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button variant="ghost" onClick={onClose} disabled={submitting}>
                                {t.common.cancel}
                            </Button>
                            <Button
                                variant="solid"
                                colorPalette="pitch"
                                loading={submitting}
                                disabled={!picked || !comment.trim()}
                                onClick={submit}
                            >
                                {s.submitButton}
                            </Button>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}

/** The requester's own list: what's still waiting, what the admin decided. */
export function MyPlayerClaimRequests({
    requests,
    onChanged,
}: {
    requests: PlayerClaimRequest[]
    onChanged: () => void
}) {
    const t = useTranslation()
    const s = t.components.playerClaim.myRequests
    const [busyId, setBusyId] = useState<number | null>(null)

    if (requests.length === 0) return null

    async function cancel(id: number) {
        setBusyId(id)
        try {
            await cancelPlayerClaimRequest(id)
            onChanged()
        } finally {
            setBusyId(null)
        }
    }

    return (
        <VStack align="stretch" gap="2">
            <Text fontSize="sm" fontWeight="semibold" color="fg.muted">{s.heading}</Text>
            {requests.map((r) => (
                <Box key={r.id} borderWidth="1px" borderColor="border.emphasized" rounded="md" p="3">
                    <HStack justify="space-between" gap="2" wrap="wrap">
                        <VStack align="start" gap="0.5" minW="0">
                            <Text fontWeight="semibold" fontSize="sm">{r.playerName}</Text>
                            <Text fontSize="xs" color="fg.muted">
                                {[r.teamName, r.tournamentName].filter(Boolean).join(" · ")}
                            </Text>
                        </VStack>
                        <HStack gap="2">
                            <ClaimStatusBadge status={r.status} />
                            {r.status === "PENDING" && (
                                <Button
                                    size="xs"
                                    variant="ghost"
                                    loading={busyId === r.id}
                                    onClick={() => cancel(r.id)}
                                >
                                    {s.cancelButton}
                                </Button>
                            )}
                        </HStack>
                    </HStack>
                    {r.adminNote && (
                        <Text fontSize="xs" color="fg.muted" mt="2">
                            <Text as="span" fontWeight={700}>{s.adminNoteLabel}</Text> {r.adminNote}
                        </Text>
                    )}
                </Box>
            ))}
        </VStack>
    )
}

export function ClaimStatusBadge({ status }: { status: PlayerClaimRequest["status"] }) {
    const t = useTranslation()
    const s = t.components.playerClaim.status
    const map = {
        PENDING: { palette: "yellow", label: s.pending },
        APPROVED: { palette: "green", label: s.approved },
        REJECTED: { palette: "red", label: s.rejected },
        CANCELLED: { palette: "gray", label: s.cancelled },
    } as const
    const cfg = map[status] ?? map.PENDING
    return (
        <Badge variant="subtle" colorPalette={cfg.palette} size="sm">
            {cfg.label}
        </Badge>
    )
}
