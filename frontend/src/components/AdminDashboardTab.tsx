import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link as RouterLink } from "react-router-dom"
import {
    Badge,
    Box,
    Button,
    Card,
    Flex,
    HStack,
    Input,
    Spinner,
    Stack,
    Tabs,
    Text,
    VStack,
} from "@chakra-ui/react"
import { useQueryClient } from "@tanstack/react-query"
import { FiChevronRight, FiList, FiSearch } from "react-icons/fi"
import { ADMIN_PENDING_COUNTS_KEY } from "../api/adminCounts"
import {
    adminConfirmTournamentDelete,
    adminDeleteTournament,
    adminFeatureTournament,
    adminListDeleteRequests,
    adminListTournaments,
    adminResetTournament,
    adminRestoreTournament,
    adminSetTournamentStatus,
    adminUnfeatureTournament,
    adminExportTournament,
    adminImportTournament,
    type AdminDeleteRequestDto,
    type AdminImportResponse,
    type AdminTournamentDto,
} from "../api/admin"
import { hideTournament, unhideTournament } from "../api/tournaments"
import { formatDate } from "../admin/format"
import { useTranslation } from "../i18n"
import {
    FiAlertTriangle,
    FiDownload,
    FiExternalLink,
    FiEye,
    FiEyeOff,
    FiPlay,
    FiRotateCcw,
    FiStar,
    FiStopCircle,
    FiTrash2,
    FiUpload,
} from "react-icons/fi"

/**
 * Admin-only "Upravljanje turnirima" tab on the profile page, gated on a
 * single tournament picker at the top.
 *
 * <p>For the selected tournament the admin can:
 *   - see the current owner and grant/revoke co-editor rights ("Prava na
 *     turnir") without transferring ownership - useful when the owner
 *     wants help managing the tournament (details, teams, schedule,
 *     Zapisnik…);
 *   - run administrative actions ("Akcije turnira"): force a status
 *     override, reset rounds/bracket/schedule, toggle the daily-highlight
 *     feature, hide/unhide the tournament from public listings, export a
 *     full JSON dump, or soft-delete it.
 *
 * <p>UI flow:
 *   1. Admin picks a tournament from the list (top section). The list
 *      shows the current owner alongside each row so the admin knows
 *      what they're about to act on.
 *   2. Component fetches the tournament's editors and renders the rights
 *      card (owner + editor list + "Daj prava osobi" button) and the
 *      actions card below it.
 *   3. "Daj prava osobi" opens a user-search dialog. Selecting a user
 *      grants editor rights and appends them to the list; the dialog
 *      stays open so several people can be granted in one go.
 *
 * <p>Component-level state intentionally lives here rather than a
 * context - the dashboard is a single self-contained screen that
 * doesn't share state with anything else.
 */
/* ──────────────────────────────────────────────────────────────────────────
   AdminDashboardTab - the "Upravljanje turnirima" module's LIST screen.

   A searchable list of every tournament, where each row OPENS that
   tournament's admin screen (/admin/turniri/{uuid} - AdminTournamentDetailPage,
   which carries the rights and the destructive actions).

   Only what belongs to no single tournament stays here: the pending deletion
   requests and the JSON import (which creates a new one). The old screen put
   a picker on top and revealed three stacked cards below it, so the tournament
   you were acting on was a scroll away from the buttons acting on it - and
   "Reset" of the wrong tournament is not a recoverable mistake.

   Those three surfaces are now TABS, not a stack: the list is the daily work
   and was pushed down the page by two panels that are looked at once a month.
   The deletion tab carries a count badge because a request filed by an
   organizer is otherwise invisible until someone scrolls - the same number the
   console card badges (GET /admin/pending-counts).
   ────────────────────────────────────────────────────────────────────── */

