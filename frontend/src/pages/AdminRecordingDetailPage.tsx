import { useCallback, useEffect, useState } from "react"
import {
    Badge,
    Box,
    Button,
    Flex,
    Heading,
    HStack,
    Input,
    NativeSelect,
    Spinner,
    Text,
    VStack,
} from "@chakra-ui/react"
import { useNavigate, useParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { FiDownload, FiEdit2, FiRepeat, FiSlash, FiTrash2 } from "react-icons/fi"

import {
    deleteMatchRecording,
    fetchMatchRecordingDownloadLink,
    fetchMatchRecordings,
    reassignMatchRecording,
    renameMatchRecording,
    type MatchRecordingDto,
} from "../api/matchRecordings"
import { fetchTournaments } from "../api/tournaments"
import { fetchSchedule } from "../api/schedule"
import type { TournamentCard } from "../types/tournaments"
import { qk } from "../queryClient"
import { BackLink, MonoLabel } from "../ui/pitch"
import { ConfirmDialog, EmptyState, Loader, Panel } from "../ui/primitives"
import { useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   AdminRecordingDetailPage - /admin/baza-snimki/{uuid}.

   One library recording: what it is, and the four things that can be done to
   it (download, rename, re-map to another match, delete).

   Split out of the list because three of those four used to open their own
   inline panel inside a row - a tournament+match picker under a 40px line -
   so the list flipped between "a list" and "a form" depending on what was
   expanded. Deleting a recording is also unrecoverable, which is reason enough
   for it not to sit one mis-tap away from the row above it.
   ────────────────────────────────────────────────────────────────────── */

function formatKickoff(iso: string | null | undefined): string {
    if (!iso) return ""
    try {
        return new Date(iso).toLocaleString("hr-HR", {
            day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
        })
    } catch {
        return ""
    }
}

/** "1,4 GB" / "230 MB" style size label. */
function formatFileSize(bytes: number | null | undefined): string {
    if (bytes == null) return ""
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace(".", ",")} GB`
    if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
    return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export default function AdminRecordingDetailPage() {
    const t = useTranslation()
    const lib = t.recordingRequest.adminLibrary
    const p = t.pages.adminRecordingDetail
    const navigate = useNavigate()
    const { uuid = "" } = useParams<{ uuid: string }>()

    const [rec, setRec] = useState<MatchRecordingDto | null>(null)
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState<null | "download" | "rename" | "delete" | "reassign">(null)
    const [deleteOpen, setDeleteOpen] = useState(false)

    /* Rename. */
    const [nameInput, setNameInput] = useState("")

    /* Re-map, prefilled with where the recording currently sits so fixing a
       wrong match inside the same tournament is one select. */
    const [reassignTournamentUuid, setReassignTournamentUuid] = useState("")
    const [reassignMatchId, setReassignMatchId] = useState<number | null>(null)

    /** There is no by-uuid endpoint - the library list is admin-only and
     *  small, so it is fetched and matched here rather than adding one. */
    const load = useCallback(async () => {
        const rows = await fetchMatchRecordings({})
        const found = rows.find((r) => r.uuid === uuid) ?? null
        setRec(found)
        setNameInput(found?.fileName ?? "")
        setReassignTournamentUuid(found?.tournamentUuid ?? "")
        setReassignMatchId(found?.matchId ?? null)
    }, [uuid])

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        load()
            .catch(() => { /* interceptor toasts */ })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [load])

    const { data: tournaments } = useQuery({
        queryKey: ["matchRecordings", "pickerTournaments"] as const,
        queryFn: async () => {
            const [upcoming, finished] = await Promise.all([
                fetchTournaments("upcoming"),
                fetchTournaments("finished"),
            ])
            return [...upcoming, ...finished] as TournamentCard[]
        },
    })

    const { data: schedule, isLoading: scheduleLoading } = useQuery({
        queryKey: qk.schedule(reassignTournamentUuid),
        queryFn: () => fetchSchedule(reassignTournamentUuid),
        enabled: !!reassignTournamentUuid,
    })
    const pickableMatches = (schedule?.matches ?? []).filter((m) => m.team1Name && m.team2Name)

    async function download() {
        if (!rec) return
        try {
            setBusy("download")
            const { url } = await fetchMatchRecordingDownloadLink(rec.uuid)
            window.open(url, "_blank", "noopener")
        } finally {
            setBusy(null)
        }
    }

    async function rename() {
        if (!rec || !nameInput.trim()) return
        try {
            setBusy("rename")
            await renameMatchRecording(rec.uuid, nameInput.trim())
            await load()
        } finally {
            setBusy(null)
        }
    }

    async function reassign() {
        if (!rec || reassignMatchId == null || reassignMatchId === rec.matchId) return
        try {
            setBusy("reassign")
            await reassignMatchRecording(rec.uuid, reassignMatchId)
            await load()
        } finally {
            setBusy(null)
        }
    }

    async function remove() {
        if (!rec) return
        setDeleteOpen(false)
        try {
            setBusy("delete")
            await deleteMatchRecording(rec.uuid)
            navigate("/admin/baza-snimki")
        } finally {
            setBusy(null)
        }
    }

    if (loading) return <Loader />

    if (!rec) {
        return (
            <Box>
                <BackLink to="/admin/baza-snimki" onClick={() => navigate("/admin/baza-snimki")} label={p.back} />
                <EmptyState
                    icon={FiSlash}
                    title={p.notFoundTitle}
                    description={p.notFoundDesc}
                    action={
                        <Button size="sm" variant="outline" colorPalette="pitch" onClick={() => navigate("/admin/baza-snimki")}>
                            {p.back}
                        </Button>
                    }
                />
            </Box>
        )
    }

    const matchLabel = [rec.team1Name, rec.team2Name].filter(Boolean).join(" — ") || p.unknownMatch

    return (
        <Box>
            <BackLink to="/admin/baza-snimki" onClick={() => navigate("/admin/baza-snimki")} label={p.back} />

            <Flex align="flex-start" justify="space-between" gap="3" wrap="wrap" mb="4">
                <Box minW="0">
                    <Heading as="h1" size="lg" lineHeight="1.2" letterSpacing="-0.02em" color="fg.ink">
                        {rec.fileName || p.unnamed}
                    </Heading>
                    <HStack gap="2" mt="1.5" wrap="wrap">
                        <Text fontSize="sm" color="fg.muted">{matchLabel}</Text>
                        {rec.videoSizeBytes != null && (
                            <Badge size="sm" variant="subtle" colorPalette="purple">
                                {formatFileSize(rec.videoSizeBytes)}
                            </Badge>
                        )}
                    </HStack>
                </Box>
                <Button size="sm" colorPalette="pitch" loading={busy === "download"} onClick={download}>
                    <FiDownload /> {lib.download}
                </Button>
            </Flex>

            <VStack align="stretch" gap="4">
                <Panel p={{ base: "3", md: "4" }}>
                    <VStack align="stretch" gap="2.5">
                        <MonoLabel display="block">{p.detailsLabel}</MonoLabel>
                        <HStack justify="space-between" gap="3" wrap="wrap">
                            <Text fontSize="sm" color="fg.muted">{p.tournamentLabel}</Text>
                            <Text fontSize="sm" fontWeight={600}>{rec.tournamentName}</Text>
                        </HStack>
                        <HStack justify="space-between" gap="3" wrap="wrap">
                            <Text fontSize="sm" color="fg.muted">{p.kickoffLabel}</Text>
                            <Text fontSize="sm" fontWeight={600}>{formatKickoff(rec.kickoffAt) || "-"}</Text>
                        </HStack>
                        <HStack justify="space-between" gap="3" wrap="wrap">
                            <Text fontSize="sm" color="fg.muted">{p.uploadedLabel}</Text>
                            <Text fontSize="sm" fontWeight={600}>{formatKickoff(rec.createdAt) || "-"}</Text>
                        </HStack>
                    </VStack>
                </Panel>

                <Panel p={{ base: "3", md: "4" }}>
                    <VStack align="stretch" gap="2">
                        <MonoLabel display="block">{lib.renameLabel}</MonoLabel>
                        <HStack gap="2">
                            <Input
                                size="sm"
                                value={nameInput}
                                onChange={(e) => setNameInput(e.target.value)}
                                fontFamily="mono"
                                fontSize="13px"
                            />
                            <Button
                                size="sm"
                                variant="outline"
                                colorPalette="pitch"
                                loading={busy === "rename"}
                                disabled={!nameInput.trim() || nameInput.trim() === (rec.fileName ?? "")}
                                onClick={rename}
                            >
                                <FiEdit2 /> {lib.save}
                            </Button>
                        </HStack>
                    </VStack>
                </Panel>

                <Panel p={{ base: "3", md: "4" }}>
                    <VStack align="stretch" gap="2.5">
                        <Box>
                            <MonoLabel display="block">{lib.reassignLabel}</MonoLabel>
                            <Text fontSize="xs" color="fg.muted" mt="0.5">{p.reassignHint}</Text>
                        </Box>
                        <NativeSelect.Root size="sm">
                            <NativeSelect.Field
                                value={reassignTournamentUuid}
                                onChange={(e) => {
                                    setReassignTournamentUuid(e.currentTarget.value)
                                    setReassignMatchId(null)
                                }}
                            >
                                <option value="">{lib.pickTournament}</option>
                                {(tournaments ?? []).map((tn) => (
                                    <option key={tn.uuid} value={tn.uuid}>{tn.name}</option>
                                ))}
                            </NativeSelect.Field>
                            <NativeSelect.Indicator />
                        </NativeSelect.Root>

                        {scheduleLoading ? (
                            <HStack gap="2" color="fg.muted"><Spinner size="xs" /><Text fontSize="sm">{t.common.loading}</Text></HStack>
                        ) : (
                            <NativeSelect.Root size="sm" disabled={!reassignTournamentUuid}>
                                <NativeSelect.Field
                                    value={reassignMatchId == null ? "" : String(reassignMatchId)}
                                    onChange={(e) => {
                                        const v = e.currentTarget.value
                                        setReassignMatchId(v ? Number(v) : null)
                                    }}
                                >
                                    <option value="">{lib.pickMatch}</option>
                                    {pickableMatches.map((m) => (
                                        <option key={m.matchId} value={m.matchId}>
                                            {m.team1Name} — {m.team2Name}
                                            {m.kickoffAt ? ` · ${formatKickoff(m.kickoffAt)}` : ""}
                                        </option>
                                    ))}
                                </NativeSelect.Field>
                                <NativeSelect.Indicator />
                            </NativeSelect.Root>
                        )}

                        <HStack>
                            <Button
                                size="sm"
                                variant="outline"
                                colorPalette="pitch"
                                loading={busy === "reassign"}
                                disabled={reassignMatchId == null || reassignMatchId === rec.matchId}
                                onClick={reassign}
                            >
                                <FiRepeat /> {lib.reassignConfirm}
                            </Button>
                        </HStack>
                    </VStack>
                </Panel>

                <Panel p={{ base: "3", md: "4" }}>
                    <HStack justify="space-between" gap="3" wrap="wrap">
                        <Box>
                            <Text fontSize="sm" fontWeight={700} color="fg.ink">{p.deleteTitle}</Text>
                            <Text fontSize="xs" color="fg.muted">{p.deleteDesc}</Text>
                        </Box>
                        <Button
                            size="sm"
                            variant="outline"
                            colorPalette="red"
                            loading={busy === "delete"}
                            onClick={() => setDeleteOpen(true)}
                        >
                            <FiTrash2 /> {lib.delete}
                        </Button>
                    </HStack>
                </Panel>
            </VStack>

            <ConfirmDialog
                open={deleteOpen}
                title={p.deleteConfirmTitle}
                description={p.deleteConfirmDesc}
                confirmLabel={lib.delete}
                danger
                busy={busy === "delete"}
                onConfirm={remove}
                onClose={() => setDeleteOpen(false)}
            />
        </Box>
    )
}
