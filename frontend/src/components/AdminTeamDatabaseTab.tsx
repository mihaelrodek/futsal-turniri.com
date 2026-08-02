import { useEffect, useMemo, useState } from "react"
import {
    Badge,
    Box,
    Button,
    Card,
    Dialog,
    HStack,
    Input,
    NativeSelect,
    Portal,
    Spinner,
    Stack,
    Tabs,
    Text,
    VStack,
} from "@chakra-ui/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FiEye, FiEyeOff, FiGitMerge, FiSearch, FiUsers, FiX } from "react-icons/fi"
import {
    adminDismissTeamDuplicate,
    adminListTeamDuplicates,
    adminListTeamIdentities,
    adminMergeTeams,
    adminSetTeamDemo,
    type AdminTeamIdentityDto,
    type TeamDuplicateGroupDto,
} from "../api/admin"
import { qk } from "../queryClient"
import { useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   "Baza ekipa" admin tab - cross-tournament team-identity management:
     1. Full name list with the hidden/test (demo) flag toggle - mirrors
        the players' is_demo flag, just with an actual UI (players never
        got one; the flag there is set by hand in the DB).
     2. Duplicate-name finder + merge tool - groups likely-duplicate team
        names ("OGREVANJE ZAMUDA" vs "Ogrevanje Zamuda") and lets the admin
        pick a canonical spelling to unify them (renames every Teams row
        plus every other place a team name is stored: tournament podium
        snapshots, saved "par" presets, default kits).
   ────────────────────────────────────────────────────────────────────── */

/** Select value that switches the merge dialog to a free-text canonical-name
 *  input. Team names are trimmed server-side, so a value with leading/
 *  trailing spaces can never collide with a real name. */
const CUSTOM_SENTINEL = " __custom__ "

export default function AdminTeamDatabaseTab() {
    const t = useTranslation()
    return (
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Body p={{ base: "4", md: "6" }}>
                <Stack gap="4">
                    {/* No card title: /admin/{slug} already names the module. */}

                    <Tabs.Root defaultValue="list" variant="line">
                        <Tabs.List>
                            <Tabs.Trigger value="list">
                                <FiUsers /> {t.components.adminTeamDatabaseTab.tabList}
                            </Tabs.Trigger>
                            <Tabs.Trigger value="duplicates">
                                <FiGitMerge /> {t.components.adminTeamDatabaseTab.tabDuplicates}
                            </Tabs.Trigger>
                        </Tabs.List>
                        <Tabs.Content value="list">
                            <TeamIdentityList />
                        </Tabs.Content>
                        <Tabs.Content value="duplicates">
                            <DuplicateFinder />
                        </Tabs.Content>
                    </Tabs.Root>
                </Stack>
            </Card.Body>
        </Card.Root>
    )
}

function TeamIdentityList() {
    const t = useTranslation()
    const queryClient = useQueryClient()
    const [search, setSearch] = useState("")
    const [busyName, setBusyName] = useState<string | null>(null)

    const { data: teams, isLoading } = useQuery({
        queryKey: qk.adminTeamIdentities,
        queryFn: adminListTeamIdentities,
    })

    const filtered = useMemo(() => {
        if (!teams) return []
        const q = search.trim().toLowerCase()
        if (!q) return teams
        return teams.filter((t) => t.name.toLowerCase().includes(q))
    }, [teams, search])

    async function toggleDemo(team: AdminTeamIdentityDto) {
        setBusyName(team.name)
        try {
            await adminSetTeamDemo(team.name, !team.demo)
            queryClient.setQueryData<AdminTeamIdentityDto[]>(qk.adminTeamIdentities, (old) =>
                old?.map((t) => (t.name === team.name ? { ...t, demo: !team.demo } : t)),
            )
        } catch {
            /* toaster surfaces the error */
        } finally {
            setBusyName(null)
        }
    }

    return (
        <Stack gap="3" pt="3">
            <Box position="relative">
                <Box position="absolute" left="3" top="50%" transform="translateY(-50%)"
                     color="fg.muted" pointerEvents="none">
                    <FiSearch />
                </Box>
                <Input
                    pl="9"
                    placeholder={t.components.adminTeamDatabaseTab.list.searchPlaceholder}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </Box>

            {isLoading ? (
                <HStack py="4" justify="center"><Spinner size="sm" /></HStack>
            ) : filtered.length === 0 ? (
                <Text fontSize="sm" color="fg.muted" py="2">{t.components.adminTeamDatabaseTab.list.noResults}</Text>
            ) : (
                <>
                    <Text fontSize="xs" color="fg.muted">
                        {search.trim()
                            ? t.components.adminTeamDatabaseTab.list.countFiltered(filtered.length, teams!.length)
                            : t.components.adminTeamDatabaseTab.list.countTotal(teams!.length)}
                    </Text>
                    <VStack align="stretch" gap="2" maxH="480px" overflowY="auto">
                        {filtered.map((team) => (
                            <HStack
                                key={team.name}
                                px="3"
                                py="2"
                                borderWidth="1px"
                                borderColor="border.subtle"
                                rounded="md"
                                justify="space-between"
                                gap="3"
                                opacity={team.demo ? 0.6 : 1}
                            >
                                <Box minW="0" flex="1">
                                    <HStack gap="2">
                                        <Text fontSize="sm" fontWeight="medium" truncate>
                                            {team.name}
                                        </Text>
                                        {team.demo && (
                                            <Badge size="xs" variant="subtle" colorPalette="gray">{t.components.adminTeamDatabaseTab.list.hiddenBadge}</Badge>
                                        )}
                                    </HStack>
                                    <Text fontSize="xs" color="fg.muted">
                                        {t.components.adminTeamDatabaseTab.list.appearances(team.rowCount)} · {t.components.adminTeamDatabaseTab.list.tournaments(team.tournamentsCount)}
                                    </Text>
                                </Box>
                                <Button
                                    size="xs"
                                    variant="outline"
                                    colorPalette={team.demo ? "green" : "gray"}
                                    loading={busyName === team.name}
                                    onClick={() => toggleDemo(team)}
                                >
                                    {team.demo
                                        ? <><FiEye /> {t.components.adminTeamDatabaseTab.list.show}</>
                                        : <><FiEyeOff /> {t.components.adminTeamDatabaseTab.list.hide}</>}
                                </Button>
                            </HStack>
                        ))}
                    </VStack>
                </>
            )}
        </Stack>
    )
}

