import { useState } from "react"
import {
    Box,
    Button,
    Card,
    HStack,
    Input,
    Spinner,
    Text,
    VStack,
} from "@chakra-ui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FiCheck, FiMail, FiRefreshCw, FiX } from "react-icons/fi"
import { Link as RouterLink } from "react-router-dom"
import {
    adminApprovePlayerClaimRequest,
    adminBackfillPlayerLinks,
    adminListPlayerClaimRequests,
    adminRejectPlayerClaimRequest,
    type PlayerClaimRequest,
} from "../api/playerClaims"
import { ClaimStatusBadge } from "./PlayerClaimDialogs"
import { useTranslation } from "../i18n"
import { showError, showSuccess } from "../toaster"

/**
 * Admin inbox for manual "this roster player is me" requests.
 *
 * Approving links the requester into the team's co-owner slot - the exact
 * same state an automatic name match produces - so this tab is the only
 * place where a claim that ISN'T backed by an exact name match can be
 * granted. That's why the requester's comment, name and e-mail are all
 * shown together: they're the whole evidence base for the decision.
 */
export default function AdminPlayerClaimRequestsTab() {
    const t = useTranslation()
    const s = t.components.adminPlayerClaimRequestsTab
    const qc = useQueryClient()

    const { data, isLoading } = useQuery({
        queryKey: ["adminPlayerClaimRequests"],
        queryFn: adminListPlayerClaimRequests,
    })

    const [notes, setNotes] = useState<Record<number, string>>({})
    const [busyId, setBusyId] = useState<number | null>(null)

    const decide = useMutation({
        mutationFn: async (v: { id: number; approve: boolean; note: string }) =>
            v.approve
                ? adminApprovePlayerClaimRequest(v.id, v.note || undefined)
                : adminRejectPlayerClaimRequest(v.id, v.note || undefined),
        onMutate: (v) => setBusyId(v.id),
        onSuccess: (_res, v) => {
            showSuccess(v.approve ? s.approveSuccess : s.rejectSuccess)
            setNotes((prev) => ({ ...prev, [v.id]: "" }))
            qc.invalidateQueries({ queryKey: ["adminPlayerClaimRequests"] })
        },
        onError: (e: any) => {
            const code = typeof e?.response?.data === "string" ? e.response.data : ""
            const message =
                code.includes("NOT_PENDING") ? s.errorNotPending
                : code.includes("PLAYER_GONE") ? s.errorPlayerGone
                : code.includes("ALREADY_CLAIMED") ? s.errorAlreadyClaimed
                : s.errorGeneric
            showError(s.errorTitle, message)
        },
        onSettled: () => setBusyId(null),
    })

    const [backfilling, setBackfilling] = useState(false)

    async function runBackfill() {
        setBackfilling(true)
        try {
            const res = await adminBackfillPlayerLinks()
            showSuccess(s.backfillDoneTitle, s.backfillDoneDescription(res.linked, res.ambiguous))
            qc.invalidateQueries({ queryKey: ["adminPlayerClaimRequests"] })
        } catch {
            showError(s.errorTitle, s.errorGeneric)
        } finally {
            setBackfilling(false)
        }
    }

    const rows: PlayerClaimRequest[] = data ?? []
    const pending = rows.filter((r) => r.status === "PENDING")

    return (
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Body p={{ base: "4", md: "5" }}>
                <VStack align="stretch" gap="4">
                    {/* No card title: /admin/{slug} already names the module. */}
                    <HStack justify="flex-end" wrap="wrap" gap="3">
                        <Text fontSize="sm" color="fg.muted">{s.pendingCount(pending.length)}</Text>
                        {/* Manual re-run of the automatic matcher - useful
                            right after fixing a misspelled roster name. */}
                        <Button size="xs" variant="outline" loading={backfilling} onClick={runBackfill}>
                            <FiRefreshCw /> {s.backfillButton}
                        </Button>
                    </HStack>

                    {isLoading ? (
                        <HStack gap="2" color="fg.muted"><Spinner size="sm" /><Text>{t.common.loading}</Text></HStack>
                    ) : rows.length === 0 ? (
                        <Box borderWidth="1px" borderStyle="dashed" borderColor="border.emphasized" rounded="md" py="6" textAlign="center">
                            <Text fontSize="sm" color="fg.muted">{s.empty}</Text>
                        </Box>
                    ) : (
                        <VStack align="stretch" gap="3">
                            {rows.map((r) => (
                                <Box key={r.id} borderWidth="1px" borderColor="border.emphasized" rounded="md" p="3">
                                    <VStack align="stretch" gap="2">
                                        <HStack justify="space-between" gap="2" wrap="wrap">
                                            <VStack align="start" gap="0.5" minW="0">
                                                <Text fontWeight="semibold">{r.playerName}</Text>
                                                <Text fontSize="xs" color="fg.muted">
                                                    {[r.teamName, r.tournamentName].filter(Boolean).join(" · ")}
                                                </Text>
                                            </VStack>
                                            <ClaimStatusBadge status={r.status} />
                                        </HStack>

                                        <HStack gap="3" wrap="wrap" fontSize="xs" color="fg.muted">
                                            <Text>
                                                {s.requesterLabel}{" "}
                                                {r.requesterSlug ? (
                                                    <RouterLink
                                                        to={`/profil/${r.requesterSlug}`}
                                                        style={{ color: "var(--chakra-colors-blue-fg)", fontWeight: 500 }}
                                                    >
                                                        {r.requesterName || r.requesterSlug}
                                                    </RouterLink>
                                                ) : (r.requesterName ?? "-")}
                                            </Text>
                                            {r.requesterEmail && (
                                                <HStack gap="1"><FiMail size={12} /><Text>{r.requesterEmail}</Text></HStack>
                                            )}
                                        </HStack>

                                        {r.comment && (
                                            <Box bg="bg.subtle" rounded="md" p="2.5">
                                                <Text fontSize="xs" color="fg.muted" mb="0.5">{s.commentLabel}</Text>
                                                <Text fontSize="sm" whiteSpace="pre-wrap">{r.comment}</Text>
                                            </Box>
                                        )}

                                        {r.adminNote && r.status !== "PENDING" && (
                                            <Text fontSize="xs" color="fg.muted">
                                                <Text as="span" fontWeight={700}>{s.adminNoteLabel}</Text> {r.adminNote}
                                            </Text>
                                        )}

                                        {r.status === "PENDING" && (
                                            <HStack gap="2" wrap="wrap">
                                                <Input
                                                    size="sm"
                                                    flex="1"
                                                    minW="180px"
                                                    placeholder={s.notePlaceholder}
                                                    value={notes[r.id] ?? ""}
                                                    onChange={(e) => setNotes((prev) => ({ ...prev, [r.id]: e.target.value }))}
                                                />
                                                <Button
                                                    size="sm"
                                                    variant="solid"
                                                    colorPalette="pitch"
                                                    loading={busyId === r.id}
                                                    onClick={() => decide.mutate({ id: r.id, approve: true, note: notes[r.id] ?? "" })}
                                                >
                                                    <FiCheck /> {s.approveButton}
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    colorPalette="red"
                                                    loading={busyId === r.id}
                                                    onClick={() => decide.mutate({ id: r.id, approve: false, note: notes[r.id] ?? "" })}
                                                >
                                                    <FiX /> {s.rejectButton}
                                                </Button>
                                            </HStack>
                                        )}
                                    </VStack>
                                </Box>
                            ))}
                        </VStack>
                    )}
                </VStack>
            </Card.Body>
        </Card.Root>
    )
}
