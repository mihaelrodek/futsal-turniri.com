import { useEffect, useMemo, useRef, useState } from "react"
import { Link as RouterLink } from "react-router-dom"
import {
    Badge,
    Box,
    Button,
    Card,
    Dialog,
    HStack,
    Input,
    Portal,
    Spinner,
    Stack,
    Text,
    VStack,
} from "@chakra-ui/react"
import { FiSearch, FiUserPlus } from "react-icons/fi"
import {
    adminConfirmTournamentDelete,
    adminDeleteTournament,
    adminFeatureTournament,
    adminListDeleteRequests,
    adminListTournaments,
    adminResetTournament,
    adminRestoreTournament,
    adminSearchUsers,
    adminSetTournamentStatus,
    adminListEditors,
    adminAddEditor,
    adminRemoveEditor,
    adminUnfeatureTournament,
    adminExportTournament,
    adminImportTournament,
    type AdminDeleteRequestDto,
    type AdminImportResponse,
    type AdminTournamentDto,
    type AdminUserDto,
} from "../api/admin"
import { hideTournament, unhideTournament } from "../api/tournaments"
import SpectoStreamCard from "./SpectoStreamCard"
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
export default function AdminDashboardTab() {
    const t = useTranslation()

    /* ─────────────── Tournament list + selection ─────────────── */

    const [tournaments, setTournaments] = useState<AdminTournamentDto[] | null>(null)
    const [selectedTournamentId, setSelectedTournamentId] = useState<number | null>(null)
    const [tournamentSearch, setTournamentSearch] = useState("")
    const [loadingTournaments, setLoadingTournaments] = useState(false)

    useEffect(() => {
        let cancelled = false
        setLoadingTournaments(true)
        adminListTournaments()
            .then((rows) => { if (!cancelled) setTournaments(rows) })
            .catch(() => { /* http interceptor surfaces the toast */ })
            .finally(() => { if (!cancelled) setLoadingTournaments(false) })
        return () => { cancelled = true }
    }, [])

    // Client-side filter so the admin can narrow down a long list of
    // tournaments by name without an extra API trip. Server-side search
    // would be marginal complexity for a list this size (~tens of rows).
    const filteredTournaments = useMemo(() => {
        if (!tournaments) return []
        const q = tournamentSearch.trim().toLowerCase()
        if (!q) return tournaments
        return tournaments.filter((t) => {
            const hay = `${t.name} ${t.location ?? ""} ${t.slug ?? ""}`.toLowerCase()
            return hay.includes(q)
        })
    }, [tournaments, tournamentSearch])

    const selectedTournament = useMemo(
        () => tournaments?.find((t) => t.id === selectedTournamentId) ?? null,
        [tournaments, selectedTournamentId],
    )

    /* ─────────────── Tournament editors (rights) ─────────────── */

    // Current editors (co-owners) of the selected tournament.
    const [editors, setEditors] = useState<AdminUserDto[]>([])
    const [loadingEditors, setLoadingEditors] = useState(false)

    useEffect(() => {
        if (selectedTournamentId == null) { setEditors([]); return }
        let cancelled = false
        setLoadingEditors(true)
        adminListEditors(selectedTournamentId)
            .then((rows) => { if (!cancelled) setEditors(rows) })
            .catch(() => { /* handled by toaster */ })
            .finally(() => { if (!cancelled) setLoadingEditors(false) })
        return () => { cancelled = true }
    }, [selectedTournamentId])

    // "Grant rights" user picker. Multi-add: stays open so several people can
    // be granted in a row.
    const [editorDialogOpen, setEditorDialogOpen] = useState(false)
    const [editorUserSearch, setEditorUserSearch] = useState("")
    const [editorUsers, setEditorUsers] = useState<AdminUserDto[]>([])
    const [loadingEditorUsers, setLoadingEditorUsers] = useState(false)
    const [grantingUid, setGrantingUid] = useState<string | null>(null)
    const [removingUid, setRemovingUid] = useState<string | null>(null)

    useEffect(() => {
        if (!editorDialogOpen) return
        let cancelled = false
        setLoadingEditorUsers(true)
        const handle = setTimeout(() => {
            adminSearchUsers(editorUserSearch)
                .then((rows) => { if (!cancelled) setEditorUsers(rows) })
                .catch(() => { /* handled by toaster */ })
                .finally(() => { if (!cancelled) setLoadingEditorUsers(false) })
        }, 200)
        return () => {
            cancelled = true
            clearTimeout(handle)
        }
    }, [editorUserSearch, editorDialogOpen])

    function openEditorDialog() {
        setEditorDialogOpen(true)
        setEditorUserSearch("")
        setEditorUsers([])
    }
    function closeEditorDialog() {
        setEditorDialogOpen(false)
        setEditorUsers([])
        setEditorUserSearch("")
    }

    async function handleGrantEditor(user: AdminUserDto) {
        if (selectedTournament == null) return
        try {
            setGrantingUid(user.userUid)
            const added = await adminAddEditor(selectedTournament.id, user.userUid)
            // Append if not already granted (grant is idempotent). Dialog stays
            // open so the admin can grant more people in one go.
            setEditors((prev) =>
                prev.some((e) => e.userUid === added.userUid) ? prev : [...prev, added],
            )
        } finally {
            setGrantingUid(null)
        }
    }

    async function handleRemoveEditor(userUid: string) {
        if (selectedTournament == null) return
        try {
            setRemovingUid(userUid)
            await adminRemoveEditor(selectedTournament.id, userUid)
            setEditors((prev) => prev.filter((e) => e.userUid !== userUid))
        } finally {
            setRemovingUid(null)
        }
    }

    /* ─────────────── Render ─────────────── */

    return (
        <VStack align="stretch" gap="4">
            <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
                <Card.Body p={{ base: "4", md: "6" }}>
                    <Stack gap="3">
                        <Box>
                            <Text fontSize="lg" fontWeight="semibold">{t.components.adminDashboardTab.heading}</Text>
                            <Text fontSize="sm" color="fg.muted">
                                {t.components.adminDashboardTab.description}
                            </Text>
                        </Box>

                        {/* Tournament picker. Plain Input search + scrollable
                            list of matches - works for tens-to-hundreds of
                            tournaments without needing a heavier combobox. */}
                        <Box>
                            <Text fontSize="sm" fontWeight="medium" mb="2">{t.components.adminDashboardTab.tournamentLabel}</Text>
                            <HStack mb="2" gap="2">
                                <Box position="relative" flex="1">
                                    <Box position="absolute" left="3" top="50%" transform="translateY(-50%)"
                                         color="fg.muted" pointerEvents="none">
                                        <FiSearch />
                                    </Box>
                                    <Input
                                        pl="9"
                                        placeholder={t.components.adminDashboardTab.searchPlaceholder}
                                        value={tournamentSearch}
                                        onChange={(e) => setTournamentSearch(e.target.value)}
                                    />
                                </Box>
                            </HStack>
                            {loadingTournaments ? (
                                <HStack py="3" justify="center"><Spinner size="sm" /></HStack>
                            ) : (
                                <Box
                                    maxH="260px"
                                    overflowY="auto"
                                    borderWidth="1px"
                                    borderColor="border.subtle"
                                    rounded="md"
                                >
                                    {filteredTournaments.length === 0 ? (
                                        <Text p="3" fontSize="sm" color="fg.muted">
                                            {t.components.adminDashboardTab.noResults}
                                        </Text>
                                    ) : (
                                        filteredTournaments.map((tour) => {
                                            const active = tour.id === selectedTournamentId
                                            return (
                                                <Box
                                                    key={tour.id}
                                                    px="3"
                                                    py="2"
                                                    cursor="pointer"
                                                    bg={active ? "blue.subtle" : "transparent"}
                                                    _hover={{ bg: active ? "blue.subtle" : "bg.muted" }}
                                                    borderBottomWidth="1px"
                                                    borderColor="border.subtle"
                                                    onClick={() => setSelectedTournamentId(tour.id)}
                                                >
                                                    <HStack justify="space-between" gap="2">
                                                        <Box minW="0" flex="1">
                                                            <Text fontSize="sm" fontWeight={active ? "semibold" : "medium"} truncate>
                                                                {tour.name}
                                                            </Text>
                                                            <Text fontSize="xs" color="fg.muted" truncate>
                                                                {[tour.location, formatDate(tour.startAt)].filter(Boolean).join(" • ")}
                                                            </Text>
                                                            <Text fontSize="xs" color="fg.muted" truncate>
                                                                {t.components.adminDashboardTab.ownerPrefix}
                                                                {tour.createdByName || (tour.createdByUid ? t.components.adminDashboardTab.noName : t.components.adminDashboardTab.ownerLegacy)}
                                                            </Text>
                                                        </Box>
                                                        {tour.status && (
                                                            <Badge size="sm" variant="subtle"
                                                                   colorPalette={tour.status === "FINISHED" ? "gray" : "blue"}>
                                                                {tour.status}
                                                            </Badge>
                                                        )}
                                                    </HStack>
                                                </Box>
                                            )
                                        })
                                    )}
                                </Box>
                            )}
                        </Box>
                    </Stack>
                </Card.Body>
            </Card.Root>

            {/* Pending deletion requests - organizer "Obriši" only files a
                request (tournament archived); the final soft delete or the
                restore back to public happens here. */}
            <AdminDeleteRequestsCard
                onChanged={async () => {
                    // A confirm drops the row from the picker; a restore keeps
                    // it - either way re-pull so the list matches reality.
                    const rows = await adminListTournaments()
                    setTournaments(rows)
                }}
            />

            {/* Import a tournament from an exported JSON dump - the inverse of
                the per-tournament "Export u JSON" action. Always creates a NEW
                tournament, so it sits at the global level (no selection needed). */}
            <AdminImportCard
                onImported={async () => {
                    // The freshly created tournament should appear in the picker.
                    const rows = await adminListTournaments()
                    setTournaments(rows)
                }}
            />

            {selectedTournament != null && (
                <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
                    <Card.Body p={{ base: "4", md: "6" }}>
                        <Stack gap="3">
                            <Box>
                                <Text fontSize="md" fontWeight="semibold">
                                    {t.components.adminDashboardTab.rights.heading}
                                </Text>
                                <Text fontSize="sm" color="fg.muted">
                                    {t.components.adminDashboardTab.rights.description}
                                </Text>
                            </Box>

                            {/* Owner (read-only). */}
                            <Box
                                p="3"
                                bg="bg.muted"
                                rounded="md"
                                borderWidth="1px"
                                borderColor="border.subtle"
                            >
                                <Text fontSize="xs" color="fg.muted">{t.components.adminDashboardTab.rights.ownerLabel}</Text>
                                <Text fontSize="sm" fontWeight="medium">
                                    {selectedTournament.createdByName
                                        || (selectedTournament.createdByUid
                                            ? t.components.adminDashboardTab.noName
                                            : t.components.adminDashboardTab.rights.ownerLegacyNoOwner)}
                                </Text>
                            </Box>

                            {/* Editors (co-owners) with per-row revoke. */}
                            <Box>
                                <Text fontSize="xs" color="fg.muted" mb="1.5">
                                    {t.components.adminDashboardTab.rights.editorsCount(editors.length)}
                                </Text>
                                {loadingEditors ? (
                                    <HStack gap="2" color="fg.muted">
                                        <Spinner size="sm" />
                                        <Text fontSize="sm">{t.common.loading}</Text>
                                    </HStack>
                                ) : editors.length === 0 ? (
                                    <Text fontSize="sm" color="fg.muted">
                                        {t.components.adminDashboardTab.rights.noEditors}
                                    </Text>
                                ) : (
                                    <Stack gap="1.5">
                                        {editors.map((e) => (
                                            <HStack
                                                key={e.userUid}
                                                justify="space-between"
                                                gap="2"
                                                p="2"
                                                bg="bg.subtle"
                                                rounded="md"
                                                borderWidth="1px"
                                                borderColor="border.subtle"
                                            >
                                                <Box minW="0">
                                                    <Text fontSize="sm" fontWeight="medium" truncate>
                                                        {e.displayName || t.components.adminDashboardTab.noName}
                                                    </Text>
                                                    <Text fontSize="xs" color="fg.muted" truncate>
                                                        {e.slug ? `@${e.slug}` : e.userUid}
                                                    </Text>
                                                </Box>
                                                <Button
                                                    size="xs"
                                                    variant="ghost"
                                                    colorPalette="red"
                                                    flexShrink={0}
                                                    loading={removingUid === e.userUid}
                                                    onClick={() => handleRemoveEditor(e.userUid)}
                                                >
                                                    <FiTrash2 /> {t.components.adminDashboardTab.rights.remove}
                                                </Button>
                                            </HStack>
                                        ))}
                                    </Stack>
                                )}
                            </Box>

                            <HStack justify="flex-end">
                                <Button
                                    size="sm"
                                    variant="solid"
                                    colorPalette="pitch"
                                    onClick={openEditorDialog}
                                >
                                    <FiUserPlus /> {t.components.adminDashboardTab.rights.grantButton}
                                </Button>
                            </HStack>
                        </Stack>
                    </Card.Body>
                </Card.Root>
            )}

            {/* ────── Akcije turnira ──────
                Destructive + status-override actions for the selected
                tournament. Reset wipes rounds/bracket/schedule back to
                DRAFT. Status override force-writes status without the
                normal /start business rules (INSUFFICIENT_TEAMS). Delete
                soft-deletes via the standard endpoint (admin bypasses
                the assertCanEdit owner check). Feature toggles the
                daily-highlight flag. All destructive ops gate on a
                native confirm. */}
            {selectedTournament != null && (
                <AdminTournamentActions
                    tournament={selectedTournament}
                    onChanged={async (next) => {
                        // Re-fetch list so the row's status / featuredAt
                        // reflects the change. Delete drops the row;
                        // status keeps it but updates the badge.
                        const rows = await adminListTournaments()
                        setTournaments(rows)
                        if (next === "deleted") setSelectedTournamentId(null)
                    }}
                />
            )}

            {/* Live-stream overlay (SpectoStream) - moved here from the
                tournament's Detalji tab; provisions the SELECTED tournament's
                OBS camera + overlay. Parked in the admin dashboard for now. */}
            {selectedTournament?.uuid && (
                <Box mt="4">
                    <SpectoStreamCard uuid={selectedTournament.uuid} />
                </Box>
            )}

            {/* "Daj prava" dialog - grant editor rights to one or more people.
                Stays open after each grant so several can be added in a row.
                Only rendered when opened (the search effect short-circuits on
                !editorDialogOpen). */}
            <Dialog.Root
                open={editorDialogOpen}
                onOpenChange={(e) => { if (!e.open) closeEditorDialog() }}
                placement="center"
                motionPreset="slide-in-bottom"
            >
                <Portal>
                    <Dialog.Backdrop />
                    <Dialog.Positioner>
                        <Dialog.Content maxW={{ base: "92%", md: "md" }}>
                            <Dialog.Header>
                                <Dialog.Title>
                                    {t.components.adminDashboardTab.grantDialog.title}
                                </Dialog.Title>
                            </Dialog.Header>
                            <Dialog.Body>
                                <Stack gap="3">
                                    {selectedTournament && (
                                        <Box
                                            p="3"
                                            bg="bg.muted"
                                            rounded="md"
                                            borderWidth="1px"
                                            borderColor="border.subtle"
                                        >
                                            <Text fontSize="xs" color="fg.muted">{t.components.adminDashboardTab.grantDialog.tournamentLabel}</Text>
                                            <Text fontSize="sm" fontWeight="medium">
                                                {selectedTournament.name}
                                            </Text>
                                            <Text fontSize="xs" color="fg.muted" mt="1">
                                                {t.components.adminDashboardTab.grantDialog.note}
                                            </Text>
                                        </Box>
                                    )}

                                    <Box position="relative">
                                        <Box position="absolute" left="3" top="50%" transform="translateY(-50%)"
                                             color="fg.muted" pointerEvents="none">
                                            <FiSearch />
                                        </Box>
                                        <Input
                                            pl="9"
                                            placeholder={t.components.adminDashboardTab.grantDialog.searchPlaceholder}
                                            value={editorUserSearch}
                                            onChange={(e) => setEditorUserSearch(e.target.value)}
                                            autoFocus
                                        />
                                    </Box>

                                    <Box
                                        maxH="320px"
                                        overflowY="auto"
                                        borderWidth="1px"
                                        borderColor="border.subtle"
                                        rounded="md"
                                    >
                                        {loadingEditorUsers ? (
                                            <HStack py="4" justify="center"><Spinner size="sm" /></HStack>
                                        ) : editorUsers.length === 0 ? (
                                            <Text p="3" fontSize="sm" color="fg.muted">
                                                {t.components.adminDashboardTab.noResults}
                                            </Text>
                                        ) : (
                                            editorUsers.map((u) => {
                                                const isOwner =
                                                    !!selectedTournament
                                                    && selectedTournament.createdByUid === u.userUid
                                                const hasRights =
                                                    editors.some((e) => e.userUid === u.userUid)
                                                return (
                                                    <HStack
                                                        key={u.userUid}
                                                        px="3"
                                                        py="2"
                                                        justify="space-between"
                                                        gap="2"
                                                        borderBottomWidth="1px"
                                                        borderColor="border.subtle"
                                                        _hover={{ bg: "bg.muted" }}
                                                    >
                                                        <Box minW="0" flex="1">
                                                            <HStack gap="2">
                                                                <Text fontSize="sm" fontWeight="medium" truncate>
                                                                    {u.displayName || t.components.adminDashboardTab.noName}
                                                                </Text>
                                                                {isOwner && (
                                                                    <Badge size="xs" variant="subtle" colorPalette="gray">
                                                                        {t.components.adminDashboardTab.grantDialog.ownerBadge}
                                                                    </Badge>
                                                                )}
                                                                {!isOwner && hasRights && (
                                                                    <Badge size="xs" variant="subtle" colorPalette="green">
                                                                        {t.components.adminDashboardTab.grantDialog.hasRightsBadge}
                                                                    </Badge>
                                                                )}
                                                            </HStack>
                                                            {u.slug && (
                                                                <Text fontSize="xs" color="fg.muted" truncate>
                                                                    /profil/{u.slug}
                                                                </Text>
                                                            )}
                                                        </Box>
                                                        <Button
                                                            size="xs"
                                                            variant="solid"
                                                            colorPalette="pitch"
                                                            loading={grantingUid === u.userUid}
                                                            disabled={isOwner || hasRights}
                                                            onClick={() => handleGrantEditor(u)}
                                                        >
                                                            {isOwner
                                                                ? t.components.adminDashboardTab.grantDialog.ownerButton
                                                                : hasRights
                                                                    ? t.components.adminDashboardTab.grantDialog.addedButton
                                                                    : t.components.adminDashboardTab.grantDialog.grantButton}
                                                        </Button>
                                                    </HStack>
                                                )
                                            })
                                        )}
                                    </Box>
                                </Stack>
                            </Dialog.Body>
                            <Dialog.Footer>
                                <Button variant="ghost" onClick={closeEditorDialog}>{t.components.adminDashboardTab.grantDialog.done}</Button>
                            </Dialog.Footer>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog.Root>
        </VStack>
    )
}

