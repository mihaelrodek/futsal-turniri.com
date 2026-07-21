import { useEffect, useMemo, useRef, useState } from "react"
import { Box, Button, Flex, Grid, HStack, Text, VStack, chakra } from "@chakra-ui/react"
import { Link as RouterLink } from "react-router-dom"
import { GiSoccerBall } from "react-icons/gi"
import { FiX, FiClock, FiPlay, FiHome } from "react-icons/fi"

import StreamPlayer from "./StreamPlayer"
import LiveScoreBug from "./LiveScoreBug"
import { PulseDot } from "../ui/pitch"
import { usePolling } from "../hooks/usePolling"
import { fetchMatchEvents } from "../api/matchEvents"
import { fetchGroups } from "../api/groups"
import { fetchBracket } from "../api/bracket"
import { fetchSchedule } from "../api/schedule"
import { liveGroupStandings } from "./liveStandings"
import { useTeamColors, teamColor, teamShorts, TeamKitChip, KitSwatch } from "./jersey"
import type { MatchEventDto } from "../types/matchEvents"
import type { LiveMatch } from "../api/live"
import type { Group } from "../types/groups"
import type { Bracket, BracketMatch } from "../types/bracket"
import type { ScheduledMatch } from "../types/schedule"
import type { TeamKit } from "../api/tournaments"

/* ──────────────────────────────────────────────────────────────────────────
   StreamHero - the home-page hero while the admin's live-stream banner is on.

   Desktop (lg+) is a two-column row of equal height:
     [ video player (widened) ] [ side panel: Utakmica | Tablica ]
   The video takes the larger share; the side panel is a single card with
   two tabs. Compact enough that the search + filters stay visible below.

   • Utakmica (default tab) - the current LIVE match ticker: fixed header
     (team names + score), events scroll inside the body, grouped into
     1./2. poluvrijeme like the match page's timeline. Auto-scrolls to the
     newest event.
   • Tablica - the group currently being played (live-overlaid standings,
     provisional cells in red like the Grupe tab) or the knockout bracket;
     chips let the viewer flip to any other group.

   Both tab bodies stay mounted (visibility toggles) so their polling and
   scroll position survive a tab switch.

   Mobile keeps only the full-width 16:9 player - the panels live on the
   match page / tournament tabs there.
   ────────────────────────────────────────────────────────────────────────── */

/** Height of the desktop hero row - the video and side panel align to it.
 *  Taller than the old three-column row so the widened video fills it (the
 *  name + turnir-mode button moved into the side panel free up the space). */
const ROW_H = "450px"

/** Overlay pinned to the top of the stream: the live scorebug when a match is
 *  in progress, else a "SLJEDEĆA UTAKMICA" card for the tournament's next
 *  fixture (kickoff time instead of a score). Undefined when there's neither.
 *  No live dot on the live bug - the "UŽIVO PRIJENOS" pill already pulses. */
export function buildScoreBug(
    match: LiveMatch | null,
    colors: Record<string, TeamKit>,
    nextMatch?: ScheduledMatch | null,
) {
    if (match) {
        return (
            <LiveScoreBug
                team1Name={match.team1Name}
                team2Name={match.team2Name}
                score1={match.score1 ?? 0}
                score2={match.score2 ?? 0}
                color1={teamColor(colors, match.team1Id)}
                color2={teamColor(colors, match.team2Id)}
                shorts1={teamShorts(colors, match.team1Id)}
                shorts2={teamShorts(colors, match.team2Id)}
                live={false}
            />
        )
    }
    if (nextMatch) {
        return (
            <VStack gap="1.5" align="center">
                <HStack
                    gap="1"
                    px="2"
                    py="0.5"
                    rounded="full"
                    bg="rgba(11,21,34,0.86)"
                    borderWidth="1px"
                    borderColor="whiteAlpha.200"
                    css={{ backdropFilter: "blur(6px)" }}
                >
                    <Box color="accent.amber" display="inline-flex"><FiClock size={11} /></Box>
                    <Text fontFamily="mono" fontSize="9px" fontWeight={800} letterSpacing="0.1em" color="white">
                        SLJEDEĆA UTAKMICA
                    </Text>
                </HStack>
                <LiveScoreBug
                    team1Name={nextMatch.team1Name ?? "TBD"}
                    team2Name={nextMatch.team2Name ?? "TBD"}
                    score1={0}
                    score2={0}
                    color1={teamColor(colors, nextMatch.team1Id)}
                    color2={teamColor(colors, nextMatch.team2Id)}
                    shorts1={teamShorts(colors, nextMatch.team1Id)}
                    shorts2={teamShorts(colors, nextMatch.team2Id)}
                    live={false}
                    centerText={nextMatch.kickoffAt ? formatKickoff(nextMatch.kickoffAt) : "vs"}
                />
            </VStack>
        )
    }
    return undefined
}

