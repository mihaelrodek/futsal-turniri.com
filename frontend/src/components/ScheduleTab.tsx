import { useEffect, useState } from "react"
import {
    Box,
    chakra,
    Field,
    Flex,
    HStack,
    Input,
    Text,
    VStack,
} from "@chakra-ui/react"
import { FiCalendar, FiChevronDown, FiChevronUp, FiClock } from "react-icons/fi"
import { LuCalendarClock, LuCalendarX2, LuSettings2 } from "react-icons/lu"
import { fetchSchedule, generateSchedule, updateKickoff } from "../api/schedule"
import type { Schedule, ScheduledMatch } from "../types/schedule"
import { GoalscorersPanel } from "./liveMatch"
import { EmptyState, Loader, Panel } from "../ui/primitives"
import { MonoLabel, PrimaryButton, SectionCard } from "../ui/pitch"
import { buildMatchIcs, downloadIcs } from "../utils/ics"

/* ────────────────────────────────────────────────────────────────────────────
   Schedule tab — match scheduling.

   Behaviour:
     a) Matches sorted: LIVE first, SCHEDULED second, FINISHED last.
        Within each group the original kickoff order is preserved.
     b) LIVE matches rendered with a red border + "UZIVO" badge.
     c) FINISHED and LIVE matches get a centered expand toggle that reveals
        the shared GoalscorersPanel (SofaScore-style event timeline).
        SCHEDULED matches get no expand toggle.
     d) "Format utakmice" config box is hidden once the tournament has
        started (any match is LIVE or FINISHED).
   ─────────────────────────────────────────────────────────────────────────── */

const STAGE_LABEL: Record<string, string> = {
    GROUP: "Grupa",
    ROUND_OF_32: "1/16 finala",
    ROUND_OF_16: "Osmina finala",
    QUARTERFINAL: "Četvrtfinale",
    SEMIFINAL: "Polufinale",
    FINAL: "Finale",
    THIRD_PLACE: "Za 3. mjesto",
}

/**
 * Sort bucket for a schedule row. Lower number = higher in the list.
 *
 * Rationale: a viewer wants the actionable bits at the top of the page.
 *   0 — LIVE              : right now, eyeballs glued.
 *   1 — FINISHED          : final scores, what just happened.
 *   2 — SCHEDULED w/ time : the next thing, kickoff known.
 *   3 — SCHEDULED no time : "TBD" filler, pushed to the bottom so it
 *                           doesn't fragment the timeline above.
 */
function statusOrder(m: ScheduledMatch): number {
    if (m.status === "LIVE") return 0
    if (m.status === "FINISHED") return 1
    if (m.kickoffAt) return 2
    return 3
}

type Cfg = {
    halfCount: string
    halfLengthMin: string
    halftimeBreakMin: string
    breakBetweenMatchesMin: string
    bufferMin: string
}

