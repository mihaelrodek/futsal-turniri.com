import React, { useEffect, useState } from "react"
import {
    Box,
    CloseButton,
    Drawer,
    Flex,
    HStack,
    IconButton,
    Image,
    Button,
    Container,
    Menu,
    Portal,
    Switch,
    Text,
    VStack,
    chakra,
    useBreakpointValue,
} from "@chakra-ui/react"
import { Link as RouterLink, useMatch, useResolvedPath, useNavigate } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { queryClient, PERSIST_KEY, qk } from "../queryClient"
import { FiBell, FiGrid, FiLogOut, FiMenu, FiShoppingCart, FiUser } from "react-icons/fi"
import { useAuth } from "../auth/AuthContext"
import { useAdminView } from "../admin/AdminViewContext"
import { getProfile } from "../api/userMe"
import { getUnreadNotificationCount } from "../api/notifications"
import { InstallAppButton } from "./InstallAppButton"
import { LiveNavItem } from "./LiveNavItem"
import { Logo } from "./Logo"
import { MonoLabel } from "../ui/pitch"
import { useTranslation } from "../i18n"
import { useCart } from "../cart/CartContext"
import LanguagePicker from "./LanguagePicker"
import ThemeSwitch from "./ThemeSwitch"

/* ──────────────────────────────────────────────────────────────────────────
   PitchNav - top navigation in the "Pitch" theme.

   Desktop layout (md+):  three-column grid
     [ brand mark + wordmark ]  [ centred pill nav capsule ]  [ user pill ]
   Signed in: theme/language/install all live inside the user pill's own
   menu (DesktopAuthArea) - one dropdown, nothing else needed next to it.
   Signed out: there's no user pill to hang them off, so a small guest
   hamburger (DesktopGuestMenu) carries the same three controls instead -
   anonymous visitors must be able to reach them too.

   Mobile layout (base):  brand on the left, cart + a single hamburger button
   on the right - everything else (profile/sign-out, theme, language,
   install) lives inside a right-side drawer opened from that hamburger, to
   keep the top bar from getting crowded on a small screen. Primary
   navigation itself stays in the fixed `MobileBottomNav` at the foot of the
   viewport, unaffected by this drawer.
   ────────────────────────────────────────────────────────────────────── */

/** Single nav pill inside the centred capsule. Filled pitch-green when the
 *  current route matches; ghost otherwise. */
function PillNavLink({
    to,
    exact,
    children,
    onClick,
}: {
    to: string
    exact?: boolean
    children: React.ReactNode
    onClick?: () => void
}) {
    const resolved = useResolvedPath(to)
    const match = useMatch({ path: resolved.pathname, end: !!exact })
    const isActive = !!match
    return (
        <Box
            asChild
            display="inline-flex"
            alignItems="center"
            gap="1"
            px="3"
            py="1.5"
            rounded="full"
            fontSize="12px"
            fontWeight={600}
            color={isActive ? "white" : "fg.ink"}
            bg={isActive ? "pitch.500" : "transparent"}
            transition="background 150ms"
            _hover={!isActive ? { bg: "bg.panel" } : undefined}
            cursor="pointer"
            onClick={onClick}
        >
            <RouterLink to={to}>{children}</RouterLink>
        </Box>
    )
}

/** Gradient circle initials avatar used both inside the user pill and
 *  inside the user menu dropdown. */
