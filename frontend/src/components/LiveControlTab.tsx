import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router-dom"
import { Box, Button, Flex, HStack, Menu, Portal, Text, VStack } from "@chakra-ui/react"
import { FiCheckCircle, FiChevronDown, FiEyeOff, FiInfo, FiList, FiMaximize2, FiPlay } from "react-icons/fi"
import { LuRadioTower } from "react-icons/lu"

import { fetchGroups } from "../api/groups"
import { fetchBracket } from "../api/bracket"
import { fetchStreamBanner, type StreamBanner } from "../api/streamBanner"
import type { Group } from "../types/groups"
import type { BracketMatch } from "../types/bracket"
import { usePolling } from "../hooks/usePolling"
import { useStreamPresence } from "../hooks/useStreamPresence"
import { EmptyState, Loader, Panel } from "../ui/primitives"
import { PulseDot } from "../ui/pitch"
import { useTranslation, type Dictionary } from "../i18n"
import LiveMatchPanel, { type PanelMatch } from "./LiveMatchPanel"
import StreamPlayer from "./StreamPlayer"

type LiveControlLabels = Dictionary["components"]["liveControlTab"]

/* ──────────────────────────────────────────────────────────────────────────
   "Zapisnik" - organizer-only match-recording control centre, fully inline.

   Pulls every group + knockout fixture that already has a kickoff (i.e. the
   schedule is generated), surfaces the current LIVE (or next on-deck) match
   with the inline live-control panel, and a dropdown to jump to any other
   scheduled/live match. Nothing shows before the schedule exists.
   ────────────────────────────────────────────────────────────────────────── */

type Entry = { kind: "group" | "knockout"; match: PanelMatch }

const STATUS_RANK: Record<string, number> = { LIVE: 0, SCHEDULED: 1 }

const kickoffMs = (k?: string | null) =>
    k ? new Date(k).getTime() : Number.POSITIVE_INFINITY

