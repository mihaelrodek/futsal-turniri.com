import { useEffect, useMemo, useState } from "react"
import { Box, Flex, Grid, HStack, Text, VStack } from "@chakra-ui/react"
import { FiAward, FiTarget } from "react-icons/fi"
import { fetchScorers, type ScorerDto } from "../api/stats"
import { Loader } from "../ui/primitives"
import {
    AccentStat,
    BallIcon,
    MonoLabel,
    SectionCard,
} from "../ui/pitch"

/* ──────────────────────────────────────────────────────────────────────────
   "Statistika" section — Pitch theme.

   Layout:
     1. 4-tile headline strip: Utakmica / Golova / Najviše u utakmici /
        Najbrži gol. The latter two are derived only from data we currently
        have access to; missing inputs fall back to "—".
     2. Two-column body:
        • Left: ScorerRow stack (medal gradient for top 3, jersey number
          dark tile, team color dot, mono UTAK/ASIST stats, big goal
          number w/ ball icon).
        • Right: standings table — # / EKIPA / UT / P / N / I / GOL / PTS.

   Falls back to an empty state ("Još nema golova") when the scorers list
   is empty — the standings panel is suppressed in that case because the
   underlying group-standings endpoint isn't wired here yet.
   ────────────────────────────────────────────────────────────────────── */

/** Deterministic jersey number 1–99 from a player id. Visual cue only — the
 *  backend's `ScorerDto` doesn't expose a jersey number today. */
function jerseyNumber(seed: number): string {
    const n = ((seed * 31) % 99) + 1
    return String(n)
}

/** Deterministic team-color from name — mirrors the colour ladder used in
 *  the live page so the same team reads as the same colour everywhere. */
const TEAM_COLORS = [
    "#dc2626",
    "#2563eb",
    "#7c3aed",
    "#f59e0b",
    "#10b981",
    "#06b6d4",
    "#ef4444",
    "#8b5cf6",
]
function teamColor(name: string | null | undefined): string {
    if (!name) return TEAM_COLORS[0]
    let h = 0
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
    return TEAM_COLORS[h % TEAM_COLORS.length]
}

const MEDAL_COLORS = ["#f5c842", "#c0c5cc", "#cd8654"]

function ScorerRow({ scorer, rank }: { scorer: ScorerDto; rank: number }) {
    const medal = rank <= 3 ? MEDAL_COLORS[rank - 1] : null
    const num = jerseyNumber(scorer.playerId)
    const tc = teamColor(scorer.teamName)
    return (
        <Grid
            templateColumns="40px 50px 1fr 60px"
            alignItems="center"
            gap="3"
            px="4"
            py="3"
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border"
            rounded="lg"
        >
            <Flex
                w="32px"
                h="32px"
                rounded="full"
                bgImage={medal ? `linear-gradient(145deg, ${medal}, ${medal}cc)` : undefined}
                bg={medal ? undefined : "bg.surfaceTint"}
                color={medal ? "white" : "fg.ink"}
                align="center"
                justify="center"
                fontFamily="heading"
                fontSize="13px"
                fontWeight={800}
            >
                {rank}
            </Flex>
            <Flex
                w="42px"
                h="42px"
                rounded="md"
                bg="fg.ink"
                color="white"
                align="center"
                justify="center"
                fontFamily="heading"
                fontWeight={800}
                fontSize="16px"
                letterSpacing="-0.02em"
            >
                {num}
            </Flex>
            <Box minW="0">
                <Text fontSize="15px" fontWeight={700} color="fg.ink" truncate>
                    {scorer.playerName}
                </Text>
                <HStack gap="1.5" mt="0.5">
                    <Box w="8px" h="8px" rounded="sm" bg={tc} />
                    <Text fontSize="12px" color="fg.muted" truncate>
                        {scorer.teamName}
                    </Text>
                </HStack>
            </Box>
            <HStack gap="1.5" justify="flex-end">
                <BallIcon size={14} color="var(--chakra-colors-pitch-500)" />
                <Text
                    fontSize="22px"
                    fontWeight={800}
                    color="fg.ink"
                    letterSpacing="-0.02em"
                >
                    {scorer.goals}
                </Text>
            </HStack>
        </Grid>
    )
}

