import { useEffect, useMemo, useState } from "react"
import { Box, Flex, Grid, HStack, NativeSelect, Text, VStack } from "@chakra-ui/react"
import { FiAward, FiDownload, FiTarget } from "react-icons/fi"
import { fetchScorers, type ScorerDto } from "../api/stats"
import { setScorerScope } from "../api/tournaments"
import type { ScorerScope, TournamentDetails } from "../types/tournaments"
import { useQueryClient } from "@tanstack/react-query"
import { qk } from "../queryClient"
import { Loader } from "../ui/primitives"
import {
    AccentStat,
    BallIcon,
    GhostButton,
    MonoLabel,
    SectionCard,
} from "../ui/pitch"
import { ExportDialog, type ExportMeta } from "../components/TournamentExport"

/* ──────────────────────────────────────────────────────────────────────────
   "Statistika" section - Pitch theme.

   Layout:
     1. 4-tile headline strip: Utakmica / Golova / Najviše u utakmici /
        Najbrži gol. The latter two are derived only from data we currently
        have access to; missing inputs fall back to "-".
     2. Two-column body:
        • Left: ScorerRow stack (medal gradient for top 3, jersey number
          dark tile, team color dot, mono UTAK/ASIST stats, big goal
          number w/ ball icon).
        • Right: standings table - # / EKIPA / UT / P / N / I / GOL / PTS.

   Falls back to an empty state ("Još nema golova") when the scorers list
   is empty - the standings panel is suppressed in that case because the
   underlying group-standings endpoint isn't wired here yet.
   ────────────────────────────────────────────────────────────────────── */

/** Slim mobile stat chip - the phone-width stand-in for a full AccentStat
 *  card. Three of these share one row (~56px total) where the stacked cards
 *  used to eat ~350px before the search + scorer list became visible. */
function StatChip({
    accent,
    label,
    value,
}: {
    accent: string
    label: string
    value: string | number
}) {
    return (
        <Box
            position="relative"
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border"
            rounded="lg"
            pl="2.5"
            pr="2"
            py="1.5"
            overflow="hidden"
            minW="0"
        >
            <Box position="absolute" top="0" left="0" w="3px" h="100%" bg={accent} />
            <Text
                fontFamily="mono"
                fontSize="9px"
                fontWeight={700}
                letterSpacing="0.08em"
                textTransform="uppercase"
                color="fg.muted"
                truncate
            >
                {label}
            </Text>
            <Text fontSize="15px" fontWeight={800} color="fg.ink" letterSpacing="-0.01em" truncate>
                {value}
            </Text>
        </Box>
    )
}

/** Deterministic jersey number 1–99 from a player id. Visual cue only - the
 *  backend's `ScorerDto` doesn't expose a jersey number today. */
function jerseyNumber(seed: number): string {
    const n = ((seed * 31) % 99) + 1
    return String(n)
}

/** Deterministic team-color from name - mirrors the colour ladder used in
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

/** Croatian label for a scorer-scope option. */
const SCOPE_LABEL: Record<ScorerScope, string> = {
    ALL: "Grupe + eliminacija",
    KNOCKOUT: "Samo eliminacija",
    ROUND_OF_32: "Od šesnaestine finala",
    ROUND_OF_16: "Od osmine finala",
    QUARTERFINAL: "Od četvrtfinala",
    SEMIFINAL: "Od polufinala",
}
const SCOPE_ORDER: ScorerScope[] = [
    "KNOCKOUT",
    "ALL",
    "ROUND_OF_32",
    "ROUND_OF_16",
    "QUARTERFINAL",
    "SEMIFINAL",
]