function UserAvatar({
    name,
    email,
    avatarUrl,
    size = 30,
    unread = 0,
}: {
    name?: string | null
    email?: string | null
    avatarUrl?: string | null
    size?: number
    /** Unread notifications. > 0 draws the same red badge the admin module
     *  cards use, so "there is something waiting for you" looks identical
     *  wherever it appears. The menu itself is one tap away, so the badge only
     *  has to be noticed - it is deliberately not a button of its own. */
    unread?: number
}) {
    const t = useTranslation()
    const source = (name || email || "?").trim()
    const initials =
        source
            .split(/[\s@]+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((s) => s[0]?.toUpperCase())
            .join("") || "?"
    // The badge hangs outside the avatar circle, so the wrapper must NOT clip
    // (`overflow: hidden` lives on the inner circle, where the image needs it).
    const badgeSize = Math.max(14, Math.round(size * 0.5))
    return (
        <Box position="relative" flexShrink={0} w={`${size}px`} h={`${size}px`}>
        <Box
            w={`${size}px`}
            h={`${size}px`}
            rounded="full"
            overflow="hidden"
            color="white"
            display="flex"
            alignItems="center"
            justifyContent="center"
            fontWeight={700}
            fontSize={`${Math.round(size * 0.36)}px`}
            letterSpacing="0.02em"
            // Gradient is intentionally hard-coded because the inline
            // gradient string can't reference Chakra tokens via theme keys.
            bgImage="linear-gradient(135deg, #2AD4C8, #0B1522)"
            flexShrink={0}
        >
            {avatarUrl ? (
                <Image src={avatarUrl} alt={name ?? t.nav.profilePictureAlt} w="100%" h="100%" objectFit="cover" />
            ) : (
                initials
            )}
        </Box>
        {unread > 0 && (
            <Box
                position="absolute"
                top="-2px"
                right="-4px"
                minW={`${badgeSize}px`}
                h={`${badgeSize}px`}
                px="1"
                rounded="full"
                bg="accent.red"
                color="white"
                fontSize={`${Math.max(9, Math.round(badgeSize * 0.62))}px`}
                fontWeight={800}
                lineHeight={`${badgeSize}px`}
                textAlign="center"
                // Rings the badge in the surface colour so it reads as a
                // separate chip rather than a smudge on the avatar.
                borderWidth="2px"
                borderColor="bg.panel"
                aria-label={t.nav.unreadNotifications(unread)}
                title={t.nav.unreadNotifications(unread)}
            >
                {unread > 9 ? "9+" : unread}
            </Box>
        )}
        </Box>
    )
}

/** /cjenik cart icon - a real cart with a live item-count badge, next to the
 *  profile pill. Always visible (works signed-out too, since the cart flow
 *  supports an anonymous checkout) but only draws the badge once non-empty.
 *  Navigates to the full /kosarica page. */
function CartButton({ size = 30 }: { size?: number }) {
    const t = useTranslation()
    const navigate = useNavigate()
    const { itemCount } = useCart()
    return (
        <Box position="relative" display="inline-flex">
            <chakra.button
                type="button"
                aria-label={t.nav.cartAria(itemCount)}
                title={t.nav.cartAria(itemCount)}
                onClick={() => navigate("/kosarica")}
                display="inline-flex"
                alignItems="center"
                justifyContent="center"
                w={`${size}px`}
                h={`${size}px`}
                rounded="full"
                bg="bg.surfaceTint"
                border="none"
                cursor="pointer"
                color="fg.ink"
                _hover={{ bg: "pitch.100" }}
            >
                <FiShoppingCart size={Math.round(size * 0.5)} />
            </chakra.button>
            {itemCount > 0 && (
                <Box
                    position="absolute"
                    top="-2px"
                    right="-2px"
                    minW="16px"
                    h="16px"
                    px="1"
                    rounded="full"
                    bg="pitch.500"
                    color="white"
                    fontSize="10px"
                    fontWeight={700}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    lineHeight="1"
                >
                    {itemCount}
                </Box>
            )}
        </Box>
    )
}

/** Hard cap at 20 characters (ellipsis) - the pill's `truncate mt="0.5"` CSS
 *  ellipsis alone still let a very long display name push the pill wide
 *  enough to crowd the nav capsule; this bounds it up front instead. */
function truncateName(name: string, max = 20): string {
    return name.length > max ? `${name.slice(0, max).trimEnd()}…` : name
}

export default function NavBar() {
    const t = useTranslation()
    const { user, signOut, loading } = useAuth()
    const { isAdmin, mode: adminViewMode, setMode: setAdminViewMode } = useAdminView()
    const navigate = useNavigate()
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

    /* Unread badge on the avatar. Signed-in only (guests have no inbox and
       would just collect 401s), and a background read: a failed or pending
       count is simply "no badge", never a toast over the page. Refetches on
       focus because the inbox changes while the tab sits in the background -
       the one query in the app where returning to the tab is exactly when the
       number is stale. */
    const { data: unreadCount = 0 } = useQuery({
        queryKey: qk.notificationsUnread,
        queryFn: getUnreadNotificationCount,
        enabled: !!user?.uid,
        staleTime: 60_000,
        refetchOnWindowFocus: true,
    })

    function goTo(path: string) {
        setMobileMenuOpen(false)
        navigate(path)
    }

    /* Admin view: a persisted preference, shaped exactly like the theme row
       next to it. Deliberately does NOT navigate - flipping it retargets
       "Profil" (see profileHref) and the user goes there when they mean to,
       instead of the app yanking them somewhere on a toggle. */
    const adminViewSwitch = (
        <Switch.Root
            checked={adminViewMode === "admin"}
            onCheckedChange={(e) => setAdminViewMode(e.checked ? "admin" : "user")}
            colorPalette="pitch"
            size="lg"
        >
            <Switch.HiddenInput aria-label={t.pages.adminConsole.viewSwitch.label} />
            <Switch.Control>
                <Switch.Thumb>
                    <Switch.ThumbIndicator fallback={<FiUser size={13} />}>
                        <FiGrid size={13} />
                    </Switch.ThumbIndicator>
                </Switch.Thumb>
            </Switch.Control>
        </Switch.Root>
    )

    /** Where "Profil" goes. An admin who left the view switch ON wants the
     *  console, not their own player profile - the choice lives in profile
     *  settings and persists, so this just follows it. */
    const profileHref = isAdmin && adminViewMode === "admin" ? "/admin" : "/profil"

    // Tour-aware breakpoint flag - see comment block in the previous NavBar
    // for the full reasoning. Short version: the guided tour needs
    // `data-tour` attrs only on the *visible* variant of the nav.
    const isMobile = useBreakpointValue({ base: true, md: false }, { ssr: false }) ?? false

    const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
    useEffect(() => {
        if (!user?.uid) {
            setAvatarUrl(null)
            return
        }
        let cancelled = false
        const refresh = async () => {
            try {
                const p = await getProfile()
                if (!cancelled) setAvatarUrl(p.avatarUrl ?? null)
            } catch {
                /* anonymous / network error */
            }
        }
        refresh()
        const handler = () => refresh()
        window.addEventListener("futsal:profile-updated", handler)
        return () => {
            cancelled = true
            window.removeEventListener("futsal:profile-updated", handler)
        }
    }, [user?.uid])

    async function onSignOut() {
        try {
            await signOut()
        } finally {
            // Drop all cached data + its persisted copy so the next (anonymous
            // or different) session never briefly sees the previous user's data.
            queryClient.clear()
            try { localStorage.removeItem(PERSIST_KEY) } catch { /* private mode */ }
            setMobileMenuOpen(false)
            navigate("/turniri")
        }
    }

    /** Desktop hamburger for SIGNED-OUT visitors only: theme + language +
     *  install. Signed-in users get the same three controls inside the user
     *  pill's own menu instead (DesktopAuthArea) - rendering both at once
     *  would be a redundant second hamburger next to the profile pill. */
    function DesktopGuestMenu() {
        return (
            <Menu.Root>
                <Menu.Trigger asChild>
                    <IconButton
                        aria-label={t.nav.menuAria}
                        title={t.nav.menuAria}
                        size="sm"
                        variant="ghost"
                        rounded="full"
                        data-tour={isMobile ? undefined : "help-install"}
                    >
                        <FiMenu />
                    </IconButton>
                </Menu.Trigger>
                <Menu.Positioner>
                    <Menu.Content minW="200px">
                        {/* Plain content (not Menu.Item) so clicking the
                            switch/picker/button doesn't auto-close the menu -
                            stopPropagation keeps it open. */}
                        <Box px="3" py="2" onClick={(e) => e.stopPropagation()}>
                            <HStack justify="space-between">
                                <MonoLabel>{t.nav.themeLabel}</MonoLabel>
                                <ThemeSwitch size="lg" />
                            </HStack>
                        </Box>
                        {isAdmin && (
                            <Box px="3" py="2" borderTopWidth="1px" borderColor="border" onClick={(e) => e.stopPropagation()}>
                                <HStack justify="space-between">
                                    <MonoLabel>{t.pages.adminConsole.viewSwitch.label}</MonoLabel>
                                    {adminViewSwitch}
                                </HStack>
                            </Box>
                        )}
                        <Box px="3" py="2" borderTopWidth="1px" borderColor="border" onClick={(e) => e.stopPropagation()}>
                            <MonoLabel>{t.nav.languageLabel}</MonoLabel>
                            <Box mt="1.5">
                                <LanguagePicker variant="inline" />
                            </Box>
                        </Box>
                        <Box px="3" py="2" borderTopWidth="1px" borderColor="border" onClick={(e) => e.stopPropagation()}>
                            <InstallAppButton size="sm" variant="labeled" />
                        </Box>
                    </Menu.Content>
                </Menu.Positioner>
            </Menu.Root>
        )
    }

    function DesktopAuthArea() {
        if (loading) return null
        if (!user) {
            return (
                <Button asChild size="sm" variant="solid" colorPalette="pitch">
                    <RouterLink to="/prijava">{t.nav.login}</RouterLink>
                </Button>
            )
        }
        // Pill-shaped user chip: avatar gradient + display name. The whole
        // pill is the menu trigger.
        return (
            <Menu.Root>
                <Menu.Trigger asChild>
                    <chakra.button
                        type="button"
                        display="inline-flex"
                        alignItems="center"
                        gap="2.5"
                        pl="1"
                        pr="3"
                        py="1"
                        rounded="full"
                        bg="bg.surfaceTint"
                        border="none"
                        cursor="pointer"
                        _hover={{ bg: "pitch.100" }}
                        data-tour={isMobile ? undefined : "nav-auth"}
                    >
                        <UserAvatar name={user.displayName} email={user.email} avatarUrl={avatarUrl} unread={unreadCount} />
                        <Box
                            as="span"
                            display={{ base: "none", lg: "inline" }}
                            fontSize="13px"
                            fontWeight={600}
                            color="fg.ink"
                        >
                            {truncateName(user.displayName || user.email || "")}
                        </Box>
                    </chakra.button>
                </Menu.Trigger>
                <Menu.Positioner>
                    <Menu.Content minW="220px">
                        {/* No "Prijavljen kao <e-mail>" header - the trigger
                            pill already shows who's signed in, and the raw
                            address added nothing but a PII line on screen. */}
                        <Menu.Item value="profile" onSelect={() => navigate(profileHref)}>
                            <FiUser /> {t.nav.profile}
                        </Menu.Item>
                        <Menu.Item value="notifications" onSelect={() => navigate("/obavijesti")}>
                            <FiBell /> {t.nav.notifications}
                            {unreadCount > 0 && (
                                <Box
                                    as="span"
                                    ms="auto"
                                    minW="18px"
                                    px="1.5"
                                    rounded="full"
                                    bg="accent.red"
                                    color="white"
                                    fontSize="10px"
                                    fontWeight={800}
                                    lineHeight="18px"
                                    textAlign="center"
                                >
                                    {unreadCount > 99 ? "99+" : unreadCount}
                                </Box>
                            )}
                        </Menu.Item>
                        {/* Theme + language rows - plain content, NOT
                            Menu.Item, so flipping the switch / picking a
                            language doesn't trigger item-select auto-close; a
                            nested Menu-based language picker would also fight
                            this menu's own overlay, hence the inline variant.
                            stopPropagation keeps the menu open on click. */}
                        <Box
                            px="3"
                            py="2"
                            mt="1"
                            borderTopWidth="1px"
                            borderColor="border"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <HStack justify="space-between">
                                <MonoLabel>{t.nav.themeLabel}</MonoLabel>
                                <ThemeSwitch size="lg" />
                            </HStack>
                        </Box>
                        <Box px="3" py="2" borderTopWidth="1px" borderColor="border" onClick={(e) => e.stopPropagation()}>
                            <MonoLabel>{t.nav.languageLabel}</MonoLabel>
                            <Box mt="1.5">
                                <LanguagePicker variant="inline" />
                            </Box>
                        </Box>
                        {/* Sign out sits LAST on purpose - it's the one
                            destructive-ish action in here, so it shouldn't be
                            adjacent to "Profil" where a mis-tap costs a login. */}
                        <Menu.Item value="logout" onSelect={onSignOut} mt="1" borderTopWidth="1px" borderColor="border">
                            <FiLogOut /> {t.nav.logout}
                        </Menu.Item>
                    </Menu.Content>
                </Menu.Positioner>
            </Menu.Root>
        )
    }

    return (
        <Box
            as="header"
            bg="bg.panel"
            borderBottomWidth="1px"
            borderColor="border"
            position="sticky"
            top={0}
            // Beats Leaflet's internal panes - see prior NavBar comment.
            zIndex={1000}
        >
            {/* Same maxW/px as the page-content Container (App.tsx) so the
                logo and right cluster line up with the content edges below
                instead of sitting inset from them. */}
            <Container maxW="1280px" px={{ base: 4, md: 6 }} py="2">
                {/* ── Desktop layout ───────────────────────────────────────── */}
                <Box
                    display={{ base: "none", md: "grid" }}
                    gridTemplateColumns="1fr auto 1fr"
                    alignItems="center"
                    gap="3"
                >
                    {/* Brand block - shared Logo component (mark + live-text
                        wordmark + domain) per the brand guide. */}
                    <Box>
                        <Logo size={40} to="/turniri" />
                    </Box>

                    {/* Centre nav capsule */}
                    <HStack
                        data-tour={isMobile ? undefined : "nav-items"}
                        gap="0.5"
                        justify="center"
                        bg="bg.surfaceTint"
                        padding="1"
                        rounded="full"
                    >
                        <PillNavLink to="/turniri" exact>
                            {t.nav.tournaments}
                        </PillNavLink>
                        <LiveNavItem />
                        <PillNavLink to="/turniri/novi">{t.nav.createTournament}</PillNavLink>
                        <PillNavLink to="/karta">{t.nav.map}</PillNavLink>
                        <PillNavLink to="/statistika">{t.nav.stats}</PillNavLink>
                    </HStack>

                    {/* Right cluster: cart + the user pill (its menu carries
                        theme/language/install when signed in). Signed out,
                        the "Prijava" button takes the pill's place and the
                        guest hamburger (same three controls) sits after it,
                        flush right. The stand-in notification bell was
                        removed - it wasn't wired to anything and added
                        clutter. */}
                    <HStack justify="end" gap="3">
                        <CartButton />
                        <DesktopAuthArea />
                        {!loading && !user && <DesktopGuestMenu />}
                    </HStack>
                </Box>

                {/* ── Mobile layout ─────────────────────────────────────────────
                     Logo, cart, a "Prijava" button when signed out (visible
                     right in the bar - it's the primary CTA for an anonymous
                     visitor, not worth burying in the drawer), and a single
                     hamburger. Everything else (profile/sign-out, theme,
                     language, install) lives in the drawer below. Primary
                     navigation stays in the fixed MobileBottomNav. */}
                <Flex display={{ base: "flex", md: "none" }} align="center" gap="2">
                    <Logo size={32} showDomain={false} to="/turniri" />
                    <Box flex="1" />
                    <CartButton size={28} />
                    {!loading && !user && (
                        <Button asChild size="sm" variant="solid" colorPalette="pitch">
                            <RouterLink to="/prijava">{t.nav.login}</RouterLink>
                        </Button>
                    )}
                    <IconButton
                        aria-label={t.nav.menuAria}
                        title={t.nav.menuAria}
                        size="sm"
                        variant="ghost"
                        rounded="full"
                        onClick={() => setMobileMenuOpen(true)}
                        data-tour={isMobile ? "nav-auth" : undefined}
                    >
                        <FiMenu />
                    </IconButton>
                </Flex>
            </Container>

            {/* ── Mobile drawer - profile/sign-out + theme/language/install ── */}
            <Drawer.Root
                open={mobileMenuOpen}
                onOpenChange={(e) => setMobileMenuOpen(e.open)}
                placement="end"
                size="xs"
            >
                <Portal>
                    <Drawer.Backdrop />
                    <Drawer.Positioner>
                        <Drawer.Content>
                            <Drawer.Header borderBottomWidth="1px" borderColor="border">
                                <Drawer.Title>{t.nav.menuAria}</Drawer.Title>
                            </Drawer.Header>
                            {/* Default recipe position: absolute top-right,
                                which lands it in the header row opposite the
                                title. */}
                            <Drawer.CloseTrigger asChild>
                                <CloseButton size="sm" aria-label={t.common.close} title={t.common.close} />
                            </Drawer.CloseTrigger>
                            <Drawer.Body py="4">
                                <VStack align="stretch" gap="5">
                                    {!loading && user && (
                                        <VStack align="stretch" gap="2">
                                            <chakra.button
                                                type="button"
                                                onClick={() => goTo("/profil")}
                                                display="flex"
                                                alignItems="center"
                                                gap="3"
                                                p="2"
                                                rounded="lg"
                                                bg="transparent"
                                                border="none"
                                                cursor="pointer"
                                                textAlign="left"
                                                _hover={{ bg: "bg.subtle" }}
                                            >
                                                <UserAvatar name={user.displayName} email={user.email} avatarUrl={avatarUrl} size={40} unread={unreadCount} />
                                                <Box minW="0" flex="1">
                                                    <Text fontSize="sm" fontWeight={700} truncate>
                                                        {user.displayName || t.nav.anonymous}
                                                    </Text>
                                                    <Text fontSize="xs" color="fg.muted" truncate>
                                                        {user.email ?? t.nav.anonymous}
                                                    </Text>
                                                </Box>
                                            </chakra.button>
                                            <Button variant="ghost" justifyContent="flex-start" onClick={() => goTo(profileHref)}>
                                                <FiUser /> {t.nav.profile}
                                            </Button>
                                            <Button variant="ghost" justifyContent="flex-start" onClick={() => goTo("/obavijesti")}>
                                                <FiBell /> {t.nav.notifications}
                                                {unreadCount > 0 && (
                                                    <Box
                                                        as="span"
                                                        ms="auto"
                                                        minW="18px"
                                                        px="1.5"
                                                        rounded="full"
                                                        bg="accent.red"
                                                        color="white"
                                                        fontSize="10px"
                                                        fontWeight={800}
                                                        lineHeight="18px"
                                                        textAlign="center"
                                                    >
                                                        {unreadCount > 99 ? "99+" : unreadCount}
                                                    </Box>
                                                )}
                                            </Button>
                                        </VStack>
                                    )}
                                    {!loading && !user && (
                                        <Button colorPalette="pitch" onClick={() => goTo("/prijava")}>
                                            {t.nav.login}
                                        </Button>
                                    )}

                                    <VStack align="stretch" gap="3" pt="2" borderTopWidth="1px" borderColor="border">
                                        <HStack justify="space-between">
                                            <Text fontSize="sm" fontWeight={600}>{t.nav.themeLabel}</Text>
                                            <ThemeSwitch size="lg" />
                                        </HStack>
                                        {isAdmin && (
                                            <HStack justify="space-between">
                                                <Text fontSize="sm" fontWeight={600}>
                                                    {t.pages.adminConsole.viewSwitch.label}
                                                </Text>
                                                {adminViewSwitch}
                                            </HStack>
                                        )}
                                        <HStack justify="space-between">
                                            <Text fontSize="sm" fontWeight={600}>{t.nav.languageLabel}</Text>
                                            {/* Inline variant - a Menu-based
                                                picker portals under the open
                                                drawer and never receives the
                                                tap. */}
                                            <LanguagePicker variant="inline" />
                                        </HStack>
                                        <InstallAppButton size="sm" variant="labeled" />
                                    </VStack>

                                    {/* Sign out last, below the settings block -
                                        same ordering as the desktop menu. */}
                                    {!loading && user && (
                                        <Button
                                            variant="ghost"
                                            justifyContent="flex-start"
                                            colorPalette="red"
                                            pt="2"
                                            onClick={onSignOut}
                                        >
                                            <FiLogOut /> {t.nav.logout}
                                        </Button>
                                    )}
                                </VStack>
                            </Drawer.Body>
                        </Drawer.Content>
                    </Drawer.Positioner>
                </Portal>
            </Drawer.Root>
        </Box>
    )
}