function fmtKickoff(k?: string | null): string {
    if (!k) return "-"
    return new Date(k).toLocaleString("hr-HR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    })
}

/** Round name for a knockout stage enum (mirrors the bracket UI) so a
 *  not-yet-drawn fixture reads "Polufinale" / "Finale", not a bare
 *  "Eliminacija". */
function stageLabel(stage: string | null | undefined, labels: LiveControlLabels["stageLabels"]): string {
    switch (stage) {
        case "ROUND_OF_32": return labels.ROUND_OF_32
        case "ROUND_OF_16": return labels.ROUND_OF_16
        case "QUARTERFINAL": return labels.QUARTERFINAL
        case "SEMIFINAL": return labels.SEMIFINAL
        case "FINAL": return labels.FINAL
        case "THIRD_PLACE": return labels.THIRD_PLACE
        default: return labels.default
    }
}

/** Structured match-picker data: a status (drives the chip), the teams line,
 *  and a muted meta line (stage · time) - e.g. { LIVE, "Roma – Đurđ",
 *  "Grupa · 10. 07. 20:00" }. A knockout fixture that's on the schedule before
 *  its teams are decided shows "TBD – TBD" (the group stage still has to say
 *  who plays). */
type MatchMeta = {
    status: "LIVE" | "ONDECK" | "SCHEDULED" | "FINISHED"
    teams: string
    meta: string
}

function matchMeta(e: Entry, onDeck: boolean, labels: LiveControlLabels): MatchMeta {
    const m = e.match
    const teams = `${m.team1Name ?? "TBD"} – ${m.team2Name ?? "TBD"}`
    const stage =
        e.kind === "group" ? labels.groupLabel : stageLabel((m as { stage?: string | null }).stage, labels.stageLabels)
    const when = m.kickoffAt ? fmtKickoff(m.kickoffAt) : ""
    const meta = [stage, when].filter(Boolean).join(" · ")
    const status =
        m.status === "LIVE" ? "LIVE" :
            m.status === "FINISHED" ? "FINISHED" :
                onDeck ? "ONDECK" : "SCHEDULED"
    return { status, teams, meta }
}

/** Left-hand status chip: a red pulsing "UŽIVO" pill for a live match, else a
 *  muted "NA REDU" (the on-deck match) / "ZAKAZANO" tag. */
function StatusChip({ status }: { status: MatchMeta["status"] }) {
    const t = useTranslation()
    const tc = t.components.liveControlTab
    if (status === "LIVE") {
        return (
            <HStack gap="1.5" bg="red.solid" color="white" rounded="full" px="2.5" py="1" flexShrink={0}>
                <PulseDot color="white" size={6} glow />
                <Text fontSize="2xs" fontWeight={800} letterSpacing="wide">{tc.statusLive}</Text>
            </HStack>
        )
    }
    const label = status === "ONDECK" ? tc.statusOnDeck : status === "FINISHED" ? tc.statusFinished : tc.statusScheduled
    return (
        <Box bg="bg.muted" color="fg.muted" rounded="full" px="2.5" py="1" flexShrink={0}>
            <Text fontSize="2xs" fontWeight={800} letterSpacing="wide">{label}</Text>
        </Box>
    )
}

/** One picker row/trigger body: status chip · two-line teams(bold)/meta(muted).
 *  Truncation-safe so long team names never push the layout wide. `active`
 *  marks the currently-selected match with a trailing check. */
function MatchCardContent({ meta, active }: { meta: MatchMeta; active?: boolean }) {
    return (
        <>
            <StatusChip status={meta.status} />
            <VStack align="stretch" gap="0.5" minW="0" flex="1">
                <Text fontSize="sm" fontWeight={800} color="fg.ink" truncate>{meta.teams}</Text>
                {meta.meta && (
                    <Text fontSize="2xs" fontWeight={600} color="fg.muted" truncate>{meta.meta}</Text>
                )}
            </VStack>
            {active && (
                <Text as="span" color="green.solid" fontWeight={800} flexShrink={0}>✓</Text>
            )}
        </>
    )
}

export default function LiveControlTab({
    uuid,
    finishedLocked = false,
    standaloneHref,
    onClockArgs,
    onFixturesSettled,
    selectorSlot,
    onSelectedMatch,
    onScore,
}: {
    uuid: string
    /** Forwarded to the panel: the live, event-derived score for a host header. */
    onScore?: (score1: number, score2: number) => void
    /** Reports which match the console is CURRENTLY on, so a host header can
     *  follow the picker instead of showing whatever happens to be live. Called
     *  with null while nothing is selected. */
    onSelectedMatch?: (m: {
        team1Id: number | null
        team1Name: string | null
        team2Id: number | null
        team2Name: string | null
        score1: number | null
        score2: number | null
        status: string | null
    } | null) => void
    /** DOM node to render the match picker into instead of inline - the
     *  zapisnik's sticky header. A portal rather than a lifted React node:
     *  the picker owns open/selected state, and handing a rendered node up
     *  through a callback would re-create it on every parent render. */
    selectorSlot?: HTMLElement | null
    /** Tournament FINISHED + non-admin viewer: render the "locked" notice
     *  instead of the live-control console (the simplest robust lock). */
    finishedLocked?: boolean
    /** When set (embedded-in-tab usage), render a small "Puni zapisnik" link
     *  above the console that opens the standalone scorekeeper view at this
     *  href. Omitted on the standalone page itself, so it shows no self-link. */
    standaloneHref?: string
    /** Passed straight through to the live panel: lifts the console's own clock
     *  instants up to a host (fullscreen zapisnik header) so its clock ticks
     *  from the same instants and freezes together on pause. */
    onClockArgs?: (
        args: {
            liveStartedAt: string | null | undefined
            firstHalfEndedAt: string | null
            secondHalfStartedAt: string | null
            livePausedAt: string | null
            halfLengthMin: number | null
            halfCount: number | null
        } | null,
    ) => void
    /** Fired once the fixtures have loaded, and again whenever a result is
     *  entered or corrected - NOT on every goal/card. `finalDecided` says the
     *  tournament has been played out; the standalone zapisnik uses it to offer
     *  the awards + "Završi turnir" card right there. `initial` marks the first
     *  (load) call, which reports state rather than a change. */
    onFixturesSettled?: (info: { finalDecided: boolean; initial: boolean }) => void
}) {
    const navigate = useNavigate()
    const t = useTranslation()
    const tc = t.components.liveControlTab
    const [groups, setGroups] = useState<Group[] | null>(null)
    const [knockout, setKnockout] = useState<BracketMatch[] | null>(null)
    const [loading, setLoading] = useState(true)
    const [selectedId, setSelectedId] = useState<number | null>(null)
    const [showFinished, setShowFinished] = useState(false)
    const [pickerOpen, setPickerOpen] = useState(false)

    // Lifted here (rather than fetched only inside StreamSection below) so
    // LiveMatchPanel can also see it: while THIS tournament is actually
    // streaming, the mode picker only offers "s mjeračem vremena" - a
    // SIMPLE/result-only match would leave the overlay clock unusable.
    const [banner, setBanner] = useState<StreamBanner | null>(null)
    useEffect(() => {
        let cancelled = false
        fetchStreamBanner().then((b) => { if (!cancelled) setBanner(b) }).catch(() => { /* silent - next poll retries */ })
        return () => { cancelled = true }
    }, [])
    usePolling(() => {
        fetchStreamBanner().then(setBanner).catch(() => { /* silent */ })
    }, 30_000)
    const streamActive = !!banner?.live && banner.tournamentUuid === uuid

    const reload = useCallback(async () => {
        const [g, b] = await Promise.all([
            fetchGroups(uuid).catch(() => [] as Group[]),
            fetchBracket(uuid).catch(() => null),
        ])
        setGroups(g)
        const ko: BracketMatch[] = []
        if (b) {
            for (const r of b.rounds) for (const m of r.matches) ko.push(m)
            if (b.thirdPlace) ko.push(b.thirdPlace)
        }
        setKnockout(ko)
    }, [uuid])

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        reload().finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [reload])

    // A recordable fixture has both teams decided and a kickoff (→ the schedule
    // is generated). Finished matches stay hidden until the user asks for them,
    // but they remain selectable so results can be corrected through Zapisnik.
    const recordable = useMemo<Entry[]>(() => {
        const out: Entry[] = []
        for (const g of groups ?? [])
            for (const m of g.matches)
                out.push({ kind: "group", match: m as PanelMatch })
        for (const m of knockout ?? [])
            out.push({ kind: "knockout", match: m as PanelMatch })
        return out
            .filter(
                (e) =>
                    e.match.team1Id != null &&
                    e.match.team2Id != null &&
                    e.match.kickoffAt != null &&
                    (e.match.status === "LIVE" || e.match.status === "SCHEDULED" || e.match.status === "FINISHED"),
            )
            .sort((a, b) => {
                const sr = (STATUS_RANK[a.match.status] ?? 9) - (STATUS_RANK[b.match.status] ?? 9)
                if (sr !== 0) return sr
                return kickoffMs(a.match.kickoffAt) - kickoffMs(b.match.kickoffAt)
            })
    }, [groups, knockout])

    const manageable = useMemo(
        () => recordable.filter((e) => e.match.status === "LIVE" || e.match.status === "SCHEDULED"),
        [recordable],
    )
    const finished = useMemo(
        () => recordable
            .filter((e) => e.match.status === "FINISHED")
            .sort((a, b) => kickoffMs(b.match.kickoffAt) - kickoffMs(a.match.kickoffAt)),
        [recordable],
    )
    const selectable = useMemo(
        () => showFinished ? [...manageable, ...finished] : manageable,
        [manageable, finished, showFinished],
    )

    /** The tournament has been played out. Primary signal is the FINAL match
     *  being FINISHED - both formats have one, and it is what decides the
     *  champion regardless of how the result was entered (timer or score-only).
     *  A bracket without a FINAL entry is a legacy/odd shape: fall back to
     *  "nothing left to record". */
    const finalDecided = useMemo(() => {
        const ko = knockout ?? []
        const fin = ko.find((m) => m.stage === "FINAL")
        if (fin) return fin.status === "FINISHED"
        return recordable.length > 0 && manageable.length === 0
    }, [knockout, recordable.length, manageable.length])

    // Report the fixture state to the host: once on load, then on every change
    // to the finished count or to `finalDecided`. Deliberately not on every
    // mutation - goals and cards don't move either value.
    const settledRef = useRef<string | null>(null)
    useEffect(() => {
        if (loading) return
        const stamp = `${finished.length}|${finalDecided}`
        const first = settledRef.current === null
        if (settledRef.current === stamp) return
        settledRef.current = stamp
        onFixturesSettled?.({ finalDecided, initial: first })
    }, [finished.length, finalDecided, loading, onFixturesSettled])

    // Generated knockout fixtures whose participants aren't decided yet - e.g. a
    // semifinal/final drawn with a reserved kickoff while the group stage is
    // still running. They can't be recorded (no teams), but the organizer should
    // still see them on the schedule as upcoming "TBD" games. Byes are
    // auto-FINISHED, so the SCHEDULED filter already leaves them out.
    const pending = useMemo<Entry[]>(() => {
        const out: Entry[] = []
        for (const m of knockout ?? []) {
            const pm = m as PanelMatch
            if (
                pm.kickoffAt != null &&
                pm.status === "SCHEDULED" &&
                (pm.team1Id == null || pm.team2Id == null)
            ) {
                out.push({ kind: "knockout", match: pm })
            }
        }
        return out.sort(
            (a, b) => kickoffMs(a.match.kickoffAt) - kickoffMs(b.match.kickoffAt),
        )
    }, [knockout])

    // Default selection = the match the schedule says is up now: the current
    // LIVE one, else the next-to-play (earliest kickoff SCHEDULED). Finished
    // matches become fallbacks only after the explicit "Pokaži završene" click.
    const fallback =
        manageable.find((e) => e.match.status === "LIVE") ??
        manageable[0] ??
        (showFinished ? finished[0] ?? null : null)
    const selected = selectable.find((e) => e.match.matchId === selectedId) ?? fallback

    // Keep the host header in step with the picker. Depends on the score and
    // status too, so a goal entered on the selected match updates the header
    // without waiting for the live-matches poll.
    const sm = selected?.match
    useEffect(() => {
        if (!onSelectedMatch) return
        onSelectedMatch(sm
            ? {
                team1Id: sm.team1Id ?? null,
                team1Name: sm.team1Name ?? null,
                team2Id: sm.team2Id ?? null,
                team2Name: sm.team2Name ?? null,
                score1: sm.score1 ?? null,
                score2: sm.score2 ?? null,
                status: sm.status ?? null,
            }
            : null)
        return () => onSelectedMatch(null)
    }, [
        onSelectedMatch, sm, sm?.team1Id, sm?.team1Name, sm?.team2Id, sm?.team2Name,
        sm?.score1, sm?.score2, sm?.status,
    ])

    // Finished + locked: the console is off entirely - show the notice instead.
    if (finishedLocked) {
        return (
            <Panel>
                <Flex align="center" gap="2" color="fg.muted">
                    <FiInfo size={14} />
                    <Text fontFamily="mono" fontSize="xs" fontWeight={600}>
                        {tc.lockedNotice}
                    </Text>
                </Flex>
            </Panel>
        )
    }

    if (loading) return <Loader />

    if (recordable.length === 0 && pending.length === 0) {
        return (
            <Panel>
                <EmptyState
                    icon={LuRadioTower}
                    title={tc.emptyNoMatchTitle}
                    description={tc.emptyNoMatchDesc}
                />
            </Panel>
        )
    }

    // Every match already recorded, nothing pending - the tournament is done.
    // A centred "završen" notice reads far better than the sparse card the
    // "pending" branch below renders (which floats top-left, no context).
    if (selectable.length === 0 && pending.length === 0) {
        return (
            <Panel>
                <EmptyState
                    icon={FiCheckCircle}
                    title={tc.tournamentFinishedTitle}
                    description={tc.tournamentFinishedDesc(finished.length)}
                    action={
                        !showFinished ? (
                            <Button size="sm" variant="outline" colorPalette="pitch" onClick={() => setShowFinished(true)}>
                                {tc.showFinished(finished.length)}
                            </Button>
                        ) : undefined
                    }
                />
            </Panel>
        )
    }

    // Nothing to record yet, but the schedule already holds knockout fixtures
    // waiting on the draw: list them as upcoming "TBD" games instead of the
    // empty state, so it's clear the final/semifinal is scheduled.
    if (selectable.length === 0) {
        return (
            <Panel>
                <VStack align="stretch" gap="3">
                    <Flex align="center" gap="2">
                        <Box color="fg.muted" display="inline-flex"><LuRadioTower size={16} /></Box>
                        <Text fontSize="sm" fontWeight={800} color="fg.ink">
                            {tc.upcomingHeading}
                        </Text>
                    </Flex>
                    <Text fontSize="xs" color="fg.muted" lineHeight="1.45">
                        {tc.upcomingHint}
                    </Text>
                    <VStack align="stretch" gap="2">
                        {pending.map((e) => (
                            <Flex
                                key={`pending-${e.match.matchId}`}
                                align="center"
                                gap="3"
                                borderWidth="1px"
                                borderColor="border"
                                rounded="lg"
                                px="3"
                                py="2.5"
                                minW="0"
                            >
                                <MatchCardContent meta={matchMeta(e, false, tc)} />
                            </Flex>
                        ))}
                    </VStack>
                    {finished.length > 0 && !showFinished && (
                        <Button size="sm" variant="outline" colorPalette="pitch" onClick={() => setShowFinished(true)} alignSelf="flex-start">
                            {tc.showFinished(finished.length)}
                        </Button>
                    )}
                </VStack>
            </Panel>
        )
    }

    // The styled match-selector: a structured card-like trigger (status chip +
    // two-line teams/meta + chevron); a Menu lists the other matches as rows of
    // the same shape. Single-match case renders the same card without the Menu.
    const selectedMeta = selected
        ? matchMeta(selected, selected.match.matchId === fallback?.match.matchId, tc)
        : null
    const cardBox = {
        align: "center" as const,
        gap: "3",
        w: "auto",
        maxW: { base: "100%", md: "xl" },
        minW: "0",
        borderWidth: "1px",
        borderColor: "border",
        rounded: "2xl",
        px: "3.5",
        py: "2.5",
        bg: "bg.panel",
    }
    /** True when there is anything to pick BETWEEN - one match needs no menu. */
    const hasPicker =
        selectable.length + pending.length > 1 || (finished.length > 0 && !showFinished)

    /**
     * The picker, around whatever trigger the caller wants.
     *
     * Two triggers exist: the wide match card the console shows inline, and a
     * compact "Izaberi utakmicu" button for the zapisnik's sticky header. The
     * MENU is shared - one list, one selection state, one "Pokaži završene"
     * toggle - so the two can never drift apart.
     */
    const pickerMenu = (trigger: React.ReactNode) => (
            <Menu.Root open={pickerOpen} onOpenChange={(e) => setPickerOpen(e.open)}>
                <Menu.Trigger asChild>
                    {trigger}
                </Menu.Trigger>
                <Portal>
                    <Menu.Positioner>
                        <Menu.Content maxW="min(92vw, 640px)" maxH="60vh" overflowY="auto">
                            {selectable.map((e) => (
                                <Menu.Item
                                    key={`${e.kind}-${e.match.matchId}`}
                                    value={String(e.match.matchId)}
                                    onClick={() => setSelectedId(e.match.matchId)}
                                >
                                    <Flex align="center" gap="3" w="full" minW="0">
                                        <MatchCardContent
                                            meta={matchMeta(e, e.match.matchId === fallback?.match.matchId, tc)}
                                            active={e.match.matchId === selected?.match.matchId}
                                        />
                                    </Flex>
                                </Menu.Item>
                            ))}
                            {finished.length > 0 && !showFinished && (
                                <>
                                    <Menu.Separator />
                                    <Box px="2" py="1.5">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            colorPalette="pitch"
                                            w="full"
                                            justifyContent="flex-start"
                                            fontWeight={800}
                                            onClick={(event) => {
                                                event.preventDefault()
                                                event.stopPropagation()
                                                setShowFinished(true)
                                                window.setTimeout(() => setPickerOpen(true), 0)
                                            }}
                                        >
                                            {tc.showFinished(finished.length)}
                                        </Button>
                                    </Box>
                                </>
                            )}
                            {pending.length > 0 && (
                                <>
                                    <Menu.Separator />
                                    {pending.map((e) => (
                                        <Menu.Item
                                            key={`pending-${e.match.matchId}`}
                                            value={`pending-${e.match.matchId}`}
                                            disabled
                                        >
                                            <Flex align="center" gap="3" w="full" minW="0">
                                                <MatchCardContent meta={matchMeta(e, false, tc)} />
                                            </Flex>
                                        </Menu.Item>
                                    ))}
                                </>
                            )}
                        </Menu.Content>
                    </Menu.Positioner>
                </Portal>
            </Menu.Root>
    )

    const wideTrigger = (
        <Flex
            {...cardBox}
            as="button"
            cursor="pointer"
            _hover={{ borderColor: "border.emphasized" }}
            textAlign="left"
        >
            {selectedMeta && <MatchCardContent meta={selectedMeta} />}
            <Box color="fg.muted" flexShrink={0}><FiChevronDown size={16} /></Box>
        </Flex>
    )

    // Inline in the console: the wide card, exactly as before. When a host
    // supplies a header slot the picker moves there instead, and the console
    // renders nothing in its place - two of the same control on one screen is
    // one too many.
    const selector = selectorSlot
        ? null
        : hasPicker
            ? pickerMenu(wideTrigger)
            : (
                <Flex {...cardBox}>
                    {selectedMeta && <MatchCardContent meta={selectedMeta} />}
                </Flex>
            )

    /** The header-mounted picker, portalled into the host's slot. */
    const headerPicker = selectorSlot && hasPicker
        ? createPortal(
            pickerMenu(
                <Button
                    size="xs"
                    variant="outline"
                    colorPalette="gray"
                    maxW={{ base: "9.5rem", md: "13rem" }}
                >
                    <FiList />
                    <Box as="span" truncate>{tc.pickMatch}</Box>
                    <FiChevronDown size={14} />
                </Button>,
            ),
            selectorSlot,
        )
        : null

    // Keyed by id+status so a status change (SCHEDULED→LIVE→…) remounts the
    // panel with fresh state.
    return selected ? (
        <VStack align="stretch" gap="4">
            {headerPicker}
            <LiveMatchPanel
                key={`${selected.match.matchId}-${selected.match.status}`}
                uuid={uuid}
                kind={selected.kind}
                match={selected.match}
                onChanged={reload}
                selector={selector}
                streamActive={streamActive}
                onClockArgs={onClockArgs}
                onScore={onScore}
                footerAction={
                    standaloneHref ? (
                        <Button
                            size="xs"
                            variant="outline"
                            colorPalette="pitch"
                            onClick={() => navigate(standaloneHref)}
                        >
                            <FiMaximize2 /> {tc.fullscreenButton}
                        </Button>
                    ) : undefined
                }
            />
            {/* Optional live stream of the match being recorded (organizer aid):
                only when the admin has linked a stream to THIS tournament. Kept
                below the console and low-key when collapsed - it's a nice-to-have,
                not the main event. */}
            <StreamSection uuid={uuid} banner={banner} />
        </VStack>
    ) : null
}