/** Admin-toggled media (image/video) to draw CENTRED over the live video.
 *  Returns the media node (StreamPlayer centres it), or undefined when hidden. */
export function buildStreamOverlay(
    overlayUrl?: string | null,
    overlayMediaType?: "IMAGE" | "VIDEO" | null,
) {
    if (!overlayUrl) return undefined
    return overlayMediaType === "VIDEO" ? (
        <chakra.video
            src={overlayUrl}
            autoPlay
            muted
            loop
            playsInline
            maxW="72%"
            maxH="72%"
            css={{ objectFit: "contain" }}
        />
    ) : (
        <chakra.img src={overlayUrl} alt="Overlay" maxW="72%" maxH="72%" css={{ objectFit: "contain" }} />
    )
}

/** Per-side goalscorers for the FULLSCREEN player: team 1 down the left edge,
 *  team 2 down the right, each row "Ime Prezime 12'". StreamPlayer positions
 *  and auto-hides them; only the content is built here.
 *
 *  Which events count (the semantics used across the app): GOAL and OWN_GOAL
 *  both belong to the team in `teamId` - for an own goal that's the
 *  BENEFICIARY, while the named player is the one who put it into his own net
 *  (hence the "(ag)" marker). PENALTY_GOAL / PENALTY_MISSED are shootout kicks
 *  that never touch the match score, so they are left out entirely.
 *
 *  Undefined when nothing is live - the player then draws no columns. */
export function buildSideScorers(match: LiveMatch | null, events: MatchEventDto[]) {
    if (!match) return undefined
    const goals = events
        .filter((e) => e.type === "GOAL" || e.type === "OWN_GOAL")
        .sort((a, b) => a.minute - b.minute)
    return {
        left: <ScorerColumn goals={goals.filter((e) => e.teamId === match.team1Id)} align="left" />,
        right: <ScorerColumn goals={goals.filter((e) => e.teamId === match.team2Id)} align="right" />,
    }
}

/** One side's scorer list as a dark translucent card - the same overlay idiom
 *  as the scorebug, so it stays legible over any footage (bright pitch, night
 *  game, snow). Renders NOTHING at all when that side hasn't scored. */
function ScorerColumn({ goals, align }: { goals: MatchEventDto[]; align: "left" | "right" }) {
    if (goals.length === 0) return <></>
    return (
        // Deliberately SMALL type: this card sits inside the scorebug's 1.6x
        // fullscreen scale, so 10px renders around 16px on screen - readable
        // from the couch while a long scorer list still stays compact instead
        // of eating a third of the picture.
        <VStack
            align={align === "left" ? "flex-start" : "flex-end"}
            gap="0"
            bg="rgba(11,21,34,0.72)"
            css={{ backdropFilter: "blur(6px)" }}
            borderWidth="1px"
            borderColor="whiteAlpha.200"
            rounded="md"
            px="1.5"
            py="1"
        >
            {goals.map((e) => (
                <Text
                    key={e.id}
                    fontSize={{ base: "8px", md: "10px" }}
                    fontWeight={600}
                    lineHeight="1.35"
                    textAlign={align}
                    css={{ overflowWrap: "anywhere" }}
                >
                    {scorerLabel(e)}{" "}
                    <chakra.span fontFamily="mono" fontVariantNumeric="tabular-nums">
                        {e.minute}'
                    </chakra.span>
                </Text>
            ))}
        </VStack>
    )
}