function DuplicateFinder() {
    const t = useTranslation()
    const queryClient = useQueryClient()
    const [mergeGroup, setMergeGroup] = useState<TeamDuplicateGroupDto | null>(null)
    const [dismissingKey, setDismissingKey] = useState<string | null>(null)

    const { data: groups, isLoading } = useQuery({
        queryKey: qk.adminTeamDuplicates,
        queryFn: adminListTeamDuplicates,
    })

    function afterMerge() {
        setMergeGroup(null)
        queryClient.invalidateQueries({ queryKey: qk.adminTeamDuplicates })
        queryClient.invalidateQueries({ queryKey: qk.adminTeamIdentities })
    }

    const dismissMutation = useMutation({
        mutationFn: (names: string[]) => adminDismissTeamDuplicate(names),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: qk.adminTeamDuplicates })
        },
        onSettled: () => setDismissingKey(null),
    })

    return (
        <Stack gap="3" pt="3">
            <Text fontSize="xs" color="fg.muted">
                {t.components.adminTeamDatabaseTab.duplicates.intro}
            </Text>

            {isLoading ? (
                <HStack py="4" justify="center"><Spinner size="sm" /></HStack>
            ) : !groups || groups.length === 0 ? (
                <Text fontSize="sm" color="fg.muted" py="2">{t.components.adminTeamDatabaseTab.duplicates.noResults}</Text>
            ) : (
                <VStack align="stretch" gap="2" maxH="480px" overflowY="auto">
                    {groups.map((group, i) => (
                        <Box
                            key={`${group.type}-${i}`}
                            borderWidth="1px"
                            borderColor="border.subtle"
                            rounded="md"
                            p="3"
                        >
                            <HStack justify="space-between" align="flex-start" gap="2" mb="2">
                                <Badge
                                    size="xs"
                                    variant="subtle"
                                    colorPalette={group.type === "EXACT" ? "brand" : "orange"}
                                >
                                    {group.type === "EXACT"
                                        ? t.components.adminTeamDatabaseTab.duplicates.badgeExact
                                        : t.components.adminTeamDatabaseTab.duplicates.badgeSimilar}
                                </Badge>
                                <HStack gap="1.5">
                                    <Button
                                        size="xs"
                                        variant="outline"
                                        colorPalette="gray"
                                        loading={dismissingKey === `${group.type}-${i}`}
                                        onClick={() => {
                                            setDismissingKey(`${group.type}-${i}`)
                                            dismissMutation.mutate(group.variants.map((v) => v.name))
                                        }}
                                    >
                                        <FiX /> {t.components.adminTeamDatabaseTab.duplicates.dismissButton}
                                    </Button>
                                    <Button
                                        size="xs"
                                        variant="solid"
                                        colorPalette="brand"
                                        onClick={() => setMergeGroup(group)}
                                    >
                                        <FiGitMerge /> {t.components.adminTeamDatabaseTab.duplicates.mergeButton}
                                    </Button>
                                </HStack>
                            </HStack>
                            <VStack align="stretch" gap="1">
                                {group.variants.map((v) => (
                                    <HStack key={v.name} justify="space-between" gap="2">
                                        <Text fontSize="sm" truncate>{v.name}</Text>
                                        <Text fontSize="xs" color="fg.muted" flexShrink={0}>
                                            {t.components.adminTeamDatabaseTab.duplicates.appearances(v.rowCount)}
                                        </Text>
                                    </HStack>
                                ))}
                            </VStack>
                        </Box>
                    ))}
                </VStack>
            )}

            <MergeDialog group={mergeGroup} onClose={() => setMergeGroup(null)} onMerged={afterMerge} />
        </Stack>
    )
}

