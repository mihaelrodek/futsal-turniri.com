import { useEffect, useState } from "react"
import { Box, Flex, chakra } from "@chakra-ui/react"
import { FiX } from "react-icons/fi"

import StreamPlayer from "./StreamPlayer"
import { MatchTickerPanel, GroupTablePanel, UpcomingMatchPanel, buildScoreBug } from "./StreamHero"
import { useTeamColors } from "./jersey"
import type { LiveMatch } from "../api/live"

/* ──────────────────────────────────────────────────────────────────────────
   TheaterMode - a distraction-free, YouTube-theater-style full-screen view
   for a single live-streamed tournament: the stream fills ~80% on the left,
   the group/bracket table + the "tijek utakmice" feed stack on the right.
   Nothing else - no filters, no tournament list, no nav.

   Mounted as a fixed overlay so entering/leaving can animate (scale + fade)
   without a route change. Esc closes it; body scroll is locked while open.
   On mobile the two panes stack (stream on top, table + feed below).
   ────────────────────────────────────────────────────────────────────────── */

export default function TheaterMode({
    url,
    match,
    onClose,
}: {
    url: string
    match: LiveMatch | null
    onClose: () => void
}) {
    // Drives the enter/exit transition. Mounts hidden, flips shown on the next
    // frame (enter); on close, flips back and unmounts after the transition.
    const [shown, setShown] = useState(false)

    useEffect(() => {
        const id = requestAnimationFrame(() => setShown(true))
        const prevOverflow = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => {
            cancelAnimationFrame(id)
            document.body.style.overflow = prevOverflow
        }
    }, [])

    function handleClose() {
        setShown(false)
        window.setTimeout(onClose, 320)
    }

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose() }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const colors = useTeamColors(match?.tournamentUuid ?? null)
    const scoreBug = buildScoreBug(match, colors)

    return (
        <Box
            position="fixed"
            inset="0"
            zIndex={2000}
            bg="#0a0c0f"
            opacity={shown ? 1 : 0}
            css={{ transition: "opacity 320ms ease" }}
        >
            {/* Exit button - always on top. */}
            <chakra.button
                type="button"
                onClick={handleClose}
                aria-label="Izađi iz turnir moda"
                title="Izađi (Esc)"
                position="absolute"
                top={{ base: "2", md: "3" }}
                right={{ base: "2", md: "3" }}
                zIndex={2}
                display="inline-flex"
                alignItems="center"
                justifyContent="center"
                gap="1.5"
                px="3"
                h="9"
                rounded="full"
                bg="whiteAlpha.200"
                color="white"
                fontSize="sm"
                fontWeight={700}
                cursor="pointer"
                _hover={{ bg: "whiteAlpha.300" }}
                css={{ backdropFilter: "blur(6px)" }}
            >
                <FiX size={16} /> Izađi
            </chakra.button>

            <Flex
                h="100dvh"
                w="100vw"
                p={{ base: "2", md: "4" }}
                gap={{ base: "2", md: "3" }}
                direction={{ base: "column", lg: "row" }}
                css={{
                    transition: "transform 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 320ms ease",
                    transform: shown ? "scale(1)" : "scale(0.96)",
                    opacity: shown ? 1 : 0,
                }}
            >
                {/* Left ~80%: the stream, vertically centered, filling the height
                    (letterboxed to 16:9). */}
                <Flex
                    flex={{ base: "0 0 auto", lg: "0 0 79%" }}
                    minW="0"
                    align="center"
                    justify="center"
                    minH={{ base: "34vh", lg: "0" }}
                >
                    <Box w="full" h={{ base: "auto", lg: "full" }}>
                        <StreamPlayer url={url} overlay={scoreBug} />
                    </Box>
                </Flex>

                {/* Right ~20%, top → bottom on every breakpoint: tijek utakmice
                    (largest), the group/bracket table, then a compact "nadolazeća
                    utakmica" card. pt on lg reserves room for the top-right
                    "Izađi" button so it doesn't overlap the panel header. */}
                <Flex flex="1" minW="0" minH="0" direction="column" gap={{ base: "2", md: "3" }} pt={{ base: 0, lg: "12" }}>
                    <Box flex="1.5" minH="0">
                        <MatchTickerPanel match={match} />
                    </Box>
                    <Box flex="1.1" minH="0">
                        <GroupTablePanel match={match} />
                    </Box>
                    <Box flexShrink={0}>
                        <UpcomingMatchPanel match={match} />
                    </Box>
                </Flex>
            </Flex>
        </Box>
    )
}