/* ──────────────────────────────────────────────────────────────────────
   AdminDeleteRequestsCard - compact list of pending tournament-deletion
   requests (name, requester, reason, date). "Potvrdi brisanje" finalizes
   the SOFT delete (is_deleted + deleted_at - rows are never physically
   removed); "Vrati" rejects the request and puts the tournament back on
   the public listings. Always rendered so the admin knows the surface
   exists; shows a one-line empty state when there's nothing pending.
   ────────────────────────────────────────────────────────────────────── */
function AdminDeleteRequestsCard({ onChanged }: { onChanged: () => void }) {
    const t = useTranslation()
    const dr = t.components.adminDashboardTab.deleteRequests
    const [rows, setRows] = useState<AdminDeleteRequestDto[] | null>(null)
    const [busyKey, setBusyKey] = useState<string | null>(null)

    function load() {
        adminListDeleteRequests()
            .then(setRows)
            .catch(() => setRows([]))
    }
    useEffect(() => { load() }, [])

    async function confirmDelete(row: AdminDeleteRequestDto) {
        const key = row.uuid ?? row.slug
        if (!key || busyKey) return
        if (!window.confirm(dr.confirmPrompt(row.name))) return
        try {
            setBusyKey(key)
            await adminConfirmTournamentDelete(key)
            load()
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
            load()
            onChanged()
        } finally {
            setBusyKey(null)
        }
    }

    return (
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Body p={{ base: "4", md: "6" }}>
                <Stack gap="3">
                    <Box>
                        <Text fontSize="md" fontWeight="semibold">{dr.heading}</Text>
                        <Text fontSize="sm" color="fg.muted">{dr.description}</Text>
                    </Box>
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
            </Card.Body>
        </Card.Root>
    )
}

/* ──────────────────────────────────────────────────────────────────────
   AdminImportCard - "Uvoz iz JSON-a": file picker for a .json dump made
   by the per-tournament export action. The file is parsed client-side
   (bad JSON never leaves the browser) and POSTed verbatim to
   /admin/tournaments/import, which creates a NEW tournament (fresh
   uuid + slug, the admin becomes owner) with every id in the file
   remapped. On success the card shows a link to the new tournament and
   any server warnings (skipped poster, missing editor users).
   ────────────────────────────────────────────────────────────────────── */
function AdminImportCard({ onImported }: { onImported: () => void }) {
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
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Body p={{ base: "4", md: "6" }}>
                <Stack gap="3">
                    <Box>
                        <Text fontSize="md" fontWeight="semibold">{ic.heading}</Text>
                        <Text fontSize="sm" color="fg.muted">{ic.description}</Text>
                    </Box>

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
            </Card.Body>
        </Card.Root>
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
function AdminTournamentActions({
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
function formatDate(iso: string | null): string | null {
    if (!iso) return null
    try {
        return new Intl.DateTimeFormat("hr-HR", {
            day: "2-digit",
            month: "short",
            year: "numeric",
        }).format(new Date(iso))
    } catch {
        return iso
    }
}
