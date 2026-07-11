import { useEffect, useMemo, useRef, useState } from "react"
import { Box, Button, Flex, Grid, HStack, Text, VStack, chakra } from "@chakra-ui/react"
import { Link as RouterLink } from "react-router-dom"
import { GiSoccerBall } from "react-icons/gi"
import { FiX, FiMaximize } from "react-icons/fi"

import StreamPlayer from "./StreamPlayer"
import LiveScoreBug from "./LiveScoreBug"
import { PulseDot } from "../ui/pitch"
import { usePolling } from "../hooks/usePolling"
import { fetchMatchEvents } from "../api/matchEvents"
import { fetchGroups } from "../api/groups"
import { fetchBracket } from "../api/bracket"
import { fetchSchedule } from "../api/schedule"
import { liveGroupStandings } from "./liveStandings"
import { useTeamColors, teamColor, JerseyDot } from "./jersey"
import type { MatchEventDto } from "../types/matchEvents"
import type { LiveMatch } from "../api/live"
import type { Group } from "../types/groups"
import type { Bracket, BracketMatch } from "../types/bracket"
import type { ScheduledMatch } from "../types/schedule"

/* ──────────────────────────────────────────────────────────────────────────
   StreamHero - the home-page hero while the admin's live-stream banner is on.

   Desktop (lg+) is a three-column row of equal height:
     [ video player ] [ tijek utakmice ] [ tablica skupine ]
   compact enough that the search + filters stay visible right below.

   • Tijek utakmice - the current LIVE match: fixed header (team names +
     score), events scroll inside the fixed-height body, grouped into
     1./2. poluvrijeme exactly like the match page's timeline. Auto-scrolls
     to the newest event.
   • Tablica skupine - the group currently being played (live-overlaid
     standings, provisional cells in red like the Grupe tab); chips let the
     viewer flip to any other group.

   Mobile keeps only the full-width 16:9 player - the panels live on the
   match page / tournament tabs there.
   ────────────────────────────────────────────────────────────────────────── */

/** Height of the desktop hero row - all three columns align to it. */
const ROW_H = "330px"

/** Live scorebug for the current match (jersey colours; no live dot - the
 *  "UŽIVO PRIJENOS" pill already pulses). Null when nothing is live. */
export function buildScoreBug(match: LiveMatch | null, colors: Record<string, string>) {
    if (!match) return undefined
    return (
        <LiveScoreBug
            team1Name={match.team1Name}
            team2Name={match.team2Name}
            score1={match.score1 ?? 0}
            score2={match.score2 ?? 0}
            color1={teamColor(colors, match.team1Id)}
            color2={teamColor(colors, match.team2Id)}
            live={false}
        />
    )
}

export default function StreamHero({
    url,
    match,
    tournamentName,
    onEnterTheater,
}: {
    url: string
    /** The featured LIVE match (home page already polls it) - drives both
     *  side panels. Null when nothing is live right now. */
    match: LiveMatch | null
    /** The streamed tournament's name, shown above the theater button. Passed
     *  explicitly so it shows even when the linked tournament isn't playing a
     *  live match right now (match would be null then). */
    tournamentName?: string | null
    /** When set, shows a "Turnir mode" button that opens the theater view. */
    onEnterTheater?: () => void
}) {
    const colors = useTeamColors(match?.tournamentUuid ?? null)
    const scoreBug = buildScoreBug(match, colors)

    return (
        <Box mb={{ base: 0, md: 5 }}>
            {(onEnterTheater || tournamentName) && (
                <Flex justify="center" align="center" gap={{ base: "2", md: "3" }} wrap="wrap" mb="2.5">
                    {tournamentName && (
                        <Text
                            fontSize={{ base: "sm", md: "md" }}
                            fontWeight={800}
                            color="fg.ink"
                            textAlign="center"
                            lineClamp={1}
                            maxW={{ base: "88vw", md: "520px" }}
                        >
                            {tournamentName}
                        </Text>
                    )}
                    {onEnterTheater && (
                        <Button size="sm" variant="outline" colorPalette="pitch" onClick={onEnterTheater}>
                            <FiMaximize /> Uključi turnir mode
                        </Button>
                    )}
                </Flex>
            )}
            <Grid
                templateColumns={{ base: "1fr", lg: "minmax(0, 1.75fr) minmax(0, 1fr) minmax(0, 1.05fr)" }}
                gap="3"
                alignItems="stretch"
            >
                <Box h={{ lg: ROW_H }} minW="0">
                    <StreamPlayer url={url} overlay={scoreBug} />
                </Box>
                <Box display={{ base: "none", lg: "flex" }} h={ROW_H} minW="0">
                    <MatchTickerPanel match={match} />
                </Box>
                <Box display={{ base: "none", lg: "flex" }} h={ROW_H} minW="0">
                    <GroupTablePanel match={match} />
                </Box>
            </Grid>
        </Box>
    )
}

