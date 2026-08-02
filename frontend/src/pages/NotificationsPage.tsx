import { useMemo, useRef, useState } from "react"
import { Box, Button, HStack, Icon, Text, VStack, chakra } from "@chakra-ui/react"
import { Link as RouterLink } from "react-router-dom"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FiBell, FiCheck, FiChevronDown, FiChevronRight } from "react-icons/fi"

import {
    getNotifications,
    markNotificationsRead,
    type NotificationGroup,
    type NotificationItem,
} from "../api/notifications"
import { qk } from "../queryClient"
import { EmptyState, Loader, Panel } from "../ui/primitives"
import { MonoLabel, PageTitle } from "../ui/pitch"
import { useTranslation } from "../i18n"

/* ──────────────────────────────────────────────────────────────────────────
   "Obavijesti" - the inbox of everything the user was pushed.

   The whole point of the screen is GROUPING: a 10-goal match is ONE
   collapsible card, not ten rows. The backend does the bucketing
   (`group.key` = "match:123" / "tournament:45" / "other"); this page only
   owns expand/collapse state and the read-marking side effects.
   ────────────────────────────────────────────────────────────────────── */

/**
 * Coarse "prije 5 min" formatting, driven by the dictionary. Deliberately
 * local and tiny: the repo carries no date-fns/dayjs and this is the only
 * screen that needs relative timestamps, so a shared util would be
 * over-building. Anything older than a week falls back to a short date.
 */
function useTimeAgo() {
    const t = useTranslation()
    const c = t.pages.notificationsPage
    return (iso: string): string => {
        const then = Date.parse(iso)
        if (Number.isNaN(then)) return ""
        // Clock skew between server and client can make a fresh item "future" -
        // clamp instead of rendering a negative age.
        const mins = Math.max(0, Math.floor((Date.now() - then) / 60_000))
        if (mins < 1) return c.justNow
        if (mins < 60) return c.minutesAgo(mins)
        const hours = Math.floor(mins / 60)
        if (hours < 24) return c.hoursAgo(hours)
        const days = Math.floor(hours / 24)
        if (days <= 7) return c.daysAgo(days)
        return new Date(then).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
            year: "numeric",
        })
    }
}

export default function NotificationsPage() {
    const t = useTranslation()
    const c = t.pages.notificationsPage
    const timeAgo = useTimeAgo()
    const queryClient = useQueryClient()

    const { data, isLoading } = useQuery({
        queryKey: qk.notifications,
        queryFn: getNotifications,
    })

    const groups = useMemo(() => data?.groups ?? [], [data])
    const unreadCount = data?.unreadCount ?? 0

    /* Expand state. A plain Set of group keys - no accordion dependency.
       `null` means "user hasn't touched anything yet", which derives to
       "newest group open, rest collapsed" (the backend orders groups by
       latestAt desc). Deriving instead of seeding via an effect keeps a
       refetch from re-opening a card the user just collapsed. */
    const [expanded, setExpanded] = useState<Set<string> | null>(null)
    const openKeys = useMemo(() => {
        if (expanded) return expanded
        const first = groups[0]?.key
        return new Set<string>(first ? [first] : [])
    }, [expanded, groups])

    const invalidate = () => {
        void queryClient.invalidateQueries({ queryKey: qk.notifications })
    }
    const markAll = useMutation({
        // Empty array = "mark ALL of mine read" (backend contract).
        mutationFn: () => markNotificationsRead([]),
        onSuccess: invalidate,
    })
    const markSome = useMutation({
        mutationFn: (ids: number[]) => markNotificationsRead(ids),
        onSuccess: invalidate,
    })

    /* Ids already POSTed during this mount. Expanding a group marks its unread
       items read exactly once - collapsing and re-expanding must not re-POST -
       and the request never blocks the toggle. */
    const markedRef = useRef<Set<number>>(new Set())

    function toggleGroup(group: NotificationGroup) {
        const wasOpen = openKeys.has(group.key)
        const next = new Set(openKeys)
        if (wasOpen) next.delete(group.key)
        else next.add(group.key)
        setExpanded(next)

        if (wasOpen) return // only mark on the way OPEN
        const ids = group.items
            .filter((i) => !i.readAt && !markedRef.current.has(i.id))
            .map((i) => i.id)
        if (ids.length === 0) return
        ids.forEach((id) => markedRef.current.add(id))
        markSome.mutate(ids)
    }

    if (isLoading) return <Loader />

    return (
        <Box>
            <PageTitle
                title={c.title}
                subtitle={c.subtitle}
                size="sm"
                action={
                    unreadCount > 0 ? (
                        <Button
                            size="sm"
                            variant="outline"
                            colorPalette="pitch"
                            loading={markAll.isPending}
                            onClick={() => markAll.mutate()}
                        >
                            <FiCheck /> {c.markAllRead}
                        </Button>
                    ) : undefined
                }
            />

            {groups.length === 0 ? (
                <Panel>
                    <EmptyState icon={FiBell} title={c.empty.title} description={c.empty.description} />
                </Panel>
            ) : (
                <VStack align="stretch" gap="2.5">
                    {groups.map((group) => (
                        <GroupCard
                            key={group.key}
                            group={group}
                            open={openKeys.has(group.key)}
                            onToggle={() => toggleGroup(group)}
                            timeAgo={timeAgo}
                        />
                    ))}
                </VStack>
            )}
        </Box>
    )
}