/* ──────────────────────────────────────────────────────────────────────────
   StreamSection - lets the scorekeeper watch the tournament's live stream right
   inside the Zapisnik, so goals can be entered the moment they happen. Uses
   ONLY the stream the admin linked to this tournament (the home-page banner);
   there's no URL to paste. Off by default; the show/hide choice is remembered
   per tournament. Renders nothing when no stream is linked here.
   ────────────────────────────────────────────────────────────────────────── */
function StreamSection({ uuid, banner }: { uuid: string; banner: StreamBanner | null }) {
    const t = useTranslation()
    const tc = t.components.liveControlTab
    const [shown, setShown] = useState<boolean>(() => {
        try {
            return localStorage.getItem(`zapisnik-stream-${uuid}`) === "1"
        } catch {
            return false
        }
    })

    // A stream is available here only when the admin linked one to THIS
    // tournament (t.uuid is canonical, same as banner.tournamentUuid).
    const url = banner?.url && banner.tournamentUuid === uuid ? banner.url : null
    // Zapisnik watchers join the global viewer count too: heartbeat only while
    // the player is actually shown. Called before the early return below so the
    // hook order stays stable across renders.
    const viewers = useStreamPresence(shown && !!url)
    if (!url) return null

    function toggle() {
        setShown((prev) => {
            const next = !prev
            try { localStorage.setItem(`zapisnik-stream-${uuid}`, next ? "1" : "0") } catch { /* ignore */ }
            return next
        })
    }

    return (
        <Box
            bg="bg.panel"
            borderWidth="1px"
            borderColor="border"
            rounded={shown ? "2xl" : "xl"}
            shadow={shown ? "sm" : "none"}
            p="3"
            // Expanded: the panel HUGS the (now bigger) player and centres, so
            // there's no dead white frame to its left/right - the video is the
            // star. Collapsed stays a slim full-width row so the show/hide
            // toggle is always easy to find.
            w={shown ? { base: "full", md: "fit-content" } : "full"}
            minW={shown ? { md: "480px" } : undefined}
            mx={shown ? "auto" : undefined}
        >
            <Flex align="center" justify="space-between" gap="2" mb={shown ? "3" : "0"}>
                <HStack gap="2" minW="0">
                    <Box color="accent.red" display="inline-flex"><LuRadioTower size={16} /></Box>
                    <Text fontSize="sm" fontWeight={800} color="fg.ink" truncate>{tc.streamSectionHeading}</Text>
                </HStack>
                <Button size="sm" variant="outline" colorPalette="pitch" onClick={toggle} flexShrink={0}>
                    {shown ? <><FiEyeOff /> {tc.streamHide}</> : <><FiPlay /> {tc.streamShow}</>}
                </Button>
            </Flex>
            {shown && (
                // A real width (not just maxW) drives the fit-content panel to
                // hug the player at up to 760px; maxW="full" keeps it from
                // overflowing a narrow content column (e.g. tablet width).
                <Box w={{ base: "full", md: "760px" }} maxW="full" mx="auto">
                    <StreamPlayer url={url} viewers={viewers} tournamentUuid={uuid} />
                </Box>
            )}
        </Box>
    )
}