/* ═══════════════════ Tijek utakmice ═══════════════════ */

const REGULATION: ReadonlySet<string> = new Set(["GOAL", "OWN_GOAL", "YELLOW_CARD", "RED_CARD"])

export function MatchTickerPanel({ match }: { match: LiveMatch | null }) {
    const uuid = match?.tournamentUuid ?? null
    const matchId = match?.matchId ?? null
    const colors = useTeamColors(uuid)
    const [events, setEvents] = useState<MatchEventDto[]>([])

    // Load on match switch (also clears when the match ends)…
    useEffect(() => {
        if (!uuid || !matchId) {
            setEvents([])
            return
        }
        let cancelled = false
        fetchMatchEvents(uuid, matchId)
            .then((list) => { if (!cancelled) setEvents(list) })
            .catch(() => { /* silent - next poll retries */ })
        return () => { cancelled = true }
    }, [uuid, matchId])

    // …and keep refreshing while live (visible-tab only).
    usePolling(() => {
        if (!uuid || !matchId) return
        fetchMatchEvents(uuid, matchId)
            .then(setEvents)
            .catch(() => { /* silent */ })
    }, 12_000, !!uuid && !!matchId)

    // Fixed-height view - keep the newest event in sight.
    const bodyRef = useRef<HTMLDivElement>(null)
    useEffect(() => {
        const el = bodyRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [events.length, matchId])

    // Sections mirror the match-page timeline: halves split at halfLengthMin
    // (an event's half = minute below / at-or-above the boundary), penalty
    // kicks get their own section.
    const sections = useMemo(() => {
        const regulation = events.filter((e) => REGULATION.has(e.type))
        const pens = events.filter((e) => !REGULATION.has(e.type))
        const out: { key: string; title: string; events: MatchEventDto[] }[] = []
        const hl = match?.halfLengthMin != null && match.halfLengthMin > 0 ? match.halfLengthMin : null
        if (regulation.length > 0) {
            if (hl != null) {
                const first = regulation.filter((e) => e.minute < hl)
                const second = regulation.filter((e) => e.minute >= hl)
                if (first.length) out.push({ key: "h1", title: "1. poluvrijeme", events: first })
                if (second.length) out.push({ key: "h2", title: "2. poluvrijeme", events: second })
            } else {
                out.push({ key: "reg", title: "", events: regulation })
            }
        }
        if (pens.length) out.push({ key: "pen", title: "Penali", events: pens })
        return out
    }, [events, match?.halfLengthMin])

    return (
        <PanelShell>
            {/* Fixed header: kicker + link to the match page. */}
            <Flex px="3" py="2" borderBottomWidth="1px" borderColor="border" align="center" justify="space-between" gap="2">
                <HStack gap="1.5" minW="0">
                    <PulseDot color="var(--chakra-colors-accent-red)" size={6} />
                    <Text fontFamily="mono" fontSize="10px" fontWeight={800} letterSpacing="0.08em" color="fg.muted">
                        TIJEK UTAKMICE
                    </Text>
                </HStack>
                {match && (
                    <chakra.a
                        asChild
                        fontSize="11px"
                        fontWeight={700}
                        color="pitch.500"
                        flexShrink={0}
                        _hover={{ textDecoration: "underline" }}
                    >
                        <RouterLink to={`/turniri/${match.tournamentSlug ?? match.tournamentUuid}/utakmica/${match.matchId}`}>
                            Otvori →
                        </RouterLink>
                    </chakra.a>
                )}
            </Flex>

            {match ? (
                <>
                    {/* Fixed scoreboard: names never scroll away. */}
                    <Grid
                        templateColumns="1fr auto 1fr"
                        alignItems="center"
                        gap="2"
                        px="3"
                        py="2"
                        borderBottomWidth="1px"
                        borderColor="border"
                        flexShrink={0}
                    >
                        <HStack gap="1.5" justify="flex-end" minW="0">
                            <JerseyDot color={teamColor(colors, match.team1Id)} size={9} />
                            <Text fontSize="xs" fontWeight={700} color="fg.ink" textAlign="right" lineClamp={2} minW="0">
                                {match.team1Name ?? "-"}
                            </Text>
                        </HStack>
                        <Text
                            fontFamily="mono"
                            fontSize="lg"
                            fontWeight={800}
                            color="red.fg"
                            fontVariantNumeric="tabular-nums"
                            lineHeight="1"
                        >
                            {match.score1 ?? 0}:{match.score2 ?? 0}
                        </Text>
                        <HStack gap="1.5" justify="flex-start" minW="0">
                            <Text fontSize="xs" fontWeight={700} color="fg.ink" textAlign="left" lineClamp={2} minW="0">
                                {match.team2Name ?? "-"}
                            </Text>
                            <JerseyDot color={teamColor(colors, match.team2Id)} size={9} />
                        </HStack>
                    </Grid>

                    {/* Scrolling event feed. */}
                    <Box ref={bodyRef} flex="1" minH="0" overflowY="auto" px="2.5" py="2">
                        {sections.length === 0 ? (
                            <Flex h="full" align="center" justify="center">
                                <Text fontSize="xs" color="fg.muted" textAlign="center">
                                    Još nema događaja - golovi i kartoni pojavit će se ovdje.
                                </Text>
                            </Flex>
                        ) : (
                            sections.map((s) => (
                                <Box key={s.key} mb="1.5">
                                    {s.title && (
                                        <Flex justify="center" my="1.5">
                                            <Text
                                                fontSize="9px"
                                                fontFamily="mono"
                                                fontWeight={800}
                                                letterSpacing="0.08em"
                                                color="fg.muted"
                                                borderWidth="1px"
                                                borderColor="border"
                                                rounded="full"
                                                px="2"
                                                py="0.5"
                                            >
                                                {s.title.toUpperCase()}
                                            </Text>
                                        </Flex>
                                    )}
                                    {s.events.map((e) => (
                                        <TickerRow key={e.id} e={e} left={e.teamId === match.team1Id} />
                                    ))}
                                </Box>
                            ))
                        )}
                    </Box>
                </>
            ) : (
                <Flex flex="1" align="center" justify="center" px="4">
                    <Box textAlign="center">
                        <Text fontSize="sm" fontWeight={700} color="fg.ink">
                            Trenutno se ne igra nijedna utakmica
                        </Text>
                        <Text fontSize="xs" color="fg.muted" mt="1">
                            Tijek utakmice prikazat će se čim krene sljedeća.
                        </Text>
                    </Box>
                </Flex>
            )}
        </PanelShell>
    )
}

/** One event row - minute pill + icon + name, aligned to the event's side. */
function TickerRow({ e, left }: { e: MatchEventDto; left: boolean }) {
    const own = e.type === "OWN_GOAL"
    const noName = e.playerName == null
    const name = own
        ? (e.playerName != null ? `${e.playerName} (ag)` : "Autogol")
        : e.type === "PENALTY_MISSED" || e.type === "PENALTY_GOAL"
            ? (e.playerName ?? "Nepoznati izvođač")
            : (e.playerName ?? (e.type === "GOAL" ? "Nepoznati strijelac" : "Nepoznati igrač"))

    const icon =
        e.type === "GOAL" || e.type === "PENALTY_GOAL" ? (
            <Box color="accent.goal" display="inline-flex"><GiSoccerBall size={13} /></Box>
        ) : own ? (
            <Box color="accent.red" display="inline-flex"><GiSoccerBall size={13} /></Box>
        ) : e.type === "PENALTY_MISSED" ? (
            <Box color="fg.muted" display="inline-flex"><FiX size={13} /></Box>
        ) : (
            <Box
                w="9px"
                h="12px"
                rounded="2px"
                bg={e.type === "YELLOW_CARD" ? "#e8a01f" : "#c0392b"}
                flexShrink={0}
            />
        )

    return (
        <Flex
            direction={left ? "row" : "row-reverse"}
            align="center"
            gap="1.5"
            py="1"
        >
            <Text
                fontFamily="mono"
                fontSize="10px"
                fontWeight={800}
                color="blue.fg"
                bg="blue.subtle"
                rounded="full"
                px="1.5"
                py="0.5"
                flexShrink={0}
                fontVariantNumeric="tabular-nums"
            >
                {e.minute}'
            </Text>
            {icon}
            <Text
                fontSize="11px"
                fontWeight={600}
                color="fg.ink"
                fontStyle={noName ? "italic" : undefined}
                textAlign={left ? "left" : "right"}
                lineClamp={2}
                minW="0"
                css={{ overflowWrap: "anywhere" }}
            >
                {name}
            </Text>
        </Flex>
    )
}

/* ═══════════════════ Tablica skupine ═══════════════════ */

type PanelMode = "groups" | "bracket"

export function GroupTablePanel({ match }: { match: LiveMatch | null }) {
    const uuid = match?.tournamentUuid ?? null
    const [groups, setGroups] = useState<Group[]>([])
    const [bracket, setBracket] = useState<Bracket | null>(null)
    // The viewer's explicit group pick; null = follow the group being played.
    const [pickedId, setPickedId] = useState<number | null>(null)
    // The viewer's explicit tab; null = auto-follow the live phase.
    const [manualMode, setManualMode] = useState<PanelMode | null>(null)

    useEffect(() => {
        setGroups([])
        setBracket(null)
        setPickedId(null)
        setManualMode(null)
        if (!uuid) return
        let cancelled = false
        fetchGroups(uuid, { silent: true })
            .then((g) => { if (!cancelled) setGroups(g) })
            .catch(() => { /* silent */ })
        fetchBracket(uuid, { silent: true })
            .then((b) => { if (!cancelled) setBracket(b) })
            .catch(() => { /* silent */ })
        return () => { cancelled = true }
    }, [uuid])

    // Standings + bracket move while matches are live - keep them fresh.
    usePolling(() => {
        if (!uuid) return
        fetchGroups(uuid, { silent: true }).then(setGroups).catch(() => { /* silent */ })
        fetchBracket(uuid, { silent: true }).then(setBracket).catch(() => { /* silent */ })
    }, 30_000, !!uuid)

    const hasGroups = groups.length > 0
    const hasBracket = (bracket?.rounds?.length ?? 0) > 0

    // Auto-follow the phase of the live match: a knockout game live → show the
    // bracket, a group game → the group table. A manual tab pick overrides
    // until the live phase flips (group ↔ knockout).
    const knockoutLive = !!match?.stage && match.stage !== "GROUP"
    const lastPhaseRef = useRef<string>("")
    useEffect(() => {
        const phase = knockoutLive ? "bracket" : "groups"
        if (phase !== lastPhaseRef.current) {
            lastPhaseRef.current = phase
            setManualMode(null)
        }
    }, [knockoutLive])

    const autoMode: PanelMode =
        knockoutLive && hasBracket ? "bracket" : hasGroups ? "groups" : hasBracket ? "bracket" : "groups"
    const mode: PanelMode = manualMode ?? autoMode
    const showToggle = hasGroups && hasBracket

    // The group the featured live match belongs to (null for knockout).
    const playingGroupId = useMemo(() => {
        if (!match) return null
        return groups.find((g) => g.matches.some((m) => m.matchId === match.matchId))?.id ?? null
    }, [groups, match])

    const selected =
        groups.find((g) => g.id === pickedId) ??
        groups.find((g) => g.id === playingGroupId) ??
        groups[0] ??
        null

    const live = selected ? liveGroupStandings(selected) : null
    const liveTeamIds = useMemo(() => {
        const ids = new Set<number>()
        if (match && selected && selected.id === playingGroupId) {
            if (match.team1Id != null) ids.add(match.team1Id)
            if (match.team2Id != null) ids.add(match.team2Id)
        }
        return ids
    }, [match, selected, playingGroupId])

    return (
        <PanelShell>
            {/* Fixed header: kicker + tab toggle + tournament link. */}
            <Flex px="3" py="2" borderBottomWidth="1px" borderColor="border" align="center" justify="space-between" gap="2">
                <Text fontFamily="mono" fontSize="10px" fontWeight={800} letterSpacing="0.08em" color="fg.muted" flexShrink={0}>
                    {mode === "bracket" ? "ZAVRŠNICA" : "TABLICA SKUPINE"}
                </Text>
                <HStack gap="2" flexShrink={0}>
                    {showToggle && (
                        <HStack gap="0.5" bg="bg.surfaceTint" rounded="full" p="0.5" borderWidth="1px" borderColor="border">
                            {(["groups", "bracket"] as PanelMode[]).map((m) => (
                                <chakra.button
                                    key={m}
                                    type="button"
                                    onClick={() => setManualMode(m)}
                                    px="2"
                                    py="0.5"
                                    rounded="full"
                                    fontSize="10px"
                                    fontWeight={800}
                                    cursor="pointer"
                                    bg={mode === m ? "fg.ink" : "transparent"}
                                    color={mode === m ? "bg.panel" : "fg.muted"}
                                    transition="background 120ms, color 120ms"
                                >
                                    {m === "groups" ? "Skupine" : "Završnica"}
                                </chakra.button>
                            ))}
                        </HStack>
                    )}
                    {match && (
                        <chakra.a
                            asChild
                            fontSize="11px"
                            fontWeight={700}
                            color="pitch.500"
                            _hover={{ textDecoration: "underline" }}
                        >
                            <RouterLink to={`/turniri/${match.tournamentSlug ?? match.tournamentUuid}`}>
                                Turnir →
                            </RouterLink>
                        </chakra.a>
                    )}
                </HStack>
            </Flex>

            {!uuid ? (
                <Flex flex="1" align="center" justify="center" px="4">
                    <Box textAlign="center">
                        <Text fontSize="sm" fontWeight={700} color="fg.ink">Nema aktivnog turnira</Text>
                        <Text fontSize="xs" color="fg.muted" mt="1">
                            Prikaz se pojavi za vrijeme utakmice.
                        </Text>
                    </Box>
                </Flex>
            ) : mode === "bracket" ? (
                <MiniBracket bracket={bracket} liveMatchId={match?.matchId ?? null} />
            ) : (
                <>
                    {groups.length > 0 && (
                        <Flex gap="1" px="2.5" py="1.5" borderBottomWidth="1px" borderColor="border" overflowX="auto" flexShrink={0}>
                            {groups.map((g) => {
                                const active = selected?.id === g.id
                                const hasLive = g.matches.some((m) => m.status === "LIVE")
                                return (
                                    <chakra.button
                                        key={g.id}
                                        type="button"
                                        onClick={() => setPickedId(g.id)}
                                        display="inline-flex"
                                        alignItems="center"
                                        gap="1"
                                        px="2"
                                        py="0.5"
                                        rounded="full"
                                        fontSize="11px"
                                        fontWeight={800}
                                        flexShrink={0}
                                        cursor="pointer"
                                        bg={active ? "fg.ink" : "bg.surfaceTint"}
                                        color={active ? "bg.panel" : "fg.ink"}
                                        borderWidth="1px"
                                        borderColor={active ? "fg.ink" : "border"}
                                        transition="background 120ms, color 120ms"
                                    >
                                        {g.name}
                                        {hasLive && <PulseDot color="var(--chakra-colors-accent-red)" size={5} />}
                                    </chakra.button>
                                )
                            })}
                        </Flex>
                    )}

                    {!selected || !live ? (
                        <Flex flex="1" align="center" justify="center" px="4">
                            <Box textAlign="center">
                                <Text fontSize="sm" fontWeight={700} color="fg.ink">Turnir nema grupnu fazu</Text>
                                <Text fontSize="xs" color="fg.muted" mt="1">Rezultati su na stranici turnira.</Text>
                            </Box>
                        </Flex>
                    ) : (
                        <Box flex="1" minH="0" overflowY="auto" px="2.5" py="1.5">
                            {/* Column header. */}
                            <Grid templateColumns="16px minmax(0,1fr) 26px 32px 30px" gap="1" px="1" pb="1">
                                {["#", "EKIPA", "UT", "+/-", "BOD"].map((h, i) => (
                                    <Text
                                        key={h}
                                        fontFamily="mono"
                                        fontSize="9px"
                                        fontWeight={800}
                                        color="fg.muted"
                                        textAlign={i >= 2 ? "right" : "left"}
                                    >
                                        {h}
                                    </Text>
                                ))}
                            </Grid>
                            {live.rows.map((r, i) => {
                                const isPlaying = liveTeamIds.has(r.teamId)
                                const advancing = i < (selected.effectiveAdvance ?? 0)
                                return (
                                    <Grid
                                        key={r.teamId}
                                        templateColumns="16px minmax(0,1fr) 26px 32px 30px"
                                        gap="1"
                                        alignItems="center"
                                        px="1"
                                        py="1"
                                        rounded="md"
                                        bg={isPlaying ? "red.subtle" : undefined}
                                        borderLeftWidth="2px"
                                        borderLeftColor={advancing ? "accent.goal" : "transparent"}
                                    >
                                        <Text fontSize="10px" fontFamily="mono" fontWeight={700} color="fg.muted">
                                            {i + 1}.
                                        </Text>
                                        <Text fontSize="11px" fontWeight={isPlaying ? 800 : 600} color="fg.ink" truncate>
                                            {r.teamName}
                                        </Text>
                                        <Cell changed={r.liveChanged.has("played")}>{r.played}</Cell>
                                        <Cell changed={r.liveChanged.has("goalDiff")}>
                                            {r.goalDiff > 0 ? `+${r.goalDiff}` : r.goalDiff}
                                        </Cell>
                                        <Cell changed={r.liveChanged.has("points")} bold>
                                            {r.points}
                                        </Cell>
                                    </Grid>
                                )
                            })}
                        </Box>
                    )}
                </>
            )}
        </PanelShell>
    )
}

/* ═══════════════════ Nadolazeća utakmica ═══════════════════ */

/** A compact "next up" card for the streamed tournament: the earliest-kickoff
 *  fixture still to be played (excludes the current live game and finished
 *  ones). Knockout fixtures still waiting on the draw show "TBD". */
export function UpcomingMatchPanel({ match }: { match: LiveMatch | null }) {
    const uuid = match?.tournamentUuid ?? null
    const liveId = match?.matchId ?? null
    const colors = useTeamColors(uuid)
    const [next, setNext] = useState<ScheduledMatch | null>(null)

    useEffect(() => {
        setNext(null)
        if (!uuid) return
        let cancelled = false
        fetchSchedule(uuid)
            .then((s) => { if (!cancelled) setNext(pickNextMatch(s.matches, liveId)) })
            .catch(() => { /* silent - next poll retries */ })
        return () => { cancelled = true }
    }, [uuid, liveId])

    // The schedule shifts as matches finish - keep "next up" fresh.
    usePolling(() => {
        if (!uuid) return
        fetchSchedule(uuid)
            .then((s) => setNext(pickNextMatch(s.matches, liveId)))
            .catch(() => { /* silent */ })
    }, 30_000, !!uuid)

    return (
        <PanelShell>
            <Flex px="3" py="2" borderBottomWidth="1px" borderColor="border" align="center" justify="space-between" gap="2">
                <Text fontFamily="mono" fontSize="10px" fontWeight={800} letterSpacing="0.08em" color="fg.muted" flexShrink={0}>
                    NADOLAZEĆA UTAKMICA
                </Text>
                {next && (
                    <HStack gap="2" minW="0">
                        <Text fontSize="10px" fontWeight={800} color="fg.muted" truncate minW="0">
                            {roundLabel(next)}
                        </Text>
                        {next.kickoffAt && (
                            <Text
                                fontFamily="mono"
                                fontSize="11px"
                                fontWeight={800}
                                color="pitch.500"
                                fontVariantNumeric="tabular-nums"
                                flexShrink={0}
                            >
                                {formatKickoff(next.kickoffAt)}
                            </Text>
                        )}
                    </HStack>
                )}
            </Flex>
            {next ? (
                <VStack align="stretch" gap="1.5" px="3" py="2.5">
                    <UpcomingRow name={next.team1Name} color={teamColor(colors, next.team1Id)} />
                    <UpcomingRow name={next.team2Name} color={teamColor(colors, next.team2Id)} />
                </VStack>
            ) : (
                <Flex px="3" py="3" align="center" justify="center">
                    <Text fontSize="xs" color="fg.muted" textAlign="center">
                        Nema više utakmica na rasporedu.
                    </Text>
                </Flex>
            )}
        </PanelShell>
    )
}

function UpcomingRow({ name, color }: { name: string | null; color: string | null }) {
    return (
        <HStack gap="2" minW="0">
            {/* Fixed slot so both team names line up whether or not a kit colour
                is set (JerseyDot renders nothing when there's no colour). */}
            <Box w="10px" flexShrink={0} display="inline-flex" justifyContent="center">
                <JerseyDot color={color} size={10} />
            </Box>
            <Text
                fontSize="13px"
                fontWeight={700}
                color={name ? "fg.ink" : "fg.muted"}
                fontStyle={name ? undefined : "italic"}
                truncate
                minW="0"
            >
                {name ?? "TBD"}
            </Text>
        </HStack>
    )
}

/** The earliest-kickoff match still to be played (not finished, not the current
 *  live game). Matches without a kickoff fall back to schedule (play) order. */
function pickNextMatch(matches: ScheduledMatch[], liveId: number | null): ScheduledMatch | null {
    const upcoming = matches.filter(
        (m) => m.status !== "FINISHED" && m.status !== "LIVE" && m.matchId !== liveId,
    )
    if (upcoming.length === 0) return null
    const withTime = upcoming.filter((m) => m.kickoffAt != null)
    if (withTime.length === 0) return upcoming[0]
    return withTime.reduce((a, b) => (kickoffMs(a.kickoffAt) <= kickoffMs(b.kickoffAt) ? a : b))
}

function kickoffMs(iso: string | null): number {
    return iso ? new Date(iso).getTime() : Number.POSITIVE_INFINITY
}

/** Round/group label for the card (e.g. "Skupina A", "ČF", "Finale"). */
function roundLabel(m: ScheduledMatch): string {
    if (m.stage === "GROUP") return m.groupName ? `Skupina ${m.groupName}` : "Skupina"
    return ROUND_ABBR[m.stage] ?? m.stage
}

/** Kickoff as HH:mm (adds a dd.MM. prefix when it isn't today). */
function formatKickoff(iso: string): string {
    const d = new Date(iso)
    const now = new Date()
    const time = d.toLocaleTimeString("hr-HR", { hour: "2-digit", minute: "2-digit" })
    if (d.toDateString() === now.toDateString()) return time
    return `${d.toLocaleDateString("hr-HR", { day: "2-digit", month: "2-digit" })} ${time}`
}

/* ═══════════════════ Mini bracket (završnica) ═══════════════════ */

/** Compact round labels for the mini bracket columns. */
const ROUND_ABBR: Record<string, string> = {
    ROUND_OF_32: "1/16",
    ROUND_OF_16: "1/8",
    QUARTERFINAL: "ČF",
    SEMIFINAL: "PF",
    FINAL: "Finale",
    THIRD_PLACE: "3. mj.",
}

function MiniBracket({ bracket, liveMatchId }: { bracket: Bracket | null; liveMatchId: number | null }) {
    if (!bracket || bracket.rounds.length === 0) {
        return (
            <Flex flex="1" align="center" justify="center" px="4">
                <Box textAlign="center">
                    <Text fontSize="sm" fontWeight={700} color="fg.ink">Završnica još nije određena</Text>
                    <Text fontSize="xs" color="fg.muted" mt="1">
                        Prikazat će se čim se generira ždrijeb eliminacije.
                    </Text>
                </Box>
            </Flex>
        )
    }

    return (
        <Box flex="1" minH="0" overflow="auto" p="2">
            {/* Rounds as columns; each column spreads its matches over the full
                height (space-around) so later rounds sit between their feeders -
                the classic bracket look. Third place is a trailing column. */}
            <Flex gap="2" h="full" css={{ minWidth: "min-content" }}>
                {bracket.rounds.map((round) => (
                    <Flex key={round.stage} direction="column" minW="104px" flexShrink={0}>
                        <Text
                            fontFamily="mono"
                            fontSize="9px"
                            fontWeight={800}
                            letterSpacing="0.06em"
                            color="fg.muted"
                            textAlign="center"
                            pb="1"
                            flexShrink={0}
                        >
                            {(ROUND_ABBR[round.stage] ?? round.title ?? "").toUpperCase()}
                        </Text>
                        <Flex direction="column" flex="1" justify="space-around" gap="1.5">
                            {round.matches.map((m) => (
                                <MiniMatch key={m.matchId} m={m} live={m.matchId === liveMatchId} />
                            ))}
                        </Flex>
                    </Flex>
                ))}
                {bracket.thirdPlace && (
                    <Flex direction="column" minW="104px" flexShrink={0}>
                        <Text
                            fontFamily="mono"
                            fontSize="9px"
                            fontWeight={800}
                            letterSpacing="0.06em"
                            color="fg.muted"
                            textAlign="center"
                            pb="1"
                            flexShrink={0}
                        >
                            3. MJ.
                        </Text>
                        <Flex direction="column" flex="1" justify="center">
                            <MiniMatch m={bracket.thirdPlace} live={bracket.thirdPlace.matchId === liveMatchId} />
                        </Flex>
                    </Flex>
                )}
            </Flex>
        </Box>
    )
}

/** One knockout match box: two team rows, winner tinted, live game ringed red. */
function MiniMatch({ m, live }: { m: BracketMatch; live: boolean }) {
    const w1 = m.winnerTeamId != null && m.winnerTeamId === m.team1Id
    const w2 = m.winnerTeamId != null && m.winnerTeamId === m.team2Id
    return (
        <Box
            borderWidth="1px"
            borderColor={live ? "accent.red" : "border"}
            rounded="md"
            overflow="hidden"
            bg="bg.panel"
            css={
                live
                    ? { boxShadow: "0 0 0 2px color-mix(in srgb, var(--chakra-colors-accent-red) 22%, transparent)" }
                    : undefined
            }
        >
            <MiniMatchRow name={m.team1Name} score={m.score1} winner={w1} />
            <Box h="1px" bg="border" />
            <MiniMatchRow name={m.team2Name} score={m.score2} winner={w2} />
        </Box>
    )
}

function MiniMatchRow({
    name,
    score,
    winner,
}: {
    name: string | null
    score: number | null
    winner: boolean
}) {
    return (
        <Flex align="center" justify="space-between" gap="1" px="1.5" py="1" bg={winner ? "green.subtle" : undefined}>
            <Text
                fontSize="10px"
                fontWeight={winner ? 800 : 600}
                color={name ? "fg.ink" : "fg.muted"}
                fontStyle={name ? undefined : "italic"}
                truncate
                minW="0"
            >
                {name ?? "TBD"}
            </Text>
            <Text
                fontSize="10px"
                fontFamily="mono"
                fontWeight={800}
                color="fg.ink"
                flexShrink={0}
                fontVariantNumeric="tabular-nums"
            >
                {score != null ? score : ""}
            </Text>
        </Flex>
    )
}

/** Right-aligned mono stat cell; provisional (live-modified) values go red. */
function Cell({
    children,
    changed,
    bold,
}: {
    children: React.ReactNode
    changed: boolean
    bold?: boolean
}) {
    return (
        <Text
            fontSize="11px"
            fontFamily="mono"
            fontWeight={bold ? 800 : 600}
            color={changed ? "red.fg" : "fg.ink"}
            textAlign="right"
            fontVariantNumeric="tabular-nums"
        >
            {children}
        </Text>
    )
}

/* ═══════════════════ shared shell ═══════════════════ */

/** Equal-height panel chrome: fixed headers + a scrollable body slot. */
function PanelShell({ children }: { children: React.ReactNode }) {
    return (
        <Flex
            direction="column"
            w="full"
            h="full"
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border"
            rounded="2xl"
            overflow="hidden"
        >
            {children}
        </Flex>
    )
}
