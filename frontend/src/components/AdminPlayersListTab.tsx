import { useEffect, useMemo, useState } from "react"
import {
    Box,
    Button,
    Card,
    HStack,
    Input,
    Spinner,
    Stack,
    Text,
    VStack,
} from "@chakra-ui/react"
import { Link as RouterLink } from "react-router-dom"
import { FiExternalLink, FiSearch, FiUser } from "react-icons/fi"
import { adminListAllUsers, type AdminUserDto } from "../api/admin"

/**
 * Admin-only "Popis igrača" tab on the profile page. Lists every
 * registered user the admin can navigate to, with a one-click button
 * that opens the user's public profile page (/profil/{slug}).
 *
 * <p>Sister tab to {@link AdminDashboardTab}; both gated on the
 * Firebase {@code role: "admin"} custom claim. Where Dashboard is for
 * cross-entity admin actions (attach teams, transfer tournaments),
 * this tab is the simplest possible "browse all profiles" view —
 * useful when the admin wants to spot-check a user's history or hand
 * out a link to someone.
 *
 * <p>Client-side filtering against the loaded list keeps the
 * interaction snappy and avoids hammering the server with debounced
 * search requests; the full user list is in the dozens, well under
 * any reasonable client-render budget. If the user base eventually
 * scales past a few hundred, switch to a server-side paginated search
 * (the existing {@code /admin/users?q=…} endpoint already supports it).
 */
export default function AdminPlayersListTab() {
    const [users, setUsers] = useState<AdminUserDto[] | null>(null)
    const [loading, setLoading] = useState(false)
    const [search, setSearch] = useState("")

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        adminListAllUsers()
            .then((rows) => { if (!cancelled) setUsers(rows) })
            .catch(() => { /* http interceptor surfaces the toast */ })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [])

    const filtered = useMemo(() => {
        if (!users) return []
        const q = search.trim().toLowerCase()
        if (!q) return users
        return users.filter((u) => {
            const hay = `${u.displayName ?? ""} ${u.slug ?? ""}`.toLowerCase()
            return hay.includes(q)
        })
    }, [users, search])

    return (
        <Card.Root variant="outline" rounded="xl" borderColor="border.emphasized" shadow="sm">
            <Card.Body p={{ base: "4", md: "6" }}>
                <Stack gap="3">
                    <Box>
                        <Text fontSize="lg" fontWeight="semibold">Popis igrača</Text>
                        <Text fontSize="sm" color="fg.muted">
                            Svi registrirani igrači — klikni "Otvori profil" za
                            navigaciju na korisničku stranicu.
                        </Text>
                    </Box>

                    {/* Client-side filter input. Search hits both displayName
                        and slug so the admin can find a user by either the
                        readable name or the URL fragment they remember. */}
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
                            placeholder="Pretraži po imenu i prezimenu ili slug-u…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </Box>

                    {loading ? (
                        <HStack py="4" justify="center"><Spinner size="sm" /></HStack>
                    ) : users == null ? (
                        <Text fontSize="sm" color="fg.muted">
                            Nije moguće učitati popis igrača.
                        </Text>
                    ) : filtered.length === 0 ? (
                        <Text fontSize="sm" color="fg.muted">
                            Nema rezultata.
                        </Text>
                    ) : (
                        <>
                            <Text fontSize="xs" color="fg.muted">
                                {search.trim()
                                    ? `${filtered.length} od ${users.length} igrača`
                                    : `Ukupno: ${users.length} igrača`}
                            </Text>
                            <VStack align="stretch" gap="2">
                                {filtered.map((u) => (
                                    <HStack
                                        key={u.userUid}
                                        px="3"
                                        py="2"
                                        borderWidth="1px"
                                        borderColor="border.subtle"
                                        rounded="md"
                                        justify="space-between"
                                        gap="3"
                                        _hover={{ bg: "bg.muted" }}
                                    >
                                        <HStack gap="3" minW="0" flex="1">
                                            <Box color="fg.muted" flexShrink={0}>
                                                <FiUser />
                                            </Box>
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
                                        </HStack>
                                        {/* RouterLink-as-Button keeps the
                                            navigation client-side (SPA route)
                                            and inherits the colour palette. The
                                            disabled-fallback handles edge-case
                                            profiles with no slug — those are
                                            usually freshly-imported legacy users
                                            whose slug hasn't been backfilled
                                            yet; the admin can't directly link
                                            but at least sees the row. */}
                                        {u.slug ? (
                                            <Button
                                                asChild
                                                size="sm"
                                                variant="outline"
                                                colorPalette="pitch"
                                            >
                                                <RouterLink to={`/profil/${u.slug}`}>
                                                    <FiExternalLink /> Otvori profil
                                                </RouterLink>
                                            </Button>
                                        ) : (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                colorPalette="gray"
                                                disabled
                                                title="Slug nije postavljen za ovog korisnika"
                                            >
                                                Bez slug-a
                                            </Button>
                                        )}
                                    </HStack>
                                ))}
                            </VStack>
                        </>
                    )}
                </Stack>
            </Card.Body>
        </Card.Root>
    )
}
