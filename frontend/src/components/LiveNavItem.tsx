import { useState } from "react"
import { Box, HStack } from "@chakra-ui/react"
import { Link as RouterLink, useMatch, useResolvedPath } from "react-router-dom"
import { fetchLiveMatches } from "../api/live"
import { usePolling } from "../hooks/usePolling"

/* ──────────────────────────────────────────────────────────────────────────
   Pitch-styled nav pill that flips identity based on live state.

   Always navigates to /uzivo. Polls /tournaments/live every 30s:
     - At least one match live → red text + pulsing red dot (label "Uživo")
     - Nothing live            → quiet pill (label "Uživo")

   Used as one of the four items inside the centre nav capsule in NavBar.
   The active state (route matches /uzivo) is rendered as the same green
   filled pill as the other nav items, so the active treatment overrides
   the live-red treatment on the page itself.
   ────────────────────────────────────────────────────────────────────── */
export function LiveNavItem({ onNavigate }: { onNavigate?: () => void }) {
    const [liveCount, setLiveCount] = useState(0)

    const resolved = useResolvedPath("/uzivo")
    const match = useMatch({ path: resolved.pathname, end: false })
    const isActive = !!match

    // Poll the live-matches endpoint so the label stays in sync with reality.
    // usePolling pauses while the tab is hidden (and refreshes on return).
    usePolling(() => {
        fetchLiveMatches()
            .then((l) => setLiveCount(l.length))
            .catch(() => {
                /* offline / endpoint down — treat as nothing live */
            })
    }, 30000)

    const isLive = liveCount > 0

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
            color={isActive ? "white" : isLive ? "accent.red" : "fg.ink"}
            bg={isActive ? "pitch.500" : "transparent"}
            transition="background 150ms"
            _hover={!isActive ? { bg: "bg.panel" } : undefined}
            cursor="pointer"
            onClick={onNavigate}
        >
            <RouterLink to="/uzivo">
                {isLive && !isActive && (
                    <Box
                        as="span"
                        w="7px"
                        h="7px"
                        rounded="full"
                        bg="accent.red"
                        boxShadow="0 0 6px var(--chakra-colors-accent-red)"
                        css={{ animation: "pitchPulse 1.6s infinite" }}
                    />
                )}
                {isLive && isActive && (
                    <Box
                        as="span"
                        w="7px"
                        h="7px"
                        rounded="full"
                        bg="white"
                        css={{ animation: "pitchPulse 1.6s infinite" }}
                    />
                )}
                <HStack as="span" gap="1" align="center">
                    Uživo
                    {isLive ? (
                        <Box
                            as="span"
                            fontFamily="mono"
                            fontSize="10px"
                            fontWeight={700}
                            opacity={0.8}
                        >
                            {liveCount}
                        </Box>
                    ) : null}
                </HStack>
            </RouterLink>
        </Box>
    )
}
