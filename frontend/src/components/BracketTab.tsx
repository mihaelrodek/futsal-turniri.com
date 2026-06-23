import { useEffect, useMemo, useRef, useState } from "react"
import type { ReactNode } from "react"
import {
    Badge,
    Box,
    Button,
    Dialog,
    Flex,
    HStack,
    IconButton,
    Input,
    NativeSelect,
    Portal,
    Text,
    VStack,
} from "@chakra-ui/react"
import { FiTrash2 } from "react-icons/fi"
import {
    SingleEliminationBracket,
    createTheme,
    type MatchComponentProps,
    type MatchType,
} from "@g-loot/react-tournament-brackets"
import { fetchBracket, generateBracket, recordKnockoutResult } from "../api/bracket"
import type { Bracket, BracketMatch, BracketRound } from "../types/bracket"
import { fetchPlayers } from "../api/players"
import type { PlayerDto } from "../types/players"
import {
    addMatchEvent,
    deleteMatchEvent,
    fetchMatchEvents,
    finishMatch,
    startMatch,
    startSecondHalf,
} from "../api/matchEvents"
import type { MatchEventDto, MatchEventType, MatchLiveMode } from "../types/matchEvents"
import { fetchSchedule } from "../api/schedule"
import { EmptyState, Loader, Panel } from "../ui/primitives"
import { GhostButton, SectionCard } from "../ui/pitch"
import { LiveClock, StartLivePopover, matchPhase } from "./liveMatch"
import { FiActivity, FiRefreshCw, FiShare2 } from "react-icons/fi"

/* ──────────────────────────────────────────────────────────────────────────
   Library data-shape adapter.

   `@g-loot/react-tournament-brackets` consumes a flat MatchType[] where each
   match carries a `nextMatchId` pointing to its successor. We compute that
   by walking adjacent rounds: matches[i] in round R feeds match[floor(i/2)]
   in round R+1. The library handles all column layout + SVG connectors
   from there; we just provide identity + ordering.

   Round titles come straight from our backend (BracketRound.title) — set
   on the lib via `tournamentRoundText` which the lib renders as the column
   heading. State maps PLAYED/RUNNING/SCHEDULED so the lib's hover and
   "winner" styles can fire (though our custom matchComponent ignores
   most of them in favour of the BracketMatch).

   The 3rd-place fixture is intentionally NOT in this list — it stays as a
   separate Panel below the bracket. Putting it in the chain would force
   the lib to draw a spurious connector to the Finale.
   ────────────────────────────────────────────────────────────────────── */
/* Pitch-themed bracket theme — what the library uses for round-header
   pills, connector lines, the SVG canvas background, and the default
   text colour. We pass it via the `theme` prop; without it the library
   falls back to its dark "g-loot" theme (the navy/black round headers
   in the bug screenshot).

   Note: the public ThemeType in the lib's typings is slightly stale —
   it declares `roundHeaders.background`, but the actual createTheme
   implementation reads `roundHeader.backgroundColor` (singular,
   no `s`). The cast to `any` here lets us pass the real schema. */
const bracketTheme = createTheme({
    textColor: {
        main: "#0e1f15",       // fg.ink
        highlighted: "#0b6b3a", // pitch.500
        dark: "#3a4046",
        disabled: "#9ca3af",
    } as any,
    matchBackground: {
        wonColor: "#f0faf4",   // very subtle pitch tint
        lostColor: "#ffffff",
    },
    score: {
        background: {
            wonColor: "#e9f7ee",
            lostColor: "#f3f4f6",
        },
        text: {
            highlightedWonColor: "#0b6b3a",
            highlightedLostColor: "#6b7280",
        },
    },
    border: {
        color: "#e5e7eb",          // border
        highlightedColor: "#0b6b3a", // pitch.500
    },
    // The lib reads `roundHeader.backgroundColor` (singular). Light
    // pitch-tinted pill on a clean cream label.
    roundHeader: {
        backgroundColor: "#e9f7ee", // pitch.50
        fontColor: "#0b6b3a",        // pitch.500
    },
    connectorColor: "#cbd5e1",       // muted slate so connectors don't shout
    connectorColorHighlight: "#0b6b3a",
    svgBackground: "transparent",
    fontFamily: "'Inter', system-ui, sans-serif",
    transitionTimingFunction: "ease-out",
    disabledColor: "#9ca3af",
} as any)

function bracketToLibraryMatches(rounds: BracketRound[]): MatchType[] {
    if (rounds.length === 0) return []
    const out: MatchType[] = []
    rounds.forEach((round, roundIdx) => {
        const nextRound = rounds[roundIdx + 1]
        round.matches.forEach((m, matchIdx) => {
            // Pair (0,1) → 0; (2,3) → 1; …
            const successor = nextRound?.matches[Math.floor(matchIdx / 2)]
            const state =
                m.status === "FINISHED"
                    ? "DONE"
                    : m.status === "LIVE"
                        ? "RUNNING"
                        : "SCHEDULED"
            out.push({
                id: m.matchId,
                nextMatchId: successor ? successor.matchId : null,
                tournamentRoundText: round.title,
                startTime: "",
                state,
                participants: [
                    {
                        id: m.team1Id ?? `slot-${m.matchId}-1`,
                        name: m.team1Name ?? "",
                        isWinner:
                            m.winnerTeamId != null &&
                            m.winnerTeamId === m.team1Id,
                        status: null,
                        resultText: m.score1 != null ? String(m.score1) : null,
                    },
                    {
                        id: m.team2Id ?? `slot-${m.matchId}-2`,
                        name: m.team2Name ?? "",
                        isWinner:
                            m.winnerTeamId != null &&
                            m.winnerTeamId === m.team2Id,
                        status: null,
                        resultText: m.score2 != null ? String(m.score2) : null,
                    },
                ],
            })
        })
    })
    return out
}

/**
 * "Eliminacija" tab — the knockout bracket.
 *
 * Before generation: EmptyState with a "generate" button.
 * After: rounds as scrollable columns, podium banner, third-place section,
 * and inline result entry (goals + optional penalty row when level).
 *
 * Each match also supports a LIVE mode: the organizer can start a match
 * (SCHEDULED -> LIVE), record goals and cards from each team's roster, and
 * finish it (LIVE -> FINISHED). Adding/removing a goal makes the backend
 * recompute the score, so the bracket is re-fetched after live actions.
 */
