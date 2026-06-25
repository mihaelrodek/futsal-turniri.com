import { useEffect, useState } from "react"
import {
    Box,
    Button,
    chakra,
    Field,
    Flex,
    HStack,
    Input,
    NativeSelect,
    Text,
    VStack,
} from "@chakra-ui/react"
import { FiCalendar, FiChevronDown, FiChevronUp, FiClock, FiFilter } from "react-icons/fi"
import { LuCalendarClock, LuCalendarX2, LuSettings2 } from "react-icons/lu"
import { confirmSchedule, fetchSchedule, generateSchedule, updateKickoff } from "../api/schedule"
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

/** Kickoff time in ms for sorting; matches without a time sort to the end. */
function kickoffMs(m: ScheduledMatch): number {
    return m.kickoffAt ? new Date(m.kickoffAt).getTime() : Number.POSITIVE_INFINITY
}

// Half count is fixed at 2 (a futsal match is always two halves) — no config.
const HALF_COUNT = 2

type Cfg = {
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
function StageBadge({ stage, groupName }: { stage: string; groupName?: string | null }) {
    const isGroup = stage === "GROUP"
    // For group matches show which group ("Grupa A"); knockout keeps its
    // phase label ("Polufinale", "Finale", …).
    const label = isGroup
        ? groupName
            ? `Grupa ${groupName}`
            : "Grupa"
        : STAGE_LABEL[stage] ?? stage
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

/* -- Read-only format-setting tile (label + value) ----------------------- */
function SettingStat({ label, value }: { label: string; value: string }) {
    return (
        <Box bg="bg.surfaceTint" rounded="md" px="3" py="2.5" textAlign="center">
            <Text
                fontFamily="mono"
                fontSize="9px"
                fontWeight={800}
                letterSpacing="0.1em"
                color="fg.muted"
                textTransform="uppercase"
                mb="1"
            >
                {label}
            </Text>
            <Text
                fontFamily="heading"
                fontSize="18px"
                fontWeight={800}
                color="fg.ink"
                letterSpacing="-0.02em"
            >
                {value}
            </Text>
        </Box>
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
    isNext = false,
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
    /** True for the single next-to-start (earliest scheduled) match — gets a
     *  red border so the organizer sees what's on deck. */
    isNext?: boolean
}) {
    const [expanded, setExpanded] = useState(false)
    const hasScore = match.score1 != null && match.score2 != null
    const isLive = match.status === "LIVE"
    const isFinished = match.status === "FINISHED"
    const canExpand = true // any match expands to show its timeline (tijek)
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
            uid: `match-${match.matchId}@futsal-turniri.com`,
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
            py="2"
            borderColor={isLive || isNext ? "red.emphasized" : "border"}
            borderWidth={isLive || isNext ? "2px" : "1px"}
        >
            <VStack align="stretch" gap="1">
                {/* Meta header — one compact row: stage badge (+live) on the
                    left, kickoff time/editor centred, "Dodaj u kalendar" on
                    the right. Equal flex on the two side clusters keeps the
                    time visually centred regardless of badge width. */}
                <Flex align="center" gap="2" wrap="wrap">
                    {/* Left: stage + live/next badges */}
                    <HStack gap="2" minW="0" flex="1" wrap="wrap">
                        <StageBadge stage={match.stage} groupName={match.groupName} />
                        {isLive && <LiveBadge />}
                        {/* "Na redu" tag for the next match to start. */}
                        {isNext && !isLive && (
                            <Box
                                as="span"
                                px="2"
                                py="0.5"
                                rounded="full"
                                bg="red.subtle"
                                color="red.fg"
                                fontFamily="mono"
                                fontSize="9px"
                                fontWeight={800}
                                letterSpacing="0.1em"
                                textTransform="uppercase"
                                flexShrink={0}
                                whiteSpace="nowrap"
                            >
                                Na redu
                            </Box>
                        )}
                    </HStack>

                    {/* Center: kickoff time / editor */}
                    <Box flexShrink={0}>
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
                                    fontSize: "0.8rem",
                                    fontFamily: "inherit",
                                    color: "var(--chakra-colors-fg)",
                                    background: "var(--chakra-colors-bg-panel)",
                                    outline: "none",
                                    cursor: "pointer",
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
                                gap="1.5"
                                fontSize="sm"
                                fontWeight="600"
                                color="fg.muted"
                                fontFamily="mono"
                            >
                                <FiClock size={12} />
                                <Box>
                                    {(() => {
                                        const v = isoToLocal(match.kickoffAt)
                                        if (!v) return "—"
                                        // YYYY-MM-DDTHH:MM → "DD.MM.YYYY HH:MM"
                                        const [d, t] = v.split("T")
                                        const [y, m, day] = d.split("-")
                                        return `${day}.${m}.${y} ${t}`
                                    })()}
                                </Box>
                            </HStack>
                        ) : (
                            <Text fontSize="xs" color="fg.subtle">
                                Termin nije određen
                            </Text>
                        )}
                    </Box>

                    {/* Right: add to calendar (scheduled matches only) */}
                    <Flex flex="1" justify="flex-end" minW="0">
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
                                flexShrink={0}
                            >
                                <FiCalendar size={12} />
                                Dodaj u kalendar
                            </RowButton>
                        )}
                    </Flex>
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
                    cursor="pointer"
                    onClick={() => setExpanded((v) => !v)}
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
                        hideEmpty={!isLive}
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
    focusMatchId = null,
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
    /** When set (arriving from a /uzivo upcoming-match click), that match's
     *  row is scrolled into view + briefly highlighted. */
    focusMatchId?: number | null
}) {
    const [schedule, setSchedule] = useState<Schedule | null>(null)
    const [loading, setLoading] = useState(true)
    const [generating, setGenerating] = useState(false)
    const [confirming, setConfirming] = useState(false)
    /** Team id (as string) to filter the schedule by; "" = all teams. */
    const [teamFilter, setTeamFilter] = useState<string>("")
    const [cfg, setCfg] = useState<Cfg>({
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

    // Scroll to + highlight the match the user tapped on /uzivo. Runs once
    // the schedule has loaded so the target row exists in the DOM.
    useEffect(() => {
        if (focusMatchId == null || loading) return
        const el = document.getElementById(`sched-match-${focusMatchId}`)
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" })
    }, [focusMatchId, loading, schedule])

    const slot =
        HALF_COUNT * numVal(cfg.halfLengthMin) +
        numVal(cfg.halftimeBreakMin) +
        numVal(cfg.breakBetweenMatchesMin) +
        numVal(cfg.bufferMin)

    async function runGenerate() {
        setGenerating(true)
        try {
            const s = await generateSchedule(uuid, {
                halfCount: HALF_COUNT,
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

    async function runConfirm() {
        setConfirming(true)
        try {
            setSchedule(await confirmSchedule(uuid))
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setConfirming(false)
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

    // Sort strictly by kickoff time (play order) — matches without a time go
    // to the bottom. Array.sort is stable, so equal/no-time rows keep the
    // backend's original order.
    const byKickoff = [...rawMatches]
        .map((m, i) => ({ m, i }))
        .sort((a, b) => {
            const ka = kickoffMs(a.m)
            const kb = kickoffMs(b.m)
            if (ka !== kb) return ka - kb
            return a.i - b.i
        })
        .map((x) => x.m)

    // Distinct teams across the schedule, for the "filter by team" dropdown.
    const teamOptions = (() => {
        const map = new Map<number, string>()
        for (const m of rawMatches) {
            if (m.team1Id != null) map.set(m.team1Id, m.team1Name ?? `#${m.team1Id}`)
            if (m.team2Id != null) map.set(m.team2Id, m.team2Name ?? `#${m.team2Id}`)
        }
        return [...map.entries()]
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name, "hr"))
    })()

    // Apply the team filter (only that team's matches when one is picked).
    const visibleMatches = teamFilter
        ? byKickoff.filter(
              (m) =>
                  String(m.team1Id) === teamFilter || String(m.team2Id) === teamFilter,
          )
        : byKickoff

    // Two sections: upcoming/live first (the schedule), finished at the bottom.
    const upcomingMatches = visibleMatches.filter((m) => m.status !== "FINISHED")
    const finishedMatches = visibleMatches.filter((m) => m.status === "FINISHED")

    // The next match to start: the earliest-kickoff SCHEDULED match (computed
    // from the full list so the highlight is the globally-next game). Gets a red
    // border so the organizer immediately sees which game is on deck.
    const nextMatchId = byKickoff.find((m) => m.status === "SCHEDULED")?.matchId ?? null

    const renderRow = (m: ScheduledMatch) => (
        <Box
            key={m.matchId}
            id={`sched-match-${m.matchId}`}
            rounded="xl"
            css={
                focusMatchId === m.matchId
                    ? {
                          outline: "2px solid var(--chakra-colors-brand-solid)",
                          outlineOffset: "2px",
                      }
                    : undefined
            }
        >
            <MatchRow
                match={m}
                tournamentUuid={uuid}
                tournamentName={tournamentName ?? "Futsal turnir"}
                tournamentLocation={tournamentLocation}
                tournamentSlug={tournamentSlug}
                slotMinutes={slot}
                onTimeChange={onTimeChange}
                canEdit={canEdit}
                isNext={m.matchId === nextMatchId}
            />
        </Box>
    )

    // Tournament has started if any match is LIVE or FINISHED.
    const tournamentStarted = rawMatches.some(
        (m) => m.status === "LIVE" || m.status === "FINISHED",
    )

    // The schedule has a stored format once it's been generated.
    const scheduleHasConfig = schedule != null && schedule.halfLengthMin != null
    // Matches without a kickoff (e.g. knockout drawn after the group schedule).
    const unscheduledCount = rawMatches.filter((m) => !m.kickoffAt).length
    // The organizer sees the editable config card (only before the start); the
    // read-only summary is for everyone else — and for organizers after start.
    const showEditableConfig = canEdit && !tournamentStarted

    return (
        <VStack align="stretch" gap="5" py="2">
            {/* Read-only format summary — visible to everyone once the schedule
                is generated, so all viewers see how long halves/breaks are. */}
            {scheduleHasConfig && !showEditableConfig && (
                <SectionCard
                    icon={LuSettings2}
                    title="Postavke rasporeda"
                    subtitle="Format utakmice — vrijedi za sve utakmice"
                    padding="4"
                >
                    <Box
                        display="grid"
                        gridTemplateColumns={{ base: "1fr 1fr", md: "repeat(5, 1fr)" }}
                        gap="3"
                    >
                        <SettingStat label="Min / poluvrijeme" value={`${schedule.halfLengthMin}`} />
                        <SettingStat label="Poluvremena" value={`${schedule.halfCount ?? 2}`} />
                        <SettingStat label="Pauza poluvrijeme" value={`${schedule.halftimeBreakMin ?? 0} min`} />
                        <SettingStat label="Pauza između" value={`${schedule.breakBetweenMatchesMin ?? 0} min`} />
                        <SettingStat label="Trajanje termina" value={`${schedule.slotLengthMin} min`} />
                    </Box>
                </SectionCard>
            )}

            {/* Some matches have no kickoff (typically the knockout drawn after
                the group schedule). Let the organizer re-confirm so they get a
                slot — useful for day-split tournaments. */}
            {canEdit && unscheduledCount > 0 && (
                <Flex
                    align="center"
                    justify="space-between"
                    gap="3"
                    wrap="wrap"
                    bg="brand.subtle"
                    borderWidth="1px"
                    borderColor="brand.emphasized"
                    rounded="xl"
                    px="4"
                    py="3"
                >
                    <HStack gap="2" minW="0">
                        <FiClock size={16} />
                        <Text fontSize="sm" color="fg.ink" fontWeight={500}>
                            {unscheduledCount === 1
                                ? "1 utakmica nema raspored"
                                : `${unscheduledCount} utakmica nema raspored`}{" "}
                            (npr. eliminacija). Potvrdi raspored da im se dodijeli termin.
                        </Text>
                    </HStack>
                    <PrimaryButton
                        onClick={runConfirm}
                        disabled={confirming}
                        icon={<LuCalendarClock size={14} />}
                    >
                        {confirming ? "Potvrđivanje…" : "Potvrdi raspored"}
                    </PrimaryButton>
                </Flex>
            )}

            {/* ── Format utakmice — Pitch SectionCard ─────────────────────
                 5-col grid of mini-stat inputs + computed slot footer +
                 Generiraj raspored CTA in the card header. Hidden once
                 the tournament has started (any match LIVE/FINISHED), and
                 also hidden for non-organizers — schedule generation is a
                 destructive owner-only action. */}
            {showEditableConfig && (
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
                        gridTemplateColumns={{ base: "1fr 1fr", md: "repeat(4, 1fr)" }}
                        gap="3"
                    >
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

            {/* Filter the schedule down to a single team's matches — centred,
                in a noticeable box that lights up when a filter is active. */}
            {teamOptions.length > 1 && (
                <Flex justify="center">
                    <Flex
                        align="center"
                        justify="center"
                        gap="2.5"
                        wrap="wrap"
                        borderWidth="1px"
                        borderColor={teamFilter ? "brand.emphasized" : "border.emphasized"}
                        bg={teamFilter ? "brand.subtle" : "bg.surfaceTint"}
                        rounded="xl"
                        px="5"
                        py="3"
                        shadow="xs"
                        transition="background-color 0.15s, border-color 0.15s"
                    >
                        <HStack
                            gap="1.5"
                            color={teamFilter ? "brand.fg" : "fg.ink"}
                            flexShrink={0}
                        >
                            <FiFilter size={15} />
                            <Text fontSize="sm" fontWeight={600} whiteSpace="nowrap">
                                Filtriraj po ekipi:
                            </Text>
                        </HStack>
                        <NativeSelect.Root size="sm" w="auto" minW="200px" maxW="280px">
                            <NativeSelect.Field
                                value={teamFilter}
                                onChange={(e) => setTeamFilter(e.target.value)}
                                fontWeight={600}
                            >
                                <option value="">Sve ekipe</option>
                                {teamOptions.map((t) => (
                                    <option key={t.id} value={t.id}>
                                        {t.name}
                                    </option>
                                ))}
                            </NativeSelect.Field>
                            <NativeSelect.Indicator />
                        </NativeSelect.Root>
                        {/* Always rendered (just hidden when inactive) so the
                            box keeps the same size and the layout doesn't shift
                            when a team is picked. */}
                        <Button
                            size="xs"
                            variant="ghost"
                            colorPalette="brand"
                            onClick={() => setTeamFilter("")}
                            visibility={teamFilter ? "visible" : "hidden"}
                            aria-hidden={!teamFilter}
                            tabIndex={teamFilter ? 0 : -1}
                            flexShrink={0}
                        >
                            Poništi filter
                        </Button>
                    </Flex>
                </Flex>
            )}

            {/* Match list — upcoming (the schedule) first, finished at the bottom. */}
            {rawMatches.length === 0 ? (
                <Panel>
                    <EmptyState
                        icon={LuCalendarX2}
                        title="Nema utakmica"
                        description="Još nema utakmica. Izvuci grupe ili generiraj eliminacijsku ljestvicu, pa generiraj raspored."
                    />
                </Panel>
            ) : visibleMatches.length === 0 ? (
                <Panel>
                    <EmptyState
                        icon={LuCalendarX2}
                        title="Nema utakmica"
                        description="Odabrana ekipa nema utakmica u rasporedu."
                    />
                </Panel>
            ) : (
                <>
                    {upcomingMatches.length > 0 && (
                        <SectionCard
                            icon={LuCalendarClock}
                            title="Nadolazeće utakmice"
                            padding="4"
                        >
                            <VStack align="stretch" gap="2">
                                {upcomingMatches.map(renderRow)}
                            </VStack>
                        </SectionCard>
                    )}
                    {finishedMatches.length > 0 && (
                        <SectionCard
                            icon={LuCalendarClock}
                            title="Završene utakmice"
                            padding="4"
                        >
                            <VStack align="stretch" gap="2">
                                {finishedMatches.map(renderRow)}
                            </VStack>
                        </SectionCard>
                    )}
                </>
            )}
        </VStack>
    )
}
