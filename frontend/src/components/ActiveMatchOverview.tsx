import { Box, Flex, HStack, Text, VStack } from "@chakra-ui/react"
import { Link as RouterLink } from "react-router-dom"
import { PulseDot } from "../ui/pitch"
import { LiveClock } from "./liveMatch"
import { useTeamColors, TeamKitChip } from "./jersey"
import type { TeamKit } from "../api/tournaments"
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
    compact = false,
}: {
    matches: LiveMatch[]
    /** Slug (preferred) or uuid for the /utakmica/:id deep link. */
    uuidOrSlug: string
    /** Denser variant for the narrow desktop sidebar (~200px column):
     *  smaller padding, fonts and score so the card never overflows. */
    compact?: boolean
}) {
    // All matches here belong to the same tournament → one shared colour fetch.
    const colors = useTeamColors(uuidOrSlug)
    if (matches.length === 0) return null
    return (
        <VStack align="stretch" gap="2">
            {matches.map((m) => (
                <ActiveMatchCard
                    key={m.matchId}
                    m={m}
                    uuidOrSlug={uuidOrSlug}
                    colors={colors}
                    compact={compact}
                />
            ))}
        </VStack>
    )
}

function ActiveMatchCard({
    m,
    uuidOrSlug,
    colors,
    compact,
}: {
    m: LiveMatch
    uuidOrSlug: string
    colors: Record<string, TeamKit>
    compact: boolean
}) {
    const isTimer = m.liveMode === "TIMER"
    // In the stacked (SofaScore-style) layout every team name gets a full row
    // to itself — only its own score sits to the right — so names have far more
    // horizontal room than the old side-by-side scoreboard and can run a size
    // larger before shrinking. Compact still starts smaller since the sidebar
    // column is only ~200px wide; long names wrap (clamped) rather than
    // overflowing.
    const maxLen = Math.max((m.team1Name ?? "").length, (m.team2Name ?? "").length)
    const nameFont = compact
        ? (maxLen > 22 ? "12px" : "13px")
        : maxLen > 30
            ? { base: "13px", md: "15px" }
            : { base: "15px", md: "17px" }
    const scoreFont = compact ? "22px" : { base: "24px", md: "28px" }
    const chipSize = compact ? 12 : 13
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
                px={compact ? "3" : { base: "3", md: "4" }}
                py={compact ? "3" : { base: "2.5", md: "3" }}
                transition="box-shadow .15s, transform .15s"
                _hover={{ shadow: "md" }}
                // Faint red ring so it reads as "live" without shouting.
                css={{ boxShadow: "0 0 0 3px rgba(220,38,38,0.06)" }}
            >
                {/* Top strip: live indicator (left) · running clock (right).
                    The compact sidebar card shows ONLY a small pulsing red dot —
                    the whole card is already a link to the match, so the old
                    "UŽIVO" text badge and the "NA UTAKMICU →" hint are dropped
                    as redundant. The mobile (non-compact) card keeps the fuller
                    UŽIVO pill and the open hint. */}
                <Flex justify="space-between" align="center" gap="2" mb={compact ? "2.5" : "1.5"}>
                    {compact ? (
                        <HStack gap="1.5" flexShrink={0}>
                            <PulseDot color="accent.red" size={8} glow />
                            <Text fontFamily="mono" fontSize="10px" fontWeight={800} letterSpacing="0.1em" color="accent.red">
                                UŽIVO
                            </Text>
                        </HStack>
                    ) : (
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
                    )}
                    {isTimer && m.liveStartedAt ? (
                        <LiveClock
                            liveStartedAt={m.liveStartedAt}
                            firstHalfEndedAt={m.firstHalfEndedAt ?? null}
                            secondHalfStartedAt={m.secondHalfStartedAt ?? null}
                            livePausedAt={m.livePausedAt ?? null}
                            halfLengthMin={m.halfLengthMin}
                            halfCount={m.halfCount}
                            // Drop the phase label in the narrow sidebar so the
                            // clock stays on one line next to the live dot.
                            showLabel={!compact}
                        />
                    ) : compact ? null : (
                        <Text fontSize="11px" fontWeight={700} color="pitch.500">
                            NA UTAKMICU →
                        </Text>
                    )}
                </Flex>

                {/* Scoreboard: team names stacked vertically (gore i dolje),
                    SofaScore-style, each with its own right-aligned score. */}
                <VStack align="stretch" gap={compact ? "2" : "2.5"}>
                    <TeamRow
                        colors={colors}
                        teamId={m.team1Id}
                        name={m.team1Name}
                        score={m.score1}
                        nameFont={nameFont}
                        scoreFont={scoreFont}
                        chipSize={chipSize}
                    />
                    <TeamRow
                        colors={colors}
                        teamId={m.team2Id}
                        name={m.team2Name}
                        score={m.score2}
                        nameFont={nameFont}
                        scoreFont={scoreFont}
                        chipSize={chipSize}
                    />
                </VStack>
            </Box>
        </RouterLink>
    )
}

/** One scoreboard row: kit chip + team name on the left (wraps within the
 *  narrow column, clamped to two lines), the team's OWN score right-aligned in
 *  bold mono. Stacking two of these gives the vertical "name / name" layout
 *  instead of a single centre "score1 : score2" with names on the sides. The
 *  score keeps the app's live red accent (`red.fg`). */
function TeamRow({
    colors,
    teamId,
    name,
    score,
    nameFont,
    scoreFont,
    chipSize,
}: {
    colors: Record<string, TeamKit>
    teamId?: number | null
    name: string | null
    score: number | null
    nameFont: string | { base: string; md: string }
    scoreFont: string | { base: string; md: string }
    chipSize: number
}) {
    return (
        <Flex align="center" gap="2" justify="space-between">
            <HStack gap="2" minW="0" flex="1">
                <TeamKitChip colors={colors} teamId={teamId} size={chipSize} />
                <Text
                    fontSize={nameFont}
                    fontWeight={700}
                    color="fg.ink"
                    lineHeight="1.2"
                    lineClamp="2"
                    minW="0"
                >
                    {name ?? "-"}
                </Text>
            </HStack>
            <Text
                fontFamily="mono"
                fontSize={scoreFont}
                fontWeight={800}
                fontVariantNumeric="tabular-nums"
                color="red.fg"
                lineHeight="1"
                flexShrink={0}
            >
                {score ?? 0}
            </Text>
        </Flex>
    )
}
