import { useMemo } from "react"
import { Box, Button, Flex, SimpleGrid, Text } from "@chakra-ui/react"
import { useQuery } from "@tanstack/react-query"
import { FiArrowRight, FiUser } from "react-icons/fi"
import { Link as RouterLink } from "react-router-dom"

import { ADMIN_MODULE_GROUPS, type AdminModule, type AdminModuleKey } from "../admin/modules"
import {
    ADMIN_PENDING_COUNTS_KEY,
    getAdminPendingCounts,
    type AdminPendingCounts,
} from "../api/adminCounts"
import { useTranslation } from "../i18n"
import { IconChip, Panel } from "../ui/primitives"
import { MonoLabel } from "../ui/pitch"

/* ──────────────────────────────────────────────────────────────────────────
   AdminHomePage - the /admin landing screen: a launcher grid over the module
   registry (`src/admin/modules.tsx`). Every card links to /admin/{slug},
   where AdminModulePage mounts the module itself.

   Copy comes exclusively from `t.pages.adminConsole`; the registry only
   supplies identity, slug and icon, so adding a module never touches this
   file.
   ────────────────────────────────────────────────────────────────────── */

/** How many items of this module await the admin. The counters cover only a
 *  few modules, and their wire keys ARE the module keys - anything else, plus
 *  a missing/failed query, is simply zero (= no badge). */
function pendingFor(counts: AdminPendingCounts | undefined, key: AdminModuleKey): number {
    if (!counts) return 0
    const value = (counts as Partial<Record<AdminModuleKey, number>>)[key]
    return typeof value === "number" && value > 0 ? value : 0
}

type ModuleCard = {
    module: AdminModule
    title: string
    description: string
}

export default function AdminHomePage() {
    const t = useTranslation()

    const copy = t.pages.adminConsole

    // Background read - a 403/5xx must never toast over the dashboard, and a
    // pending or failed query just means "no badges" (see `pendingFor`).
    const { data: pendingCounts } = useQuery({
        queryKey: ADMIN_PENDING_COUNTS_KEY,
        queryFn: getAdminPendingCounts,
        staleTime: 60_000,
    })

    const groups = useMemo(
        () =>
            ADMIN_MODULE_GROUPS.map((group) => ({
                key: group.key,
                cards: group.modules.map((module): ModuleCard => {
                    const label = copy.modules[module.key]
                    return {
                        module,
                        title: label.title,
                        description: label.description,
                    }
                }),
            })),
        [copy],
    )

    const visibleGroups = groups.filter((group) => group.cards.length > 0)

    return (
        <Box>
            {/* No page header and no search: the console is reached
                deliberately and holds eight cards, which is well under the
                point where scanning beats filtering. The one thing that has to
                stay reachable is the way BACK to the ordinary user profile -
                with the view switch now living in profile settings, /admin
                would otherwise be a room with no door. */}
            <Flex justify="flex-end" mb="4">
                <Button size="xs" variant="ghost" asChild>
                    <RouterLink to="/profil">
                        <FiUser /> {t.pages.adminConsole.userProfileLink}
                    </RouterLink>
                </Button>
            </Flex>

            {visibleGroups.length === 0 ? (
                <Text fontSize="sm" color="fg.muted" py="8" textAlign="center">
                    {copy.noResults}
                </Text>
            ) : (
                <Flex direction="column" gap="6">
                    {visibleGroups.map((group) => (
                        <Box key={group.key}>
                            {/* Quiet mono label rather than a heading - the
                                sections separate the grid, they don't compete
                                with the page title. */}
                            <MonoLabel as="h2" display="block" mb="2">
                                {copy.groups[group.key]}
                            </MonoLabel>
                            {/* Mobile is a dense two-per-row launcher: icon +
                                title only. The description and the "open"
                                affordance are desktop-only - on a phone the
                                whole card is the tap target anyway, and eight
                                subtitles turn a launcher into a wall of text. */}
                            <SimpleGrid columns={{ base: 2, sm: 2, lg: 3, xl: 4 }} gap={{ base: "2", sm: "3" }}>
                                {group.cards.map(({ module, title, description }) => {
                                    const pending = pendingFor(pendingCounts, module.key)
                                    return (
                                        <Panel
                                            key={module.key}
                                            asChild
                                            p={{ base: "3", sm: "4" }}
                                            position="relative"
                                            transition="transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease"
                                            _hover={{
                                                borderColor: "pitch.500",
                                                shadow: "md",
                                                transform: "translateY(-2px)",
                                            }}
                                            _focusVisible={{
                                                outline: "2px solid",
                                                outlineColor: "pitch.500",
                                                outlineOffset: "2px",
                                            }}
                                        >
                                            <RouterLink to={`/admin/${module.slug}`}>
                                                {pending > 0 ? (
                                                    <Box
                                                        position="absolute"
                                                        top={{ base: "1.5", sm: "2.5" }}
                                                        right={{ base: "1.5", sm: "2.5" }}
                                                        minW={{ base: "18px", sm: "20px" }}
                                                        h={{ base: "18px", sm: "20px" }}
                                                        px="1.5"
                                                        rounded="full"
                                                        bg="accent.red"
                                                        color="white"
                                                        fontSize={{ base: "10px", sm: "11px" }}
                                                        fontWeight={700}
                                                        lineHeight={{ base: "18px", sm: "20px" }}
                                                        textAlign="center"
                                                        aria-label={copy.pendingBadge(pending)}
                                                        title={copy.pendingBadge(pending)}
                                                    >
                                                        {pending}
                                                    </Box>
                                                ) : null}
                                                <Flex
                                                    direction={{ base: "row", sm: "column" }}
                                                    align={{ base: "center", sm: "stretch" }}
                                                    gap={{ base: "2", sm: "2.5" }}
                                                    h="100%"
                                                >
                                                    <IconChip
                                                        icon={module.icon}
                                                        size={{ base: "8", sm: "10" }}
                                                        iconSize={{ base: "4", sm: "5" }}
                                                    />
                                                    {/* On the compact mobile card the badge sits
                                                        over the title's corner - reserve room for
                                                        it instead of letting it cover a word. */}
                                                    <Box minW="0" pe={pending > 0 ? { base: "4", sm: "0" } : undefined}>
                                                        <Text
                                                            fontWeight={700}
                                                            color="fg.ink"
                                                            lineHeight="1.3"
                                                            fontSize={{ base: "sm", sm: "md" }}
                                                        >
                                                            {title}
                                                        </Text>
                                                        <Text
                                                            fontSize="sm"
                                                            color="fg.muted"
                                                            mt="0.5"
                                                            lineClamp="2"
                                                            hideBelow="sm"
                                                        >
                                                            {description}
                                                        </Text>
                                                    </Box>
                                                    {/* Pushed to the bottom so cards with a
                                                        one-line description still align. */}
                                                    <Flex
                                                        align="center"
                                                        gap="1.5"
                                                        mt="auto"
                                                        pt="1"
                                                        fontSize="xs"
                                                        fontWeight={600}
                                                        color="pitch.500"
                                                        hideBelow="sm"
                                                    >
                                                        {copy.openModule}
                                                        <FiArrowRight />
                                                    </Flex>
                                                </Flex>
                                            </RouterLink>
                                        </Panel>
                                    )
                                })}
                            </SimpleGrid>
                        </Box>
                    ))}
                </Flex>
            )}
        </Box>
    )
}
