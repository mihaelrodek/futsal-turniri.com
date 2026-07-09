import React, { useEffect, useState } from "react"
import {
    Box,
    Flex,
    HStack,
    Image,
    Button,
    Container,
    Menu,
    Text,
    chakra,
    useBreakpointValue,
} from "@chakra-ui/react"
import { Link as RouterLink, useMatch, useResolvedPath, useNavigate } from "react-router-dom"
import { queryClient, PERSIST_KEY } from "../queryClient"
import { FiLogOut, FiUser } from "react-icons/fi"
import { useAuth } from "../auth/AuthContext"
import { getProfile } from "../api/userMe"
import { InstallAppButton } from "./InstallAppButton"
import ColorModeToggle from "./ColorModeToggle"
import { LiveNavItem } from "./LiveNavItem"
import { Logo } from "./Logo"
import { MonoLabel } from "../ui/pitch"

/* ──────────────────────────────────────────────────────────────────────────
   PitchNav - top navigation in the "Pitch" theme.

   Desktop layout (md+):  three-column grid
     [ brand mark + wordmark ]  [ centred pill nav capsule ]  [ user pill ]

   Mobile layout (base):  brand on the left, hamburger on the right, full
                          drawer underneath when open.

   The drawer also honours the `futsal:open-nav-menu` /
   `futsal:close-nav-menu` events fired by the guided Joyride tour - they
   force the drawer open while the tour highlights nav-internals, then
   close it again when the tour moves on.
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
            gap="1.5"
            px="4"
            py="2"
            rounded="full"
            fontSize="13px"
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
}: {
    name?: string | null
    email?: string | null
    avatarUrl?: string | null
    size?: number
}) {
    const source = (name || email || "?").trim()
    const initials =
        source
            .split(/[\s@]+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((s) => s[0]?.toUpperCase())
            .join("") || "?"
    return (
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
            bgImage="linear-gradient(135deg, #3aa56b, #0b6b3a)"
            flexShrink={0}
        >
            {avatarUrl ? (
                <Image src={avatarUrl} alt={name ?? "Profilna slika"} w="100%" h="100%" objectFit="cover" />
            ) : (
                initials
            )}
        </Box>
    )
}

export default function NavBar() {
    const { user, signOut, loading } = useAuth()
    const navigate = useNavigate()

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
            navigate("/turniri")
        }
    }

    function DesktopAuthArea() {
        if (loading) return null
        if (!user) {
            return (
                <Button asChild size="sm" variant="solid" colorPalette="pitch">
                    <RouterLink to="/prijava">Prijava</RouterLink>
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
                        <UserAvatar name={user.displayName} email={user.email} avatarUrl={avatarUrl} />
                        <Box
                            as="span"
                            display={{ base: "none", lg: "inline" }}
                            fontSize="13px"
                            fontWeight={600}
                            color="fg.ink"
                        >
                            {user.displayName || user.email}
                        </Box>
                    </chakra.button>
                </Menu.Trigger>
                <Menu.Positioner>
                    <Menu.Content minW="220px">
                        <Box px="3" py="2" borderBottomWidth="1px" borderColor="border">
                            <MonoLabel>Prijavljen kao</MonoLabel>
                            <Text fontSize="sm" fontWeight={600} truncate mt="0.5">
                                {user.email ?? user.displayName ?? "Anonimno"}
                            </Text>
                        </Box>
                        <Menu.Item value="profile" onSelect={() => navigate("/profil")}>
                            <FiUser /> Profil
                        </Menu.Item>
                        <Menu.Item value="logout" onSelect={onSignOut}>
                            <FiLogOut /> Odjavi se
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
            <Container maxW="6xl" py="3">
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
                            Turniri
                        </PillNavLink>
                        <LiveNavItem />
                        <PillNavLink to="/turniri/novi">Kreiraj turnir</PillNavLink>
                        <PillNavLink to="/karta">Karta</PillNavLink>
                        <PillNavLink to="/statistika">Statistika</PillNavLink>
                    </HStack>

                    {/* Right cluster: install affordance + user pill. The
                        stand-in notification bell was removed - it wasn't
                        wired to anything and added clutter next to install. */}
                    <HStack justify="end" gap="3">
                        <HStack data-tour={isMobile ? undefined : "help-install"} gap="1.5">
                            <ColorModeToggle size="sm" />
                            <InstallAppButton size="sm" />
                        </HStack>
                        <DesktopAuthArea />
                    </HStack>
                </Box>

                {/* ── Mobile layout ─────────────────────────────────────────────
                     No hamburger menu - navigation lives in the fixed
                     MobileBottomNav at the foot of the viewport. The only
                     extra affordance is the install button, which now sits
                     inline to the left of the profile avatar. */}
                <Flex display={{ base: "flex", md: "none" }} align="center" gap="2">
                    <Logo size={32} showDomain={false} to="/turniri" />
                    <Box flex="1" />
                    <Box data-tour={isMobile ? "help-install" : undefined}>
                        <HStack gap="1.5">
                            <ColorModeToggle size="sm" />
                            <InstallAppButton size="sm" />
                        </HStack>
                    </Box>
                    <Box data-tour={isMobile ? "nav-auth" : undefined}>
                        {!loading && user && (
                            <Menu.Root>
                                <Menu.Trigger asChild>
                                    <Button aria-label="Profil meni" size="sm" variant="ghost" px={1}>
                                        <UserAvatar
                                            name={user.displayName}
                                            email={user.email}
                                            avatarUrl={avatarUrl}
                                            size={28}
                                        />
                                    </Button>
                                </Menu.Trigger>
                                <Menu.Positioner>
                                    <Menu.Content minW="220px">
                                        <Box px="3" py="2" borderBottomWidth="1px" borderColor="border">
                                            <MonoLabel>Prijavljen kao</MonoLabel>
                                            <Text fontSize="sm" fontWeight={600} truncate mt="0.5">
                                                {user.email ?? user.displayName ?? "Anonimno"}
                                            </Text>
                                        </Box>
                                        <Menu.Item value="profile" onSelect={() => navigate("/profil")}>
                                            <FiUser /> Profil
                                        </Menu.Item>
                                        <Menu.Item value="logout" onSelect={onSignOut}>
                                            <FiLogOut /> Odjavi se
                                        </Menu.Item>
                                    </Menu.Content>
                                </Menu.Positioner>
                            </Menu.Root>
                        )}
                        {!loading && !user && (
                            <Button asChild size="sm" variant="solid" colorPalette="pitch">
                                <RouterLink to="/prijava">Prijava</RouterLink>
                            </Button>
                        )}
                    </Box>
                </Flex>
            </Container>
        </Box>
    )
}