/** Scorer name for one goal, worded exactly like the rest of the app: an own
 *  goal carries the "(ag)" marker (just "Autogol" when nobody is named), and
 *  an unattributed goal reads "Nepoznati strijelac". */
function scorerLabel(e: MatchEventDto): string {
    if (e.type === "OWN_GOAL") return e.playerName != null ? `${e.playerName} (ag)` : "Autogol"
    return e.playerName ?? "Nepoznati strijelac"
}

export default function StreamHero({
    url,
    match,
    tournamentName,
    tournamentUuid,
    viewers,
    onEnterTheater,
    centerOverlay,
}: {
    url: string
    /** The featured LIVE match (home page already polls it) - drives both
     *  side panels. Null when nothing is live right now. */
    match: LiveMatch | null
    /** The streamed tournament's name, shown above the theater button. Passed
     *  explicitly so it shows even when the linked tournament isn't playing a
     *  live match right now (match would be null then). */
    tournamentName?: string | null
    /** The streamed tournament's uuid - lets the side panels (groups, next
     *  match) work even when that tournament isn't playing anything live. */
    tournamentUuid?: string | null
    /** Live-viewer count for the stream's "👁 N" badge. */
    viewers?: number | null
    /** When set, shows the "Gledaj uživo" primary (and the mobile turnir-mode
     *  button) that opens the live/theater view. */
    onEnterTheater?: () => void
    /** Admin-toggled media drawn centred over the video (built by
     *  {@link buildStreamOverlay}). */
    centerOverlay?: React.ReactNode
}) {
    const uuid = match?.tournamentUuid ?? tournamentUuid ?? null
    const colors = useTeamColors(uuid)
    // Nothing live → feature the tournament's next fixture instead.
    const nextMatch = useNextMatch(uuid, null, !match)
    const scoreBug = buildScoreBug(match, colors, nextMatch)
    // ONE events poll for the whole hero: the side panel's ticker reads it
    // (passed down below) and so do the fullscreen scorer columns.
    const events = useMatchEvents(match?.tournamentUuid ?? null, match?.matchId ?? null)
    const sideScorers = useMemo(() => buildSideScorers(match, events), [match, events])

    return (
        <Box mb="0">
            {/* Mobile/tablet only: tournament name above the player (the side
                panel is hidden below lg, where the name instead moves INTO its
                header). The "Uživo" CTA is now BELOW the player - see after the
                Grid - mirroring the desktop side panel, where it's a footer
                action under the ticker, not a header one. */}
            {tournamentName && (
                <Text
                    display={{ base: "block", lg: "none" }}
                    fontSize={{ base: "sm", md: "md" }}
                    fontWeight={800}
                    color="fg.ink"
                    textAlign="center"
                    mb="2.5"
                    // No line clamp: a long name ("31. Memorijalni turnir Darko
                    // Puškadija i Zvonimir Pavlić") was cut mid-word at 1 line.
                    lineHeight="1.3"
                    css={{ overflowWrap: "anywhere" }}
                >
                    {tournamentName}
                </Text>
            )}
            <Grid
                templateColumns={{ base: "1fr", lg: "minmax(0, 2.2fr) minmax(0, 0.95fr)" }}
                gap="3"
                alignItems="stretch"
            >
                <Box h={{ lg: ROW_H }} minW="0">
                    <StreamPlayer
                        url={url}
                        overlay={scoreBug}
                        centerOverlay={centerOverlay}
                        viewers={viewers}
                        sideScorers={sideScorers}
                    />
                </Box>
                <Box display={{ base: "none", lg: "flex" }} h={ROW_H} minW="0">
                    <StreamSidePanel
                        match={match}
                        uuid={uuid}
                        nextMatch={nextMatch}
                        tournamentName={tournamentName}
                        onEnterTheater={onEnterTheater}
                        events={events}
                    />
                </Box>
            </Grid>
            {/* Mobile/tablet only: same call to action as the desktop side
                panel's footer - solid cyan "Uživo" with a play glyph - now
                placed after the video instead of before it. */}
            {onEnterTheater && (
                <Flex display={{ base: "flex", lg: "none" }} justify="center" mt="2.5">
                    <Button
                        size="md"
                        colorPalette="pitch"
                        onClick={onEnterTheater}
                        fontWeight={800}
                        w="full"
                        maxW="240px"
                    >
                        <FiPlay /> Uživo
                    </Button>
                </Flex>
            )}
        </Box>
    )
}

