import { useEffect, useMemo, useState } from "react"
import { Box, Flex, HStack, Heading, Input, Text, VStack } from "@chakra-ui/react"
import { FiAward, FiSearch, FiTarget, FiUsers } from "react-icons/fi"
import { useQuery } from "@tanstack/react-query"
import { useSearchParams } from "react-router-dom"
import { fetchGlobalScorers, type GlobalScorer } from "../api/players"
import { fetchTeamMedals } from "../api/stats"
import { MonoLabel, PageTitle, PillTabBar } from "../ui/pitch"
import { useDocumentHead } from "../hooks/useDocumentHead"

/* ──────────────────────────────────────────────────────────────────────────
   StatsPage - all-time statistics, split into two tabs:

   - "Igrači"  - vječna lista strijelaca (unchanged from the single-tab
                 version this replaced): every player's goals summed across
                 every tournament they've ever played, so the same person
                 scoring in multiple events climbs one combined ranking.
   - "Ekipe"   - vječni poredak ekipa: a World-Cup-style medal table, how
                 many times each team finished 1st / 2nd / 3rd across every
                 tournament it's ever played.

   Both rank by (uppercase) name matching - the roster/team-name
   autocomplete elsewhere keeps that consistent. The active tab is mirrored
   into `?tab=` so a shared link / refresh lands back on the same pane.
   ────────────────────────────────────────────────────────────────────── */

type TabKey = "igraci" | "ekipe"
const TAB_KEYS: TabKey[] = ["igraci", "ekipe"]
const TAB_LABELS: Record<TabKey, string> = { igraci: "Igrači", ekipe: "Ekipe" }

// Gold / silver / bronze, shared by the scorer rank column and every medal
// dot + bar segment on the Ekipe tab, so both tabs read as one palette.
const MEDAL_COLORS = { gold: "#f5c842", silver: "#c0c5cc", bronze: "#cd8654" } as const

function rankColor(rank: number): string {
    if (rank === 1) return MEDAL_COLORS.gold
    if (rank === 2) return MEDAL_COLORS.silver
    if (rank === 3) return MEDAL_COLORS.bronze
    return "var(--chakra-colors-fg-muted)"
}

