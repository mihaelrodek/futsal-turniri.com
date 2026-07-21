import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Box, Button, Flex, HStack, Menu, Portal, Text, VStack } from "@chakra-ui/react"
import { FiChevronDown, FiEyeOff, FiInfo, FiMaximize2, FiPlay } from "react-icons/fi"
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
import LiveMatchPanel, { type PanelMatch } from "./LiveMatchPanel"
import StreamPlayer from "./StreamPlayer"

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

/** Croatian round name for a knockout stage enum (mirrors the bracket UI) so a
 *  not-yet-drawn fixture reads "Polufinale" / "Finale", not a bare
 *  "Eliminacija". */
function stageLabel(stage?: string | null): string {
    switch (stage) {
        case "ROUND_OF_32": return "Šesnaestina finala"
        case "ROUND_OF_16": return "Osmina finala"
        case "QUARTERFINAL": return "Četvrtfinale"
        case "SEMIFINAL": return "Polufinale"
        case "FINAL": return "Finale"
        case "THIRD_PLACE": return "Za 3. mjesto"
        default: return "Eliminacija"
    }
}

/** Structured match-picker data: a status (drives the chip), the teams line,
 *  and a muted meta line (stage · time) - e.g. { LIVE, "Roma – Đurđ",
 *  "Grupa · 10. 07. 20:00" }. A knockout fixture that's on the schedule before
 *  its teams are decided shows "TBD – TBD" (the group stage still has to say
 *  who plays). */
type MatchMeta = {
    status: "LIVE" | "ONDECK" | "SCHEDULED"
    teams: string
    meta: string
}

function matchMeta(e: Entry, onDeck: boolean): MatchMeta {
    const m = e.match
    const teams = `${m.team1Name ?? "TBD"} – ${m.team2Name ?? "TBD"}`
    const stage =
        e.kind === "group" ? "Grupa" : stageLabel((m as { stage?: string | null }).stage)
    const when = m.kickoffAt ? fmtKickoff(m.kickoffAt) : ""
    const meta = [stage, when].filter(Boolean).join(" · ")
    const status = m.status === "LIVE" ? "LIVE" : onDeck ? "ONDECK" : "SCHEDULED"
    return { status, teams, meta }
}

/** Left-hand status chip: a red pulsing "UŽIVO" pill for a live match, else a
 *  muted "NA REDU" (the on-deck match) / "ZAKAZANO" tag. */
