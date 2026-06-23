import { Box, Container, Flex, HStack, Text } from "@chakra-ui/react"
import { Link as RouterLink } from "react-router-dom"
import { Logo } from "./Logo"

/* ──────────────────────────────────────────────────────────────────────────
   Footer — slim sticky brand bar pinned to the bottom of the viewport.

   It's intentionally short (single row) so it stays visible while scrolling
   without eating content height. Dark pitch-green ground so it reads as a
   distinct base no matter what's above it. Holds the dark-variant logo +
   the © line.

   Rendered once in App.tsx as a sibling of the main content. Because it's
   `position: sticky; bottom: 0`, the main content area must leave room for
   it (App.tsx already lifts content above the mobile nav; the footer sits
   below that in the flow and sticks).
   ────────────────────────────────────────────────────────────────────── */

export default function Footer() {
    return (
        <Box
            as="footer"
            // Desktop only. On mobile the fixed bottom nav already owns the
            // bottom edge, so a sticky footer there just fought it — per
            // product request the footer is web-only.
            display={{ base: "none", md: "block" }}
            position="sticky"
            bottom="0"
            // Sit above page content / Leaflet panes but below the top nav
            // (1000) so it never covers it.
            zIndex={900}
            bg="#0e1f15"
            borderTopWidth="1px"
            borderColor="rgba(255,255,255,0.08)"
        >
            <Container maxW="6xl" py={{ base: "2.5", md: "3" }}>
                <Flex
                    align="center"
                    justify="space-between"
                    gap="3"
                    wrap="wrap"
                >
                    <Logo size={26} variant="dark" showDomain={false} to="/turniri" />
                    <HStack gap="4" wrap="wrap" justify="flex-end">
                        <Box
                            asChild
                            fontFamily="mono"
                            fontSize="11px"
                            fontWeight={600}
                            letterSpacing="0.04em"
                            color="rgba(255,255,255,0.7)"
                            css={{ "&:hover": { color: "#fff" } }}
                        >
                            <RouterLink to="/privatnost">Privatnost</RouterLink>
                        </Box>
                        <Text
                            fontFamily="mono"
                            fontSize="11px"
                            fontWeight={600}
                            letterSpacing="0.04em"
                            color="rgba(255,255,255,0.6)"
                            whiteSpace="nowrap"
                        >
                            © 2026 Mihael Rodek · futsal-turniri.com
                        </Text>
                    </HStack>
                </Flex>
            </Container>
        </Box>
    )
}