function ScorerRow({
    scorer,
    rank,
    splitTallies,
}: {
    scorer: ScorerDto
    rank: number
    /** True when group goals don't count - show the full tally next to the
     *  counted one so both reads stay visible. */
    splitTallies: boolean
}) {
    const medal = rank <= 3 ? MEDAL_COLORS[rank - 1] : null
    const num = jerseyNumber(scorer.playerId)
    const tc = teamColor(scorer.teamName)
    const showAll = splitTallies && scorer.goalsAll !== scorer.goals
    return (
        <Grid
            templateColumns="40px 50px 1fr auto"
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
                // Token INVERSION so the number stays legible in BOTH themes:
                // bg.canvas flips opposite fg.ink (light: dark tile + white
                // number; dark: light tile + navy number). A hardcoded white
                // number went invisible on the light-in-dark fg.ink tile.
                bg="fg.ink"
                color="bg.canvas"
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
            <VStack gap="0" align="flex-end">
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
                {/* Full tally incl. the group stage - only when it differs. */}
                {showAll && (
                    <Text
                        fontSize="10px"
                        color="fg.muted"
                        fontWeight={600}
                        whiteSpace="nowrap"
                        lineHeight="1.2"
                    >
                        s grupama {scorer.goalsAll}
                    </Text>
                )}
            </VStack>
        </Grid>
    )
}

