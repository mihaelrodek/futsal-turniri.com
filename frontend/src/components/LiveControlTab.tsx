import { useCallback, useEffect, useMemo, useState } from "react"
import { Box, Flex, Menu, Portal, Text, VStack } from "@chakra-ui/react"
import { FiChevronDown } from "react-icons/fi"
import { LuRadioTower } from "react-icons/lu"

import { fetchGroups } from "../api/groups"
import { fetchBracket } from "../api/bracket"
import type { Group } from "../types/groups"
import type { BracketMatch } from "../types/bracket"
import { EmptyState, Loader, Panel } from "../ui/primitives"
import LiveMatchPanel, { type PanelMatch } from "./LiveMatchPanel"

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

/** Trigger / menu label: a status tag (● UŽIVO / ▶ NA REDU), the teams, then
 *  stage + time - e.g. "● UŽIVO · Roma – Đurđ · Grupa · 10. 07. 20:00". A
 *  knockout fixture that's on the schedule before its teams are decided shows
 *  "TBD – TBD" (the group stage still has to say who plays). */
function optionLabel(e: Entry, onDeck: boolean): string {
    const m = e.match
    const teams = `${m.team1Name ?? "TBD"} – ${m.team2Name ?? "TBD"}`
    const stage =
        e.kind === "group" ? "Grupa" : stageLabel((m as { stage?: string | null }).stage)
    const when = m.kickoffAt ? fmtKickoff(m.kickoffAt) : ""
    const meta = [stage, when].filter(Boolean).join(" · ")
    const tag = m.status === "LIVE" ? "● UŽIVO · " : onDeck ? "▶ NA REDU · " : ""
    return `${tag}${teams}${meta ? ` · ${meta}` : ""}`
}

export default function LiveControlTab({ uuid }: { uuid: string }) {
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
                                borderWidth="1px"
                                borderColor="border"
                                rounded="lg"
                                px="3"
                                py="2.5"
                            >
                                <Text fontSize="sm" fontWeight={700} color="fg.ink" minW="0" truncate>
                                    {optionLabel(e, false)}
                                </Text>
                            </Flex>
                        ))}
                    </VStack>
                </VStack>
            </Panel>
        )
    }

    // The styled match-selector (design: an outlined full-width button with the
    // current match label + a chevron; a Menu lists the other manageable ones).
    const selectorLabel = selected ? optionLabel(selected, selected.match.matchId === fallback?.match.matchId) : "-"
    const selector =
        manageable.length + pending.length > 1 ? (
            <Menu.Root>
                <Menu.Trigger asChild>
                    <Flex
                        as="button"
                        align="center"
                        gap="2"
                        w="auto"
                        maxW={{ base: "100%", md: "xl" }}
                        minW="0"
                        borderWidth="1px"
                        borderColor="border"
                        rounded="full"
                        px="4"
                        py="2"
                        bg="bg.panel"
                        cursor="pointer"
                        _hover={{ borderColor: "border.emphasized" }}
                        textAlign="left"
                    >
                        <Text fontSize="sm" fontWeight={700} color="fg.ink" truncate minW="0">
                            {selectorLabel}
                        </Text>
                        <Box color="fg.muted" flexShrink={0}><FiChevronDown size={15} /></Box>
                    </Flex>
                </Menu.Trigger>
                <Portal>
                    <Menu.Positioner>
                        <Menu.Content maxW="min(92vw, 640px)">
                            {manageable.map((e) => (
                                <Menu.Item
                                    key={`${e.kind}-${e.match.matchId}`}
                                    value={String(e.match.matchId)}
                                    onClick={() => setSelectedId(e.match.matchId)}
                                    fontWeight={e.match.matchId === selected?.match.matchId ? 800 : 500}
                                >
                                    {optionLabel(e, e.match.matchId === fallback?.match.matchId)}
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
                                            color="fg.muted"
                                        >
                                            {optionLabel(e, false)}
                                        </Menu.Item>
                                    ))}
                                </>
                            )}
                        </Menu.Content>
                    </Menu.Positioner>
                </Portal>
            </Menu.Root>
        ) : (
            <Flex
                align="center"
                gap="2"
                w="auto"
                maxW={{ base: "100%", md: "xl" }}
                minW="0"
                borderWidth="1px"
                borderColor="border"
                rounded="full"
                px="4"
                py="2"
                bg="bg.panel"
            >
                <Text fontSize="sm" fontWeight={700} color="fg.ink" truncate minW="0">
                    {selectorLabel}
                </Text>
            </Flex>
        )

    // Keyed by id+status so a status change (SCHEDULED→LIVE→…) remounts it with
    // fresh state.
    return selected ? (
        <LiveMatchPanel
            key={`${selected.match.matchId}-${selected.match.status}`}
            uuid={uuid}
            kind={selected.kind}
            match={selected.match}
            onChanged={reload}
            selector={selector}
        />
    ) : null
}
