import { Box, Flex, Text } from "@chakra-ui/react"
import { PulseDot } from "../ui/pitch"

/* ──────────────────────────────────────────────────────────────────────────
   LiveScoreBug - a TV-broadcast-style score overlay for the current live
   match: [live] TEAM 1 | score : score | TEAM 2, with each side accented by
   its jersey colour. Dark, semi-transparent, blurred so it reads over any
   video / display. Used as an overlay on the home stream player (and its
   fullscreen) and pinned to the top of the fullscreen tournament display.

   Full team names are kept (no abbreviations): the font shrinks with the
   longer name and names wrap to two lines so a long one like
   "DŠR Žarovnica & MH System & Bueno Caffe" stays legible.
   ────────────────────────────────────────────────────────────────────────── */

export default function LiveScoreBug({
    team1Name,
    team2Name,
    score1,
    score2,
    color1,
    color2,
    live = true,
    size = "md",
}: {
    team1Name: string | null
    team2Name: string | null
    score1: number
    score2: number
    color1?: string | null
    color2?: string | null
    /** Show the pulsing live marker (default true). */
    live?: boolean
    /** "md" for the video overlay, "lg" for the fullscreen display. */
    size?: "md" | "lg"
}) {
    const maxLen = Math.max((team1Name ?? "").length, (team2Name ?? "").length)
    const lg = size === "lg"

    // Shrink the name font as the longer club name grows so it stays on ≤2
    // lines. Two size scales: overlay (md) and the bigger fullscreen (lg).
    const nameFont = lg
        ? maxLen > 34
            ? { base: "16px", md: "22px" }
            : maxLen > 22
                ? { base: "18px", md: "26px" }
                : { base: "22px", md: "30px" }
        : maxLen > 34
            ? { base: "10px", md: "13px" }
            : maxLen > 22
                ? { base: "11px", md: "15px" }
                : { base: "13px", md: "17px" }
    const scoreFont = lg ? { base: "22px", md: "32px" } : { base: "15px", md: "19px" }
    const nameMaxW = lg ? { base: "34vw", md: "360px" } : { base: "34vw", md: "220px" }

    return (
        <Flex
            align="stretch"
            bg="rgba(15,15,17,0.86)"
            css={{ backdropFilter: "blur(6px)" }}
            rounded={lg ? "xl" : "lg"}
            overflow="hidden"
            borderWidth="1px"
            borderColor="whiteAlpha.200"
            boxShadow="0 6px 20px rgba(0,0,0,0.45)"
            maxW="full"
        >
            {live && (
                <Flex align="center" px={lg ? "3" : "2"} bg="accent.red" flexShrink={0}>
                    <PulseDot color="white" size={lg ? 8 : 6} />
                </Flex>
            )}

            {/* Team 1 - name (right-aligned toward the score) + colour bar. */}
            <Flex align="center" gap="2" pl={lg ? "4" : "3"} pr="2" py={lg ? "2.5" : "1.5"} minW="0">
                <Text
                    color="white"
                    fontWeight={800}
                    fontSize={nameFont}
                    lineHeight="1.1"
                    lineClamp={2}
                    textAlign="right"
                    maxW={nameMaxW}
                    css={{ overflowWrap: "anywhere" }}
                >
                    {team1Name ?? "-"}
                </Text>
                <Box w={lg ? "6px" : "4px"} alignSelf="stretch" rounded="sm" bg={color1 ?? "whiteAlpha.400"} flexShrink={0} />
            </Flex>

            {/* Score. */}
            <Flex align="center" px={lg ? "4" : "3"} bg="blackAlpha.500" flexShrink={0}>
                <Text
                    color="white"
                    fontFamily="mono"
                    fontWeight={800}
                    fontSize={scoreFont}
                    fontVariantNumeric="tabular-nums"
                    whiteSpace="nowrap"
                    lineHeight="1"
                >
                    {score1} : {score2}
                </Text>
            </Flex>

            {/* Team 2 - colour bar + name (left-aligned toward the score). */}
            <Flex align="center" gap="2" pl="2" pr={lg ? "4" : "3"} py={lg ? "2.5" : "1.5"} minW="0">
                <Box w={lg ? "6px" : "4px"} alignSelf="stretch" rounded="sm" bg={color2 ?? "whiteAlpha.400"} flexShrink={0} />
                <Text
                    color="white"
                    fontWeight={800}
                    fontSize={nameFont}
                    lineHeight="1.1"
                    lineClamp={2}
                    textAlign="left"
                    maxW={nameMaxW}
                    css={{ overflowWrap: "anywhere" }}
                >
                    {team2Name ?? "-"}
                </Text>
            </Flex>
        </Flex>
    )
}
