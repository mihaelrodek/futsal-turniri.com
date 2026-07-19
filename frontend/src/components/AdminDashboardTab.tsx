import { useEffect, useMemo, useState } from "react"
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
    adminDeleteTournament,
    adminFeatureTournament,
    adminListTournaments,
    adminResetTournament,
    adminSearchUsers,
    adminSetTournamentStatus,
    adminListEditors,
    adminAddEditor,
    adminRemoveEditor,
    adminUnfeatureTournament,
    adminExportTournament,
    type AdminTournamentDto,
    type AdminUserDto,
} from "../api/admin"
import { hideTournament, unhideTournament } from "../api/tournaments"
import {
    FiAlertTriangle,
    FiDownload,
    FiEye,
    FiEyeOff,
    FiPlay,
    FiRotateCcw,
    FiStar,
    FiStopCircle,
    FiTrash2,
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
                            <Text fontSize="lg" fontWeight="semibold">Upravljanje turnirima</Text>
                            <Text fontSize="sm" color="fg.muted">
                                Odaberi turnir da bi dodijelio pravo upravljanja drugoj osobi ili
                                izvršio administratorske akcije nad turnirom (status, reset,
                                isticanje, vidljivost, export, brisanje).
                            </Text>
                        </Box>

                        {/* Tournament picker. Plain Input search + scrollable
                            list of matches - works for tens-to-hundreds of
                            tournaments without needing a heavier combobox. */}
                        <Box>
                            <Text fontSize="sm" fontWeight="medium" mb="2">Turnir</Text>
                            <HStack mb="2" gap="2">
                                <Box position="relative" flex="1">
                                    <Box position="absolute" left="3" top="50%" transform="translateY(-50%)"
                                         color="fg.muted" pointerEvents="none">
                                        <FiSearch />
                                    </Box>
                                    <Input
                                        pl="9"
                                        placeholder="Pretraži turnire po imenu, lokaciji ili slug-u…"
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
                                            Nema rezultata.
                                        </Text>
                                    ) : (
                                        filteredTournaments.map((t) => {
                                            const active = t.id === selectedTournamentId
                                            return (
                                                <Box
                                                    key={t.id}
                                                    px="3"
                                                    py="2"
                                                    cursor="pointer"
                                                    bg={active ? "blue.subtle" : "transparent"}
                                                    _hover={{ bg: active ? "blue.subtle" : "bg.muted" }}
                                                    borderBottomWidth="1px"
                                                    borderColor="border.subtle"
                                                    onClick={() => setSelectedTournamentId(t.id)}
                                                >
                                                    <HStack justify="space-between" gap="2">
                                                        <Box minW="0" flex="1">
                                                            <Text fontSize="sm" fontWeight={active ? "semibold" : "medium"} truncate>
                                                                {t.name}
                                                            </Text>
                                                            <Text fontSize="xs" color="fg.muted" truncate>
                                                                {[t.location, formatDate(t.startAt)].filter(Boolean).join(" • ")}
                                                            </Text>
                                                            <Text fontSize="xs" color="fg.muted" truncate>
                                                                Vlasnik: {t.createdByName || (t.createdByUid ? "(bez imena)" : "- (legacy)")}
                                                            </Text>
                                                        </Box>
                                                        {t.status && (
                                                            <Badge size="sm" variant="subtle"
                                                                   colorPalette={t.status === "FINISHED" ? "gray" : "blue"}>
                                                                {t.status}
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

            {selectedTournament != null && (
                <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
                    <Card.Body p={{ base: "4", md: "6" }}>
                        <Stack gap="3">
                            <Box>
                                <Text fontSize="md" fontWeight="semibold">
                                    Prava na turnir
                                </Text>
                                <Text fontSize="sm" color="fg.muted">
                                    Dodijeli pravo upravljanja turnirom (detalji, ekipe, raspored,
                                    Zapisnik…) jednoj ili više osoba - bez prijenosa vlasništva.
                                    Vlasnik ostaje isti.
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
                                <Text fontSize="xs" color="fg.muted">VLASNIK</Text>
                                <Text fontSize="sm" fontWeight="medium">
                                    {selectedTournament.createdByName
                                        || (selectedTournament.createdByUid
                                            ? "(bez imena)"
                                            : "- (legacy / nema vlasnika)")}
                                </Text>
                            </Box>

                            {/* Editors (co-owners) with per-row revoke. */}
                            <Box>
                                <Text fontSize="xs" color="fg.muted" mb="1.5">
                                    OSOBE S PRAVIMA ({editors.length})
                                </Text>
                                {loadingEditors ? (
                                    <HStack gap="2" color="fg.muted">
                                        <Spinner size="sm" />
                                        <Text fontSize="sm">Učitavanje…</Text>
                                    </HStack>
                                ) : editors.length === 0 ? (
                                    <Text fontSize="sm" color="fg.muted">
                                        Nitko još nema dodatna prava.
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
                                                        {e.displayName || "(bez imena)"}
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
                                                    <FiTrash2 /> Ukloni
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
                                    <FiUserPlus /> Daj prava osobi
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
                                    Daj prava na turnir
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
                                            <Text fontSize="xs" color="fg.muted">TURNIR</Text>
                                            <Text fontSize="sm" fontWeight="medium">
                                                {selectedTournament.name}
                                            </Text>
                                            <Text fontSize="xs" color="fg.muted" mt="1">
                                                Osoba dobiva pravo upravljanja, vlasništvo se ne mijenja.
                                                Možeš dodati više osoba.
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
                                            placeholder="Pretraži po imenu i prezimenu…"
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
                                                Nema rezultata.
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
                                                                    {u.displayName || "(bez imena)"}
                                                                </Text>
                                                                {isOwner && (
                                                                    <Badge size="xs" variant="subtle" colorPalette="gray">
                                                                        vlasnik
                                                                    </Badge>
                                                                )}
                                                                {!isOwner && hasRights && (
                                                                    <Badge size="xs" variant="subtle" colorPalette="green">
                                                                        ima prava
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
                                                            {isOwner ? "Vlasnik" : hasRights ? "Dodano" : "Daj prava"}
                                                        </Button>
                                                    </HStack>
                                                )
                                            })
                                        )}
                                    </Box>
                                </Stack>
                            </Dialog.Body>
                            <Dialog.Footer>
                                <Button variant="ghost" onClick={closeEditorDialog}>Gotovo</Button>
                            </Dialog.Footer>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog.Root>
        </VStack>
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
    const [busy, setBusy] = useState<null | "status" | "reset" | "delete" | "feature" | "hidden" | "export">(null)
    // The admin endpoints accept uuid OR slug - prefer uuid, fall back
    // to slug for legacy tournaments missing one.
    const idKey = tournament.uuid ?? tournament.slug ?? ""

    async function changeStatus(next: "DRAFT" | "STARTED" | "FINISHED") {
        if (busy) return
        if (next === tournament.status) return
        const ok = window.confirm(
            `Postaviti status turnira "${tournament.name}" na ${next}?\n\n` +
            `Ova akcija zaobilazi normalna pravila (broj ekipa, redoslijed kola). ` +
            `Koristi samo ako se turnir zaglavio i ne može se popraviti kroz uobičajeni tok.`,
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
            `Resetirati turnir "${tournament.name}"?\n\n` +
            `Brišu se sva kola, ždrijeb i raspored. Status se vraća na DRAFT. ` +
            `Ekipe i postavke turnira ostaju.`,
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
            `OBRISATI turnir "${tournament.name}"?\n\n` +
            `Soft-delete - turnir nestaje iz svih lista. Za potvrdu upiši ime turnira.`,
        )
        if (typed == null) return
        if (typed.trim() !== tournament.name.trim()) {
            window.alert("Ime se ne podudara. Obriskivanje otkazano.")
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
                            Akcije turnira
                        </Text>
                        <Text fontSize="sm" color="fg.muted">
                            Administratorske operacije nad turnirom - koristi pažljivo.
                            Promjene zaobilaze uobičajene provjere (vlasništvo, broj ekipa,
                            redoslijed kola).
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
                            <Text fontSize="xs" color="fg.muted">TRENUTNI STATUS</Text>
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
                        <Text fontSize="xs" color="fg.muted" mb="2">PROMIJENI STATUS (force)</Text>
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
                            <FiRotateCcw /> Resetiraj
                        </Button>
                        <Button
                            size="sm"
                            variant="outline"
                            colorPalette="yellow"
                            disabled={busy != null}
                            loading={busy === "feature"}
                            onClick={toggleFeature}
                        >
                            <FiStar /> Istakni
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            colorPalette="gray"
                            disabled={busy != null}
                            loading={busy === "feature"}
                            onClick={unfeature}
                        >
                            Ukloni istaknuto
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
                                <FiEye /> Javno
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
                                <FiEyeOff /> Sakrij
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
                            <FiDownload /> Export u JSON
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
                            <FiTrash2 /> Obriši turnir
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
