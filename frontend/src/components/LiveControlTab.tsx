import { useCallback, useEffect, useMemo, useState } from "react"
import { Box, Flex, Menu, Portal, Text } from "@chakra-ui/react"
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

/** Trigger / menu label: a status tag (● UŽIVO / ▶ NA REDU), the teams, then
 *  stage + time - e.g. "● UŽIVO · Roma – Đurđ · Grupa · 10. 07. 20:00". */
function optionLabel(e: Entry, onDeck: boolean): string {
    const m = e.match
    const teams = `${m.team1Name ?? "-"} – ${m.team2Name ?? "-"}`
    const stage = e.kind === "group" ? "Grupa" : "Eliminacija"
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

    // Default selection = the match the schedule says is up now: the current
    // LIVE one, else the next-to-play (earliest kickoff SCHEDULED). A manual
    // pick (selectedId) overrides until that match leaves the list (finished).
    const fallback = manageable.find((e) => e.match.status === "LIVE") ?? manageable[0] ?? null
    const selected = manageable.find((e) => e.match.matchId === selectedId) ?? fallback

    if (loading) return <Loader />

    if (manageable.length === 0) {
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

    // The styled match-selector (design: an outlined full-width button with the
    // current match label + a chevron; a Menu lists the other manageable ones).
    const selectorLabel = selected ? optionLabel(selected, selected.match.matchId === fallback?.match.matchId) : "-"
    const selector =
        manageable.length > 1 ? (
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