type EditForm = { s1: string; s2: string; p1: string; p2: string }

/** `canEdit` — true when the viewer is the tournament owner or an admin.
 *  Drives all mutating UI: regenerate bracket, enter result, start a live
 *  match. When false the tab is read-only and the toolbar is collapsed.
 *
 *  `tournamentStarted` — set once any match goes LIVE or FINISHED. When
 *  true, "Ponovno generiraj" is removed from the toolbar (regenerating a
 *  bracket mid-tournament would wipe live scores). canEdit controls
 *  visibility of result entry on individual matches; tournamentStarted
 *  controls the destructive whole-bracket regenerate action. */
export default function BracketTab({
    uuid,
    canEdit = false,
    tournamentStarted = false,
    tournamentName,
}: {
    uuid: string
    canEdit?: boolean
    tournamentStarted?: boolean
    /** Surfaced in the navigator.share payload so the system share-
     *  sheet preview reads "Ždrijeb — {tournamentName}". Optional —
     *  when absent we fall back to a generic "Ždrijeb turnira" title. */
    tournamentName?: string
}) {
    const [bracket, setBracket] = useState<Bracket | null>(null)
    const [loading, setLoading] = useState(true)
    const [generating, setGenerating] = useState(false)
    const [shareCopied, setShareCopied] = useState(false)
    const [editingId, setEditingId] = useState<number | null>(null)
    const [form, setForm] = useState<EditForm>({ s1: "", s2: "", p1: "", p2: "" })
    const [saving, setSaving] = useState(false)
    /** matchId of the card whose "start live" call is in flight. */
    const [startingId, setStartingId] = useState<number | null>(null)
    /** The match currently open in the live dialog, or null. */
    const [liveMatch, setLiveMatch] = useState<BracketMatch | null>(null)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        fetchBracket(uuid)
            .then((b) => { if (!cancelled) setBracket(b) })
            .catch(() => { if (!cancelled) setBracket(null) })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [uuid])

    /** Re-fetch the bracket (after a live action changed the score / status). */
    async function reloadBracket() {
        try {
            setBracket(await fetchBracket(uuid))
        } catch {
            /* error toast surfaced by the http interceptor */
        }
    }

    async function runGenerate() {
        setGenerating(true)
        try {
            setBracket(await generateBracket(uuid))
            setEditingId(null)
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setGenerating(false)
        }
    }

    function startEdit(m: BracketMatch) {
        setEditingId(m.matchId)
        setForm({
            s1: m.score1 != null ? String(m.score1) : "",
            s2: m.score2 != null ? String(m.score2) : "",
            p1: m.penalties1 != null ? String(m.penalties1) : "",
            p2: m.penalties2 != null ? String(m.penalties2) : "",
        })
    }

    async function saveResult(m: BracketMatch) {
        const s1 = parseInt(form.s1, 10)
        const s2 = parseInt(form.s2, 10)
        if (!Number.isFinite(s1) || !Number.isFinite(s2)) return
        const body: {
            score1: number
            score2: number
            penalties1?: number
            penalties2?: number
        } = { score1: s1, score2: s2 }
        if (s1 === s2) {
            const p1 = parseInt(form.p1, 10)
            const p2 = parseInt(form.p2, 10)
            if (!Number.isFinite(p1) || !Number.isFinite(p2)) return
            body.penalties1 = p1
            body.penalties2 = p2
        }
        setSaving(true)
        try {
            setBracket(await recordKnockoutResult(uuid, m.matchId, body))
            setEditingId(null)
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setSaving(false)
        }
    }

    /** Web Share for the bracket URL — same pattern as the
     *  ShareButton in tournament/parts.tsx. Mobile gets the OS
     *  share sheet (WhatsApp, SMS, …); desktop browsers without
     *  navigator.share fall back to clipboard + a "Kopirano!" pill. */
    async function shareBracket() {
        const url = typeof window !== "undefined" ? window.location.href : ""
        const title = tournamentName
            ? `Ždrijeb — ${tournamentName}`
            : "Ždrijeb turnira"
        if (typeof navigator !== "undefined" && (navigator as any).share) {
            try {
                await (navigator as any).share({ title, url })
            } catch {
                /* user cancelled the share sheet — no-op */
            }
            return
        }
        try {
            await navigator.clipboard.writeText(url)
            setShareCopied(true)
            setTimeout(() => setShareCopied(false), 2000)
        } catch {
            window.prompt("Kopiraj link:", url)
        }
    }

    /** SCHEDULED -> LIVE, then open the live dialog and re-fetch. */
    async function handleStartLive(m: BracketMatch, mode: MatchLiveMode) {
        setStartingId(m.matchId)
        try {
            await startMatch(uuid, m.matchId, mode)
            await reloadBracket()
            setLiveMatch({
                ...m,
                status: "LIVE",
                liveMode: mode,
                liveStartedAt: new Date().toISOString(),
                secondHalfStartedAt: null,
            })
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setStartingId(null)
        }
    }

    /* ── Library bridge + auto-scroll — every hook here MUST run on
       every render regardless of the loading / no-bracket early
       returns below. React's "Rules of Hooks" rejects any render where
       the hook count changes from the previous render, which is what
       happened the last two times I added a `useMemo` / `useEffect`
       below the gate. Keep them all above. */
    const safeRounds = bracket?.rounds ?? []
    const libraryMatches = useMemo(
        () => bracketToLibraryMatches(safeRounds),
        [safeRounds],
    )
    const matchById = useMemo(() => {
        const m = new Map<string | number, BracketMatch>()
        for (const r of safeRounds) {
            for (const bm of r.matches) m.set(bm.matchId, bm)
        }
        return m
    }, [safeRounds])

    /* Auto-scroll to the currently-LIVE match. Falls back to null
       when the bracket isn't loaded yet — the effect early-returns
       on null so the scroll only fires after data + DOM both exist. */
    const liveMatchId = useMemo(() => {
        for (const r of safeRounds) {
            for (const m of r.matches) {
                if (m.status === "LIVE") return m.matchId
            }
        }
        if (bracket?.thirdPlace?.status === "LIVE") {
            return bracket.thirdPlace.matchId
        }
        return null
    }, [safeRounds, bracket?.thirdPlace])
    const liveRefs = useRef<Map<number, HTMLDivElement>>(new Map())
    useEffect(() => {
        if (liveMatchId == null) return
        // Defer one tick so the library's foreignObject has mounted
        // by the time we look up its ref.
        const t = setTimeout(() => {
            const el = liveRefs.current.get(liveMatchId)
            if (el && typeof el.scrollIntoView === "function") {
                el.scrollIntoView({
                    behavior: "smooth",
                    block: "nearest",
                    inline: "center",
                })
            }
        }, 80)
        return () => clearTimeout(t)
    }, [liveMatchId])

    if (loading) {
        return <Loader label="Učitavanje ljestvice…" />
    }

    const hasBracket = bracket != null && bracket.rounds.length > 0

    if (!hasBracket) {
        return (
            <Panel p="0">
                <EmptyState
                    title="Eliminacijska ljestvica još nije generirana"
                    description={
                        canEdit
                            ? "Generiraj ljestvicu nakon završetka grupne faze (ili odmah, za turnir bez grupa)."
                            : "Organizator još nije generirao eliminacijsku ljestvicu."
                    }
                    action={
                        canEdit ? (
                            <Button
                                colorPalette="brand"
                                size="sm"
                                onClick={runGenerate}
                                loading={generating}
                            >
                                Generiraj eliminacijsku ljestvicu
                            </Button>
                        ) : undefined
                    }
                />
            </Panel>
        )
    }

    // Penalty row visibility is derived from the currently active edit form.
    const editA = parseInt(form.s1, 10)
    const editB = parseInt(form.s2, 10)
    const showPenaltyRow = Number.isFinite(editA) && Number.isFinite(editB) && editA === editB

    // Podium — derived from the decided final and third-place matches.
    const finalMatch = bracket.rounds.find((r) => r.stage === "FINAL")?.matches[0]
    const champion =
        finalMatch && finalMatch.winnerTeamId != null
            ? finalMatch.winnerTeamId === finalMatch.team1Id
                ? finalMatch.team1Name
                : finalMatch.team2Name
            : null
    const runnerUp =
        finalMatch && finalMatch.winnerTeamId != null
            ? finalMatch.winnerTeamId === finalMatch.team1Id
                ? finalMatch.team2Name
                : finalMatch.team1Name
            : null
    const tp = bracket.thirdPlace
    const thirdPlaceName =
        tp && tp.winnerTeamId != null
            ? tp.winnerTeamId === tp.team1Id
                ? tp.team1Name
                : tp.team2Name
            : null

    const roundCount = bracket.rounds.length

    // Total matches across all rounds — surfaced in the Pitch toolbar subtitle
    // ("16 ekipa · 4 kola · 15 utakmica" style) to match the design.
    const totalMatches = bracket.rounds.reduce((n, r) => n + r.matches.length, 0)
    const firstRoundCount = bracket.rounds[0]?.matches.length ?? 0
    const teamCount = firstRoundCount * 2

    // `libraryMatches` + `matchById` are computed above (before the
    // early returns) — re-aliasing here for readability only. Each
    // matchComponent invocation looks up the ORIGINAL BracketMatch by
    // id to recover all the live state the lib doesn't carry (score,
    // liveStartedAt, status, etc.).

    // Stage of the final round, used to flag Finale rendering in the
    // matchComponent (yellow theme + trophy header).
    // `liveMatchId`, `liveRefs` and the auto-scroll useEffect were
    // hoisted ABOVE the early returns at the top of the function to
    // satisfy React's hook-order rule (see comment up there).
    const finalStage = bracket.rounds[roundCount - 1]?.stage ?? null

    const renderLibraryMatch = (props: MatchComponentProps) => {
        const original = matchById.get(props.match.id)
        if (!original) return null
        const isFinalCard = original.stage === finalStage && roundCount > 0
        // The library renders us inside a fixed-size SVG foreignObject
        // (`width` × `boxHeight` from options.style) and draws bracket
        // connectors from BOX-CENTER to next BOX-CENTER. If our card
        // renders shorter than the foreignObject (e.g. an empty card
        // with just two "— —" placeholder rows), it sits at the TOP of
        // the box and the connector line visually misses it.
        //
        // Wrapping the card in a flex container that fills the
        // foreignObject and centres its child vertically restores the
        // alignment: short cards render at the box midpoint, tall
        // cards (live + edit buttons) overflow symmetrically.
        return (
            <Box
                w="100%"
                h="100%"
                display="flex"
                alignItems="center"
                justifyContent="stretch"
                ref={(el: HTMLDivElement | null) => {
                    // Track refs for every match by id. The auto-scroll
                    // effect picks the LIVE one out of this map and
                    // calls scrollIntoView on it. We register every
                    // card (not just live) because the live status can
                    // change between renders and we want the ref ready
                    // by the time the effect fires.
                    if (el) liveRefs.current.set(original.matchId, el)
                    else liveRefs.current.delete(original.matchId)
                }}
            >
                <Box flex="1" minW="0">
                    <MatchCard
                        match={original}
                        canEdit={canEdit}
                        isFinal={isFinalCard}
                        editing={editingId === original.matchId}
                        form={form}
                        showPenaltyRow={showPenaltyRow}
                        saving={saving}
                        starting={startingId === original.matchId}
                        onEdit={startEdit}
                        onSave={saveResult}
                        onCancel={() => setEditingId(null)}
                        onFormChange={setForm}
                        onStartLive={handleStartLive}
                        onOpenLive={setLiveMatch}
                    />
                </Box>
            </Box>
        )
    }

    return (
        <VStack align="stretch" gap="5" py="2">
            {/* ── Pitch toolbar card ────────────────────────────────────── */}
            <SectionCard
                icon={FiActivity}
                title="Eliminacija"
                subtitle={`${teamCount} ekipa · ${roundCount} ${roundCount === 1 ? "kolo" : "kola"} · ${totalMatches} ${totalMatches === 1 ? "utakmica" : "utakmica"}`}
                action={
                    <HStack gap="2">
                        {/* Podijeli is safe for any viewer — just copies the
                             public URL. Ponovno generiraj is destructive
                             (wipes existing results) so it's owner/admin
                             only AND only before the tournament starts —
                             once any match is LIVE / FINISHED, wiping the
                             bracket would destroy real results. */}
                        <GhostButton
                            icon={<FiShare2 size={14} />}
                            onClick={shareBracket}
                        >
                            {shareCopied ? "Kopirano!" : "Podijeli ždrijeb"}
                        </GhostButton>
                        {canEdit && !tournamentStarted && (
                            <GhostButton
                                danger
                                icon={<FiRefreshCw size={14} />}
                                onClick={runGenerate}
                            >
                                Ponovno generiraj
                            </GhostButton>
                        )}
                    </HStack>
                }
            />

            {/* ── Podium banner ──────────────────────────────────────────── */}
            {champion && (
                <Panel>
                    <Box
                        px="5"
                        py="4"
                        rounded="2xl"
                        bgGradient="to-r"
                        gradientFrom="yellow.subtle"
                        gradientTo="brand.subtle"
                    >
                        <Text
                            fontSize="xs"
                            fontWeight="semibold"
                            letterSpacing="wider"
                            textTransform="uppercase"
                            color="yellow.fg"
                            mb="2"
                        >
                            Rezultati turnira
                        </Text>
                        <Flex gap="5" wrap="wrap" align="center">
                            <HStack gap="2">
                                <Text fontSize="lg" lineHeight="1">🥇</Text>
                                <Text fontWeight="bold" color="fg">
                                    {champion}
                                </Text>
                            </HStack>
                            {runnerUp && (
                                <HStack gap="2">
                                    <Text fontSize="lg" lineHeight="1">🥈</Text>
                                    <Text color="fg.muted">{runnerUp}</Text>
                                </HStack>
                            )}
                            {thirdPlaceName && (
                                <HStack gap="2">
                                    <Text fontSize="lg" lineHeight="1">🥉</Text>
                                    <Text color="fg.muted">{thirdPlaceName}</Text>
                                </HStack>
                            )}
                        </Flex>
                    </Box>
                </Panel>
            )}

            {/* ── Bracket — driven by @g-loot/react-tournament-brackets.
                 The library renders the SVG layout + connectors; our
                 custom matchComponent feeds each match into the same
                 MatchCard we used before, so the Pitch theme (yellow
                 Finale, live red border, edit / Pokreni uživo buttons)
                 stays visually identical. The 3rd-place fixture renders
                 in its own Panel BELOW the bracket — keeping it out of
                 the matches[] array prevents the lib from drawing a
                 spurious connector to the Finale. */}
            <Panel p="0" overflow="hidden">
                <Box overflowX="auto" px={{ base: "3", md: "5" }} py="5">
                    {(() => {
                        // SingleEliminationBracket's typings carry the
                        // older JSX.Element global that React 19 removed,
                        // so we cast to `any` once at the call site.
                        const Bracket: any = SingleEliminationBracket
                        return (
                            <Bracket
                                matches={libraryMatches}
                                matchComponent={renderLibraryMatch}
                                theme={bracketTheme}
                                options={{
                                    style: {
                                        roundHeader: {
                                            isShown: true,
                                            height: 32,
                                            marginBottom: 16,
                                            fontSize: 11,
                                            fontFamily:
                                                "'JetBrains Mono', ui-monospace, monospace",
                                            // Override the lib's
                                            // "Round {N}" default — return
                                            // OUR backend round titles
                                            // ("Četvrtfinale", "Polufinale",
                                            // "Finale", …). 1-indexed.
                                            roundTextGenerator: (
                                                currentRoundNumber: number,
                                            ) => {
                                                const r =
                                                    bracket.rounds[
                                                        currentRoundNumber - 1
                                                    ]
                                                return r?.title ?? undefined
                                            },
                                        },
                                        // Match-box dimensions. boxHeight
                                        // has to be ≥ the TALLEST possible
                                        // MatchCard render (Finale header
                                        // strip + 2 team rows + "Pocni
                                        // uzivo" + "Unesi rezultat" stack
                                        // ≈ 270px). The card wrapper above
                                        // vertically centres shorter cards
                                        // inside this box so the bracket
                                        // connectors always land on the
                                        // visible centre of the card, not
                                        // an empty box top.
                                        width: 260,
                                        boxHeight: 280,
                                        canvasPadding: 16,
                                        spaceBetweenColumns: 64,
                                        spaceBetweenRows: 48,
                                        roundSeparatorWidth: 24,
                                    },
                                }}
                            />
                        )
                    })()}
                </Box>
            </Panel>

            {/* ── 3rd-place playoff — separate panel below the bracket.
                 Stays out of the lib's match chain so no connector is
                 drawn to it; sits in its own short Panel with the gray
                 "Za 3. mjesto" header pill above its MatchCard. */}
            {bracket.thirdPlace && (
                <Panel p="0" overflow="hidden">
                    <Box px={{ base: "3", md: "5" }} py="5">
                        <Flex justify="center" mb="3">
                            <RoundLabel tone="gray">Za 3. mjesto</RoundLabel>
                        </Flex>
                        <Box maxW="280px" mx="auto">
                            <MatchCard
                                match={bracket.thirdPlace}
                                canEdit={canEdit}
                                isThirdPlace
                                editing={editingId === bracket.thirdPlace.matchId}
                                form={form}
                                showPenaltyRow={showPenaltyRow}
                                saving={saving}
                                starting={startingId === bracket.thirdPlace.matchId}
                                onEdit={startEdit}
                                onSave={saveResult}
                                onCancel={() => setEditingId(null)}
                                onFormChange={setForm}
                                onStartLive={handleStartLive}
                                onOpenLive={setLiveMatch}
                            />
                        </Box>
                    </Box>
                </Panel>
            )}

            {/* ── Live-match dialog — goals, cards, finish. ──────────────── */}
            {liveMatch && (
                <LiveMatchDialog
                    uuid={uuid}
                    match={liveMatch}
                    onClose={() => setLiveMatch(null)}
                    onChanged={reloadBracket}
                />
            )}
        </VStack>
    )
}