export default function AdminDashboardTab() {
    const t = useTranslation()
    const d = t.components.adminDashboardTab
    const queryClient = useQueryClient()

    const [tournaments, setTournaments] = useState<AdminTournamentDto[] | null>(null)
    const [tournamentSearch, setTournamentSearch] = useState("")
    const [loadingTournaments, setLoadingTournaments] = useState(false)

    // Lifted out of AdminDeleteRequestsCard: the tab trigger needs the count
    // before the panel is ever opened, and two fetches of the same list would
    // be two different numbers the moment one of them is stale.
    const [deleteRequests, setDeleteRequests] = useState<AdminDeleteRequestDto[] | null>(null)

    const loadDeleteRequests = useCallback(() => {
        adminListDeleteRequests()
            .then(setDeleteRequests)
            .catch(() => setDeleteRequests([]))
        // The console's card badge counts the same rows - keep it honest after
        // a confirm/restore instead of waiting out its staleTime.
        queryClient.invalidateQueries({ queryKey: ADMIN_PENDING_COUNTS_KEY })
    }, [queryClient])

    useEffect(() => { loadDeleteRequests() }, [loadDeleteRequests])

    const pendingDeletes = deleteRequests?.length ?? 0

    const reload = useCallback(async () => {
        const rows = await adminListTournaments()
        setTournaments(rows)
    }, [])

    useEffect(() => {
        let cancelled = false
        setLoadingTournaments(true)
        adminListTournaments()
            .then((rows) => { if (!cancelled) setTournaments(rows) })
            .catch(() => { /* http interceptor surfaces the toast */ })
            .finally(() => { if (!cancelled) setLoadingTournaments(false) })
        return () => { cancelled = true }
    }, [])

    // Finished tournaments are the archive, not the work: they only grow in
    // number and push what an admin actually acts on off the screen. Hidden
    // until asked for - a search still only looks inside what is shown, so the
    // toggle has to be flipped to find an old one by name.
    const [showFinished, setShowFinished] = useState(false)

    const finishedCount = useMemo(
        () => (tournaments ?? []).filter((tour) => tour.status === "FINISHED").length,
        [tournaments],
    )

    // Client-side filter: the list is tens of rows, so a round trip per
    // keystroke would buy nothing.
    const filteredTournaments = useMemo(() => {
        if (!tournaments) return []
        const q = tournamentSearch.trim().toLowerCase()
        return tournaments.filter((tour) => {
            if (!showFinished && tour.status === "FINISHED") return false
            if (!q) return true
            const hay = `${tour.name} ${tour.location ?? ""} ${tour.slug ?? ""}`.toLowerCase()
            return hay.includes(q)
        })
    }, [tournaments, tournamentSearch, showFinished])

    return (
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Body p={{ base: "4", md: "6" }}>
                <Tabs.Root defaultValue="list" variant="line">
                    <Tabs.List>
                        <Tabs.Trigger value="list">
                            <FiList /> {d.tabs.list}
                        </Tabs.Trigger>
                        <Tabs.Trigger value="deleteRequests">
                            <FiTrash2 /> {d.tabs.deleteRequests}
                            {pendingDeletes > 0 && (
                                <Badge size="sm" variant="solid" colorPalette="red">
                                    {pendingDeletes}
                                </Badge>
                            )}
                        </Tabs.Trigger>
                        <Tabs.Trigger value="import">
                            <FiUpload /> {d.tabs.import}
                        </Tabs.Trigger>
                    </Tabs.List>

                    <Tabs.Content value="list">
                        <Stack gap="3">
                            <HStack justify="space-between" gap="3" wrap="wrap">
                            <Text fontSize="sm" fontWeight="medium">{d.tournamentLabel}</Text>
                            <HStack gap="2" wrap="wrap">
                                {tournaments && (
                                    <Text fontSize="xs" color="fg.muted">
                                        {filteredTournaments.length === tournaments.length
                                            ? d.countTotal(tournaments.length)
                                            : d.countFiltered(filteredTournaments.length, tournaments.length)}
                                    </Text>
                                )}
                                {finishedCount > 0 && (
                                    <Button
                                        size="xs"
                                        variant="ghost"
                                        colorPalette="gray"
                                        onClick={() => setShowFinished((v) => !v)}
                                    >
                                        {showFinished
                                            ? <><FiEyeOff /> {d.hideFinished}</>
                                            : <><FiEye /> {d.showFinished(finishedCount)}</>}
                                    </Button>
                                )}
                            </HStack>
                        </HStack>

                        <Box position="relative">
                            <Box
                                position="absolute"
                                left="3"
                                top="50%"
                                transform="translateY(-50%)"
                                color="fg.muted"
                                pointerEvents="none"
                            >
                                <FiSearch />
                            </Box>
                            <Input
                                pl="9"
                                placeholder={d.searchPlaceholder}
                                value={tournamentSearch}
                                onChange={(e) => setTournamentSearch(e.target.value)}
                            />
                        </Box>

                        {loadingTournaments ? (
                            <HStack py="4" justify="center"><Spinner size="sm" /></HStack>
                        ) : filteredTournaments.length === 0 ? (
                            <Text fontSize="sm" color="fg.muted" py="2">{d.noResults}</Text>
                        ) : (
                            <VStack align="stretch" gap="2">
                                {filteredTournaments.map((tour) => (
                                    /* Whole row opens the tournament - the only
                                       action a row has. */
                                    <Flex
                                        key={tour.id}
                                        asChild
                                        align="center"
                                        justify="space-between"
                                        gap="3"
                                        p="3"
                                        borderWidth="1px"
                                        borderColor="border"
                                        rounded="lg"
                                        transition="border-color 0.15s ease, background 0.15s ease"
                                        _hover={{ borderColor: "pitch.500", bg: "bg.subtle" }}
                                    >
                                        <RouterLink to={`/admin/turniri/${tour.uuid ?? tour.slug ?? tour.id}`}>
                                            <Box minW="0" flex="1">
                                                <Text fontSize="sm" fontWeight={700} color="fg.ink" truncate>
                                                    {tour.name}
                                                </Text>
                                                <Text fontSize="xs" color="fg.muted" truncate>
                                                    {[tour.location, formatDate(tour.startAt)].filter(Boolean).join(" • ")}
                                                </Text>
                                                <Text fontSize="xs" color="fg.muted" truncate>
                                                    {d.ownerPrefix}
                                                    {tour.createdByName
                                                        || (tour.createdByUid ? d.noName : d.ownerLegacy)}
                                                </Text>
                                            </Box>
                                            <HStack gap="2" flexShrink={0}>
                                                {tour.status && (
                                                    <Badge
                                                        size="sm"
                                                        variant="subtle"
                                                        colorPalette={tour.status === "FINISHED" ? "gray" : "blue"}
                                                    >
                                                        {tour.status}
                                                    </Badge>
                                                )}
                                                <Box color="fg.muted"><FiChevronRight /></Box>
                                            </HStack>
                                        </RouterLink>
                                    </Flex>
                                ))}
                            </VStack>
                        )}
                        </Stack>
                    </Tabs.Content>

                    {/* Pending deletion requests - organizer "Obriši" only files
                        a request (tournament archived); the final soft delete or
                        the restore back to public happens here. */}
                    <Tabs.Content value="deleteRequests">
                        <AdminDeleteRequests
                            rows={deleteRequests}
                            onChanged={() => { loadDeleteRequests(); reload() }}
                        />
                    </Tabs.Content>

                    {/* Import a tournament from an exported JSON dump - the
                        inverse of the per-tournament "Export u JSON" action.
                        Always creates a NEW tournament, so it belongs to no
                        single one. */}
                    <Tabs.Content value="import">
                        <AdminImportPanel onImported={reload} />
                    </Tabs.Content>
                </Tabs.Root>
            </Card.Body>
        </Card.Root>
    )
}

