import { useState } from "react"
import { Box, Flex, Text } from "@chakra-ui/react"
import { Link as RouterLink, useMatch, useResolvedPath } from "react-router-dom"
import { FiBarChart2, FiList, FiMap, FiPlus, FiRadio } from "react-icons/fi"
import { useQueryClient } from "@tanstack/react-query"
import { fetchLiveMatches } from "../api/live"
import { qk } from "../queryClient"
import { usePolling } from "../hooks/usePolling"

/* ──────────────────────────────────────────────────────────────────────────
   MobileBottomNav - v3 5-tab bottom navigation with a centred FAB.

   Layout (left → right):
     1. Turniri        (list icon)
     2. Uživo          (radio icon, pulsing red dot when something is live)
     3. Kreiraj turnir (raised pitch-green FAB, lifted above the bar)
     4. Karta          (map pin)
     5. Statistika     (bar-chart icon)

   Profil isn't a bottom tab on mobile - it lives behind the avatar in the
   top bar - so the four flanking tabs stay balanced 2+2 around the FAB.

   The FAB is the only visual focal point - it shouldn't disappear into a
   row of equally-weighted icons. The remaining four tabs share the row
   evenly around it.

   Fixed to the bottom of the viewport with `safe-area` padding so it
   lifts above the iOS home-indicator gesture bar. App.tsx main content
   adds `pb` on mobile so the bar never overlaps page content.
   ────────────────────────────────────────────────────────────────────── */

type Item = {
    to: string
    label: string
    icon: typeof FiList
    exact?: boolean
    /** When true, this tab listens to `fetchLiveMatches` for the badge dot. */
    livePoll?: boolean
}

// Four flanking items - Kreiraj is rendered separately as a FAB between the
// 2nd and 3rd entries below.
const SIDE_ITEMS: Item[] = [
    { to: "/turniri", label: "Turniri", icon: FiList, exact: true },
    { to: "/uzivo", label: "Uživo", icon: FiRadio, livePoll: true },
    { to: "/karta", label: "Karta", icon: FiMap },
    { to: "/statistika", label: "Statistika", icon: FiBarChart2 },
]

function NavTab({ item, liveCount }: { item: Item; liveCount: number }) {
    const resolved = useResolvedPath(item.to)
    const match = useMatch({ path: resolved.pathname, end: !!item.exact })
    const isActive = !!match
    const Icon = item.icon
    const isLive = item.livePoll && liveCount > 0
    return (
        <RouterLink to={item.to} style={{ textDecoration: "none", flex: 1 }}>
            <Flex
                direction="column"
                align="center"
                justify="center"
                gap="0.5"
                py="2"
                // `pitch.fg` (not the raw `pitch.500` swatch) so the active
                // tab's text/icon has a dark twin and stays readable once
                // the SPECTO dark panel kicks in.
                color={isActive ? "pitch.fg" : isLive ? "accent.red" : "fg.muted"}
                position="relative"
                _hover={{ color: isActive ? "pitch.fg" : "fg.ink" }}
            >
                {isActive && (
                    <Box
                        position="absolute"
                        top="1"
                        left="50%"
                        w="36px"
                        h="36px"
                        rounded="full"
                        // `pitch.50` is a light-only swatch (no `_dark`
                        // twin), so the halo stayed pale cyan even on the
                        // dark panel. `pitch.subtle` + `pitch.fg` is the
                        // same active-pill pairing already used in
                        // LiveMatchPanel, and both carry dark twins.
                        bg="pitch.subtle"
                        css={{ transform: "translateX(-50%)" }}
                    />
                )}
                <Box position="relative">
                    <Icon size={20} />
                    {isLive && !isActive && (
                        <Box
                            position="absolute"
                            top="-2px"
                            right="-4px"
                            w="8px"
                            h="8px"
                            rounded="full"
                            bg="accent.red"
                            borderWidth="1.5px"
                            borderColor="bg.panel"
                            css={{
                                animation: "pitchPulse 1.6s infinite",
                                boxShadow: "0 0 6px var(--chakra-colors-accent-red)",
                            }}
                        />
                    )}
                </Box>
                <Text
                    fontSize="10px"
                    fontWeight={isActive ? 700 : 600}
                    letterSpacing="-0.01em"
                    lineHeight={1}
                    mt="0.5"
                    position="relative"
                >
                    {item.label}
                </Text>
            </Flex>
        </RouterLink>
    )
}

/** Raised pitch-green FAB for "Kreiraj turnir". Sits centred in the bar,
 *  hoisted 18px above its baseline so it visually pops out of the row.
 *  The notch below it (negative top margin on the inner Flex) lets the
 *  bar visually wrap the button without an actual SVG notch. */