/* ── RoundLabel ─────────────────────────────────────────────────────────────
   A small pill heading for a bracket round column / section.
   ────────────────────────────────────────────────────────────────────────── */
function RoundLabel({
    children,
    tone = "brand",
}: {
    children: ReactNode
    tone?: "brand" | "gray" | "yellow"
}) {
    return (
        <Box
            px="3"
            py="1.5"
            rounded="full"
            bg={`${tone}.subtle`}
            display="inline-flex"
        >
            <Text
                fontSize="2xs"
                fontWeight="bold"
                letterSpacing="wider"
                textTransform="uppercase"
                color={`${tone}.fg`}
                whiteSpace="nowrap"
            >
                {children}
            </Text>
        </Box>
    )
}

/* ── MatchCard ──────────────────────────────────────────────────────────────
   A single match: two team rows, optional inline result-entry form, plus
   live-match controls (start live / open live panel).
   ────────────────────────────────────────────────────────────────────────── */
type MatchCardProps = {
    match: BracketMatch
    /** Owner / admin only — controls visibility of every mutating action
     *  (result entry, start-live, open-live management). When false the
     *  card is purely informational. */
    canEdit: boolean
    editing: boolean
    form: EditForm
    showPenaltyRow: boolean
    saving: boolean
    starting: boolean
    isFinal?: boolean
    isThirdPlace?: boolean
    onEdit: (m: BracketMatch) => void
    onSave: (m: BracketMatch) => void
    onCancel: () => void
    onFormChange: (updater: (prev: EditForm) => EditForm) => void
    onStartLive: (m: BracketMatch, mode: MatchLiveMode) => void
    onOpenLive: (m: BracketMatch) => void
}

