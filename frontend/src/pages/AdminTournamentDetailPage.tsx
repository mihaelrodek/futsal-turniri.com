import { useCallback, useEffect, useMemo, useState } from "react"
import {
    Badge,
    Box,
    Button,
    Dialog,
    Flex,
    Heading,
    HStack,
    Input,
    Portal,
    Spinner,
    Stack,
    Text,
    VStack,
} from "@chakra-ui/react"
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom"
import { FiExternalLink, FiSlash, FiTrash2, FiUserPlus } from "react-icons/fi"

import {
    adminAddEditor,
    adminListEditors,
    adminListTournaments,
    adminRemoveEditor,
    adminSearchUsers,
    type AdminTournamentDto,
    type AdminUserDto,
} from "../api/admin"
import { AdminTournamentActions } from "../components/AdminDashboardTab"
import { formatDate } from "../admin/format"
import { BackLink, MonoLabel } from "../ui/pitch"
import { EmptyState, Loader, Panel } from "../ui/primitives"
import { useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   AdminTournamentDetailPage - /admin/turniri/{uuidOrSlug}.

   Everything an admin can do TO one tournament: who may manage it, and the
   destructive/administrative actions (status, reset, feature, visibility,
   export, delete).

   Split out of the old single-screen module for one reason: the actions here
   bypass the ordinary checks and several are irreversible, so the tournament
   they act on has to be named at the top of the same screen - not selected in
   a picker three cards higher up.
   ────────────────────────────────────────────────────────────────────── */

export default function AdminTournamentDetailPage() {
    const t = useTranslation()
    const d = t.components.adminDashboardTab
    const p = t.pages.adminTournamentDetail
    const navigate = useNavigate()
    const { id = "" } = useParams<{ id: string }>()

    const [tournaments, setTournaments] = useState<AdminTournamentDto[] | null>(null)
    const [loading, setLoading] = useState(true)

    const reload = useCallback(async () => {
        const rows = await adminListTournaments()
        setTournaments(rows)
        return rows
    }, [])

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        reload()
            .catch(() => { /* interceptor toasts */ })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [reload])

    /** The admin list has no by-id endpoint, and the route may carry a uuid,
     *  a slug or (legacy rows) the numeric id - so match on all three. */
    const tournament = useMemo(
        () => tournaments?.find(
            (row) => row.uuid === id || row.slug === id || String(row.id) === id,
        ) ?? null,
        [tournaments, id],
    )

    /* ─────────────── Rights (co-editors) ─────────────── */

    const [editors, setEditors] = useState<AdminUserDto[]>([])
    const [loadingEditors, setLoadingEditors] = useState(false)
    const [editorDialogOpen, setEditorDialogOpen] = useState(false)
    const [editorUserSearch, setEditorUserSearch] = useState("")
    const [editorUsers, setEditorUsers] = useState<AdminUserDto[]>([])
    const [loadingEditorUsers, setLoadingEditorUsers] = useState(false)
    const [grantingUid, setGrantingUid] = useState<string | null>(null)
    const [removingUid, setRemovingUid] = useState<string | null>(null)

    const tournamentId = tournament?.id ?? null

    useEffect(() => {
        if (tournamentId == null) { setEditors([]); return }
        let cancelled = false
        setLoadingEditors(true)
        adminListEditors(tournamentId)
            .then((rows) => { if (!cancelled) setEditors(rows) })
            .catch(() => { /* handled by toaster */ })
            .finally(() => { if (!cancelled) setLoadingEditors(false) })
        return () => { cancelled = true }
    }, [tournamentId])

    // Debounced user search, and only while the picker is open.
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

    async function grantEditor(user: AdminUserDto) {
        if (tournamentId == null) return
        try {
            setGrantingUid(user.userUid)
            const added = await adminAddEditor(tournamentId, user.userUid)
            // Grant is idempotent; the dialog stays open for the next person.
            setEditors((prev) =>
                prev.some((e) => e.userUid === added.userUid) ? prev : [...prev, added],
            )
        } finally {
            setGrantingUid(null)
        }
    }

    async function removeEditor(userUid: string) {
        if (tournamentId == null) return
        try {
            setRemovingUid(userUid)
            await adminRemoveEditor(tournamentId, userUid)
            setEditors((prev) => prev.filter((e) => e.userUid !== userUid))
        } finally {
            setRemovingUid(null)
        }
    }

    if (loading) return <Loader />

    if (!tournament) {
        return (
            <Box>
                <BackLink to="/admin/turniri" onClick={() => navigate("/admin/turniri")} label={p.back} />
                <EmptyState
                    icon={FiSlash}
                    title={p.notFoundTitle}
                    description={p.notFoundDesc}
                    action={
                        <Button size="sm" variant="outline" colorPalette="pitch" onClick={() => navigate("/admin/turniri")}>
                            {p.back}
                        </Button>
                    }
                />
            </Box>
        )
    }

    const publicHref = `/turniri/${tournament.slug ?? tournament.uuid ?? ""}`

    return (
        <Box>
            <BackLink to="/admin/turniri" onClick={() => navigate("/admin/turniri")} label={p.back} />

            <Flex align="flex-start" justify="space-between" gap="3" wrap="wrap" mb="4">
                <Box minW="0">
                    <Heading as="h1" size="lg" lineHeight="1.2" letterSpacing="-0.02em" color="fg.ink">
                        {tournament.name}
                    </Heading>
                    <HStack gap="2" mt="1.5" wrap="wrap">
                        {tournament.status && (
                            <Badge size="sm" variant="subtle" colorPalette={tournament.status === "FINISHED" ? "gray" : "blue"}>
                                {tournament.status}
                            </Badge>
                        )}
                        <Text fontSize="xs" color="fg.muted">
                            {[tournament.location, formatDate(tournament.startAt)].filter(Boolean).join(" • ")}
                        </Text>
                    </HStack>
                </Box>
                <Button size="sm" variant="outline" colorPalette="gray" asChild>
                    <RouterLink to={publicHref}>
                        <FiExternalLink /> {p.openPublic}
                    </RouterLink>
                </Button>
            </Flex>

            <VStack align="stretch" gap="4">
                {/* Rights first: "who may touch this" is the question that
                    brings an admin here most often, and it is the safe one. */}
                <Panel p={{ base: "4", md: "6" }}>
                    <Stack gap="3">
                        <HStack justify="space-between" gap="3" wrap="wrap">
                            <Box>
                                <Text fontSize="md" fontWeight="semibold">{d.rights.heading}</Text>
                                <Text fontSize="sm" color="fg.muted">{d.rights.description}</Text>
                            </Box>
                            <Button
                                size="sm"
                                variant="outline"
                                colorPalette="pitch"
                                onClick={() => {
                                    setEditorDialogOpen(true)
                                    setEditorUserSearch("")
                                    setEditorUsers([])
                                }}
                            >
                                <FiUserPlus /> {d.rights.grantButton}
                            </Button>
                        </HStack>

                        <Box p="3" bg="bg.muted" rounded="md" borderWidth="1px" borderColor="border.subtle">
                            <MonoLabel display="block" mb="0.5">{d.rights.ownerLabel}</MonoLabel>
                            <Text fontSize="sm" fontWeight="medium">
                                {tournament.createdByName
                                    || (tournament.createdByUid ? d.noName : d.rights.ownerLegacyNoOwner)}
                            </Text>
                        </Box>

                        {loadingEditors ? (
                            <HStack py="2" justify="center"><Spinner size="sm" /></HStack>
                        ) : editors.length === 0 ? (
                            <Text fontSize="sm" color="fg.muted">{d.rights.noEditors}</Text>
                        ) : (
                            <VStack align="stretch" gap="2">
                                {editors.map((editor) => (
                                    <HStack
                                        key={editor.userUid}
                                        justify="space-between"
                                        gap="3"
                                        p="2.5"
                                        borderWidth="1px"
                                        borderColor="border"
                                        rounded="md"
                                    >
                                        <Box minW="0">
                                            <Text fontSize="sm" fontWeight={600} truncate>
                                                {editor.displayName || d.noName}
                                            </Text>
                                            {editor.slug && (
                                                <Text fontSize="xs" color="fg.muted" truncate>/{editor.slug}</Text>
                                            )}
                                        </Box>
                                        <Button
                                            size="xs"
                                            variant="ghost"
                                            colorPalette="red"
                                            loading={removingUid === editor.userUid}
                                            onClick={() => removeEditor(editor.userUid)}
                                        >
                                            <FiTrash2 /> {d.rights.remove}
                                        </Button>
                                    </HStack>
                                ))}
                            </VStack>
                        )}
                    </Stack>
                </Panel>

                {/* Administrative actions - the destructive half of the screen. */}
                <AdminTournamentActions
                    tournament={tournament}
                    onChanged={(kind) => {
                        if (kind === "deleted") {
                            navigate("/admin/turniri")
                            return
                        }
                        void reload()
                    }}
                />
            </VStack>

            {/* Grant-rights picker. Multi-add: stays open so several people can
                be granted in one go. */}
            <Dialog.Root open={editorDialogOpen} onOpenChange={(e) => { if (!e.open) setEditorDialogOpen(false) }}>
                <Portal>
                    <Dialog.Backdrop />
                    <Dialog.Positioner>
                        <Dialog.Content maxW="md">
                            <Dialog.Header>
                                <Dialog.Title>{d.grantDialog.title}</Dialog.Title>
                            </Dialog.Header>
                            <Dialog.Body>
                                <Stack gap="3">
                                    <Input
                                        placeholder={d.grantDialog.searchPlaceholder}
                                        value={editorUserSearch}
                                        onChange={(e) => setEditorUserSearch(e.target.value)}
                                    />
                                    <Box maxH="300px" overflowY="auto" borderWidth="1px" borderColor="border.subtle" rounded="md">
                                        {loadingEditorUsers ? (
                                            <HStack py="4" justify="center"><Spinner size="sm" /></HStack>
                                        ) : editorUsers.length === 0 ? (
                                            <Text p="3" fontSize="sm" color="fg.muted">{d.noResults}</Text>
                                        ) : (
                                            editorUsers.map((user) => (
                                                <HStack
                                                    key={user.userUid}
                                                    justify="space-between"
                                                    gap="2"
                                                    px="3"
                                                    py="2"
                                                    borderBottomWidth="1px"
                                                    borderColor="border.subtle"
                                                >
                                                    <Box minW="0">
                                                        <Text fontSize="sm" fontWeight={600} truncate>
                                                            {user.displayName || d.noName}
                                                        </Text>
                                                        {user.slug && (
                                                            <Text fontSize="xs" color="fg.muted" truncate>/{user.slug}</Text>
                                                        )}
                                                    </Box>
                                                    <Button
                                                        size="xs"
                                                        colorPalette="pitch"
                                                        loading={grantingUid === user.userUid}
                                                        disabled={editors.some((e) => e.userUid === user.userUid)}
                                                        onClick={() => grantEditor(user)}
                                                    >
                                                        {editors.some((e) => e.userUid === user.userUid)
                                                            ? d.grantDialog.addedButton
                                                            : d.grantDialog.grantButton}
                                                    </Button>
                                                </HStack>
                                            ))
                                        )}
                                    </Box>
                                </Stack>
                            </Dialog.Body>
                            <Dialog.Footer>
                                <Button variant="ghost" onClick={() => setEditorDialogOpen(false)}>
                                    {d.grantDialog.done}
                                </Button>
                            </Dialog.Footer>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog.Root>
        </Box>
    )
}