export default function StatsPage() {
    /* ---------- Active-tab persistence ----------
     * Mirror the active tab into the URL so a hard refresh or a shared
     * link lands the user back on the same pane (pattern mirrors the
     * tournament detail page's `?tab=` handling). "igraci" is the default
     * and encoded as "no `tab` param" so the canonical share URL stays
     * clean. */
    const [searchParams, setSearchParams] = useSearchParams()
    const initialTab = ((): TabKey => (searchParams.get("tab") === "ekipe" ? "ekipe" : "igraci"))()
    const [tab, setTab] = useState<TabKey>(initialTab)

    useEffect(() => {
        const next = new URLSearchParams(searchParams)
        if (tab === "igraci") next.delete("tab")
        else next.set("tab", tab)
        if (next.toString() !== searchParams.toString()) {
            setSearchParams(next, { replace: true })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab])

    useDocumentHead({
        title:
            tab === "ekipe"
                ? "Vječni poredak ekipa - futsal-turniri.com"
                : "Vječna lista strijelaca - futsal-turniri.com",
        description:
            tab === "ekipe"
                ? "Vječni poredak ekipa po broju osvojenih zlatnih, srebrnih i brončanih medalja na futsal turnirima."
                : "Vječna lista strijelaca - golovi svih igrača zbrojeni kroz sve futsal turnire na jednom mjestu.",
        canonical: "https://futsal-turniri.com/statistika",
    })

    return (
        <VStack align="stretch" gap="5">
            {/* Tabs come FIRST - each pane carries its own list heading below
                them. No page-level title: it only pushed the content down, and
                the <title>/OG meta still carry "Statistika" for search +
                sharing. */}
            <PillTabBar
                size="sm"
                tabs={TAB_KEYS.map((k) => TAB_LABELS[k])}
                active={TAB_LABELS[tab]}
                onChange={(label) => {
                    const next = TAB_KEYS.find((k) => TAB_LABELS[k] === label)
                    if (next) setTab(next)
                }}
                mb="0"
            />
            {tab === "igraci" ? <IgraciPane /> : <EkipePane />}
        </VStack>
    )
}

/* ── "Igrači" - vječna lista strijelaca (unchanged content, just moved) ── */

function IgraciPane() {
    const [scorers, setScorers] = useState<GlobalScorer[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [query, setQuery] = useState("")

    useEffect(() => {
        let cancelled = false
        fetchGlobalScorers()
            .then((s) => {
                if (!cancelled) setScorers(s)
            })
            .catch((e) => {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : "Neuspješno učitavanje statistike.")
                }
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
                size="sm"
                title="Vječna lista strijelaca"
                action={
                    <HStack
                        gap="2"
                        wrap="wrap"
                        align="center"
                        justify={{ base: "flex-start", md: "flex-end" }}
                        w={{ base: "100%", md: "auto" }}
                    >
                        {!loading && !error && scorers.length > 0 && (
                            <>
                                <SummaryTile label="Različitih strijelaca" value={scorers.length} />
                                <SummaryTile label="Ukupno golova" value={totalGoals} />
                            </>
                        )}
                        {/* Green-accented search so it reads as an ACTION, not a
                            passive grey box - brand-tinted border + icon, green
                            focus ring. */}
                        <Box position="relative" w={{ base: "100%", md: "240px" }}>
                            <Box
                                position="absolute"
                                left="3"
                                top="50%"
                                transform="translateY(-50%)"
                                color="pitch.500"
                                pointerEvents="none"
                            >
                                <FiSearch />
                            </Box>
                            <Input
                                pl="9"
                                size={{ base: "md", md: "sm" }}
                                // Explicit slim height on phones - the md size
                                // recipe's own 40px+ box still read as a big
                                // slab next to the summary tiles. py 0 lets the
                                // text centre in the shorter box.
                                h={{ base: "36px", md: "32px" }}
                                py="0"
                                // iOS Safari auto-zooms the whole page when a
                                // focused input's font-size is < 16px. Pin base
                                // to 16px to stop that jump; md+ keeps the sm
                                // recipe's 14px (no zoom risk on desktop).
                                fontSize={{ base: "16px", md: "sm" }}
                                placeholder="Pretraži igrača…"
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                borderColor="pitch.500"
                                borderWidth="1.5px"
                                bg="brand.subtle"
                                _hover={{ borderColor: "pitch.600" }}
                                _focusVisible={{
                                    borderColor: "pitch.600",
                                    boxShadow: "0 0 0 1px var(--chakra-colors-pitch-600)",
                                }}
                            />
                        </Box>
                    </HStack>
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

/**
 * Compact inline counter ("41 STRIJELACA"). Value and label sit on ONE line and
 * the tile is sized to match the search input's height, so the title, both
 * counters and the search share a single header row instead of the counters
 * stacking value-over-label and pushing the row taller.
 */
function SummaryTile({ label, value }: { label: string; value: number }) {
    return (
        <HStack
            gap="1.5"
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border"
            rounded="md"
            px="2.5"
            h={{ base: "28px", md: "32px" }}
            flexShrink={0}
        >
            <Text fontFamily="heading" fontSize="13px" fontWeight={800} lineHeight={1} color="fg.ink">
                {value}
            </Text>
            <MonoLabel>{label.toUpperCase()}</MonoLabel>
        </HStack>
    )
}

/* ── "Ekipe" - vječni poredak ekipa (World-Cup-style medal table) ── */

function EkipePane() {
    const [query, setQuery] = useState("")
    const { data, isLoading, isError } = useQuery({
        queryKey: ["stats", "teamMedals"] as const,
        queryFn: fetchTeamMedals,
    })
    // Stable reference so the memos below don't re-run every render.
    const medals = useMemo(() => data ?? [], [data])

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        if (!q) return medals
        return medals.filter((m) => m.name.toLowerCase().includes(q))
    }, [medals, query])

    // Every bar's segments are sized relative to the single biggest total
    // haul in the whole table, so the leader's bar reads as (near) full and
    // everyone else visibly trails it.
    const maxTotal = useMemo(
        () => medals.reduce((max, m) => Math.max(max, m.gold + m.silver + m.bronze), 0),
        [medals],
    )


    return (
        <VStack align="stretch" gap="5">
            {isLoading ? (
                <Text color="fg.muted">Učitavanje statistike…</Text>
            ) : isError ? (
                <Text color="accent.red">Neuspješno učitavanje statistike.</Text>
            ) : medals.length === 0 ? (
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
                        <FiUsers size={22} />
                    </Flex>
                    <Heading size="md">Još nema završenih turnira</Heading>
                    <Text fontSize="sm" color="fg.muted" maxW="md">
                        Kad se prvi turnir odigra do kraja, ovdje će rasti vječni poredak ekipa
                        po osvojenim medaljama.
                    </Text>
                </Flex>
            ) : (
                <>
                    {/* Same quiet heading as the Igraci tab, so switching tabs
                        swaps one list title for the other. The medal counts and
                        the rank column in the rows below already say who is on
                        the podium, so there are no separate summary cards. */}
                    <PageTitle
                        size="sm"
                        title="Vječna lista plasmana"
                        action={
                            <Box position="relative" w={{ base: "100%", md: "240px" }}>
                                <Box
                                    position="absolute"
                                    left="3"
                                    top="50%"
                                    transform="translateY(-50%)"
                                    color="pitch.500"
                                    pointerEvents="none"
                                >
                                    <FiSearch />
                                </Box>
                                <Input
                                    pl="9"
                                    size={{ base: "md", md: "sm" }}
                                    h={{ base: "36px", md: "32px" }}
                                    py="0"
                                    fontSize={{ base: "16px", md: "sm" }}
                                    placeholder="Pretraži ekipu…"
                                    value={query}
                                    onChange={(e) => setQuery(e.target.value)}
                                    borderColor="pitch.500"
                                    borderWidth="1.5px"
                                    bg="brand.subtle"
                                    _hover={{ borderColor: "pitch.600" }}
                                    _focusVisible={{
                                        borderColor: "pitch.600",
                                        boxShadow: "0 0 0 1px var(--chakra-colors-pitch-600)",
                                    }}
                                />
                            </Box>
                        }
                    />

                    {filtered.length === 0 ? (
                        <Text fontSize="sm" color="fg.muted" textAlign="center" py="4">
                            Nijedna ekipa ne odgovara pretrazi.
                        </Text>
                    ) : (
                        <VStack align="stretch" gap="1.5">
                            {filtered.map((m) => {
                                // Rank reflects the full list position, not the filtered one.
                                const rank = medals.indexOf(m) + 1
                                return (
                                    <Flex
                                        key={m.name}
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
                                        {/* Name + medal bar */}
                                        <Box flex="1" minW="0">
                                            <Text fontSize="sm" fontWeight={700} color="fg.ink" truncate mb="1.5">
                                                {m.name}
                                            </Text>
                                            <Box
                                                position="relative"
                                                w="100%"
                                                h="6px"
                                                rounded="full"
                                                bg="bg.surfaceTint"
                                                overflow="hidden"
                                            >
                                                <Flex position="absolute" inset="0">
                                                    <Box
                                                        h="100%"
                                                        bg={MEDAL_COLORS.gold}
                                                        w={`${maxTotal > 0 ? (m.gold / maxTotal) * 100 : 0}%`}
                                                    />
                                                    <Box
                                                        h="100%"
                                                        bg={MEDAL_COLORS.silver}
                                                        w={`${maxTotal > 0 ? (m.silver / maxTotal) * 100 : 0}%`}
                                                    />
                                                    <Box
                                                        h="100%"
                                                        bg={MEDAL_COLORS.bronze}
                                                        w={`${maxTotal > 0 ? (m.bronze / maxTotal) * 100 : 0}%`}
                                                    />
                                                </Flex>
                                            </Box>
                                        </Box>
                                        {/* Medal counts */}
                                        <HStack gap="2.5" flexShrink={0}>
                                            <MedalChip color={MEDAL_COLORS.gold} count={m.gold} />
                                            <MedalChip color={MEDAL_COLORS.silver} count={m.silver} />
                                            <MedalChip color={MEDAL_COLORS.bronze} count={m.bronze} />
                                        </HStack>
                                    </Flex>
                                )
                            })}
                        </VStack>
                    )}
                </>
            )}
        </VStack>
    )
}

function MedalChip({ color, count }: { color: string; count: number }) {
    return (
        <HStack gap="1.5" minW="7">
            <Box w="8px" h="8px" rounded="full" bg={color} flexShrink={0} />
            <Text fontSize="xs" fontFamily="mono" fontWeight={700} color="fg.ink" minW="4" textAlign="right">
                {count}
            </Text>
        </HStack>
    )
}