function MatchCard({
    match: m,
    canEdit,
    editing,
    form,
    showPenaltyRow,
    saving,
    starting,
    isFinal = false,
    isThirdPlace = false,
    onEdit,
    onSave,
    onCancel,
    onFormChange,
    onStartLive,
    onOpenLive,
}: MatchCardProps) {
    const editable = m.team1Id != null && m.team2Id != null
    const w1 = m.winnerTeamId != null && m.winnerTeamId === m.team1Id
    const w2 = m.winnerTeamId != null && m.winnerTeamId === m.team2Id
    const isFinished = m.status === "FINISHED"
    const isLive = m.status === "LIVE"
    const isScheduled = m.status === "SCHEDULED"

    const accentBorder = isLive
        ? "red.emphasized"
        : isFinal
            ? "yellow.emphasized"
            : "border"

    return (
        <Box
            bg="bg.panel"
            borderWidth={isFinal || isLive ? "1.5px" : "1px"}
            borderColor={accentBorder}
            rounded="xl"
            shadow={isFinal ? "md" : "xs"}
            overflow="hidden"
        >
            {/* Card top strip — final badge / live indicator */}
            {(isFinal || isThirdPlace || isLive) && (
                <Flex
                    align="center"
                    justify="space-between"
                    px="3"
                    py="1.5"
                    bg={
                        isLive
                            ? "red.subtle"
                            : isFinal
                                ? "yellow.subtle"
                                : "gray.subtle"
                    }
                    borderBottomWidth="1px"
                    borderColor="border"
                >
                    <HStack gap="1.5">
                        {isFinal && (
                            <Text fontSize="sm" lineHeight="1">🏆</Text>
                        )}
                        <Text
                            fontSize="2xs"
                            fontWeight="bold"
                            letterSpacing="wider"
                            textTransform="uppercase"
                            color={
                                isLive
                                    ? "red.fg"
                                    : isFinal
                                        ? "yellow.fg"
                                        : "fg.muted"
                            }
                        >
                            {isFinal ? "Finale" : isThirdPlace ? "Za 3. mjesto" : "Utakmica"}
                        </Text>
                    </HStack>
                    {isLive && (
                        <HStack gap="2">
                            <LivePill />
                            {m.liveMode === "TIMER" && (
                                <LiveClock liveStartedAt={m.liveStartedAt} />
                            )}
                        </HStack>
                    )}
                </Flex>
            )}

            {/* Two team rows */}
            <Box px="3" py="2.5">
                <TeamRow name={m.team1Name} score={m.score1} pen={m.penalties1} winner={w1} loser={w2} />
                <Box h="1px" bg="border" my="2" />
                <TeamRow name={m.team2Name} score={m.score2} pen={m.penalties2} winner={w2} loser={w1} />

                {editing ? (
                    <VStack align="stretch" gap="2" mt="3">
                    {/* Score inputs */}
                    <HStack gap="2">
                        <Input
                            size="xs"
                            type="number"
                            placeholder="Golovi 1"
                            value={form.s1}
                            onChange={(e) => onFormChange((f) => ({ ...f, s1: e.target.value }))}
                            rounded="lg"
                        />
                        <Input
                            size="xs"
                            type="number"
                            placeholder="Golovi 2"
                            value={form.s2}
                            onChange={(e) => onFormChange((f) => ({ ...f, s2: e.target.value }))}
                            rounded="lg"
                        />
                    </HStack>

                    {/* Penalty row — only when scores are equal */}
                    {showPenaltyRow && (
                        <VStack align="stretch" gap="1.5">
                            <Text fontSize="2xs" color="fg.muted" fontWeight="medium">
                                Neriješeno — unesi rezultat penala
                            </Text>
                            <HStack gap="2">
                                <Input
                                    size="xs"
                                    type="number"
                                    placeholder="Penali 1"
                                    value={form.p1}
                                    onChange={(e) =>
                                        onFormChange((f) => ({ ...f, p1: e.target.value }))
                                    }
                                    rounded="lg"
                                />
                                <Input
                                    size="xs"
                                    type="number"
                                    placeholder="Penali 2"
                                    value={form.p2}
                                    onChange={(e) =>
                                        onFormChange((f) => ({ ...f, p2: e.target.value }))
                                    }
                                    rounded="lg"
                                />
                            </HStack>
                        </VStack>
                    )}

                    {/* Action buttons */}
                    <HStack gap="2">
                        <Button
                            size="xs"
                            colorPalette="brand"
                            loading={saving}
                            onClick={() => onSave(m)}
                            rounded="lg"
                        >
                            Spremi
                        </Button>
                        <Button
                            size="xs"
                            variant="ghost"
                            onClick={onCancel}
                            rounded="lg"
                        >
                            Odustani
                        </Button>
                    </HStack>
                </VStack>
            ) : (
                // Action stack only renders when the viewer is the
                // organizer / admin. Anonymous and regular-user viewers
                // get a read-only scoreboard — no "Unesi rezultat",
                // "Pokreni" or live-management controls leak through.
                canEdit && editable && (
                    <VStack align="stretch" gap="1.5" mt="2">
                        {isScheduled && (
                            <StartLivePopover
                                loading={starting}
                                onStart={(mode) => onStartLive(m, mode)}
                            />
                        )}
                        {isLive && (
                            <Button
                                size="xs"
                                colorPalette="red"
                                rounded="lg"
                                onClick={() => onOpenLive(m)}
                            >
                                Uživo
                            </Button>
                        )}
                        {isFinished && (
                            <Button
                                size="xs"
                                variant="ghost"
                                colorPalette="gray"
                                rounded="lg"
                                onClick={() => onOpenLive(m)}
                            >
                                Tijek utakmice
                            </Button>
                        )}
                        {!isLive && (
                            <Button
                                size="xs"
                                variant="ghost"
                                colorPalette="brand"
                                rounded="lg"
                                onClick={() => onEdit(m)}
                            >
                                {isFinished ? "Uredi rezultat" : "Unesi rezultat"}
                            </Button>
                        )}
                    </VStack>
                )
            )}
            </Box>
        </Box>
    )
}

