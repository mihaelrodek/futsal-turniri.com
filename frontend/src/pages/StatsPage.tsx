import { useEffect, useMemo, useState } from "react"
import { Box, Flex, HStack, Heading, Input, Text, VStack } from "@chakra-ui/react"
import { FiAward, FiSearch, FiTarget } from "react-icons/fi"
import { fetchGlobalScorers, type GlobalScorer } from "../api/players"
import { MonoLabel, PageTitle } from "../ui/pitch"
import { useDocumentHead } from "../hooks/useDocumentHead"

/* ──────────────────────────────────────────────────────────────────────────
   StatsPage — "Vječna lista strijelaca".

   The all-time scorer list: every player's goals summed across every
   tournament they've ever played, so the same person scoring in multiple
   events climbs one combined ranking. Players are matched by their
   (uppercase) name — the roster autocomplete keeps that consistent.

   Ranking: goals desc, then best-scorer awards desc (a player who's been a
   tournament's top scorer outranks an equal-goal player who hasn't), then
   name. The backend already returns the list pre-sorted; we only filter by
   the search box here.
   ────────────────────────────────────────────────────────────────────── */

function rankColor(rank: number): string {
    if (rank === 1) return "#f5c842"
    if (rank === 2) return "#c0c5cc"
    if (rank === 3) return "#cd8654"
    return "var(--chakra-colors-fg-muted)"
}

export default function StatsPage() {
    const [scorers, setScorers] = useState<GlobalScorer[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [query, setQuery] = useState("")

    useDocumentHead({
        title: "Vječna lista strijelaca — nogometni-turniri.com",
        description:
            "Vječna lista strijelaca — golovi svih igrača zbrojeni kroz sve futsal turnire na jednom mjestu.",
        canonical: "https://nogometni-turniri.com/statistika",
    })

    useEffect(() => {
        let cancelled = false
        fetchGlobalScorers()
            .then((s) => {
                if (!cancelled) setScorers(s)
            })
            .catch((e: any) => {
                if (!cancelled) setError(e?.message ?? "Neuspješno učitavanje statistike.")
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [])

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        if (!q) return scorers
        return scorers.filter((s) => s.name.toLowerCase().includes(q))
    }, [scorers, query])

    const totalGoals = useMemo(
        () => scorers.reduce((sum, s) => sum + s.goals, 0),
        [scorers],
    )

    return (
        <VStack align="stretch" gap="5">
            {/* Title on the left; summary tiles + search pulled up to the
                right of it so they share the header row instead of stacking
                below. Wraps to full width under the title on mobile. */}
            <PageTitle
                kicker="STATISTIKA · SVI TURNIRI"
                title="Vječna lista strijelaca"
                subtitle="Golovi svih igrača zbrojeni kroz sve turnire."
                action={
                    <VStack
                        align={{ base: "stretch", md: "flex-end" }}
                        gap="2.5"
                        w={{ base: "100%", md: "auto" }}
                    >
                        {!loading && !error && scorers.length > 0 && (
                            <HStack gap="3" justify={{ base: "flex-start", md: "flex-end" }}>
                                <SummaryTile label="Strijelaca" value={scorers.length} />
                                <SummaryTile label="Ukupno golova" value={totalGoals} />
                            </HStack>
                        )}
                        <Box position="relative" w={{ base: "100%", md: "280px" }}>
                            <Box
                                position="absolute"
                                left="3"
                                top="50%"
                                transform="translateY(-50%)"
                                color="fg.muted"
                                pointerEvents="none"
                            >
                                <FiSearch />
                            </Box>
                            <Input
                                pl="9"
                                size="sm"
                                placeholder="Pretraži igrača…"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                            />
                        </Box>
                    </VStack>
                }
            />

            {loading ? (
                <Text color="fg.muted">Učitavanje statistike…</Text>
            ) : error ? (
                <Text color="accent.red">{error}</Text>
            ) : scorers.length === 0 ? (
                <Flex direction="column" align="center" py="12" px="4" gap="3" textAlign="center">
                    <Flex
                        w="56px"
                        h="56px"
                        rounded="full"
                        align="center"
                        justify="center"
                        bg="bg.surfaceTint"
                        color="pitch.500"
                    >
                        <FiTarget size={22} />
                    </Flex>
                    <Heading size="md">Još nema zabilježenih golova</Heading>
                    <Text fontSize="sm" color="fg.muted" maxW="md">
                        Kad organizatori počnu bilježiti golove uživo, ovdje će rasti vječna
                        lista strijelaca.
                    </Text>
                </Flex>
            ) : filtered.length === 0 ? (
                <Text fontSize="sm" color="fg.muted" textAlign="center" py="4">
                    Nijedan igrač ne odgovara pretrazi.
                </Text>
            ) : (
                <VStack align="stretch" gap="1.5">
                    {filtered.map((s) => {
                        // Rank reflects the full list position, not the filtered one.
                        const rank = scorers.indexOf(s) + 1
                        return (
                            <Flex
                                key={s.name}
                                align="center"
                                gap="3"
                                px="3"
                                py="2.5"
                                rounded="lg"
                                borderWidth="1px"
                                borderColor="border"
                                bg="bg.panel"
                            >
                                {/* Rank */}
                                <Box
                                    minW="8"
                                    textAlign="center"
                                    fontFamily="mono"
                                    fontSize="15px"
                                    fontWeight={800}
                                    color={rankColor(rank)}
                                >
                                    {rank}
                                </Box>
                                {/* Name + awards */}
                                <Box flex="1" minW="0">
                                    <Text fontSize="sm" fontWeight={700} color="fg.ink" truncate>
                                        {s.name}
                                    </Text>
                                    <HStack gap="2" mt="0.5" color="fg.muted" wrap="wrap">
                                        <Text fontSize="xs">
                                            {s.tournamentsPlayed}{" "}
                                            {s.tournamentsPlayed === 1 ? "turnir" : "turnira"}
                                        </Text>
                                        {s.bestScorerAwards > 0 && (
                                            <HStack gap="1" color="pitch.600">
                                                <FiAward size={11} />
                                                <Text fontSize="xs" fontWeight={600}>
                                                    {s.bestScorerAwards}× najbolji strijelac
                                                </Text>
                                            </HStack>
                                        )}
                                    </HStack>
                                </Box>
                                {/* Goals */}
                                <Flex
                                    direction="column"
                                    align="center"
                                    justify="center"
                                    minW="14"
                                    px="2.5"
                                    py="1"
                                    rounded="md"
                                    bg="pitch.50"
                                    color="pitch.600"
                                >
                                    <Text fontFamily="heading" fontSize="18px" fontWeight={800} lineHeight={1}>
                                        {s.goals}
                                    </Text>
                                    <MonoLabel color="pitch.600">GOL</MonoLabel>
                                </Flex>
                            </Flex>
                        )
                    })}
                </VStack>
            )}
        </VStack>
    )
}

function SummaryTile({ label, value }: { label: string; value: number }) {
    return (
        <Box
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border"
            rounded="lg"
            px="4"
            py="2.5"
            minW="120px"
        >
            <Text fontFamily="heading" fontSize="22px" fontWeight={800} lineHeight={1} color="fg.ink">
                {value}
            </Text>
            <MonoLabel>{label.toUpperCase()}</MonoLabel>
        </Box>
    )
}