export default function StatsSection({
    uuid,
    canEdit = false,
    scorerScope,
    onTournamentChanged,
    exportMeta,
}: {
    uuid: string
    /** Organizer/admin - shows the "which goals count" picker. */
    canEdit?: boolean
    /** The tournament's scorer scope (from the details payload). */
    scorerScope?: ScorerScope | null
    /** Called with the fresh details DTO after the scope is saved. */
    onTournamentChanged?: (t: TournamentDetails) => void
    /** Tournament meta for the "Preuzmi" poster header/QR. When absent (the
     *  parent doesn't thread it yet) the poster falls back to a generic name +
     *  a uuid-based tournament URL - see `effExportMeta`. */
    exportMeta?: ExportMeta
}) {
    const queryClient = useQueryClient()
    // Seed from cache so returning to the Statistika tab paints instantly.
    const cachedScorers = queryClient.getQueryData<ScorerDto[]>(qk.scorers(uuid))
    const [scorers, setScorers] = useState<ScorerDto[]>(cachedScorers ?? [])
    const [loading, setLoading] = useState(!cachedScorers)
    const [savingScope, setSavingScope] = useState(false)
    const [exportOpen, setExportOpen] = useState(false)

    // Poster meta. The parent (TournamentDetailsPage) doesn't thread `exportMeta`
    // into StatsSection yet the way it does for the schedule/groups/bracket tabs,
    // so fall back to a generic name + a uuid-based public URL (the QR endpoint
    // accepts the uuid). Coordinator TODO: pass `exportMeta` for the full header.
    const effExportMeta: ExportMeta = exportMeta ?? {
        tournamentName: "Futsal turnir",
        tournamentUrl: `${window.location.origin}/turniri/${uuid}`,
    }

    const scope: ScorerScope = scorerScope ?? "KNOCKOUT"
    // When group goals don't count, every row shows both tallies.
    const splitTallies = scope !== "ALL"

    useEffect(() => {
        if (!uuid) return
        let cancelled = false
        if (!queryClient.getQueryData(qk.scorers(uuid))) setLoading(true)
        queryClient
            .fetchQuery({ queryKey: qk.scorers(uuid), queryFn: () => fetchScorers(uuid), staleTime: 15_000 })
            .then((list) => {
                if (!cancelled) {
                    // fetchQuery already populated the cache under qk.scorers.
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
        // `scope` in the deps: saving a new scope invalidates the cache, and
        // this rerun refetches the re-ranked list from the backend.
    }, [uuid, queryClient, scope])

    async function changeScope(next: ScorerScope) {
        if (next === scope || savingScope) return
        setSavingScope(true)
        try {
            const updated = await setScorerScope(uuid, next)
            await queryClient.invalidateQueries({ queryKey: qk.scorers(uuid) })
            onTournamentChanged?.(updated)
        } catch {
            // Error toasted by the http interceptor.
        } finally {
            setSavingScope(false)
        }
    }

    // Derived headline stats. Totals use the FULL tally (incl. groups) - the
    // scope only decides the race ranking, not how many goals the tournament
    // actually had.
    const totalGoals = useMemo(
        () => scorers.reduce((n, s) => n + s.goalsAll, 0),
        [scorers],
    )
    // Team with the most goals at the tournament (sum of its players' goals).
    const topTeam = useMemo(() => {
        const byTeam = new Map<string, number>()
        for (const s of scorers) {
            if (!s.teamName) continue
            byTeam.set(s.teamName, (byTeam.get(s.teamName) ?? 0) + s.goalsAll)
        }
        let best: { name: string; goals: number } | null = null
        for (const [name, goals] of byTeam) {
            if (!best || goals > best.goals) best = { name, goals }
        }
        return best
    }, [scorers])

    // The organizer's scope picker (also a read-only badge for visitors).
    const scopeControl = canEdit ? (
        <HStack gap="2" wrap="wrap">
            <Text fontSize="xs" color="fg.muted" fontWeight={600} whiteSpace="nowrap">
                Golovi se broje:
            </Text>
            <NativeSelect.Root size="xs" w="auto" disabled={savingScope}>
                <NativeSelect.Field
                    value={scope}
                    onChange={(e) => changeScope(e.currentTarget.value as ScorerScope)}
                >
                    {SCOPE_ORDER.map((s) => (
                        <option key={s} value={s}>
                            {SCOPE_LABEL[s]}
                        </option>
                    ))}
                </NativeSelect.Field>
                <NativeSelect.Indicator />
            </NativeSelect.Root>
        </HStack>
    ) : (
        <Text fontSize="xs" color="fg.muted" fontWeight={600}>
            Golovi se broje: {SCOPE_LABEL[scope]}
        </Text>
    )

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
            {/* Headline stats. Phone: one slim row of three compact chips so
                the search box and the scorer list surface without scrolling;
                sm+: the familiar 3-tile AccentStat strip. */}
            <Grid templateColumns="repeat(3, 1fr)" gap="2" display={{ base: "grid", sm: "none" }}>
                <StatChip
                    accent="var(--chakra-colors-pitch-500)"
                    label="Strijelci"
                    value={scorers.length}
                />
                <StatChip
                    accent="var(--chakra-colors-accent-goal)"
                    label="Golovi"
                    value={totalGoals}
                />
                <StatChip
                    accent="var(--chakra-colors-accent-amber)"
                    label="Top ekipa"
                    value={topTeam?.name ?? "-"}
                />
            </Grid>
            <Grid templateColumns="repeat(3, 1fr)" gap="3" display={{ base: "none", sm: "grid" }}>
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
                    value={topTeam?.name ?? "-"}
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
                subtitle={
                    splitTallies
                        ? `Poredak: ${SCOPE_LABEL[scope].toLowerCase()} - golovi iz grupa prikazani su odvojeno`
                        : "Lista strijelaca po broju postignutih golova"
                }
                action={
                    <HStack gap="3" wrap="wrap" justify="flex-end">
                        {scopeControl}
                        <GhostButton
                            px="3.5"
                            py="2"
                            fontSize="13px"
                            icon={<FiDownload size={14} />}
                            onClick={() => setExportOpen(true)}
                        >
                            Preuzmi
                        </GhostButton>
                    </HStack>
                }
            >
                <VStack align="stretch" gap="2">
                    {scorers.map((s, i) => (
                        <ScorerRow key={s.playerId} scorer={s} rank={i + 1} splitTallies={splitTallies} />
                    ))}
                </VStack>
            </SectionCard>

            {/* Branded top-scorers poster (PDF / JPG) - same export system as
                the schedule / groups / bracket tabs. */}
            <ExportDialog
                open={exportOpen}
                onClose={() => setExportOpen(false)}
                kind="scorers"
                meta={effExportMeta}
                scorers={scorers}
            />
        </VStack>
    )
}