/* ── TeamRow ────────────────────────────────────────────────────────────────
   One team line inside a match card. The winner's row is emphasised (bold,
   brand colour, subtle highlighted background); the loser's row is muted.
   ────────────────────────────────────────────────────────────────────────── */
function TeamRow({
    name,
    score,
    pen,
    winner,
    loser,
}: {
    name: string | null
    score: number | null
    pen: number | null
    winner: boolean
    loser: boolean
}) {
    const nameColor = !name
        ? "fg.subtle"
        : winner
            ? "brand.fg"
            : loser
                ? "fg.muted"
                : "fg"
    return (
        <HStack
            justify="space-between"
            gap="2"
            mx="-1.5"
            px="1.5"
            py="0.5"
            rounded="md"
            bg={winner ? "brand.subtle" : "transparent"}
        >
            <Text
                fontSize="sm"
                fontWeight={winner ? "bold" : "medium"}
                color={nameColor}
                truncate
                flex="1"
                minW="0"
            >
                {name ?? "—"}
            </Text>
            <HStack gap="1" flexShrink={0} align="baseline">
                <Text
                    fontSize="sm"
                    fontWeight={winner ? "bold" : "semibold"}
                    color={winner ? "brand.fg" : loser ? "fg.muted" : "fg"}
                    fontVariantNumeric="tabular-nums"
                    minW="5"
                    textAlign="right"
                >
                    {score != null ? score : "–"}
                </Text>
                {pen != null && (
                    <Text
                        fontSize="2xs"
                        fontWeight={winner ? "bold" : "medium"}
                        color={winner ? "brand.fg" : "fg.muted"}
                        fontVariantNumeric="tabular-nums"
                    >
                        ({pen})
                    </Text>
                )}
            </HStack>
        </HStack>
    )
}

