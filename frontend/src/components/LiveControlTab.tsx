import { useCallback, useEffect, useMemo, useState } from "react"
import { NativeSelect, Text, VStack } from "@chakra-ui/react"
import { LuRadioTower } from "react-icons/lu"

import { fetchGroups } from "../api/groups"
import { fetchBracket } from "../api/bracket"
import type { Group } from "../types/groups"
import type { BracketMatch } from "../types/bracket"
import { EmptyState, Loader, Panel } from "../ui/primitives"
import LiveMatchPanel, { type PanelMatch } from "./LiveMatchPanel"

/* ──────────────────────────────────────────────────────────────────────────
   "Vođenje" - organizer-only control centre, fully inline (no modal).

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

/** Dropdown label: a status tag (uživo / na redu), the teams, then stage + time. */
function optionLabel(e: Entry, onDeck: boolean): string {
    const m = e.match
    const teams = `${m.team1Name ?? "-"} - ${m.team2Name ?? "-"}`
    const stage = e.kind === "group" ? "Grupa" : "Eliminacija"
    const when = m.kickoffAt ? fmtKickoff(m.kickoffAt) : ""
    const meta = [stage, when].filter(Boolean).join(" · ")
    const tag = m.status === "LIVE" ? "● UŽIVO · " : onDeck ? "▶ NA REDU · " : ""
    return `${tag}${teams}${meta ? `  ·  ${meta}` : ""}`
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
    // LIVE one, else the next-to-play (earliest kickoff SCHEDULED - same one the
    // Raspored tab flags "Na redu"). manageable is sorted LIVE-first then by
    // kickoff, so manageable[0] is exactly that. A manual pick (selectedId)
    // overrides until that match leaves the list (finished).
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

    return (
        <VStack align="stretch" gap="4">
            <Panel p={{ base: "5", md: "6" }}>
                <VStack align="stretch" gap="4">
                    {/* Match picker - centered dropdown, no section header (the
                        tab label already says "Zapisnik"; the panel goes
                        straight to the point). Defaults to the on-deck match;
                        the organizer can switch to any other live/scheduled one. */}
                    {manageable.length > 1 && (
                        <VStack align="center" gap="1.5" w="full">
                            <Text
                                fontSize="2xs"
                                fontWeight="semibold"
                                letterSpacing="wider"
                                textTransform="uppercase"
                                color="fg.muted"
                            >
                                Utakmica za vođenje
                            </Text>
                            <NativeSelect.Root size="md" w="full" maxW="xl">
                                <NativeSelect.Field
                                    value={selected ? String(selected.match.matchId) : ""}
                                    onChange={(ev) =>
                                        setSelectedId(ev.target.value === "" ? null : Number(ev.target.value))
                                    }
                                    fontWeight={600}
                                    textAlign="center"
                                >
                                    {manageable.map((e) => (
                                        <option key={`${e.kind}-${e.match.matchId}`} value={e.match.matchId}>
                                            {optionLabel(e, e.match.matchId === fallback?.match.matchId)}
                                        </option>
                                    ))}
                                </NativeSelect.Field>
                                <NativeSelect.Indicator />
                            </NativeSelect.Root>
                        </VStack>
                    )}

                    {/* Inline live-control panel for the selected match. Keyed by
                        id+status so a status change (SCHEDULED→LIVE→…) remounts
                        it with fresh state. */}
                    {selected && (
                        <LiveMatchPanel
                            key={`${selected.match.matchId}-${selected.match.status}`}
                            uuid={uuid}
                            kind={selected.kind}
                            match={selected.match}
                            onChanged={reload}
                        />
                    )}
                </VStack>
            </Panel>
        </VStack>
    )
}