/* ═══════════════════ Tijek utakmice ═══════════════════ */

const REGULATION: ReadonlySet<string> = new Set(["GOAL", "OWN_GOAL", "YELLOW_CARD", "RED_CARD"])

/** A live match's events: load on match switch, then poll while it runs
 *  (visible-tab only). Split out of {@link useMatchTicker} so a parent can
 *  fetch ONCE and feed several consumers - the home hero polls here and hands
 *  the same list to both the ticker panel and the fullscreen scorer columns.
 *  `enabled=false` skips fetching entirely (the consumer was given events). */
export function useMatchEvents(
    uuid: string | null,
    matchId: number | null,
    enabled = true,
): MatchEventDto[] {
    const [events, setEvents] = useState<MatchEventDto[]>([])

    // Load on match switch (also clears when the match ends)…
    useEffect(() => {
        if (!uuid || !matchId || !enabled) {
            setEvents([])
            return
        }
        let cancelled = false
        fetchMatchEvents(uuid, matchId)
            .then((list) => { if (!cancelled) setEvents(list) })
            .catch(() => { /* silent - next poll retries */ })
        return () => { cancelled = true }
    }, [uuid, matchId, enabled])

    // …and keep refreshing while live (visible-tab only).
    usePolling(() => {
        if (!uuid || !matchId) return
        fetchMatchEvents(uuid, matchId)
            .then(setEvents)
            .catch(() => { /* silent */ })
    }, 12_000, enabled && !!uuid && !!matchId)

    return events
}

/** Ticker state - events fetch + poll, half-split sections, autoscroll ref.
 *  Shared by the standalone MatchTickerPanel (theater) and the tabbed
 *  StreamSidePanel (home hero) so both render identically. */
function useMatchTicker(
    match: LiveMatch | null,
    uuidProp?: string | null,
    nextMatch?: ScheduledMatch | null,
    eventsProp?: MatchEventDto[],
) {
    const uuid = match?.tournamentUuid ?? null
    const matchId = match?.matchId ?? null
    const colors = useTeamColors(match?.tournamentUuid ?? uuidProp ?? null)
    // A parent that already polls these events passes them in (the home hero
    // needs them for the fullscreen scorer columns too) - then this hook does
    // NOT fetch, so there is still exactly one poll per live match.
    const ownEvents = useMatchEvents(uuid, matchId, eventsProp === undefined)
    const events = eventsProp ?? ownEvents
    // With nothing live, the panel features the next fixture instead.
    const showUpcoming = !match && !!nextMatch

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

    return { colors, showUpcoming, bodyRef, sections }
}

type MatchTicker = ReturnType<typeof useMatchTicker>

/** Header kicker + "Otvori →" link for the standalone ticker panel. */
function MatchTickerHeader({ match, showUpcoming }: { match: LiveMatch | null; showUpcoming: boolean }) {
    return (
        <Flex px="3" py="2" borderBottomWidth="1px" borderColor="border" align="center" justify="space-between" gap="2">
            <HStack gap="1.5" minW="0">
                {showUpcoming
                    ? <Box color="accent.amber" display="inline-flex" flexShrink={0}><FiClock size={12} /></Box>
                    : <PulseDot color="var(--chakra-colors-accent-red)" size={6} />}
                <Text fontFamily="mono" fontSize="10px" fontWeight={800} letterSpacing="0.08em" color="fg.muted">
                    {showUpcoming ? "SLJEDEĆA UTAKMICA" : "TIJEK UTAKMICE"}
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
    )
}