/** One collapsible bucket: a header row that is always visible, plus the
 *  item list when expanded. */
function GroupCard({
    group,
    open,
    onToggle,
    timeAgo,
}: {
    group: NotificationGroup
    open: boolean
    onToggle: () => void
    timeAgo: (iso: string) => string
}) {
    const t = useTranslation()
    const c = t.pages.notificationsPage
    const heading = group.key === "other" ? c.otherGroup : group.title

    // Newest first, independent of the order the backend happened to send.
    const items = useMemo(
        () => [...group.items].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
        [group.items],
    )

    return (
        <Panel overflow="hidden">
            <chakra.button
                type="button"
                aria-expanded={open}
                aria-label={open ? c.collapseAria : c.expandAria}
                onClick={onToggle}
                display="flex"
                alignItems="center"
                gap="3"
                w="100%"
                px="4"
                py="3"
                textAlign="left"
                cursor="pointer"
                bg="transparent"
                border="none"
                _hover={{ bg: "bg.subtle" }}
            >
                <Icon
                    as={open ? FiChevronDown : FiChevronRight}
                    boxSize="4"
                    color="fg.muted"
                    flexShrink={0}
                />
                <Box minW="0" flex="1">
                    <HStack gap="2" minW="0">
                        <Text fontSize="sm" fontWeight={700} color="fg.ink" truncate>
                            {heading}
                        </Text>
                        {group.unread > 0 && (
                            <Box
                                flexShrink={0}
                                px="2"
                                py="0.5"
                                rounded="full"
                                bg="accent.red"
                                color="#fff"
                                fontSize="10px"
                                fontWeight={700}
                                letterSpacing="0.04em"
                            >
                                {c.unreadBadge(group.unread)}
                            </Box>
                        )}
                    </HStack>
                    <HStack gap="2" mt="0.5">
                        <MonoLabel>{c.itemCount(items.length)}</MonoLabel>
                        <MonoLabel>·</MonoLabel>
                        <MonoLabel>{timeAgo(group.latestAt)}</MonoLabel>
                    </HStack>
                </Box>
            </chakra.button>

            {open && (
                <Box borderTopWidth="1px" borderColor="border">
                    {items.map((item, idx) => (
                        <ItemRow key={item.id} item={item} first={idx === 0} timeAgo={timeAgo} />
                    ))}
                </Box>
            )}
        </Panel>
    )
}

/** A single notification inside an expanded group. Wrapped in a router link
 *  when the backend gave it a target. */
function ItemRow({
    item,
    first,
    timeAgo,
}: {
    item: NotificationItem
    first: boolean
    timeAgo: (iso: string) => string
}) {
    const t = useTranslation()
    const c = t.pages.notificationsPage
    const kindLabel = c.kinds[item.kind] ?? c.kinds.GENERIC

    const row = (
        <Box
            px="4"
            py="2.5"
            borderTopWidth={first ? "0" : "1px"}
            borderColor="border"
            // Unread rows keep the soft brand tint until they're marked read.
            bg={item.readAt ? "transparent" : "bg.surfaceTint"}
            _hover={item.url ? { bg: "bg.subtle" } : undefined}
        >
            <HStack gap="2" align="baseline" wrap="wrap">
                <MonoLabel color="pitch.500">{kindLabel}</MonoLabel>
                <MonoLabel>{timeAgo(item.createdAt)}</MonoLabel>
            </HStack>
            <Text fontSize="sm" fontWeight={600} color="fg.ink" mt="0.5">
                {item.title}
            </Text>
            {item.body ? (
                <Text fontSize="sm" color="fg.muted">
                    {item.body}
                </Text>
            ) : null}
        </Box>
    )

    if (!item.url) return row
    return (
        <RouterLink to={item.url} style={{ display: "block" }}>
            {row}
        </RouterLink>
    )
}