/* ──────────────────────────────────────────────────────────────────────
   AdminDeleteRequests - compact list of pending tournament-deletion
   requests (name, requester, reason, date). "Potvrdi brisanje" finalizes
   the SOFT delete (is_deleted + deleted_at - rows are never physically
   removed); "Vrati" rejects the request and puts the tournament back on
   the public listings.

   Rows come from the parent (which needs the count for the tab badge) and
   every action calls `onChanged`, which reloads BOTH lists - a confirmed
   deletion changes the tournament list too.
   ────────────────────────────────────────────────────────────────────── */
function AdminDeleteRequests({
    rows,
    onChanged,
}: {
    rows: AdminDeleteRequestDto[] | null
    onChanged: () => void
}) {
    const t = useTranslation()
    const dr = t.components.adminDashboardTab.deleteRequests
    const [busyKey, setBusyKey] = useState<string | null>(null)

    async function confirmDelete(row: AdminDeleteRequestDto) {
        const key = row.uuid ?? row.slug
        if (!key || busyKey) return
        if (!window.confirm(dr.confirmPrompt(row.name))) return
        try {
            setBusyKey(key)
            await adminConfirmTournamentDelete(key)
            onChanged()
        } finally {
            setBusyKey(null)
        }
    }

    async function restore(row: AdminDeleteRequestDto) {
        const key = row.uuid ?? row.slug
        if (!key || busyKey) return
        try {
            setBusyKey(key)
            await adminRestoreTournament(key)
            onChanged()
        } finally {
            setBusyKey(null)
        }
    }

    return (
                <Stack gap="3">
                    <Text fontSize="sm" color="fg.muted">{dr.description}</Text>
                    {rows === null ? (
                        <HStack py="2" justify="center"><Spinner size="sm" /></HStack>
                    ) : rows.length === 0 ? (
                        <Text fontSize="sm" color="fg.muted">{dr.empty}</Text>
                    ) : (
                        <Stack gap="1.5">
                            {rows.map((row) => {
                                const key = row.uuid ?? row.slug ?? String(row.tournamentId)
                                return (
                                    <Box
                                        key={key}
                                        p="3"
                                        bg="bg.subtle"
                                        rounded="md"
                                        borderWidth="1px"
                                        borderColor="border.subtle"
                                    >
                                        <HStack justify="space-between" gap="3" align="flex-start" wrap="wrap">
                                            <Box minW="0" flex="1">
                                                <HStack gap="2" wrap="wrap">
                                                    <Text fontSize="sm" fontWeight="semibold" truncate>
                                                        {row.name}
                                                    </Text>
                                                    {formatDate(row.requestedAt) && (
                                                        <Badge size="sm" variant="subtle" colorPalette="red">
                                                            {formatDate(row.requestedAt)}
                                                        </Badge>
                                                    )}
                                                </HStack>
                                                <Text fontSize="xs" color="fg.muted" truncate>
                                                    {dr.requesterPrefix}
                                                    {row.requestedByName
                                                        || row.requestedByUid
                                                        || t.components.adminDashboardTab.noName}
                                                </Text>
                                                {row.reason && (
                                                    <Text fontSize="xs" color="fg.muted">
                                                        {dr.reasonPrefix}{row.reason}
                                                    </Text>
                                                )}
                                            </Box>
                                            <HStack gap="2" flexShrink={0}>
                                                <Button
                                                    size="xs"
                                                    variant="outline"
                                                    colorPalette="gray"
                                                    disabled={busyKey != null}
                                                    loading={busyKey === (row.uuid ?? row.slug)}
                                                    onClick={() => restore(row)}
                                                >
                                                    <FiRotateCcw /> {dr.restore}
                                                </Button>
                                                <Button
                                                    size="xs"
                                                    variant="solid"
                                                    colorPalette="red"
                                                    disabled={busyKey != null}
                                                    loading={busyKey === (row.uuid ?? row.slug)}
                                                    onClick={() => confirmDelete(row)}
                                                >
                                                    <FiTrash2 /> {dr.confirm}
                                                </Button>
                                            </HStack>
                                        </HStack>
                                    </Box>
                                )
                            })}
                        </Stack>
                    )}
                </Stack>
    )
}