function MergeDialog({
    group,
    onClose,
    onMerged,
}: {
    group: TeamDuplicateGroupDto | null
    onClose: () => void
    onMerged: () => void
}) {
    const t = useTranslation()
    const [canonical, setCanonical] = useState<string>(group?.suggestedCanonical ?? "")
    // "__custom__" in the select switches to a free-text input, so the admin
    // can keep a spelling that isn't among the observed variants (e.g. fix
    // the capitalisation to „Ekipa 1" even if only „ekipa 1"/„EKIPA 1" exist).
    const [customName, setCustomName] = useState("")
    const [confirming, setConfirming] = useState(false)
    const [busy, setBusy] = useState(false)

    const isCustom = canonical === CUSTOM_SENTINEL
    const effectiveCanonical = isCustom ? customName.trim() : (canonical || group?.suggestedCanonical || "")

    // Reset local state whenever a DIFFERENT group is opened (the dialog
    // component instance itself never unmounts, only `group` swaps).
    const groupIdentity = group ? group.variants.map((v) => v.name).join("|") : null
    useEffect(() => {
        if (group) {
            setCanonical(group.suggestedCanonical)
            setCustomName("")
            setConfirming(false)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groupIdentity])

    async function submit() {
        if (!group || !effectiveCanonical) return
        setBusy(true)
        try {
            await adminMergeTeams(group.variants.map((v) => v.name), effectiveCanonical)
            onMerged()
        } catch {
            /* toaster surfaces the error */
        } finally {
            setBusy(false)
            setConfirming(false)
        }
    }

    return (
        <Dialog.Root
            open={!!group}
            onOpenChange={(e) => {
                if (!e.open) {
                    onClose()
                    setConfirming(false)
                    setCanonical("")
                }
            }}
            placement="center"
            motionPreset="slide-in-bottom"
        >
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW={{ base: "92%", md: "md" }}>
                        <Dialog.Header>
                            <Dialog.Title>{t.components.adminTeamDatabaseTab.merge.title}</Dialog.Title>
                        </Dialog.Header>
                        <Dialog.Body>
                            {group && !confirming && (
                                <Stack gap="3">
                                    <Text fontSize="sm" color="fg.muted">
                                        {t.components.adminTeamDatabaseTab.merge.intro}
                                    </Text>
                                    <NativeSelect.Root>
                                        <NativeSelect.Field
                                            value={canonical || group.suggestedCanonical}
                                            onChange={(e) => setCanonical(e.target.value)}
                                        >
                                            {group.variants.map((v) => (
                                                <option key={v.name} value={v.name}>
                                                    {t.components.adminTeamDatabaseTab.merge.variantOption(v.name, v.rowCount)}
                                                </option>
                                            ))}
                                            <option value={CUSTOM_SENTINEL}>{t.components.adminTeamDatabaseTab.merge.customOption}</option>
                                        </NativeSelect.Field>
                                        <NativeSelect.Indicator />
                                    </NativeSelect.Root>
                                    {isCustom && (
                                        <Input
                                            size="sm"
                                            autoFocus
                                            placeholder={t.components.adminTeamDatabaseTab.merge.customPlaceholder}
                                            value={customName}
                                            onChange={(e) => setCustomName(e.target.value)}
                                        />
                                    )}
                                    <Text fontSize="xs" color="fg.muted">
                                        {t.components.adminTeamDatabaseTab.merge.hint}
                                    </Text>
                                </Stack>
                            )}
                            {group && confirming && (
                                <Stack gap="2">
                                    <Text fontSize="sm">
                                        {t.components.adminTeamDatabaseTab.merge.confirmPrefix(group.variants.map((v) => v.name).join(", "))}{" "}
                                        <strong>{effectiveCanonical}</strong>{t.components.adminTeamDatabaseTab.merge.confirmSuffix}
                                    </Text>
                                    <Text fontSize="sm" color="red.fg" fontWeight="medium">
                                        {t.components.adminTeamDatabaseTab.merge.warning}
                                    </Text>
                                </Stack>
                            )}
                        </Dialog.Body>
                        <Dialog.Footer>
                            <Button variant="ghost" onClick={onClose} disabled={busy}>{t.common.cancel}</Button>
                            {!confirming ? (
                                <Button
                                    colorPalette="brand"
                                    onClick={() => setConfirming(true)}
                                    disabled={isCustom && !customName.trim()}
                                >
                                    {t.components.adminTeamDatabaseTab.merge.next}
                                </Button>
                            ) : (
                                <Button colorPalette="red" onClick={submit} loading={busy}>
                                    {t.components.adminTeamDatabaseTab.merge.confirm}
                                </Button>
                            )}
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}