function StatusChip({ status }: { status: MatchMeta["status"] }) {
    if (status === "LIVE") {
        return (
            <HStack gap="1.5" bg="red.solid" color="white" rounded="full" px="2.5" py="1" flexShrink={0}>
                <PulseDot color="white" size={6} glow />
                <Text fontSize="2xs" fontWeight={800} letterSpacing="wide">UŽIVO</Text>
            </HStack>
        )
    }
    const label = status === "ONDECK" ? "NA REDU" : "ZAKAZANO"
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
}: {
    uuid: string
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
}) {
    const navigate = useNavigate()
    const [groups, setGroups] = useState<Group[] | null>(null)
    const [knockout, setKnockout] = useState<BracketMatch[] | null>(null)
    const [loading, setLoading] = useState(true)
    const [selectedId, setSelectedId] = useState<number | null>(null)

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

    // Manageable = a fixture with both teams decided, a kickoff (→ the schedule
    // is generated) and still LIVE or SCHEDULED. LIVE first, then by kickoff.
    const manageable = useMemo<Entry[]>(() => {
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
                    (e.match.status === "LIVE" || e.match.status === "SCHEDULED"),
            )
            .sort((a, b) => {
                const sr = (STATUS_RANK[a.match.status] ?? 9) - (STATUS_RANK[b.match.status] ?? 9)
                if (sr !== 0) return sr
                return kickoffMs(a.match.kickoffAt) - kickoffMs(b.match.kickoffAt)
            })
    }, [groups, knockout])

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
    // LIVE one, else the next-to-play (earliest kickoff SCHEDULED). A manual
    // pick (selectedId) overrides until that match leaves the list (finished).
    const fallback = manageable.find((e) => e.match.status === "LIVE") ?? manageable[0] ?? null
    const selected = manageable.find((e) => e.match.matchId === selectedId) ?? fallback

    // Finished + locked: the console is off entirely - show the notice instead.
    if (finishedLocked) {
        return (
            <Panel>
                <Flex align="center" gap="2" color="fg.muted">
                    <FiInfo size={14} />
                    <Text fontFamily="mono" fontSize="xs" fontWeight={600}>
                        Turnir je završen. Obrati se administratoru za otključavanje.
                    </Text>
                </Flex>
            </Panel>
        )
    }

    if (loading) return <Loader />

    if (manageable.length === 0 && pending.length === 0) {
        return (
            <Panel>
                <EmptyState
                    icon={LuRadioTower}
                    title="Nema utakmice za vođenje"
                    description="Kad generiraš raspored, ovdje će se pojaviti aktivna i nadolazeće utakmice za vođenje uživo."
                />
            </Panel>
        )
    }

    // Nothing to record yet, but the schedule already holds knockout fixtures
    // waiting on the draw: list them as upcoming "TBD" games instead of the
    // empty state, so it's clear the final/semifinal is scheduled.
    if (manageable.length === 0) {
        return (
            <Panel>
                <VStack align="stretch" gap="3">
                    <Flex align="center" gap="2">
                        <Box color="fg.muted" display="inline-flex"><LuRadioTower size={16} /></Box>
                        <Text fontSize="sm" fontWeight={800} color="fg.ink">
                            Nadolazeće utakmice
                        </Text>
                    </Flex>
                    <Text fontSize="xs" color="fg.muted" lineHeight="1.45">
                        Parovi se popunjavaju kad završi grupna faza - do tada stoji TBD.
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
                                <MatchCardContent meta={matchMeta(e, false)} />
                            </Flex>
                        ))}
                    </VStack>
                </VStack>
            </Panel>
        )
    }

    // The styled match-selector: a structured card-like trigger (status chip +
    // two-line teams/meta + chevron); a Menu lists the other matches as rows of
    // the same shape. Single-match case renders the same card without the Menu.
    const selectedMeta = selected
        ? matchMeta(selected, selected.match.matchId === fallback?.match.matchId)
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
    const selector =
        manageable.length + pending.length > 1 ? (
            <Menu.Root>
                <Menu.Trigger asChild>
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
                </Menu.Trigger>
                <Portal>
                    <Menu.Positioner>
                        <Menu.Content maxW="min(92vw, 640px)" maxH="60vh" overflowY="auto">
                            {manageable.map((e) => (
                                <Menu.Item
                                    key={`${e.kind}-${e.match.matchId}`}
                                    value={String(e.match.matchId)}
                                    onClick={() => setSelectedId(e.match.matchId)}
                                >
                                    <Flex align="center" gap="3" w="full" minW="0">
                                        <MatchCardContent
                                            meta={matchMeta(e, e.match.matchId === fallback?.match.matchId)}
                                            active={e.match.matchId === selected?.match.matchId}
                                        />
                                    </Flex>
                                </Menu.Item>
                            ))}
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
                                                <MatchCardContent meta={matchMeta(e, false)} />
                                            </Flex>
                                        </Menu.Item>
                                    ))}
                                </>
                            )}
                        </Menu.Content>
                    </Menu.Positioner>
                </Portal>
            </Menu.Root>
        ) : (
            <Flex {...cardBox}>
                {selectedMeta && <MatchCardContent meta={selectedMeta} />}
            </Flex>
        )

    // Keyed by id+status so a status change (SCHEDULED→LIVE→…) remounts it with
    // fresh state.
    return selected ? (
        <VStack align="stretch" gap="4">
            {/* "Puni zapisnik" now lives INSIDE the console header (headerAction).
                Only when this console is embedded in the tournament tab (the prop
                is set there); the standalone page omits it so there's no
                self-link. */}
            <LiveMatchPanel
                key={`${selected.match.matchId}-${selected.match.status}`}
                uuid={uuid}
                kind={selected.kind}
                match={selected.match}
                onChanged={reload}
                selector={selector}
                onClockArgs={onClockArgs}
                headerAction={
                    standaloneHref ? (
                        <Button
                            size="xs"
                            variant="outline"
                            colorPalette="pitch"
                            onClick={() => navigate(standaloneHref)}
                        >
                            <FiMaximize2 /> Puni zapisnik
                        </Button>
                    ) : undefined
                }
            />
            {/* Optional live stream of the match being recorded (organizer aid):
                only when the admin has linked a stream to THIS tournament. Kept
                below the console and low-key when collapsed - it's a nice-to-have,
                not the main event. */}
            <StreamSection uuid={uuid} />
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
function StreamSection({ uuid }: { uuid: string }) {
    const [banner, setBanner] = useState<StreamBanner | null>(null)
    const [shown, setShown] = useState<boolean>(() => {
        try {
            return localStorage.getItem(`zapisnik-stream-${uuid}`) === "1"
        } catch {
            return false
        }
    })

    useEffect(() => {
        let cancelled = false
        fetchStreamBanner()
            .then((b) => { if (!cancelled) setBanner(b) })
            .catch(() => { /* silent - next poll retries */ })
        return () => { cancelled = true }
    }, [])
    // The admin may link/paste a stream mid-match; keep it fresh.
    usePolling(() => {
        fetchStreamBanner().then(setBanner).catch(() => { /* silent */ })
    }, 30_000)

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
                    <Text fontSize="sm" fontWeight={800} color="fg.ink" truncate>Prijenos utakmice</Text>
                </HStack>
                <Button size="sm" variant="outline" colorPalette="pitch" onClick={toggle} flexShrink={0}>
                    {shown ? <><FiEyeOff /> Sakrij prijenos</> : <><FiPlay /> Prikaži prijenos</>}
                </Button>
            </Flex>
            {shown && (
                // A real width (not just maxW) drives the fit-content panel to
                // hug the player at up to 760px; maxW="full" keeps it from
                // overflowing a narrow content column (e.g. tablet width).
                <Box w={{ base: "full", md: "760px" }} maxW="full" mx="auto">
                    <StreamPlayer url={url} viewers={viewers} />
                </Box>
            )}
        </Box>
    )
}