/** Scoreboard + scrolling event feed (no shell / no kicker header) - rendered
 *  inside a flex column by the panel wrapper or the tabbed side panel. */
function MatchTickerBody({
    match,
    nextMatch,
    t,
}: {
    match: LiveMatch | null
    nextMatch?: ScheduledMatch | null
    t: MatchTicker
}) {
    const { colors, bodyRef, sections } = t
    return match ? (
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
                    <TeamKitChip colors={colors} teamId={match.team1Id} size={9} />
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
                    <TeamKitChip colors={colors} teamId={match.team2Id} size={9} />
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
    ) : nextMatch ? (
        <>
            {/* Fixed scoreboard for the NEXT match - kickoff time in the
                middle instead of a score. */}
            <Grid templateColumns="1fr auto 1fr" alignItems="center" gap="2" px="3" py="2" borderBottomWidth="1px" borderColor="border" flexShrink={0}>
                <HStack gap="1.5" justify="flex-end" minW="0">
                    <TeamKitChip colors={colors} teamId={nextMatch.team1Id} size={9} />
                    <Text fontSize="xs" fontWeight={700} color={nextMatch.team1Name ? "fg.ink" : "fg.muted"} fontStyle={nextMatch.team1Name ? undefined : "italic"} textAlign="right" lineClamp={2} minW="0">
                        {nextMatch.team1Name ?? "TBD"}
                    </Text>
                </HStack>
                <Text fontFamily="mono" fontSize="sm" fontWeight={800} color="accent.amber" fontVariantNumeric="tabular-nums" lineHeight="1" whiteSpace="nowrap">
                    {nextMatch.kickoffAt ? formatKickoff(nextMatch.kickoffAt) : "vs"}
                </Text>
                <HStack gap="1.5" justify="flex-start" minW="0">
                    <Text fontSize="xs" fontWeight={700} color={nextMatch.team2Name ? "fg.ink" : "fg.muted"} fontStyle={nextMatch.team2Name ? undefined : "italic"} textAlign="left" lineClamp={2} minW="0">
                        {nextMatch.team2Name ?? "TBD"}
                    </Text>
                    <TeamKitChip colors={colors} teamId={nextMatch.team2Id} size={9} />
                </HStack>
            </Grid>
            <Flex flex="1" minH="0" align="center" justify="center" px="4" py="3">
                <Box textAlign="center">
                    <Text fontSize="2xs" fontWeight={800} color="fg.muted" letterSpacing="wider" textTransform="uppercase">
                        {roundLabel(nextMatch)}
                    </Text>
                    <Text fontSize="sm" fontWeight={700} color="fg.ink" mt="1">
                        Utakmica još nije počela
                    </Text>
                    {nextMatch.kickoffAt && (
                        <Text fontSize="xs" color="fg.muted" mt="0.5">
                            Početak u {formatKickoff(nextMatch.kickoffAt)}
                        </Text>
                    )}
                </Box>
            </Flex>
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
    )
}