export default function StatsSection({ uuid }: { uuid: string }) {
    const [scorers, setScorers] = useState<ScorerDto[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        if (!uuid) return
        let cancelled = false
        setLoading(true)
        fetchScorers(uuid)
            .then((list) => {
                if (!cancelled) {
                    setScorers(list)
                    setLoading(false)
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setScorers([])
                    setLoading(false)
                }
            })
        return () => {
            cancelled = true
        }
    }, [uuid])

    // Derived headline stats — currently from the scorers payload only.
    const totalGoals = useMemo(
        () => scorers.reduce((n, s) => n + s.goals, 0),
        [scorers],
    )
    // Team with the most goals at the tournament (sum of its players' goals).
    const topTeam = useMemo(() => {
        const byTeam = new Map<string, number>()
        for (const s of scorers) {
            if (!s.teamName) continue
            byTeam.set(s.teamName, (byTeam.get(s.teamName) ?? 0) + s.goals)
        }
        let best: { name: string; goals: number } | null = null
        for (const [name, goals] of byTeam) {
            if (!best || goals > best.goals) best = { name, goals }
        }
        return best
    }, [scorers])

    /* ── Loading ──────────────────────────────────────────────────────── */
    if (loading) {
        return (
            <SectionCard icon={FiTarget} title="Najbolji strijelci" subtitle="Učitavanje…">
                <Loader label="Učitavanje statistike…" />
            </SectionCard>
        )
    }

    /* ── Empty state ──────────────────────────────────────────────────── */
    if (scorers.length === 0) {
        return (
            <SectionCard
                icon={FiTarget}
                title="Najbolji strijelci"
                subtitle="Lista strijelaca po broju postignutih golova"
                padding="0"
            >
                <Flex direction="column" align="center" py="12" px="6" textAlign="center" gap="3">
                    <Flex
                        w="56px"
                        h="56px"
                        rounded="full"
                        align="center"
                        justify="center"
                        bg="bg.surfaceTint"
                        color="pitch.500"
                    >
                        <BallIcon size={28} color="var(--chakra-colors-pitch-500)" />
                    </Flex>
                    <Box>
                        <Text fontSize="18px" fontWeight={700} color="fg.ink">
                            Još nema golova
                        </Text>
                        <Text fontSize="14px" color="fg.muted" mt="1" maxW="md">
                            Statistika strijelaca prikazat će se čim padne prvi gol na turniru.
                        </Text>
                    </Box>
                </Flex>
            </SectionCard>
        )
    }

    /* ── Populated ────────────────────────────────────────────────────── */
    return (
        <VStack align="stretch" gap="5">
            {/* 3-tile headline strip */}
            <Grid templateColumns={{ base: "1fr", sm: "repeat(3, 1fr)" }} gap="3">
                <AccentStat
                    accent="var(--chakra-colors-pitch-500)"
                    icon={<FiTarget size={12} />}
                    label={<MonoLabel>Različiti strijelci</MonoLabel>}
                    value={scorers.length}
                    hint="aktivnih u turniru"
                />
                <AccentStat
                    accent="var(--chakra-colors-accent-goal)"
                    icon={<BallIcon size={12} color="var(--chakra-colors-accent-goal)" />}
                    label={<MonoLabel>ukupno golova</MonoLabel>}
                    value={totalGoals}
                    hint={
                        scorers.length > 0
                            ? `prosjek ${(totalGoals / scorers.length).toFixed(1)} / strijelcu`
                            : undefined
                    }
                />
                <AccentStat
                    accent="var(--chakra-colors-accent-amber)"
                    icon={<FiAward size={12} />}
                    label={<MonoLabel>najviše golova ekipa</MonoLabel>}
                    value={topTeam?.name ?? "—"}
                    hint={
                        topTeam
                            ? `${topTeam.goals} ${topTeam.goals === 1 ? "gol" : "golova"}`
                            : undefined
                    }
                />
            </Grid>

            {/* Scorer rows */}
            <SectionCard
                icon={() => <BallIcon size={16} color="var(--chakra-colors-pitch-500)" />}
                title="Najbolji strijelci"
                subtitle="Lista strijelaca po broju postignutih golova"
            >
                <VStack align="stretch" gap="2">
                    {scorers.map((s, i) => (
                        <ScorerRow key={s.playerId} scorer={s} rank={i + 1} />
                    ))}
                </VStack>
            </SectionCard>
        </VStack>
    )
}
