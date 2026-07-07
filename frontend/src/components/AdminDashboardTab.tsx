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
import { FiRepeat, FiSearch, FiUserPlus } from "react-icons/fi"
import {
    adminAttachTeam,
    adminDeleteTournament,
    adminFeatureTournament,
    adminListTournaments,
    adminListUnclaimedTeams,
    adminResetTournament,
    adminSearchUsers,
    adminSetTournamentStatus,
    adminTransferTournament,
    adminUnfeatureTournament,
    type AdminTeamDto,
    type AdminTournamentDto,
    type AdminUserDto,
} from "../api/admin"
import {
    FiAlertTriangle,
    FiPlay,
    FiRotateCcw,
    FiStar,
    FiStopCircle,
    FiTrash2,
} from "react-icons/fi"

/**
 * Admin-only "Dashboard" tab on the profile page. Two parallel flows
 * gated on a single tournament picker at the top:
 *
 * <p><b>1. Attach teams to users</b> — for legacy/organiser-added teams
 * imported from old spreadsheets. After attaching, the team shows up on
 * the target user's public profile as if they had self-registered.
 *
 * <p><b>2. Transfer tournament ownership</b> — for tournaments the admin
 * pre-created on behalf of an organiser (e.g. before the organiser had
 * signed up). After transfer the target user becomes the owner and can
 * manage teams, edit details, generate rounds, set the podium, etc.
 *
 * <p>UI flow:
 *   1. Admin picks a tournament from the list (top section). The list
 *      shows the current owner alongside each row so the admin knows
 *      what they're about to act on.
 *   2. Component fetches unclaimed teams and renders two sibling cards
 *      below: the team list (with per-team "Pridruži korisniku" buttons)
 *      and an ownership card with the current owner + "Prenesi
 *      vlasništvo" button.
 *   3. Either button opens a user-search dialog. Selecting a user fires
 *      the corresponding endpoint and refreshes only the part of state
 *      that changed (team drops out of the list, or the tournament row
 *      updates with the new owner).
 *
 * <p>Component-level state intentionally lives here rather than a
 * context — the dashboard is a single self-contained screen that
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

    /* ─────────────── Teams for selected tournament ─────────────── */

    const [teams, setTeams] = useState<AdminTeamDto[]>([])
    const [loadingTeams, setLoadingTeams] = useState(false)

    useEffect(() => {
        if (selectedTournamentId == null) {
            setTeams([])
            return
        }
        let cancelled = false
        setLoadingTeams(true)
        adminListUnclaimedTeams(selectedTournamentId)
            .then((rows) => { if (!cancelled) setTeams(rows) })
            .catch(() => { /* handled by http toaster */ })
            .finally(() => { if (!cancelled) setLoadingTeams(false) })
        return () => { cancelled = true }
    }, [selectedTournamentId])

    /* ─────────────── User-picker dialog ─────────────── */

    const [attachTargetTeam, setAttachTargetTeam] = useState<AdminTeamDto | null>(null)
    const [userSearch, setUserSearch] = useState("")
    const [users, setUsers] = useState<AdminUserDto[]>([])
    const [loadingUsers, setLoadingUsers] = useState(false)
    const [attaching, setAttaching] = useState<string | null>(null) // userUid in flight

    // Debounced user search. 200ms is short enough that it feels live
    // but coarse enough not to fire one request per keystroke. We use
    // a JS setTimeout instead of pulling in a debounce library.
    useEffect(() => {
        if (attachTargetTeam == null) return
        let cancelled = false
        setLoadingUsers(true)
        const handle = setTimeout(() => {
            adminSearchUsers(userSearch)
                .then((rows) => { if (!cancelled) setUsers(rows) })
                .catch(() => { /* handled by toaster */ })
                .finally(() => { if (!cancelled) setLoadingUsers(false) })
        }, 200)
        return () => {
            cancelled = true
            clearTimeout(handle)
        }
    }, [userSearch, attachTargetTeam])

    function openAttachDialog(team: AdminTeamDto) {
        setAttachTargetTeam(team)
        setUserSearch("")
        setUsers([])
    }
    function closeAttachDialog() {
        setAttachTargetTeam(null)
        setUsers([])
        setUserSearch("")
    }

    /* ─────────────── Transfer-tournament dialog ─────────────── */

    // Kept in parallel to the team-attach user picker rather than shared
    // because the two flows might both be open in quick succession and
    // we don't want a stale search list carrying over between them.
    const [transferDialogOpen, setTransferDialogOpen] = useState(false)
    const [transferUserSearch, setTransferUserSearch] = useState("")
    const [transferUsers, setTransferUsers] = useState<AdminUserDto[]>([])
    const [loadingTransferUsers, setLoadingTransferUsers] = useState(false)
    const [transferring, setTransferring] = useState<string | null>(null) // userUid in flight

    useEffect(() => {
        if (!transferDialogOpen) return
        let cancelled = false
        setLoadingTransferUsers(true)
        const handle = setTimeout(() => {
            adminSearchUsers(transferUserSearch)
                .then((rows) => { if (!cancelled) setTransferUsers(rows) })
                .catch(() => { /* handled by toaster */ })
                .finally(() => { if (!cancelled) setLoadingTransferUsers(false) })
        }, 200)
        return () => {
            cancelled = true
            clearTimeout(handle)
        }
    }, [transferUserSearch, transferDialogOpen])

    function openTransferDialog() {
        setTransferDialogOpen(true)
        setTransferUserSearch("")
        setTransferUsers([])
    }
    function closeTransferDialog() {
        setTransferDialogOpen(false)
        setTransferUsers([])
        setTransferUserSearch("")
    }

    async function handleTransfer(user: AdminUserDto) {
        if (selectedTournament == null) return
        try {
            setTransferring(user.userUid)
            const result = await adminTransferTournament(selectedTournament.id, user.userUid)
            // Patch the tournament list in place — the picker rows show the
            // owner and we want the new value to appear without a full
            // refetch (cheaper + avoids losing the user's scroll position).
            setTournaments((prev) => prev?.map((t) =>
                t.id === selectedTournament.id
                    ? { ...t, createdByUid: result.userUid, createdByName: result.displayName }
                    : t,
            ) ?? null)
            closeTransferDialog()
        } finally {
            setTransferring(null)
        }
    }

    async function handleAttach(user: AdminUserDto) {
        if (attachTargetTeam == null) return
        try {
            setAttaching(user.userUid)
            await adminAttachTeam(attachTargetTeam.id, user.userUid)
            // Drop the team from the unclaimed list — it's now claimed.
            setTeams((prev) => prev.filter((p) => p.id !== attachTargetTeam.id))
            closeAttachDialog()
        } catch (err: any) {
            // 409 ALREADY_CLAIMED is silenced by the http interceptor;
            // refresh the list so the now-claimed team disappears.
            if (err?.response?.status === 409 && selectedTournamentId != null) {
                adminListUnclaimedTeams(selectedTournamentId)
                    .then(setTeams)
                    .catch(() => {})
            }
        } finally {
            setAttaching(null)
        }
    }

    /* ─────────────── Render ─────────────── */

    return (
        <VStack align="stretch" gap="4">
            <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
                <Card.Body p={{ base: "4", md: "6" }}>
                    <Stack gap="3">
                        <Box>
                            <Text fontSize="lg" fontWeight="semibold">Dashboard — pridruživanje ekipa</Text>
                            <Text fontSize="sm" color="fg.muted">
                                Odaberi turnir, zatim klikni "Pridruži korisniku" pored ekipe da bi
                                ga vezao za registriranog igrača. Nakon pridruživanja ekipa se
                                pojavljuje na profilu odabranog korisnika i automatski se kreira
                                Predlošci-zapis s tim imenom ekipe.
                            </Text>
                        </Box>

                        {/* Tournament picker. Plain Input search + scrollable
                            list of matches — works for tens-to-hundreds of
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
                                                                Vlasnik: {t.createdByName || (t.createdByUid ? "(bez imena)" : "— (legacy)")}
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
                                    Nepridružene ekipe · {selectedTournament.name}
                                </Text>
                                <Text fontSize="sm" color="fg.muted">
                                    Prikazane su samo ekipe koje još nisu vezane za nijednog
                                    registriranog korisnika.
                                </Text>
                            </Box>

                            {loadingTeams ? (
                                <HStack py="4" justify="center"><Spinner size="sm" /></HStack>
                            ) : teams.length === 0 ? (
                                <Text fontSize="sm" color="fg.muted">
                                    Nema nepridruženih ekipa u ovom turniru.
                                </Text>
                            ) : (
                                <Stack gap="2">
                                    {teams.map((p) => (
                                        <HStack
                                            key={p.id}
                                            px="3"
                                            py="2"
                                            borderWidth="1px"
                                            borderColor="border.subtle"
                                            rounded="md"
                                            justify="space-between"
                                            gap="3"
                                        >
                                            <Box minW="0" flex="1">
                                                <Text fontSize="sm" fontWeight="medium" truncate>{p.name}</Text>
                                                <Text fontSize="xs" color="fg.muted">
                                                    {p.wins} pobjeda · {p.losses} poraza
                                                    {p.eliminated ? " · ispao" : ""}
                                                </Text>
                                            </Box>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                colorPalette="pitch"
                                                onClick={() => openAttachDialog(p)}
                                            >
                                                <FiUserPlus /> Pridruži korisniku
                                            </Button>
                                        </HStack>
                                    ))}
                                </Stack>
                            )}
                        </Stack>
                    </Card.Body>
                </Card.Root>
            )}

            {selectedTournament != null && (
                <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
                    <Card.Body p={{ base: "4", md: "6" }}>
                        <Stack gap="3">
                            <Box>
                                <Text fontSize="md" fontWeight="semibold">
                                    Vlasništvo turnira
                                </Text>
                                <Text fontSize="sm" color="fg.muted">
                                    Prenesi turnir drugom registriranom korisniku — postaje vlasnik
                                    i može uređivati detalje, upravljati ekipama, generirati kola,
                                    postavljati pobjednike itd.
                                </Text>
                            </Box>

                            <Box
                                p="3"
                                bg="bg.muted"
                                rounded="md"
                                borderWidth="1px"
                                borderColor="border.subtle"
                            >
                                <Text fontSize="xs" color="fg.muted">TRENUTNI VLASNIK</Text>
                                <Text fontSize="sm" fontWeight="medium">
                                    {selectedTournament.createdByName
                                        || (selectedTournament.createdByUid
                                            ? "(bez imena)"
                                            : "— (legacy / nema vlasnika)")}
                                </Text>
                                {selectedTournament.createdByUid && (
                                    <Text fontSize="xs" color="fg.muted" mt="1">
                                        UID: {selectedTournament.createdByUid}
                                    </Text>
                                )}
                            </Box>

                            <HStack justify="flex-end">
                                <Button
                                    size="sm"
                                    variant="solid"
                                    colorPalette="pitch"
                                    onClick={openTransferDialog}
                                >
                                    <FiRepeat /> Prenesi vlasništvo
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

            {/* User-picker dialog. Only rendered when a team is selected. */}
            <Dialog.Root
                open={attachTargetTeam != null}
                onOpenChange={(e) => { if (!e.open) closeAttachDialog() }}
                placement="center"
                motionPreset="slide-in-bottom"
            >
                <Portal>
                    <Dialog.Backdrop />
                    <Dialog.Positioner>
                        <Dialog.Content maxW={{ base: "92%", md: "md" }}>
                            <Dialog.Header>
                                <Dialog.Title>
                                    Pridruži ekipu korisniku
                                </Dialog.Title>
                            </Dialog.Header>
                            <Dialog.Body>
                                <Stack gap="3">
                                    {attachTargetTeam && (
                                        <Box
                                            p="3"
                                            bg="bg.muted"
                                            rounded="md"
                                            borderWidth="1px"
                                            borderColor="border.subtle"
                                        >
                                            <Text fontSize="xs" color="fg.muted">EKIPA</Text>
                                            <Text fontSize="sm" fontWeight="medium">
                                                {attachTargetTeam.name}
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
                                            value={userSearch}
                                            onChange={(e) => setUserSearch(e.target.value)}
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
                                        {loadingUsers ? (
                                            <HStack py="4" justify="center"><Spinner size="sm" /></HStack>
                                        ) : users.length === 0 ? (
                                            <Text p="3" fontSize="sm" color="fg.muted">
                                                Nema rezultata.
                                            </Text>
                                        ) : (
                                            users.map((u) => (
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
                                                        <Text fontSize="sm" fontWeight="medium" truncate>
                                                            {u.displayName || "(bez imena)"}
                                                        </Text>
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
                                                        loading={attaching === u.userUid}
                                                        onClick={() => handleAttach(u)}
                                                    >
                                                        Pridruži
                                                    </Button>
                                                </HStack>
                                            ))
                                        )}
                                    </Box>
                                </Stack>
                            </Dialog.Body>
                            <Dialog.Footer>
                                <Button variant="ghost" onClick={closeAttachDialog}>Zatvori</Button>
                            </Dialog.Footer>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog.Root>

            {/* Tournament-transfer dialog. Only rendered when the admin has
                explicitly opened it — keeps the search effect inert
                otherwise (the effect short-circuits on !transferDialogOpen). */}
            <Dialog.Root
                open={transferDialogOpen}
                onOpenChange={(e) => { if (!e.open) closeTransferDialog() }}
                placement="center"
                motionPreset="slide-in-bottom"
            >
                <Portal>
                    <Dialog.Backdrop />
                    <Dialog.Positioner>
                        <Dialog.Content maxW={{ base: "92%", md: "md" }}>
                            <Dialog.Header>
                                <Dialog.Title>
                                    Prenesi vlasništvo turnira
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
                                                Trenutni vlasnik:{" "}
                                                {selectedTournament.createdByName
                                                    || (selectedTournament.createdByUid
                                                        ? "(bez imena)"
                                                        : "— (legacy)")}
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
                                            value={transferUserSearch}
                                            onChange={(e) => setTransferUserSearch(e.target.value)}
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
                                        {loadingTransferUsers ? (
                                            <HStack py="4" justify="center"><Spinner size="sm" /></HStack>
                                        ) : transferUsers.length === 0 ? (
                                            <Text p="3" fontSize="sm" color="fg.muted">
                                                Nema rezultata.
                                            </Text>
                                        ) : (
                                            transferUsers.map((u) => {
                                                const isCurrentOwner =
                                                    !!selectedTournament
                                                    && selectedTournament.createdByUid === u.userUid
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
                                                                {isCurrentOwner && (
                                                                    <Badge size="xs" variant="subtle" colorPalette="gray">
                                                                        vlasnik
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
                                                            loading={transferring === u.userUid}
                                                            disabled={isCurrentOwner}
                                                            onClick={() => handleTransfer(u)}
                                                        >
                                                            {isCurrentOwner ? "Već vlasnik" : "Prenesi"}
                                                        </Button>
                                                    </HStack>
                                                )
                                            })
                                        )}
                                    </Box>
                                </Stack>
                            </Dialog.Body>
                            <Dialog.Footer>
                                <Button variant="ghost" onClick={closeTransferDialog}>Zatvori</Button>
                            </Dialog.Footer>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog.Root>
        </VStack>
    )
}

/* ──────────────────────────────────────────────────────────────────────
   AdminTournamentActions — destructive + status-override controls for
   a selected tournament. Lifted into its own component so the busy
   state and confirm prompts don't bloat the main dashboard render.

   onChanged is called after each successful action with the kind of
   change so the parent can re-fetch / clear selection appropriately:
     - "status"   : status changed, keep selection
     - "reset"    : rounds/bracket/schedule wiped, status → DRAFT
     - "feature"  : feature flag toggled
     - "deleted"  : tournament soft-deleted, parent should clear selection
   ────────────────────────────────────────────────────────────────────── */
function AdminTournamentActions({
    tournament,
    onChanged,
}: {
    tournament: AdminTournamentDto
    onChanged: (kind: "status" | "reset" | "feature" | "deleted") => void
}) {
    const [busy, setBusy] = useState<null | "status" | "reset" | "delete" | "feature">(null)
    // The admin endpoints accept uuid OR slug — prefer uuid, fall back
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
            `Soft-delete — turnir nestaje iz svih lista. Za potvrdu upiši ime turnira.`,
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

    return (
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Body p={{ base: "4", md: "6" }}>
                <Stack gap="4">
                    <Box>
                        <Text fontSize="md" fontWeight="semibold">
                            Akcije turnira
                        </Text>
                        <Text fontSize="sm" color="fg.muted">
                            Administratorske operacije nad turnirom — koristi pažljivo.
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
                                {tournament.status ?? "—"}
                            </Badge>
                        </HStack>
                    </Box>

                    {/* Status override — three buttons, the current status is disabled. */}
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
                    </HStack>

                    {/* Delete row — separated so it's not adjacent to the
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
