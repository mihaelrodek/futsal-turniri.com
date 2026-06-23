import { useState } from "react"
import { Box, chakra, Flex, Text } from "@chakra-ui/react"
import { FiChevronDown, FiChevronRight, FiChevronUp } from "react-icons/fi"
import type { LiveMatch } from "../api/live"
import { GoalscorersPanel, LiveClock, elapsedMinutes } from "./liveMatch"

/* ──────────────────────────────────────────────────────────────────────────
   LiveMatchRow — SofaScore-style live-match row used by the /uzivo page.

   Changes vs original:
     a) "Detalji" toggle is CENTERED horizontally under the score.
     b) Expanded panel shows goalscorers in two columns via GoalscorersPanel
        (team1 left / right-aligned, team2 right / left-aligned).
        LiveMatch has no teamId fields — null is passed and GoalscorersPanel
        auto-detects the two teamIds from the loaded goal events.
     c) For liveMode === "TIMER" the current minute + ticking clock is shown
        ABOVE the score row, centered. Hidden for SIMPLE / null.

   variant:
     "compact" — tighter padding for smaller containers.
     "full"    — roomier padding for the dedicated /uzivo page.
   ────────────────────────────────────────────────────────────────────── */

const RowButton = chakra("button")

function scoreText(n: number | null): string {
    return typeof n === "number" ? String(n) : "–"
}

export function LiveMatchRow({
    match,
    onSelect,
    variant = "compact",
}: {
    match: LiveMatch
    onSelect: (match: LiveMatch) => void
    variant?: "compact" | "full"
}) {
    const [expanded, setExpanded] = useState(false)
    const full = variant === "full"
    const team1 = match.team1Name?.trim() || "Ekipa 1"
    const team2 = match.team2Name?.trim() || "Ekipa 2"

    return (
        <Box
            w="full"
            px={full ? "4" : "3"}
            py={full ? "3.5" : "2.5"}
            rounded={full ? "xl" : "lg"}
            borderWidth={full ? "1px" : "0"}
            borderColor="border"
            bg={full ? "bg.panel" : "transparent"}
            transition="background 0.15s ease"
        >
            {/* Clickable main row */}
            <RowButton
                type="button"
                onClick={() => onSelect(match)}
                textAlign="left"
                w="full"
                cursor="pointer"
                _hover={{ bg: "bg.muted" }}
                rounded="md"
            >
                {/* TIMER mode: current minute above score, centered.
                    Once the 2nd half is under way the clock counts from
                    secondHalfStartedAt and is labelled "2. pol."; otherwise it
                    shows the 1st-half clock. The half length is not fetched on
                    this viewer page, so timing is best-effort (free-running). */}
                {match.liveMode === "TIMER" && (
                    <Flex justify="center" mb="1">
                        <Flex
                            align="center"
                            gap="1"
                            fontSize="xs"
                            fontWeight="bold"
                            color="red.fg"
                            fontVariantNumeric="tabular-nums"
                        >
                            {match.secondHalfStartedAt ? (
                                <>
                                    <LiveClock liveStartedAt={match.secondHalfStartedAt} />
                                    <Text as="span" color="fg.muted" fontWeight="medium">
                                        2. pol.
                                    </Text>
                                </>
                            ) : (
                                <>
                                    <Text as="span">
                                        {elapsedMinutes(match.liveStartedAt)}&apos;
                                    </Text>
                                    <LiveClock liveStartedAt={match.liveStartedAt} />
                                    <Text as="span" color="fg.muted" fontWeight="medium">
                                        1. pol.
                                    </Text>
                                </>
                            )}
                        </Flex>
                    </Flex>
                )}

                <Flex align="center" gap="3">
                    {/* Live red dot */}
                    <Box as="span" boxSize="2" rounded="full" bg="#E53E3E" flexShrink={0} />

                    {/* Teams + score */}
                    <Box flex="1" minW="0">
                        <Flex align="center" gap="2" minW="0">
                            <Text
                                fontSize={full ? "md" : "sm"}
                                fontWeight="semibold"
                                truncate
                                flex="1"
                                minW="0"
                            >
                                {team1}
                            </Text>
                            <Text
                                fontSize={full ? "md" : "sm"}
                                fontWeight="bold"
                                fontVariantNumeric="tabular-nums"
                                color="brand.fg"
                                whiteSpace="nowrap"
                            >
                                {scoreText(match.score1)} : {scoreText(match.score2)}
                            </Text>
                            <Text
                                fontSize={full ? "md" : "sm"}
                                fontWeight="semibold"
                                truncate
                                flex="1"
                                minW="0"
                                textAlign="right"
                            >
                                {team2}
                            </Text>
                        </Flex>
                        <Flex justify="center" mt="1" minW="0">
                            <Text fontSize="xs" color="fg.muted" truncate minW="0">
                                {match.tournamentName}
                            </Text>
                        </Flex>
                    </Box>

                    <Box as="span" color="fg.muted" flexShrink={0}>
                        <FiChevronRight />
                    </Box>
                </Flex>
            </RowButton>

            {/* Expand toggle — centered directly under the score */}
            <Flex justify="center" mt="2">
                <RowButton
                    type="button"
                    display="inline-flex"
                    alignItems="center"
                    gap="1"
                    px="2"
                    py="0.5"
                    cursor="pointer"
                    color="fg.muted"
                    fontSize="xs"
                    fontWeight="medium"
                    _hover={{ color: "fg" }}
                    onClick={() => setExpanded((v) => !v)}
                    background="none"
                    border="none"
                >
                    {expanded ? <FiChevronUp size={13} /> : <FiChevronDown size={13} />}
                    Detalji
                </RowButton>
            </Flex>

            {/* Expandable goalscorers panel */}
            {expanded && (
                <Box mt="2" pt="2" borderTopWidth="1px" borderColor="border" px="1">
                    <GoalscorersPanel
                        tournamentUuid={match.tournamentUuid}
                        matchId={match.matchId}
                        team1Id={null}
                        team2Id={null}
                    />
                </Box>
            )}
        </Box>
    )
}