/* ── LivePill — small red "UŽIVO" badge for a live match. ─────────────────── */
function LivePill() {
    return (
        <Badge
            colorPalette="red"
            variant="solid"
            rounded="full"
            fontSize="2xs"
            letterSpacing="wider"
            textTransform="uppercase"
            px="2"
        >
            <Box as="span" display="inline-block" boxSize="1.5" rounded="full" bg="white" mr="1" />
            Uživo
        </Badge>
    )
}

/* ── LiveMatchDialog ─────────────────────────────────────────────────────────
   A modal that drives a single match while it is LIVE: shows the running
   score, the chronological event log, controls to add goals/cards and a
   "Završi" button. For a FINISHED match it shows the same log read-only.
   ────────────────────────────────────────────────────────────────────────── */
type LiveSide = "1" | "2"

function LiveMatchDialog({
    uuid,
    match,
    onClose,
    onChanged,
}: {
    uuid: string
    match: BracketMatch
    onClose: () => void
    onChanged: () => Promise<void> | void
}) {
    const matchId = match.matchId
    const isFinished = match.status === "FINISHED"
    const isTimer = match.liveMode === "TIMER"

    const [events, setEvents] = useState<MatchEventDto[] | null>(null)
    const [score, setScore] = useState<{ s1: number; s2: number }>({
        s1: match.score1 ?? 0,
        s2: match.score2 ?? 0,
    })

    /** Rosters per team, lazily loaded when the dialog opens. */
    const [rosters, setRosters] = useState<Record<number, PlayerDto[]>>({})

    /**
     * The half timing for this match. {@code secondHalfStartedAt} is tracked
     * locally so the dialog reflects the 2nd half the moment the organizer
     * starts it; the half config (length + count) comes from the schedule.
     */
    const [secondHalfStartedAt, setSecondHalfStartedAt] = useState<string | null>(
        match.secondHalfStartedAt ?? null,
    )
    const [halfLengthMin, setHalfLengthMin] = useState<number | null>(null)
    const [halfCount, setHalfCount] = useState<number | null>(null)
    const [startingHalf, setStartingHalf] = useState(false)

    // Add-event form state.
    const [side, setSide] = useState<LiveSide>("1")
    const [kind, setKind] = useState<MatchEventType>("GOAL")
    const [playerId, setPlayerId] = useState<string>("")
    const [assistId, setAssistId] = useState<string>("")
    const [minute, setMinute] = useState<string>("")
    const [adding, setAdding] = useState(false)
    const [finishing, setFinishing] = useState(false)
    /** eventId currently being deleted. */
    const [deletingId, setDeletingId] = useState<number | null>(null)

    // Load events + both rosters once.
    useEffect(() => {
        let cancelled = false
        fetchMatchEvents(uuid, matchId)
            .then((ev) => { if (!cancelled) setEvents(ev) })
            .catch(() => { if (!cancelled) setEvents([]) })
        async function loadRoster(teamId: number | null) {
            if (teamId == null) return
            try {
                const players = await fetchPlayers(uuid, teamId)
                if (!cancelled) {
                    setRosters((prev) => ({ ...prev, [teamId]: players }))
                }
            } catch {
                /* error toast surfaced by the http interceptor */
            }
        }
        void loadRoster(match.team1Id)
        void loadRoster(match.team2Id)
        return () => { cancelled = true }
    }, [uuid, matchId, match.team1Id, match.team2Id])

    // For TIMER matches, fetch the half config (length + count) once.
    useEffect(() => {
        if (!isTimer) return
        let cancelled = false
        fetchSchedule(uuid)
            .then((s) => {
                if (cancelled) return
                setHalfLengthMin(s.halfLengthMin ?? null)
                setHalfCount(s.halfCount ?? null)
            })
            .catch(() => { /* error toast surfaced by the http interceptor */ })
        return () => { cancelled = true }
    }, [uuid, isTimer])

    /** Re-fetch this match from the bracket to pick up secondHalfStartedAt. */
    async function refreshMatchHalf() {
        try {
            const bracket = await fetchBracket(uuid)
            const all: BracketMatch[] = [
                ...bracket.rounds.flatMap((r) => r.matches),
                ...(bracket.thirdPlace ? [bracket.thirdPlace] : []),
            ]
            const found = all.find((mm) => mm.matchId === matchId)
            if (found) setSecondHalfStartedAt(found.secondHalfStartedAt ?? null)
        } catch {
            /* error toast surfaced by the http interceptor */
        }
    }

    /** Begin the 2nd half, then refetch so the clock switches over. */
    async function handleStartSecondHalf() {
        setStartingHalf(true)
        try {
            await startSecondHalf(uuid, matchId)
            await refreshMatchHalf()
            await onChanged()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setStartingHalf(false)
        }
    }

    const phase =
        isTimer && !isFinished
            ? matchPhase({
                  liveStartedAt: match.liveStartedAt,
                  secondHalfStartedAt,
                  halfLengthMin,
                  halfCount,
              })
            : null
    const atHalftime = phase === "HALFTIME"
    const atFullTime = phase === "FULL_TIME"

    const selectedTeamId = side === "1" ? match.team1Id : match.team2Id
    const roster = selectedTeamId != null ? rosters[selectedTeamId] ?? [] : []
    const minuteNum = parseInt(minute, 10)
    const canAdd =
        !!playerId &&
        Number.isFinite(minuteNum) &&
        minuteNum >= 0 &&
        !adding

    function resetForm() {
        setPlayerId("")
        setAssistId("")
        setMinute("")
    }

    /** Recompute the displayed score from the event log. */
    function scoreFromEvents(list: MatchEventDto[]): { s1: number; s2: number } {
        let s1 = 0
        let s2 = 0
        for (const e of list) {
            if (e.type !== "GOAL") continue
            if (e.teamId === match.team1Id) s1 += 1
            else if (e.teamId === match.team2Id) s2 += 1
        }
        return { s1, s2 }
    }

    async function refreshAfterMutation() {
        try {
            const ev = await fetchMatchEvents(uuid, matchId)
            setEvents(ev)
        } catch {
            /* error toast surfaced by the http interceptor */
        }
        await onChanged()
    }

    // Keep the score in sync with the event log.
    useEffect(() => {
        if (events) setScore(scoreFromEvents(events))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [events])

    async function handleAdd() {
        if (!canAdd) return
        setAdding(true)
        try {
            await addMatchEvent(uuid, matchId, {
                type: kind,
                playerId: Number(playerId),
                minute: minuteNum,
                assistPlayerId:
                    kind === "GOAL" && assistId ? Number(assistId) : null,
            })
            resetForm()
            await refreshAfterMutation()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setAdding(false)
        }
    }

    async function handleDelete(eventId: number) {
        setDeletingId(eventId)
        try {
            await deleteMatchEvent(uuid, matchId, eventId)
            await refreshAfterMutation()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setDeletingId(null)
        }
    }

    async function handleFinish() {
        setFinishing(true)
        try {
            await finishMatch(uuid, matchId)
            await onChanged()
            onClose()
        } catch {
            /* error toast surfaced by the http interceptor */
        } finally {
            setFinishing(false)
        }
    }

    return (
        <Dialog.Root
            open
            onOpenChange={(e) => { if (!e.open) onClose() }}
            placement="center"
            motionPreset="slide-in-bottom"
            scrollBehavior="inside"
        >
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW={{ base: "94%", md: "560px" }}>
                        <Dialog.Header>
                            <Dialog.Title>
                                <HStack gap="2">
                                    <Text>
                                        {match.team1Name ?? "—"} – {match.team2Name ?? "—"}
                                    </Text>
                                    {!isFinished && <LivePill />}
                                    {!isFinished && isTimer && (
                                        <LiveClock
                                            liveStartedAt={match.liveStartedAt}
                                            secondHalfStartedAt={secondHalfStartedAt}
                                            halfLengthMin={halfLengthMin}
                                            halfCount={halfCount}
                                            showLabel
                                        />
                                    )}
                                </HStack>
                            </Dialog.Title>
                        </Dialog.Header>
                        <Dialog.Body>
                            <VStack align="stretch" gap="4">
                                {/* Scoreboard */}
                                <Box
                                    textAlign="center"
                                    py="3"
                                    rounded="xl"
                                    bg={isFinished ? "bg.subtle" : "red.subtle"}
                                >
                                    <Text
                                        fontSize="3xl"
                                        fontWeight="bold"
                                        fontVariantNumeric="tabular-nums"
                                        color={isFinished ? "fg" : "red.fg"}
                                    >
                                        {score.s1} : {score.s2}
                                    </Text>
                                </Box>

                                {/* Halftime — prompt to start the 2nd half. */}
                                {atHalftime && (
                                    <Box
                                        textAlign="center"
                                        py="3"
                                        px="3"
                                        rounded="xl"
                                        bg="bg.subtle"
                                        borderWidth="1px"
                                        borderColor="border"
                                    >
                                        <Text
                                            fontSize="sm"
                                            fontWeight="semibold"
                                            color="fg"
                                            mb="2"
                                        >
                                            Poluvrijeme
                                        </Text>
                                        <Button
                                            colorPalette="red"
                                            loading={startingHalf}
                                            onClick={handleStartSecondHalf}
                                        >
                                            Započni 2. poluvrijeme
                                        </Button>
                                    </Box>
                                )}

                                {/* Full time — clock ran out; organizer
                                    confirms the end with "Završi". */}
                                {atFullTime && (
                                    <Box
                                        textAlign="center"
                                        py="3"
                                        px="3"
                                        rounded="xl"
                                        bg="red.subtle"
                                        borderWidth="1px"
                                        borderColor="red.emphasized"
                                    >
                                        <Text
                                            fontSize="sm"
                                            fontWeight="semibold"
                                            color="red.fg"
                                            mb="2"
                                        >
                                            Vrijeme je isteklo
                                        </Text>
                                        <Button
                                            colorPalette="red"
                                            loading={finishing}
                                            onClick={handleFinish}
                                        >
                                            Završi utakmicu
                                        </Button>
                                    </Box>
                                )}

                                {/* Event log */}
                                <Box>
                                    <Text
                                        fontSize="2xs"
                                        fontWeight="semibold"
                                        letterSpacing="wider"
                                        textTransform="uppercase"
                                        color="fg.muted"
                                        mb="2"
                                    >
                                        Tijek utakmice
                                    </Text>
                                    {events == null ? (
                                        <Text fontSize="sm" color="fg.muted">
                                            Učitavanje…
                                        </Text>
                                    ) : events.length === 0 ? (
                                        <Text fontSize="sm" color="fg.muted">
                                            Još nema zabilježenih događaja.
                                        </Text>
                                    ) : (
                                        <VStack align="stretch" gap="1.5">
                                            {events.map((ev) => (
                                                <EventRow
                                                    key={ev.id}
                                                    ev={ev}
                                                    canDelete={!isFinished}
                                                    deleting={deletingId === ev.id}
                                                    onDelete={() => handleDelete(ev.id)}
                                                />
                                            ))}
                                        </VStack>
                                    )}
                                </Box>

                                {/* Add-event controls — only while LIVE */}
                                {!isFinished && (
                                    <Box borderWidth="1px" borderColor="border" rounded="xl" p="3">
                                        <Text
                                            fontSize="2xs"
                                            fontWeight="semibold"
                                            letterSpacing="wider"
                                            textTransform="uppercase"
                                            color="fg.muted"
                                            mb="2"
                                        >
                                            Dodaj događaj
                                        </Text>
                                        <VStack align="stretch" gap="2">
                                            <HStack gap="2" wrap="wrap">
                                                <NativeSelect.Root size="sm" flex="1" minW="36">
                                                    <NativeSelect.Field
                                                        value={side}
                                                        onChange={(e) => {
                                                            setSide(e.target.value as LiveSide)
                                                            setPlayerId("")
                                                            setAssistId("")
                                                        }}
                                                    >
                                                        <option value="1">
                                                            {match.team1Name ?? "Ekipa 1"}
                                                        </option>
                                                        <option value="2">
                                                            {match.team2Name ?? "Ekipa 2"}
                                                        </option>
                                                    </NativeSelect.Field>
                                                    <NativeSelect.Indicator />
                                                </NativeSelect.Root>
                                                <NativeSelect.Root size="sm" flex="1" minW="36">
                                                    <NativeSelect.Field
                                                        value={kind}
                                                        onChange={(e) => {
                                                            setKind(e.target.value as MatchEventType)
                                                            setAssistId("")
                                                        }}
                                                    >
                                                        <option value="GOAL">⚽ Gol</option>
                                                        <option value="YELLOW_CARD">🟨 Žuti karton</option>
                                                        <option value="RED_CARD">🟥 Crveni karton</option>
                                                    </NativeSelect.Field>
                                                    <NativeSelect.Indicator />
                                                </NativeSelect.Root>
                                            </HStack>

                                            <NativeSelect.Root size="sm">
                                                <NativeSelect.Field
                                                    value={playerId}
                                                    onChange={(e) => setPlayerId(e.target.value)}
                                                >
                                                    <option value="">— odaberi igrača —</option>
                                                    {roster.map((p) => (
                                                        <option key={p.id} value={p.id}>
                                                            {p.number != null ? `${p.number}. ` : ""}
                                                            {p.name}
                                                        </option>
                                                    ))}
                                                </NativeSelect.Field>
                                                <NativeSelect.Indicator />
                                            </NativeSelect.Root>

                                            {kind === "GOAL" && (
                                                <NativeSelect.Root size="sm">
                                                    <NativeSelect.Field
                                                        value={assistId}
                                                        onChange={(e) => setAssistId(e.target.value)}
                                                    >
                                                        <option value="">
                                                            — asistencija (neobavezno) —
                                                        </option>
                                                        {roster
                                                            .filter((p) => String(p.id) !== playerId)
                                                            .map((p) => (
                                                                <option key={p.id} value={p.id}>
                                                                    {p.number != null ? `${p.number}. ` : ""}
                                                                    {p.name}
                                                                </option>
                                                            ))}
                                                    </NativeSelect.Field>
                                                    <NativeSelect.Indicator />
                                                </NativeSelect.Root>
                                            )}

                                            <HStack gap="2">
                                                <Input
                                                    size="sm"
                                                    type="number"
                                                    min={0}
                                                    placeholder="Minuta"
                                                    value={minute}
                                                    maxW="28"
                                                    onChange={(e) => setMinute(e.target.value)}
                                                />
                                                <Button
                                                    size="sm"
                                                    colorPalette="brand"
                                                    flex="1"
                                                    loading={adding}
                                                    disabled={!canAdd}
                                                    onClick={handleAdd}
                                                >
                                                    Dodaj
                                                </Button>
                                            </HStack>
                                        </VStack>
                                    </Box>
                                )}
                            </VStack>
                        </Dialog.Body>
                        <Dialog.Footer>
                            <HStack gap="2">
                                <Button variant="ghost" onClick={onClose}>
                                    Zatvori
                                </Button>
                                {!isFinished && (
                                    <Button
                                        colorPalette="red"
                                        loading={finishing}
                                        onClick={handleFinish}
                                    >
                                        Završi
                                    </Button>
                                )}
                            </HStack>
                        </Dialog.Footer>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}

/* ── EventRow — one line in the live-match event log. ─────────────────────── */
function EventRow({
    ev,
    canDelete,
    deleting,
    onDelete,
}: {
    ev: MatchEventDto
    canDelete: boolean
    deleting: boolean
    onDelete: () => void
}) {
    const icon =
        ev.type === "GOAL" ? "⚽" : ev.type === "YELLOW_CARD" ? "🟨" : "🟥"
    return (
        <HStack gap="2" px="2.5" py="1.5" rounded="lg" bg="bg.subtle" align="center">
            <Text
                fontSize="xs"
                fontWeight="bold"
                color="fg.muted"
                fontVariantNumeric="tabular-nums"
                minW="8"
            >
                {ev.minute}'
            </Text>
            <Text fontSize="sm" lineHeight="1">
                {icon}
            </Text>
            <Box flex="1" minW="0">
                <Text fontSize="sm" truncate>
                    {ev.playerName}
                </Text>
                {ev.assistPlayerName && (
                    <Text fontSize="2xs" color="fg.muted" truncate>
                        asist. {ev.assistPlayerName}
                    </Text>
                )}
            </Box>
            {canDelete && (
                <IconButton
                    aria-label="Ukloni događaj"
                    size="xs"
                    variant="ghost"
                    colorPalette="red"
                    loading={deleting}
                    onClick={onDelete}
                >
                    <FiTrash2 />
                </IconButton>
            )}
        </HStack>
    )
}