/* ──────────────────────────────────────────────────────────────────────
   AdminImportPanel - "Uvoz iz JSON-a": file picker for a .json dump made
   by the per-tournament export action. The file is parsed client-side
   (bad JSON never leaves the browser) and POSTed verbatim to
   /admin/tournaments/import, which creates a NEW tournament (fresh
   uuid + slug, the admin becomes owner) with every id in the file
   remapped. On success the card shows a link to the new tournament and
   any server warnings (skipped poster, missing editor users).
   ────────────────────────────────────────────────────────────────────── */
function AdminImportPanel({ onImported }: { onImported: () => void }) {
    const t = useTranslation()
    const ic = t.components.adminDashboardTab.importCard
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [busy, setBusy] = useState(false)
    const [parseError, setParseError] = useState<string | null>(null)
    const [result, setResult] = useState<AdminImportResponse | null>(null)

    async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0]
        // Reset so re-selecting the same file fires onChange again.
        e.target.value = ""
        if (!file || busy) return
        setParseError(null)
        let payload: unknown
        try {
            payload = JSON.parse(await file.text())
        } catch {
            setParseError(ic.invalidFile)
            return
        }
        try {
            setBusy(true)
            const res = await adminImportTournament(payload)
            setResult(res)
            onImported()
        } catch {
            // 400 with the exact broken field / other errors - the http
            // interceptor already showed the server's message as a toast.
        } finally {
            setBusy(false)
        }
    }

    return (
                <Stack gap="3">
                    <Text fontSize="sm" color="fg.muted">{ic.description}</Text>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json,application/json"
                        style={{ display: "none" }}
                        onChange={onFileSelected}
                    />
                    <HStack>
                        <Button
                            size="sm"
                            variant="outline"
                            colorPalette="pitch"
                            loading={busy}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <FiUpload /> {ic.button}
                        </Button>
                    </HStack>

                    {parseError && (
                        <Text fontSize="sm" color="red.fg">{parseError}</Text>
                    )}

                    {result && (
                        <Box
                            p="3"
                            bg="bg.muted"
                            rounded="md"
                            borderWidth="1px"
                            borderColor="border.subtle"
                        >
                            <Text fontSize="sm" fontWeight="medium">
                                {ic.successTitle(result.name)}
                            </Text>
                            {result.warnings.length > 0 && (
                                <Box mt="1.5">
                                    <Text fontSize="xs" color="fg.muted" fontWeight="medium">
                                        {ic.warningsLabel}
                                    </Text>
                                    <Stack gap="0.5" mt="0.5">
                                        {result.warnings.map((w, i) => (
                                            <Text key={i} fontSize="xs" color="fg.muted">• {w}</Text>
                                        ))}
                                    </Stack>
                                </Box>
                            )}
                            {(result.slug || result.uuid) && (
                                <Button
                                    asChild
                                    size="xs"
                                    variant="outline"
                                    colorPalette="pitch"
                                    mt="2"
                                >
                                    <RouterLink to={`/turniri/${result.slug ?? result.uuid}`}>
                                        <FiExternalLink /> {ic.openTournament}
                                    </RouterLink>
                                </Button>
                            )}
                        </Box>
                    )}
                </Stack>
    )
}