export function MatchTickerPanel({
    match,
    uuid: uuidProp,
    nextMatch,
}: {
    match: LiveMatch | null
    /** Streamed tournament's uuid, so jersey colours resolve even with no live
     *  match (when the "next match" is shown). Events still load only when live. */
    uuid?: string | null
    /** Shown when nothing is live: the tournament's next fixture. */
    nextMatch?: ScheduledMatch | null
}) {
    const t = useMatchTicker(match, uuidProp, nextMatch)
    return (
        <PanelShell>
            <MatchTickerHeader match={match} showUpcoming={t.showUpcoming} />
            <MatchTickerBody match={match} nextMatch={nextMatch} t={t} />
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

/** Skupine ↔ Završnica segmented toggle - shared by the standalone header and
 *  the tabbed side panel's Tablica tab. */
function ModeToggle({ mode, onPick }: { mode: PanelMode; onPick: (m: PanelMode) => void }) {
    return (
        <HStack gap="1" bg="bg.panel" rounded="full" p="1" borderWidth="1px" borderColor="border">
            {(["groups", "bracket"] as PanelMode[]).map((m) => (
                <chakra.button
                    key={m}
                    type="button"
                    onClick={() => onPick(m)}
                    px="2.5"
                    py="0.5"
                    rounded="full"
                    fontSize="10px"
                    fontWeight={800}
                    cursor="pointer"
                    bg={mode === m ? "pitch.500" : "transparent"}
                    color={mode === m ? "white" : "fg.muted"}
                    boxShadow={mode === m ? "sm" : undefined}
                    _hover={mode === m ? undefined : { color: "fg.ink" }}
                    transition="background 150ms, color 150ms"
                >
                    {m === "groups" ? "Skupine" : "Završnica"}
                </chakra.button>
            ))}
        </HStack>
    )
}

/** Groups + bracket state: fetch + poll, live-phase auto-follow, selected
 *  group, live-standings overlay. Shared by the standalone GroupTablePanel
 *  (theater) and the tabbed StreamSidePanel (home hero). */
function useGroupTable(match: LiveMatch | null, uuidProp?: string | null) {
    const uuid = match?.tournamentUuid ?? uuidProp ?? null
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

    return {
        uuid, groups, bracket, mode, setManualMode, showToggle,
        selected, live, liveTeamIds, pickedId, setPickedId,
        liveMatchId: match?.matchId ?? null,
    }
}

type GroupTable = ReturnType<typeof useGroupTable>

/** Group chips + live standings / mini bracket (no shell / no kicker header). */
function GroupTableBody({ d }: { d: GroupTable }) {
    const { uuid, groups, bracket, mode, selected, live, liveTeamIds, setPickedId, liveMatchId } = d
    if (!uuid) {
        return (
            <Flex flex="1" align="center" justify="center" px="4">
                <Box textAlign="center">
                    <Text fontSize="sm" fontWeight={700} color="fg.ink">Nema aktivnog turnira</Text>
                    <Text fontSize="xs" color="fg.muted" mt="1">
                        Prikaz se pojavi za vrijeme utakmice.
                    </Text>
                </Box>
            </Flex>
        )
    }
    if (mode === "bracket") {
        return <MiniBracket bracket={bracket} liveMatchId={liveMatchId} />
    }
    return (
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
                                bg={active ? "fg.ink" : "bg.panel"}
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
    )
}

export function GroupTablePanel({
    match,
    uuid: uuidProp,
}: {
    match: LiveMatch | null
    /** Streamed tournament's uuid - shows the groups even when that tournament
     *  isn't playing a live match right now (match would be null). */
    uuid?: string | null
}) {
    const d = useGroupTable(match, uuidProp)
    return (
        <PanelShell>
            {/* Fixed header: kicker + tab toggle + tournament link. */}
            <Flex px="3" py="2" borderBottomWidth="1px" borderColor="border" align="center" justify="space-between" gap="2">
                <Text fontFamily="mono" fontSize="10px" fontWeight={800} letterSpacing="0.08em" color="fg.muted" flexShrink={0}>
                    {d.mode === "bracket" ? "ZAVRŠNICA" : "TABLICA SKUPINE"}
                </Text>
                <HStack gap="2" flexShrink={0}>
                    {d.showToggle && <ModeToggle mode={d.mode} onPick={d.setManualMode} />}
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
            <GroupTableBody d={d} />
        </PanelShell>
    )
}

/* ═══════════════════ Home-hero side panel (Utakmica | Tablica) ═══════════════════ */

/** The home-hero side card: a single panel with two tabs. "Utakmica" (default)
 *  holds the live-match ticker; "Tablica" holds the group/bracket standings
 *  that used to live in a separate third column. Both bodies stay mounted -
 *  visibility toggles - so each keeps its polling and scroll position when the
 *  viewer flips tabs. Reused by the shareable turnir-mode page (/uzivo). */
export function StreamSidePanel({
    match,
    uuid,
    nextMatch,
    tournamentName,
    onEnterTheater,
    events,
}: {
    match: LiveMatch | null
    uuid?: string | null
    nextMatch?: ScheduledMatch | null
    /** Streamed tournament's name - shown at the top of the panel (lg+). */
    tournamentName?: string | null
    /** Opens the live/theater view; backs the "Gledaj uživo" primary button
     *  when set. */
    onEnterTheater?: () => void
    /** Already-polled match events. Pass them when the parent needs the same
     *  list anyway (the home hero also feeds the fullscreen scorer columns) -
     *  the ticker then reuses them instead of opening a second poll. Omit and
     *  the panel fetches its own. */
    events?: MatchEventDto[]
}) {
    const [tab, setTab] = useState<"match" | "table">("match")
    const ticker = useMatchTicker(match, uuid, nextMatch, events)
    const table = useGroupTable(match, uuid)

    // "Turnir" button → the tournament page. Built from the live match when
    // there is one, else the tournament uuid, so it works even between games
    // (turnir mode). Backs the outline secondary button in the footer.
    const tournamentHref = match?.tournamentSlug ?? match?.tournamentUuid ?? uuid ?? null

    // A touch darker than the page canvas (surfaceTint = pale pitch-green) so
    // the whole side panel reads as one "stream module", not a plain white
    // card. Inner segmented controls / group chips flip to white (bg.panel)
    // below so they still read as raised pills on the tint.
    return (
        <PanelShell bg="bg.surfaceTint">
            {/* Header (top), everything centred. Row 1: tournament name (full
                width, truncated); row 2: the Utakmica/Tablica selector (+ the
                Skupine/Završnica toggle on the table tab). The "Gledaj uživo"
                primary and "Turnir" buttons live in the footer. */}
            <VStack align="stretch" gap="1" px="2" py="1.5" borderBottomWidth="1px" borderColor="border">
                {tournamentName && (
                    <Text fontSize="xs" fontWeight={800} color="fg.ink" lineClamp={1} minW="0" textAlign="center">
                        {tournamentName}
                    </Text>
                )}
                <HStack justify="center" gap="2" minW="0" wrap="wrap">
                    <HStack gap="1" bg="bg.panel" rounded="full" p="1" borderWidth="1px" borderColor="border" flexShrink={0}>
                        {([["match", "Utakmica"], ["table", "Tablica"]] as const).map(([k, label]) => (
                            <chakra.button
                                key={k}
                                type="button"
                                onClick={() => setTab(k)}
                                px="3.5"
                                py="1"
                                rounded="full"
                                fontSize="11px"
                                fontWeight={800}
                                cursor="pointer"
                                bg={tab === k ? "pitch.500" : "transparent"}
                                color={tab === k ? "white" : "fg.muted"}
                                boxShadow={tab === k ? "sm" : undefined}
                                _hover={tab === k ? undefined : { color: "fg.ink" }}
                                transition="background 150ms, color 150ms"
                            >
                                {label}
                            </chakra.button>
                        ))}
                    </HStack>
                    {tab === "table" && table.showToggle && (
                        <ModeToggle mode={table.mode} onPick={table.setManualMode} />
                    )}
                </HStack>
            </VStack>

            {/* Both bodies mounted; only the active one is shown. */}
            <Flex direction="column" flex="1" minH="0" display={tab === "match" ? "flex" : "none"}>
                <MatchTickerBody match={match} nextMatch={nextMatch} t={ticker} />
            </Flex>
            <Flex direction="column" flex="1" minH="0" display={tab === "table" ? "flex" : "none"}>
                <GroupTableBody d={table} />
            </Flex>

            {/* Footer actions (SofaScore-style): a prominent solid-green
                "Gledaj uživo" primary that opens the live / turnir-mode view,
                and a smaller outline "Turnir" that links to the streamed
                tournament's page. On the turnir-mode page itself onEnterTheater
                is absent, so only the tournament link shows. */}
            {(onEnterTheater || tournamentHref) && (
                <HStack justify="center" gap="2" px="2.5" py="2" borderTopWidth="1px" borderColor="border">
                    {onEnterTheater && (
                        <Button
                            size="md"
                            colorPalette="pitch"
                            onClick={onEnterTheater}
                            flex="1"
                            maxW="240px"
                            fontWeight={800}
                        >
                            <FiPlay /> Uživo
                        </Button>
                    )}
                    {tournamentHref && (
                        <Button asChild size="sm" variant="outline" colorPalette="pitch" flexShrink={0}>
                            <RouterLink to={`/turniri/${tournamentHref}`}>
                                <FiHome /> Turnir
                            </RouterLink>
                        </Button>
                    )}
                </HStack>
            )}
        </PanelShell>
    )
}

/* ═══════════════════ Nadolazeća utakmica ═══════════════════ */

/** The next match to be played for a tournament: the earliest-kickoff fixture
 *  still to be played (excludes the current live game and finished ones).
 *  Polled so it stays fresh as matches finish. Null until loaded / when nothing
 *  is upcoming. `enabled=false` skips fetching entirely (e.g. while live). */
export function useNextMatch(
    uuid: string | null,
    liveId: number | null,
    enabled = true,
): ScheduledMatch | null {
    const [next, setNext] = useState<ScheduledMatch | null>(null)
    useEffect(() => {
        setNext(null)
        if (!uuid || !enabled) return
        let cancelled = false
        fetchSchedule(uuid)
            .then((s) => { if (!cancelled) setNext(pickNextMatch(s.matches, liveId)) })
            .catch(() => { /* silent - next poll retries */ })
        return () => { cancelled = true }
    }, [uuid, liveId, enabled])
    usePolling(() => {
        if (!uuid || !enabled) return
        fetchSchedule(uuid)
            .then((s) => setNext(pickNextMatch(s.matches, liveId)))
            .catch(() => { /* silent */ })
    }, 30_000, !!uuid && enabled)
    return next
}

/** A compact "next up" card for the streamed tournament: the earliest-kickoff
 *  fixture still to be played (excludes the current live game and finished
 *  ones). Knockout fixtures still waiting on the draw show "TBD". */
export function UpcomingMatchPanel({
    match,
    uuid: uuidProp,
}: {
    match: LiveMatch | null
    uuid?: string | null
}) {
    const uuid = match?.tournamentUuid ?? uuidProp ?? null
    const colors = useTeamColors(uuid)
    const next = useNextMatch(uuid, match?.matchId ?? null)

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
                    <UpcomingRow name={next.team1Name} jersey={teamColor(colors, next.team1Id)} shorts={teamShorts(colors, next.team1Id)} />
                    <UpcomingRow name={next.team2Name} jersey={teamColor(colors, next.team2Id)} shorts={teamShorts(colors, next.team2Id)} />
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

function UpcomingRow({ name, jersey, shorts }: { name: string | null; jersey: string | null; shorts: string | null }) {
    return (
        <HStack gap="2" minW="0">
            {/* Fixed slot so both team names line up whether or not a kit colour
                is set (KitSwatch renders nothing when there's no colour). */}
            <Box w="12px" flexShrink={0} display="inline-flex" justifyContent="center">
                <KitSwatch jersey={jersey} shorts={shorts} size={10} />
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

/** Equal-height panel chrome: fixed headers + a scrollable body slot. `bg`
 *  defaults to the white panel surface; the home-hero side panel passes a
 *  darker pitch-tinted shade so it reads as part of the stream module. */
function PanelShell({ children, bg = "bg.panel" }: { children: React.ReactNode; bg?: string }) {
    return (
        <Flex
            direction="column"
            w="full"
            h="full"
            bg={bg}
            borderWidth="1px"
            borderColor="border"
            rounded="2xl"
            overflow="hidden"
        >
            {children}
        </Flex>
    )
}
