import { Box, Flex, Grid, HStack, Text, VStack } from "@chakra-ui/react"
import { Link as RouterLink } from "react-router-dom"
import { PulseDot } from "../ui/pitch"
import { LiveClock } from "./liveMatch"
import type { LiveMatch } from "../api/live"

/* ──────────────────────────────────────────────────────────────────────────
   ActiveMatchOverview - a small "there's a match live right now" banner shown
   on the tournament detail page, right below the tabs (the same slot the
   golden "Rezultati turnira" takes once the tournament is over). Purely an
   at-a-glance overview; tapping a card opens that match's own live page.

   Single-court tournaments have one live match at a time, but the list is
   rendered generically so multi-court setups (>1 live) stack cleanly.
   ────────────────────────────────────────────────────────────────────────── */

export default function ActiveMatchOverview({
    matches,
    uuidOrSlug,
}: {
    matches: LiveMatch[]
    /** Slug (preferred) or uuid for the /utakmica/:id deep link. */
    uuidOrSlug: string
}) {
    if (matches.length === 0) return null
    return (
        <VStack align="stretch" gap="2">
            {matches.map((m) => (
                <ActiveMatchCard key={m.matchId} m={m} uuidOrSlug={uuidOrSlug} />
            ))}
        </VStack>
    )
}

function ActiveMatchCard({ m, uuidOrSlug }: { m: LiveMatch; uuidOrSlug: string }) {
    const isTimer = m.liveMode === "TIMER"
    // Shrink the name font once a club name is long so it stays readable and
    // wraps (up to three lines) instead of truncating with an ellipsis.
    const maxLen = Math.max((m.team1Name ?? "").length, (m.team2Name ?? "").length)
    const nameFont = maxLen > 26 ? { base: "12px", md: "14px" } : { base: "14px", md: "16px" }
    return (
        <RouterLink
            to={`/turniri/${uuidOrSlug}/utakmica/${m.matchId}`}
            style={{ textDecoration: "none", color: "inherit", display: "block" }}
        >
            <Box
                bg="bg.panel"
                borderWidth="1px"
                borderColor="border"
                rounded="xl"
                px={{ base: "3", md: "4" }}
                py={{ base: "2.5", md: "3" }}
                transition="box-shadow .15s, transform .15s"
                _hover={{ shadow: "md" }}
                // Faint red ring so it reads as "live" without shouting.
                css={{ boxShadow: "0 0 0 3px rgba(220,38,38,0.06)" }}
            >
                {/* Top strip: UŽIVO pill (left) · clock/phase or a "open" hint (right). */}
                <Flex justify="space-between" align="center" gap="2" mb="1.5">
                    <HStack
                        gap="1"
                        px="2"
                        py="0.5"
                        rounded="full"
                        bg="accent.red"
                        color="white"
                        fontFamily="mono"
                        fontSize="9px"
                        fontWeight={800}
                        letterSpacing="0.1em"
                        flexShrink={0}
                    >
                        <PulseDot color="white" size={5} />
                        UŽIVO
                    </HStack>
                    {isTimer && m.liveStartedAt ? (
                        <LiveClock
                            liveStartedAt={m.liveStartedAt}
                            firstHalfEndedAt={m.firstHalfEndedAt ?? null}
                            secondHalfStartedAt={m.secondHalfStartedAt ?? null}
                            livePausedAt={m.livePausedAt ?? null}
                            halfLengthMin={m.halfLengthMin}
                            halfCount={m.halfCount}
                            showLabel
                        />
                    ) : (
                        <Text fontSize="11px" fontWeight={700} color="pitch.500">
                            NA UTAKMICU →
                        </Text>
                    )}
                </Flex>

                {/* Scoreboard: team1 — score — team2. */}
                <Grid templateColumns="1fr auto 1fr" alignItems="center" gap={{ base: "2", md: "3" }}>
                    <Text
                        fontSize={nameFont}
                        fontWeight={700}
                        color="fg.ink"
                        textAlign="right"
                        lineClamp="3"
                        minW="0"
                    >
                        {m.team1Name ?? "-"}
                    </Text>
                    <Text
                        fontFamily="mono"
                        fontSize={{ base: "22px", md: "26px" }}
                        fontWeight={800}
                        fontVariantNumeric="tabular-nums"
                        color="red.fg"
                        lineHeight="1"
                        flexShrink={0}
                    >
                        {m.score1 ?? 0}
                        <Box as="span" color="border.strong" px={{ base: "1.5", md: "2" }}>
                            :
                        </Box>
                        {m.score2 ?? 0}
                    </Text>
                    <Text
                        fontSize={nameFont}
                        fontWeight={700}
                        color="fg.ink"
                        textAlign="left"
                        lineClamp="3"
                        minW="0"
                    >
                        {m.team2Name ?? "-"}
                    </Text>
                </Grid>
            </Box>
        </RouterLink>
    )
}