function CreateFab() {
    const resolved = useResolvedPath("/turniri/novi")
    const match = useMatch({ path: resolved.pathname, end: true })
    const isActive = !!match
    return (
        <Box
            position="relative"
            flex="0 0 64px"
            display="flex"
            justifyContent="center"
        >
            <RouterLink
                to="/turniri/novi"
                style={{ textDecoration: "none", display: "block" }}
                aria-label="Kreiraj turnir"
            >
                <Flex
                    direction="column"
                    align="center"
                    gap="1"
                    css={{
                        // Lift the FAB above the nav row so it reads as the
                        // primary action.
                        marginTop: "-18px",
                    }}
                >
                    <Flex
                        w="54px"
                        h="54px"
                        rounded="full"
                        bg={isActive ? "pitch.600" : "pitch.500"}
                        // Project rule: icon/text sitting on solid cyan
                        // uses the navy `pitch.contrast` token, not plain
                        // white - keeps this FAB consistent with the same
                        // cyan/navy pairing used for CTAs elsewhere.
                        color="pitch.contrast"
                        align="center"
                        justify="center"
                        boxShadow="0 8px 20px rgba(42,212,200,0.35)"
                        borderWidth="3px"
                        borderColor="bg.panel"
                        _active={{ transform: "scale(0.96)" }}
                    >
                        <FiPlus size={26} strokeWidth={3} />
                    </Flex>
                    <Text
                        fontSize="10px"
                        fontWeight={700}
                        letterSpacing="-0.01em"
                        // Same fix as NavTab's active label: `pitch.fg` has
                        // a dark twin, the raw `pitch.500` swatch doesn't.
                        color={isActive ? "pitch.fg" : "fg.muted"}
                        lineHeight={1}
                    >
                        Kreiraj
                    </Text>
                </Flex>
            </RouterLink>
        </Box>
    )
}

export default function MobileBottomNav() {
    const queryClient = useQueryClient()
    // Seed the live dot from the shared cache so it's correct immediately.
    const [liveCount, setLiveCount] = useState(
        () => (queryClient.getQueryData<unknown[]>(qk.liveMatches)?.length ?? 0),
    )

    // 30s polling - same cadence as LiveNavItem so the live dot stays in
    // sync. usePolling pauses while the tab is hidden.
    usePolling(() => {
        fetchLiveMatches()
            .then((l) => {
                queryClient.setQueryData(qk.liveMatches, l)
                setLiveCount(l.length)
            })
            .catch(() => {
                /* offline - treat as nothing live */
            })
    }, 30000)

    // Split flanking items around the centre FAB: 2 on each side.
    const left = SIDE_ITEMS.slice(0, 2)
    const right = SIDE_ITEMS.slice(2)

    return (
        <Box
            display={{ base: "block", md: "none" }}
            position="fixed"
            bottom="0"
            left="0"
            right="0"
            // iOS 18-style "liquid glass" effect. Semi-transparent base +
            // backdrop-filter so content scrolling underneath shows
            // through with a soft blur, blended with a small saturation
            // boost so brand colours stay vibrant. Solid fallback for
            // browsers that don't support backdrop-filter (older Firefox
            // on Android).
            //
            // Dark-theme fix: this used to be a hardcoded
            // rgba(247,249,250,…) (near-white) fill with a white-ish
            // border, so on the SPECTO dark theme the bar stayed a light
            // grey strip instead of following the page into dark navy.
            // `color-mix` blends the theme's own `bg.panel` token (white
            // in light mode, #111F31 in dark) with transparency, so the
            // glass tint now follows whichever theme is active - same
            // technique already used for panel tints in BracketTab /
            // GroupsTab / TeamsSection. The border uses the semantic
            // `border` token for the same reason.
            bg="color-mix(in srgb, var(--chakra-colors-bg-panel) 65%, transparent)"
            borderTopWidth="1px"
            borderColor="border"
            // z-index high enough to beat Leaflet panes (Leaflet container
            // is typically 400, controls 800). Also stays above Chakra
            // toasts (zIndex ~1700) is NOT what we want - toasts must be
            // visible on top of the nav. So we sit at 1100, below toast
            // (1500-1900 by Chakra default) and above Leaflet (which we
            // also explicitly clamp via the .leaflet-container CSS rule
            // injected in main.tsx so the map can't break out).
            zIndex={1100}
            css={{
                // The actual frosted-glass effect.
                backdropFilter: "saturate(180%) blur(18px)",
                WebkitBackdropFilter: "saturate(180%) blur(18px)",
                // Subtle inner highlight at the very top to sell the
                // glass edge - same trick Apple's translucent toolbars
                // use. Pure CSS, no extra DOM.
                //
                // Dark-theme fix: the highlight used to be a flat
                // rgba(255,255,255,0.5) line, which assumes a light page
                // catching a bright gloss - on the dark navy panel it
                // showed up as a glowing white hairline instead. Reading
                // `var(--chakra-colors-border)` ties the highlight to the
                // same theme-aware token as the outer border above (this
                // CSS-var-in-boxShadow trick is already used the same way
                // in ui/pitch.tsx). The drop-shadow layer already used
                // the navy `rgba(11,21,34,…)` ink colour, so it needed no
                // change - it reads fine on both light and dark canvases.
                boxShadow:
                    "inset 0 1px 0 var(--chakra-colors-border), 0 -8px 24px rgba(11,21,34,0.05)",
                // Bottom padding strategy:
                //   1. safe-area-inset-bottom - covers iOS PWA home
                //      indicator (≈ 34px on modern iPhones).
                //   2. In Safari on iOS, the browser's URL bar slides
                //      OUT (small height) when scrolling down, then
                //      back IN at the bottom. When it's in we want the
                //      nav to clear it. `env(safe-area-inset-bottom)`
                //      already includes the URL-bar area in iOS Safari's
                //      reporting when the page is in `display: fluid`
                //      mode, but we add a tiny extra buffer because some
                //      iOS versions under-report by a few px.
                paddingBottom:
                    "max(env(safe-area-inset-bottom, 0px), 8px)",
            }}
        >
            <Flex align="flex-end">
                {left.map((item) => (
                    <NavTab key={item.to} item={item} liveCount={liveCount} />
                ))}
                <CreateFab />
                {right.map((item) => (
                    <NavTab key={item.to} item={item} liveCount={liveCount} />
                ))}
            </Flex>
        </Box>
    )
}