function isoToLocal(iso: string | null): string {
    if (!iso) return ""
    const d = new Date(iso)
    const p = (n: number) => String(n).padStart(2, "0")
    return (
        `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
        `T${p(d.getHours())}:${p(d.getMinutes())}`
    )
}

function numVal(v: string): number {
    const n = parseInt(v, 10)
    return Number.isFinite(n) ? n : 0
}

/* -- Stage badge --------------------------------------------------------- */
function StageBadge({ stage }: { stage: string }) {
    const label = STAGE_LABEL[stage] ?? stage
    const isGroup = stage === "GROUP"
    return (
        <Box
            as="span"
            px="2"
            py="0.5"
            rounded="full"
            fontSize="2xs"
            fontWeight="semibold"
            letterSpacing="wide"
            textTransform="uppercase"
            bg={isGroup ? "brand.subtle" : "gray.100"}
            color={isGroup ? "brand.fg" : "fg.muted"}
            flexShrink={0}
            whiteSpace="nowrap"
        >
            {label}
        </Box>
    )
}

/* -- Live badge ---------------------------------------------------------- */
function LiveBadge() {
    return (
        <Box
            as="span"
            px="2"
            py="0.5"
            rounded="full"
            fontSize="2xs"
            fontWeight="bold"
            letterSpacing="wide"
            textTransform="uppercase"
            bg="red.subtle"
            color="red.fg"
            flexShrink={0}
            whiteSpace="nowrap"
        >
            &#x25CF; Uživo
        </Box>
    )
}

/* -- Config field -------------------------------------------------------- */
function CfgField({
    label,
    value,
    onChange,
}: {
    label: string
    value: string
    onChange: (v: string) => void
}) {
    return (
        <Field.Root>
            <Field.Label
                fontSize="2xs"
                fontWeight="semibold"
                letterSpacing="wider"
                textTransform="uppercase"
                color="fg.muted"
                mb="1"
            >
                {label}
            </Field.Label>
            <Input
                size="sm"
                type="number"
                inputMode="numeric"
                rounded="xl"
                textAlign="center"
                fontWeight="semibold"
                value={value}
                onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
            />
        </Field.Root>
    )
}

const RowButton = chakra("button")

/* -- Match row ----------------------------------------------------------- */
function MatchRow({
    match,
    tournamentUuid,
    tournamentName,
    tournamentLocation,
    tournamentSlug,
    slotMinutes,
    onTimeChange,
    canEdit,
}: {
    match: ScheduledMatch
    tournamentUuid: string
    /** Surfaced into the ICS SUMMARY so the calendar entry reads
     *  "Team A vs Team B — Tournament name". */
    tournamentName: string
    /** Optional venue carried into the ICS LOCATION field. */
    tournamentLocation?: string | null
    /** Slug used to build the deep-link back to the match page in the
     *  ICS URL + DESCRIPTION. */
    tournamentSlug?: string | null
    /** Total slot duration in minutes — used as the calendar event's
     *  default end time when the schedule has no explicit one. */
    slotMinutes: number
    onTimeChange: (m: ScheduledMatch, localValue: string) => void
    /** Owner / admin only — kickoff time editor goes read-only when false. */
    canEdit: boolean
}) {
    const [expanded, setExpanded] = useState(false)
    const hasScore = match.score1 != null && match.score2 != null
    const isLive = match.status === "LIVE"
    const isFinished = match.status === "FINISHED"
    const canExpand = isLive || isFinished
    // Scoreboard layout (team-left / score / team-right) for both LIVE
    // and FINISHED — mirrors the LivePage card design so the user has
    // one consistent mental model across the two screens.
    const scoreboard = isLive || isFinished

    function addToCalendar() {
        if (!match.kickoffAt) return
        const start = new Date(match.kickoffAt)
        const end = new Date(start.getTime() + Math.max(slotMinutes, 30) * 60 * 1000)
        const t1 = match.team1Name ?? "—"
        const t2 = match.team2Name ?? "—"
        const url = tournamentSlug
            ? `${window.location.origin}/turniri/${tournamentSlug}`
            : `${window.location.origin}/turniri/${tournamentUuid}`
        const ics = buildMatchIcs({
            uid: `match-${match.matchId}@nogometni-turniri.com`,
            summary: `${t1} vs ${t2} — ${tournamentName}`,
            location: tournamentLocation ?? undefined,
            description: `${tournamentName}`,
            url,
            start,
            end,
        })
        const safeName = `${t1}-${t2}`.replace(/[^a-z0-9\-]+/gi, "_").slice(0, 40)
        downloadIcs(`utakmica-${safeName}.ics`, ics)
    }

    return (
        <Panel
            px="4"
            py="3"
            borderColor={isLive ? "red.emphasized" : "border"}
            borderWidth={isLive ? "2px" : "1px"}
        >
            <VStack align="stretch" gap={{ base: "2", sm: "2.5" }}>
                {/* Meta header — stage + (live) badges on the left, the
                    kickoff control on the right. Kept on its own line so it
                    can never push the teams/score grid below out of column
                    alignment between rows (the old layout drifted the score
                    whenever a UŽIVO badge widened the left cluster). */}
                <Flex align="center" justify="space-between" gap="2" wrap="wrap">
                    <HStack gap="2" minW="0" wrap="wrap">
                        <StageBadge stage={match.stage} />
                        {isLive && <LiveBadge />}
                    </HStack>
                    <HStack gap="2" flexShrink={0}>
                        {!scoreboard && match.kickoffAt && (
                            <RowButton
                                type="button"
                                display="inline-flex"
                                alignItems="center"
                                gap="1"
                                px="2"
                                py="1"
                                cursor="pointer"
                                color="pitch.500"
                                fontSize="xs"
                                fontWeight="medium"
                                bg="bg.surfaceTint"
                                border="1px solid"
                                borderColor="border"
                                borderRadius="md"
                                _hover={{ bg: "pitch.50" }}
                                onClick={(e: React.MouseEvent) => {
                                    e.stopPropagation()
                                    addToCalendar()
                                }}
                                aria-label="Dodaj u kalendar"
                            >
                                <FiCalendar size={12} />
                                Kalendar
                            </RowButton>
                        )}
                        {canEdit ? (
                            <chakra.input
                                type="datetime-local"
                                value={isoToLocal(match.kickoffAt)}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                                    onTimeChange(match, e.target.value)
                                }
                                css={{
                                    border: "1px solid var(--chakra-colors-border)",
                                    borderRadius: "var(--chakra-radii-md)",
                                    padding: "3px 8px",
                                    fontSize: "0.75rem",
                                    fontFamily: "inherit",
                                    color: "var(--chakra-colors-fg)",
                                    background: "var(--chakra-colors-bg-panel)",
                                    outline: "none",
                                    cursor: "pointer",
                                    flexShrink: 0,
                                    minWidth: 0,
                                    maxWidth: "100%",
                                    _focus: {
                                        boxShadow: "0 0 0 2px var(--chakra-colors-brand-focusRing)",
                                        borderColor: "var(--chakra-colors-brand-solid)",
                                    },
                                }}
                            />
                        ) : match.kickoffAt ? (
                            <HStack
                                gap="1"
                                fontSize="xs"
                                fontWeight="600"
                                color="fg.muted"
                                fontFamily="mono"
                            >
                                <FiClock size={11} />
                                <Box>
                                    {(() => {
                                        const v = isoToLocal(match.kickoffAt)
                                        if (!v) return "—"
                                        // YYYY-MM-DDTHH:MM → "DD.MM. HH:MM"
                                        const [d, t] = v.split("T")
                                        const [y, m, day] = d.split("-")
                                        return `${day}.${m}. ${t} ${y === new Date().getFullYear().toString() ? "" : y}`.trim()
                                    })()}
                                </Box>
                            </HStack>
                        ) : (
                            <Text fontSize="xs" color="fg.subtle">
                                Termin nije određen
                            </Text>
                        )}
                    </HStack>
                </Flex>

                {/* Teams + score — one fixed 3-column grid used for EVERY
                    row (live, finished, scheduled). team1 is right-aligned
                    to the centre score box, team2 left-aligned, so the
                    score column lines up perfectly straight down the list.
                    Scheduled matches show a muted "vs" in the same slot. */}
                <Box
                    display="grid"
                    gridTemplateColumns="1fr auto 1fr"
                    alignItems="center"
                    gap={{ base: "2", sm: "4" }}
                >
                    <Text
                        fontSize="sm"
                        fontWeight={700}
                        color="fg.ink"
                        textAlign="right"
                        truncate
                    >
                        {match.team1Name ?? "—"}
                    </Text>
                    <Box
                        fontFamily="mono"
                        fontSize={scoreboard ? "lg" : "sm"}
                        fontWeight={scoreboard ? 800 : 600}
                        letterSpacing="-0.02em"
                        color={isLive ? "red.fg" : scoreboard ? "fg.ink" : "fg.muted"}
                        bg={isLive ? "red.subtle" : scoreboard ? "bg.surfaceTint" : "transparent"}
                        px="3"
                        py="1"
                        rounded="lg"
                        minW="72px"
                        textAlign="center"
                        fontVariantNumeric="tabular-nums"
                    >
                        {hasScore
                            ? `${match.score1}:${match.score2}`
                            : scoreboard
                                ? "—"
                                : "vs"}
                    </Box>
                    <Text
                        fontSize="sm"
                        fontWeight={700}
                        color="fg.ink"
                        textAlign="left"
                        truncate
                    >
                        {match.team2Name ?? "—"}
                    </Text>
                </Box>
            </VStack>

            {/* Expand toggle — centered, only for LIVE and FINISHED */}
            {canExpand && (
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
            )}

            {canExpand && expanded && (
                <Box mt="2" pt="2" borderTopWidth="1px" borderColor="border" px="1">
                    <GoalscorersPanel
                        tournamentUuid={tournamentUuid}
                        matchId={match.matchId}
                        team1Id={match.team1Id ?? null}
                        team2Id={match.team2Id ?? null}
                    />
                </Box>
            )}
        </Panel>
    )
}

/* -- Main export --------------------------------------------------------- */
/** `canEdit` — owner/admin gate for the mutating actions: format config
 *  inputs, generate-schedule button, and per-match kickoff edits. When
 *  false the user sees a read-only schedule. */
export default function ScheduleTab({
    uuid,
    canEdit = false,
    tournamentName,
    tournamentLocation,
    tournamentSlug,
}: {
    uuid: string
    canEdit?: boolean
    /** Surfaced into the per-match ICS export. The tournament name lands
     *  in the SUMMARY ("Team A vs Team B — Open Split 2026"), the
     *  location in LOCATION, and the slug in URL so the calendar entry
     *  links back to the match's tournament page. */
    tournamentName?: string
    tournamentLocation?: string | null
    tournamentSlug?: string | null
}) {
    const [schedule, setSchedule] = useState<Schedule | null>(null)
    const [loading, setLoading] = useState(true)
    const [generating, setGenerating] = useState(false)
    const [cfg, setCfg] = useState<Cfg>({
        halfCount: "2",
        halfLengthMin: "10",
        halftimeBreakMin: "5",
        breakBetweenMatchesMin: "5",
        bufferMin: "5",
    })

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        fetchSchedule(uuid)
            .then((s) => {
                if (cancelled) return
                setSchedule(s)
                setCfg({
                    halfCount: s.halfCount != null ? String(s.halfCount) : "2",
                    halfLengthMin: s.halfLengthMin != null ? String(s.halfLengthMin) : "10",
                    halftimeBreakMin:
                        s.halftimeBreakMin != null ? String(s.halftimeBreakMin) : "5",
                    breakBetweenMatchesMin:
                        s.breakBetweenMatchesMin != null
                            ? String(s.breakBetweenMatchesMin)
                            : "5",
                    bufferMin: s.bufferMin != null ? String(s.bufferMin) : "5",
                })
            })
            .catch(() => {
                if (!cancelled) setSchedule(null)
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })
        return () => {
            cancelled = true
        }
    }, [uuid])

    const slot =
        numVal(cfg.halfCount) * numVal(cfg.halfLengthMin) +
        numVal(cfg.halftimeBreakMin) +
        numVal(cfg.breakBetweenMatchesMin) +
        numVal(cfg.bufferMin)

    async function runGenerate() {
        setGenerating(true)
        try {
            const s = await generateSchedule(uuid, {
                halfCount: numVal(cfg.halfCount),
                halfLengthMin: numVal(cfg.halfLengthMin),
                halftimeBreakMin: numVal(cfg.halftimeBreakMin),
                breakBetweenMatchesMin: numVal(cfg.breakBetweenMatchesMin),
                bufferMin: numVal(cfg.bufferMin),
            })
            setSchedule(s)
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setGenerating(false)
        }
    }

    async function onTimeChange(m: ScheduledMatch, localValue: string) {
        if (!localValue) return
        try {
            const iso = new Date(localValue).toISOString()
            setSchedule(await updateKickoff(uuid, m.matchId, iso))
        } catch {
            /* error toast surfaced by the http interceptor */
        }
    }

    if (loading) {
        return <Loader label="Učitavanje rasporeda..." />
    }

    const rawMatches = schedule?.matches ?? []

    // Sort: LIVE first, SCHEDULED second, FINISHED last.
    // Array.sort is stable in V8/modern engines — kickoff order preserved within groups.
    // Bucket sort by status, then within each bucket preserve the
    // backend's original kickoff order so a tournament's chronology
    // stays intact above the TBD tail.
    const matches = [...rawMatches]
        .map((m, i) => ({ m, i }))
        .sort((a, b) => {
            const oa = statusOrder(a.m)
            const ob = statusOrder(b.m)
            if (oa !== ob) return oa - ob
            return a.i - b.i
        })
        .map((x) => x.m)

    // Tournament has started if any match is LIVE or FINISHED.
    const tournamentStarted = rawMatches.some(
        (m) => m.status === "LIVE" || m.status === "FINISHED",
    )

    return (
        <VStack align="stretch" gap="5" py="2">
            {/* ── Format utakmice — Pitch SectionCard ─────────────────────
                 5-col grid of mini-stat inputs + computed slot footer +
                 Generiraj raspored CTA in the card header. Hidden once
                 the tournament has started (any match LIVE/FINISHED), and
                 also hidden for non-organizers — schedule generation is a
                 destructive owner-only action. */}
            {canEdit && !tournamentStarted && (
                <SectionCard
                    icon={LuSettings2}
                    title="Format utakmice"
                    subtitle="Trajanje, poluvremena i pauze između utakmica"
                    action={
                        <PrimaryButton
                            onClick={runGenerate}
                            disabled={generating}
                            icon={<LuCalendarClock size={14} />}
                        >
                            {generating ? "Generiranje…" : "Generiraj raspored"}
                        </PrimaryButton>
                    }
                >
                    <Box
                        display="grid"
                        gridTemplateColumns={{ base: "1fr 1fr", md: "repeat(5, 1fr)" }}
                        gap="3"
                    >
                        <CfgField
                            label="Poluvremena"
                            value={cfg.halfCount}
                            onChange={(v) => setCfg((c) => ({ ...c, halfCount: v }))}
                        />
                        <CfgField
                            label="Min / poluvrijeme"
                            value={cfg.halfLengthMin}
                            onChange={(v) => setCfg((c) => ({ ...c, halfLengthMin: v }))}
                        />
                        <CfgField
                            label="Pauza poluvrijeme"
                            value={cfg.halftimeBreakMin}
                            onChange={(v) => setCfg((c) => ({ ...c, halftimeBreakMin: v }))}
                        />
                        <CfgField
                            label="Pauza između"
                            value={cfg.breakBetweenMatchesMin}
                            onChange={(v) => setCfg((c) => ({ ...c, breakBetweenMatchesMin: v }))}
                        />
                        <CfgField
                            label="Buffer"
                            value={cfg.bufferMin}
                            onChange={(v) => setCfg((c) => ({ ...c, bufferMin: v }))}
                        />
                    </Box>
                    {/* Computed-duration info bar */}
                    <Flex
                        mt="4"
                        align="center"
                        justify="space-between"
                        bg="bg.surfaceTint"
                        rounded="md"
                        px="4"
                        py="3"
                        gap="3"
                        wrap="wrap"
                    >
                        <HStack gap="2">
                            <FiClock size={14} />
                            <Text fontSize="13px" color="fg.ink" fontWeight={600}>
                                Trajanje termina:
                            </Text>
                            <Box
                                fontFamily="mono"
                                fontSize="15px"
                                color="pitch.500"
                                fontWeight={800}
                            >
                                {slot} min
                            </Box>
                        </HStack>
                        <MonoLabel>UKUPNO TERMINA ZA SVE UTAKMICE</MonoLabel>
                    </Flex>
                </SectionCard>
            )}

            {/* Match list */}
            {matches.length === 0 ? (
                <Panel>
                    <EmptyState
                        icon={LuCalendarX2}
                        title="Nema utakmica"
                        description="Još nema utakmica. Izvuci grupe ili generiraj eliminacijsku ljestvicu, pa generiraj raspored."
                    />
                </Panel>
            ) : (
                <SectionCard
                    icon={LuCalendarClock}
                    title="Raspored utakmica"
                    subtitle={`${matches.length} ${matches.length === 1 ? "utakmica" : "utakmica"}`}
                    padding="4"
                >
                    <VStack align="stretch" gap="2">
                        {matches.map((m) => (
                            <MatchRow
                                key={m.matchId}
                                match={m}
                                tournamentUuid={uuid}
                                tournamentName={tournamentName ?? "Futsal turnir"}
                                tournamentLocation={tournamentLocation}
                                tournamentSlug={tournamentSlug}
                                slotMinutes={slot}
                                onTimeChange={onTimeChange}
                                canEdit={canEdit}
                            />
                        ))}
                    </VStack>
                </SectionCard>
            )}
        </VStack>
    )
}