/* ──────────────────────────────────────────────────────────────────────
   AdminTournamentActions - destructive + status-override controls for
   a selected tournament. Lifted into its own component so the busy
   state and confirm prompts don't bloat the main dashboard render.

   onChanged is called after each successful action with the kind of
   change so the parent can re-fetch / clear selection appropriately:
     - "status"   : status changed, keep selection
     - "reset"    : rounds/bracket/schedule wiped, status → DRAFT
     - "feature"  : feature flag toggled
     - "hidden"   : visibility toggled (Sakrij/Javno)
     - "deleted"  : tournament soft-deleted, parent should clear selection
   ────────────────────────────────────────────────────────────────────── */
export function AdminTournamentActions({
    tournament,
    onChanged,
}: {
    tournament: AdminTournamentDto
    onChanged: (kind: "status" | "reset" | "feature" | "hidden" | "deleted") => void
}) {
    const t = useTranslation()
    const [busy, setBusy] = useState<null | "status" | "reset" | "delete" | "feature" | "hidden" | "export">(null)
    // The admin endpoints accept uuid OR slug - prefer uuid, fall back
    // to slug for legacy tournaments missing one.
    const idKey = tournament.uuid ?? tournament.slug ?? ""

    async function changeStatus(next: "DRAFT" | "STARTED" | "FINISHED") {
        if (busy) return
        if (next === tournament.status) return
        const ok = window.confirm(
            t.components.adminDashboardTab.actions.confirmStatusChange(tournament.name, next),
        )
        if (!ok) return
        try {
            setBusy("status")
            await adminSetTournamentStatus(idKey, next)
            onChanged("status")
        } finally {
            setBusy(null)
        }
    }

    async function resetTournament() {
        if (busy) return
        const ok = window.confirm(
            t.components.adminDashboardTab.actions.confirmReset(tournament.name),
        )
        if (!ok) return
        try {
            setBusy("reset")
            await adminResetTournament(idKey)
            onChanged("reset")
        } finally {
            setBusy(null)
        }
    }

    async function deleteTournament() {
        if (busy) return
        const typed = window.prompt(
            t.components.adminDashboardTab.actions.deletePrompt(tournament.name),
        )
        if (typed == null) return
        if (typed.trim() !== tournament.name.trim()) {
            window.alert(t.components.adminDashboardTab.actions.deleteNameMismatch)
            return
        }
        try {
            setBusy("delete")
            await adminDeleteTournament(idKey)
            onChanged("deleted")
        } finally {
            setBusy(null)
        }
    }

    async function toggleFeature() {
        if (busy) return
        try {
            setBusy("feature")
            // The admin DTO doesn't carry featuredAt, so we can't tell
            // from this row alone whether it's currently featured.
            // Optimistic: try featuring first; if backend later exposes
            // featuredAt on AdminTournamentDto we can flip the label.
            await adminFeatureTournament(idKey)
            onChanged("feature")
        } finally {
            setBusy(null)
        }
    }

    async function unfeature() {
        if (busy) return
        try {
            setBusy("feature")
            await adminUnfeatureTournament(idKey)
            onChanged("feature")
        } finally {
            setBusy(null)
        }
    }

    // Hide / unhide - same endpoints the tournament-details page used before
    // these controls moved here. AdminTournamentDto now carries `hidden`, so
    // this is a single toggle: whichever action applies next is the one shown.
    async function toggleHidden() {
        if (busy) return
        try {
            setBusy("hidden")
            if (tournament.hidden) {
                await unhideTournament(idKey)
            } else {
                await hideTournament(idKey)
            }
            onChanged("hidden")
        } finally {
            setBusy(null)
        }
    }

    /** Fetch the full-tournament JSON dump and hand it to the browser as a
     *  .json download (blob URL - the API needs the auth header, so a plain
     *  href to the endpoint wouldn't authenticate). */
    async function exportJson() {
        if (busy) return
        try {
            setBusy("export")
            const data = await adminExportTournament(idKey)
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = `turnir-${tournament.slug ?? tournament.uuid ?? tournament.id}.json`
            document.body.appendChild(a)
            a.click()
            a.remove()
            URL.revokeObjectURL(url)
        } finally {
            setBusy(null)
        }
    }

    return (
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Body p={{ base: "4", md: "6" }}>
                <Stack gap="4">
                    <Box>
                        <Text fontSize="md" fontWeight="semibold">
                            {t.components.adminDashboardTab.actions.heading}
                        </Text>
                        <Text fontSize="sm" color="fg.muted">
                            {t.components.adminDashboardTab.actions.description}
                        </Text>
                    </Box>

                    <Box
                        p="3"
                        bg="bg.muted"
                        rounded="md"
                        borderWidth="1px"
                        borderColor="border.subtle"
                    >
                        <HStack gap="3" wrap="wrap" align="baseline">
                            <Text fontSize="xs" color="fg.muted">{t.components.adminDashboardTab.actions.currentStatus}</Text>
                            <Badge
                                variant="solid"
                                colorPalette={
                                    tournament.status === "FINISHED" ? "gray"
                                        : tournament.status === "STARTED" || tournament.status === "IN_PROGRESS" ? "red"
                                        : "pitch"
                                }
                            >
                                {tournament.status ?? "-"}
                            </Badge>
                        </HStack>
                    </Box>

                    {/* Status override - three buttons, the current status is disabled. */}
                    <Box>
                        <Text fontSize="xs" color="fg.muted" mb="2">{t.components.adminDashboardTab.actions.forceStatusLabel}</Text>
                        <HStack gap="2" wrap="wrap">
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={busy != null || tournament.status === "DRAFT"}
                                onClick={() => changeStatus("DRAFT")}
                            >
                                <FiAlertTriangle /> DRAFT
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                colorPalette="pitch"
                                disabled={busy != null || tournament.status === "STARTED"}
                                onClick={() => changeStatus("STARTED")}
                            >
                                <FiPlay /> STARTED
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                colorPalette="gray"
                                disabled={busy != null || tournament.status === "FINISHED"}
                                onClick={() => changeStatus("FINISHED")}
                            >
                                <FiStopCircle /> FINISHED
                            </Button>
                        </HStack>
                    </Box>

                    {/* Reset + Feature toggle row */}
                    <HStack gap="2" wrap="wrap">
                        <Button
                            size="sm"
                            variant="outline"
                            colorPalette="orange"
                            disabled={busy != null}
                            loading={busy === "reset"}
                            onClick={resetTournament}
                        >
                            <FiRotateCcw /> {t.components.adminDashboardTab.actions.reset}
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            colorPalette="yellow"
                            disabled={busy != null}
                            loading={busy === "feature"}
                            onClick={toggleFeature}
                        >
                            <FiStar /> {t.components.adminDashboardTab.actions.feature}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            colorPalette="gray"
                            disabled={busy != null}
                            loading={busy === "feature"}
                            onClick={unfeature}
                        >
                            {t.components.adminDashboardTab.actions.unfeature}
                        </Button>
                        {tournament.hidden ? (
                            <Button
                                size="sm"
                                variant="outline"
                                colorPalette="gray"
                                disabled={busy != null}
                                loading={busy === "hidden"}
                                onClick={toggleHidden}
                            >
                                <FiEye /> {t.components.adminDashboardTab.actions.makePublic}
                            </Button>
                        ) : (
                            <Button
                                size="sm"
                                variant="outline"
                                colorPalette="gray"
                                disabled={busy != null}
                                loading={busy === "hidden"}
                                onClick={toggleHidden}
                            >
                                <FiEyeOff /> {t.components.adminDashboardTab.actions.hide}
                            </Button>
                        )}
                        <Button
                            size="sm"
                            variant="outline"
                            colorPalette="pitch"
                            disabled={busy != null}
                            loading={busy === "export"}
                            onClick={exportJson}
                        >
                            <FiDownload /> {t.components.adminDashboardTab.actions.exportJson}
                        </Button>
                    </HStack>

                    {/* Delete row - separated so it's not adjacent to the
                         "Resetiraj" button (similar visual weight,
                         destructive miscicks are easy). */}
                    <HStack justify="flex-end" pt="2" borderTopWidth="1px" borderColor="border.subtle">
                        <Button
                            size="sm"
                            variant="outline"
                            colorPalette="red"
                            disabled={busy != null}
                            loading={busy === "delete"}
                            onClick={deleteTournament}
                        >
                            <FiTrash2 /> {t.components.adminDashboardTab.actions.deleteTournament}
                        </Button>
                    </HStack>
                </Stack>
            </Card.Body>
        </Card.Root>
    )
}

/** Human-friendly HR date label for tournament rows. */
