import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import {
    Box,
    Button,
    Flex,
    Grid,
    HStack,
    Heading,
    IconButton,
    Input,
    Text,
    VStack,
    chakra,
} from "@chakra-ui/react"
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react"
import { FiCheck, FiChevronLeft, FiChevronRight, FiClock, FiInfo, FiMinus, FiPlus, FiRotateCcw } from "react-icons/fi"
import { LuCalendarClock, LuTimer, LuTimerOff } from "react-icons/lu"
import { FaFutbol, FaShieldAlt, FaStar } from "react-icons/fa"

import type { TournamentFormat } from "../types/tournaments"
import type { SectionKey } from "./parts"
import { Panel } from "../ui/primitives"
import { PrimaryButton, PulseDot } from "../ui/pitch"
import { readDemoCompleted, writeDemoCompleted } from "../utils/demoStorage"
import { useTranslation, type Dictionary } from "../i18n"

/* DemoSection - the organizer-only "Demo" tab: an INTERACTIVE, scripted
   walkthrough of the whole tournament lifecycle in miniature (teams →
   players → draw → schedule → zapisnik → results).

   Everything is PURELY LOCAL: no API calls, no react-query, nothing is
   persisted. The engine is a static SCRIPT of steps; each step is a list of
   actions of four kinds:

   - "click": the engine WAITS. The miniature control identified by
     `targetId` gets the pulsing highlight ring and becomes actually
     clickable; the user's click applies the transform and advances.
   - "auto": fires on a timer after the previous action - passive
     consequences (clock ticking, rows appearing, the auto-run cascade of
     the remaining matches).
   - "input": the engine WAITS on a REAL text input; the user types a value
     (team/player name) and confirms. The typed value is recorded in a ref
     map keyed by the global action index, so replays reproduce exactly
     what the user typed (or `defaultValue` when nothing was recorded).
   - "task": free-form interaction (the manual knockout pairing). The user
     manipulates the board in a local overlay until `isDone`; the outcome
     is captured as TEAM INDICES (name-independent) so replays restore the
     user's actual pairing. Replays with no recorded outcome fall back to
     the deterministic `autoResolve`.

   The engine never advances across a step boundary by itself: when a
   step's last action has been applied it STOPS, "Dalje" starts pulsing and
   the user moves on explicitly ("Natrag" replays deterministically to the
   previous step's start). Stepper pills are clickable only for steps
   already visited. The state shown at any moment is the fold of the
   applied actions over the initial state (with recorded inputs/task
   outcomes), so any jump is a cheap, deterministic replay. */

/* ── Sample data (hardcoded - it's a demo) ─────────────────────────────── */

const TEAM1 = "Mladost"
const TEAM2 = "NK Sloga"
const TEAM3 = "Futsal Kings"
/** Replay fallback for the user-typed fourth team. */
const TEAM4_DEFAULT = "Veterani Zapad"

/** Replay fallbacks for the two user-typed Mladost players. */
const PLAYER1_DEFAULT = "Ivan Horvat" // 9, captain
const PLAYER2_DEFAULT = "Marko Kovač" // 7
const PLAYER3 = "Luka Babić" // 12, auto-filled

type DemoPlayer = { name: string; number: number; captain: boolean }

/** Fixed mini rosters for the non-Mladost teams, indexed by the team's
 *  position in `state.teams` (Mladost at 0 uses the typed roster). */
const AWAY_ROSTERS: Record<number, DemoPlayer[]> = {
    1: [
        { name: "Ante Jurić", number: 5, captain: false },
        { name: "Tomislav Grgić", number: 11, captain: false },
    ],
    2: [
        { name: "Petar Šarić", number: 10, captain: false },
        { name: "Josip Klarić", number: 8, captain: false },
    ],
    3: [
        { name: "Damir Novak", number: 4, captain: false },
        { name: "Stjepan Vidić", number: 6, captain: false },
    ],
}

/** Kit colours for the demo consoles - fixed hexes on purpose, the real
 *  console also paints team names in raw kit colours. Home always KIT1. */
const KIT1 = "#3A5A7A"
const KIT2 = "#0E8A81"
/** Selected-state green used by the real pairing entry tiles. */
const SELECTED_GREEN = "#16A34A"

/* ── Demo engine ───────────────────────────────────────────────────────── */

type PairSlots = [string | null, string | null]
type DemoMatch = { badge: string; time: string; a: string; b: string }

type DemoState = {
    teams: string[]
    teamFormOpen: boolean
    players: DemoPlayer[]
    playerFormOpen: boolean
    playerFormNumber: string
    pool: string[]
    pairs: PairSlots[]
    drawConfirmed: boolean
    generating: boolean
    matches: DemoMatch[]
    /** Which bracket match the mini console currently shows:
     *  0 = SF1 (user-run), 1 = SF2, 2 = third place, 3 = final. */
    matchIdx: number
    live: boolean
    clock: string
    score: [number, number]
    pickedPlayer: boolean
    minute: string
    pickedAction: boolean
    fouls: number
    matchEnded: boolean
    events: string[]
    /** Final scores per bracket match (SF1, SF2, 3rd, final). */
    results: ([number, number] | null)[]
    podium: string[]
    awardScorer: string | null
    awardMvp: string | null
    awardGk: string | null
}

const INITIAL: DemoState = {
    teams: [TEAM1, TEAM2, TEAM3],
    teamFormOpen: false,
    players: [],
    playerFormOpen: false,
    playerFormNumber: "",
    pool: [],
    pairs: [
        [null, null],
        [null, null],
    ],
    drawConfirmed: false,
    generating: false,
    matches: [],
    matchIdx: 0,
    live: false,
    clock: "00:00",
    score: [0, 0],
    pickedPlayer: false,
    minute: "",
    pickedAction: false,
    fouls: 0,
    matchEnded: false,
    events: [],
    results: [null, null, null, null],
    podium: [],
    awardScorer: null,
    awardMvp: null,
    awardGk: null,
}

/** Captions may depend on state (typed names, derived winners). */
type Caption = string | ((s: DemoState) => string)

type Action =
    | {
          /** Engine waits; the mini control `targetId` gets the pulsing ring
           *  and becomes clickable. The caption is the instruction. */
          kind: "click"
          targetId: string
          caption: Caption
          apply: (s: DemoState) => DemoState
      }
    | {
          /** Fires `delay` ms after the previous action - a passive
           *  consequence. Caption optional (previous one holds). */
          kind: "auto"
          delay: number
          caption?: Caption
          apply: (s: DemoState) => DemoState
      }
    | {
          /** Engine waits on a real text input identified by `targetId`.
           *  Confirm applies with the trimmed typed value; replays use the
           *  recorded value or `defaultValue`. */
          kind: "input"
          targetId: string
          caption: Caption
          placeholder: string
          defaultValue: string
          apply: (s: DemoState, value: string) => DemoState
      }
    | {
          /** Engine waits while the user freely manipulates the pairing
           *  board; completes when `isDone`. `capture`/`restore` persist the
           *  outcome as team indices; `autoResolve` is the deterministic
           *  fallback for replays without a recorded outcome. */
          kind: "task"
          caption: Caption
          isDone: (s: DemoState) => boolean
          autoResolve: (s: DemoState) => DemoState
          capture: (s: DemoState) => (number | null)[][]
          restore: (s: DemoState, rec: (number | null)[][]) => DemoState
      }

type StepKey = "teams" | "players" | "draw" | "schedule" | "zapisnik" | "results"
type Step = { key: StepKey; name: string; actions: Action[] }

/** Which real page tab corresponds to each demo step (for the tab
 *  highlighting driven through `onStateChange`). */
const TAB_FOR_STEP: Record<StepKey, SectionKey> = {
    teams: "teams",
    players: "teams",
    draw: "bracket",
    schedule: "raspored",
    zapisnik: "live",
    results: "stats",
}

const identity = (s: DemoState) => s

/* ── Bracket helpers (all pure, all state-derived) ─────────────────────── */

function rosterFor(s: DemoState, team: string): DemoPlayer[] {
    const i = s.teams.indexOf(team)
    if (i === 0) return s.players
    return AWAY_ROSTERS[i] ?? []
}

/** Home/away of bracket match `idx`; 3rd place and final derive from the
 *  semifinal results already stored in state. */
function matchTeams(s: DemoState, idx: number): [string, string] {
    if (idx === 0) return [s.pairs[0][0] ?? "", s.pairs[0][1] ?? ""]
    if (idx === 1) return [s.pairs[1][0] ?? "", s.pairs[1][1] ?? ""]
    if (idx === 2) return [loserOf(s, 0), loserOf(s, 1)]
    return [winnerOf(s, 0), winnerOf(s, 1)]
}

function winnerOf(s: DemoState, i: number): string {
    const [h, a] = matchTeams(s, i)
    const r = s.results[i]
    return r && r[1] > r[0] ? a : h
}

function loserOf(s: DemoState, i: number): string {
    const [h, a] = matchTeams(s, i)
    const r = s.results[i]
    return r && r[1] > r[0] ? h : a
}

const championOf = (s: DemoState) => winnerOf(s, 3)

/** Opens bracket match `idx` in the mini console (the cascade). */
function openMatch(idx: number) {
    return (s: DemoState): DemoState => ({
        ...s,
        matchIdx: idx,
        live: true,
        matchEnded: false,
        score: [0, 0],
        clock: "00:05",
        fouls: 0,
        events: [],
        pickedPlayer: false,
        pickedAction: false,
        minute: "",
    })
}

/** A scripted goal in the current mini match by roster player `playerIdx`
 *  of `side` (0 = home, 1 = away). */
function autoGoal(side: 0 | 1, playerIdx: number, minute: string, clock: string) {
    return (s: DemoState): DemoState => {
        const team = matchTeams(s, s.matchIdx)[side]
        const p = rosterFor(s, team)[playerIdx]
        const score: [number, number] = side === 0 ? [s.score[0] + 1, s.score[1]] : [s.score[0], s.score[1] + 1]
        return { ...s, score, clock, events: [...s.events, `${minute}' ⚽ ${p?.name ?? "?"} (${team})`] }
    }
}

/** Full-time for bracket match `i` - stores the result for propagation. */
function fullTime(i: number) {
    return (s: DemoState): DemoState => ({
        ...s,
        live: false,
        matchEnded: true,
        clock: "20:00",
        results: s.results.map((r, j) => (j === i ? s.score : r)),
    })
}

/* ── The script ────────────────────────────────────────────────────────── */

function buildScript(t: Dictionary): Step[] {
    const d = t.pages.tournamentDetailsPage.demoTab
    const c = d.captions
    const sched = t.components.scheduleTab

    const teamsStep: Step = {
        key: "teams",
        name: d.stepNames.teams,
        actions: [
            {
                kind: "click",
                targetId: "addTeam",
                caption: c.teamsClick,
                apply: (s) => ({ ...s, teamFormOpen: true }),
            },
            {
                kind: "input",
                targetId: "teamName",
                caption: c.teamsType,
                placeholder: t.autocomplete.teamNamePlaceholder,
                defaultValue: TEAM4_DEFAULT,
                apply: (s, v) => ({ ...s, teamFormOpen: false, teams: [...s.teams.slice(0, 3), v] }),
            },
            { kind: "auto", delay: 800, caption: (s) => c.teamsAdded(s.teams[3] ?? ""), apply: identity },
        ],
    }

    const playersStep: Step = {
        key: "players",
        name: d.stepNames.players,
        actions: [
            {
                kind: "click",
                targetId: "addPlayer",
                caption: c.playersOpen,
                apply: (s) => ({ ...s, playerFormOpen: true, playerFormNumber: "9" }),
            },
            {
                kind: "input",
                targetId: "playerName",
                caption: c.playersTypeFirst,
                placeholder: t.teams.playerNamePlaceholder,
                defaultValue: PLAYER1_DEFAULT,
                apply: (s, v) => ({
                    ...s,
                    playerFormOpen: false,
                    playerFormNumber: "",
                    players: [{ name: v, number: 9, captain: true }],
                }),
            },
            {
                kind: "auto",
                delay: 900,
                caption: (s) => c.playersCaptain(s.players[0]?.name ?? ""),
                apply: identity,
            },
            {
                kind: "click",
                targetId: "addPlayer",
                caption: c.playersOpenSecond,
                apply: (s) => ({ ...s, playerFormOpen: true, playerFormNumber: "7" }),
            },
            {
                kind: "input",
                targetId: "playerName",
                caption: c.playersTypeSecond,
                placeholder: t.teams.playerNamePlaceholder,
                defaultValue: PLAYER2_DEFAULT,
                apply: (s, v) => ({
                    ...s,
                    playerFormOpen: false,
                    playerFormNumber: "",
                    players: [...s.players, { name: v, number: 7, captain: false }],
                }),
            },
            {
                kind: "auto",
                delay: 900,
                caption: c.playersDone,
                apply: (s) => ({ ...s, players: [...s.players, { name: PLAYER3, number: 12, captain: false }] }),
            },
        ],
    }

    const drawStep: Step = {
        key: "draw",
        name: d.stepNames.draw,
        actions: [
            {
                kind: "auto",
                delay: 600,
                caption: c.drawIntro,
                apply: (s) => ({
                    ...s,
                    pool: [...s.teams],
                    pairs: [
                        [null, null],
                        [null, null],
                    ],
                }),
            },
            {
                kind: "task",
                caption: c.drawTask,
                isDone: (s) => s.pool.length === 0 && s.pairs.every((p) => p[0] != null && p[1] != null),
                autoResolve: (s) => ({
                    ...s,
                    pool: [],
                    pairs: [
                        [s.teams[0], s.teams[1]],
                        [s.teams[2], s.teams[3] ?? TEAM4_DEFAULT],
                    ],
                }),
                capture: (s) => s.pairs.map((p) => p.map((x) => (x == null ? null : s.teams.indexOf(x)))),
                restore: (s, rec) => ({
                    ...s,
                    pool: [],
                    pairs: rec.map(
                        (p) => [p[0] == null ? null : s.teams[p[0]], p[1] == null ? null : s.teams[p[1]]] as PairSlots,
                    ),
                }),
            },
            {
                kind: "click",
                targetId: "confirmDraw",
                caption: c.drawConfirm,
                apply: (s) => ({ ...s, drawConfirmed: true }),
            },
        ],
    }

    /** Schedule rows derive from the confirmed pairing; the 3rd place and
     *  final slots show derived labels like the real app ("Pobj. PF1"). */
    const rowsFor = (s: DemoState): DemoMatch[] => [
        { badge: sched.stageLabels.SEMIFINAL, time: "18:00", a: s.pairs[0][0] ?? "", b: s.pairs[0][1] ?? "" },
        { badge: sched.stageLabels.SEMIFINAL, time: "18:40", a: s.pairs[1][0] ?? "", b: s.pairs[1][1] ?? "" },
        {
            badge: sched.stageLabels.THIRD_PLACE,
            time: "19:20",
            a: d.loserPlaceholder("PF", 1),
            b: d.loserPlaceholder("PF", 2),
        },
        {
            badge: sched.stageLabels.FINAL,
            time: "20:00",
            a: t.components.bracketTab.stage.winnerPlaceholder("PF", 1),
            b: t.components.bracketTab.stage.winnerPlaceholder("PF", 2),
        },
    ]

    const scheduleStep: Step = {
        key: "schedule",
        name: d.stepNames.schedule,
        actions: [
            {
                kind: "click",
                targetId: "generate",
                caption: c.scheduleClick,
                apply: (s) => ({ ...s, generating: true }),
            },
            { kind: "auto", delay: 1100, caption: c.scheduleGenerating, apply: identity },
            {
                kind: "auto",
                delay: 900,
                caption: c.scheduleRows,
                apply: (s) => ({ ...s, generating: false, matches: rowsFor(s).slice(0, 1) }),
            },
            { kind: "auto", delay: 600, apply: (s) => ({ ...s, matches: rowsFor(s).slice(0, 2) }) },
            { kind: "auto", delay: 600, apply: (s) => ({ ...s, matches: rowsFor(s).slice(0, 3) }) },
            { kind: "auto", delay: 600, caption: c.scheduleDone, apply: (s) => ({ ...s, matches: rowsFor(s) }) },
        ],
    }

    const zapisnikStep: Step = {
        key: "zapisnik",
        name: d.stepNames.zapisnik,
        actions: [
            // 1 · kick off SF1 with the match clock
            {
                kind: "click",
                targetId: "startTimer",
                caption: c.zapisnikStart,
                apply: (s) => ({ ...s, live: true, clock: "00:12" }),
            },
            { kind: "auto", delay: 900, caption: c.zapisnikClock, apply: (s) => ({ ...s, clock: "03:47" }) },
            { kind: "auto", delay: 900, apply: (s) => ({ ...s, clock: "07:15" }) },
            // 2 · first goal: pick the scorer (typed name), then the action tile
            {
                kind: "click",
                targetId: "pickScorer",
                caption: (s) => {
                    const p = rosterFor(s, matchTeams(s, 0)[0])[0]
                    return c.goalPickPlayer(p?.number ?? 9, p?.name ?? PLAYER1_DEFAULT)
                },
                apply: (s) => ({ ...s, pickedPlayer: true, minute: "14", clock: "13:36" }),
            },
            {
                kind: "click",
                targetId: "actionGoal",
                caption: c.goalPickAction,
                apply: (s) => ({ ...s, pickedAction: true }),
            },
            {
                kind: "auto",
                delay: 700,
                caption: c.goalScored,
                apply: (s) => ({
                    ...autoGoal(0, 0, "14", "14:02")(s),
                    pickedPlayer: false,
                    pickedAction: false,
                    minute: "",
                }),
            },
            // 3 · accumulated fouls climb to the bonus
            { kind: "click", targetId: "foulPlus", caption: c.foulsClick, apply: (s) => ({ ...s, fouls: 1 }) },
            { kind: "auto", delay: 500, apply: (s) => ({ ...s, fouls: 2, clock: "15:21" }) },
            { kind: "auto", delay: 450, apply: (s) => ({ ...s, fouls: 3 }) },
            { kind: "auto", delay: 450, apply: (s) => ({ ...s, fouls: 4, clock: "16:05" }) },
            { kind: "auto", delay: 550, caption: c.foulsFive, apply: (s) => ({ ...s, fouls: 5 }) },
            // 4 · finish SF1 (1:0 - the winner feeds the final)
            {
                kind: "click",
                targetId: "finishMatch",
                caption: c.finishClick,
                apply: fullTime(0),
            },
            // 5 · the system runs the remaining matches by itself: SF2 …
            {
                kind: "auto",
                delay: 1400,
                caption: c.cascadeNext(sched.stageLabels.SEMIFINAL),
                apply: openMatch(1),
            },
            { kind: "auto", delay: 1000, apply: autoGoal(0, 0, "03", "03:11") },
            { kind: "auto", delay: 900, apply: autoGoal(1, 0, "09", "09:44") },
            { kind: "auto", delay: 900, apply: autoGoal(0, 1, "16", "16:30") },
            { kind: "auto", delay: 1000, apply: fullTime(1) },
            // … third place …
            {
                kind: "auto",
                delay: 1300,
                caption: c.cascadeNext(sched.stageLabels.THIRD_PLACE),
                apply: openMatch(2),
            },
            { kind: "auto", delay: 900, apply: autoGoal(0, 0, "05", "05:20") },
            { kind: "auto", delay: 800, apply: autoGoal(1, 0, "11", "11:02") },
            { kind: "auto", delay: 800, apply: autoGoal(0, 1, "18", "18:47") },
            { kind: "auto", delay: 900, apply: fullTime(2) },
            // … and the final.
            {
                kind: "auto",
                delay: 1300,
                caption: c.cascadeNext(sched.stageLabels.FINAL),
                apply: openMatch(3),
            },
            { kind: "auto", delay: 1000, apply: autoGoal(0, 0, "07", "07:33") },
            { kind: "auto", delay: 900, apply: autoGoal(0, 0, "15", "15:12") },
            { kind: "auto", delay: 1000, apply: fullTime(3) },
            { kind: "auto", delay: 900, caption: (s) => c.cascadeChampion(championOf(s)), apply: identity },
        ],
    }

    const resultsStep: Step = {
        key: "results",
        name: d.stepNames.results,
        actions: [
            {
                kind: "auto",
                delay: 800,
                caption: c.resultsPodium,
                apply: (s) => ({ ...s, podium: [championOf(s)] }),
            },
            { kind: "auto", delay: 700, apply: (s) => ({ ...s, podium: [...s.podium, loserOf(s, 3)] }) },
            { kind: "auto", delay: 700, apply: (s) => ({ ...s, podium: [...s.podium, winnerOf(s, 2)] }) },
            {
                kind: "click",
                targetId: "awardScorer",
                caption: c.resultsScorer,
                apply: (s) => ({ ...s, awardScorer: rosterFor(s, championOf(s))[0]?.name ?? PLAYER1_DEFAULT }),
            },
            {
                kind: "click",
                targetId: "awardMvp",
                caption: c.resultsMvp,
                apply: (s) => ({ ...s, awardMvp: rosterFor(s, championOf(s))[1]?.name ?? PLAYER2_DEFAULT }),
            },
            {
                kind: "click",
                targetId: "awardGk",
                caption: c.resultsGk,
                apply: (s) => ({ ...s, awardGk: rosterFor(s, loserOf(s, 3))[1]?.name ?? "" }),
            },
            { kind: "auto", delay: 900, caption: c.finished, apply: identity },
        ],
    }

    return [teamsStep, playersStep, drawStep, scheduleStep, zapisnikStep, resultsStep]
}

/* ── Tiny presentational helpers ───────────────────────────────────────── */

/** Pulsing highlight ring around the miniature control currently awaiting
 *  the user. When `onClick` is given, the wrapper itself is the click
 *  target (inner minis keep pointerEvents="none"); without it the children
 *  stay interactive (real inputs/buttons). Reuses the global `pitchPulse`
 *  keyframe from index.html - no Chakra keyframes involved. */
function HL({
    on,
    onClick,
    children,
    rounded = "lg",
    w,
}: {
    on: boolean
    onClick?: () => void
    children: ReactNode
    rounded?: string
    w?: string
}) {
    return (
        <Box
            position="relative"
            display="inline-flex"
            w={w}
            cursor={on && onClick ? "pointer" : undefined}
            onClick={on ? onClick : undefined}
        >
            {children}
            {on && (
                <Box
                    position="absolute"
                    inset="-4px"
                    rounded={rounded}
                    borderWidth="2px"
                    borderColor="pitch.500"
                    pointerEvents="none"
                    css={{ animation: "pitchPulse 1.2s ease-in-out infinite" }}
                />
            )}
        </Box>
    )
}

function MiniAvatar({ name }: { name: string }) {
    const initials = name
        .split(/\s+/)
        .map((w) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    return (
        <Flex
            boxSize="8"
            rounded="full"
            bg="brand.subtle"
            color="brand.fg"
            align="center"
            justify="center"
            fontSize="xs"
            fontWeight={700}
            flexShrink={0}
        >
            {initials}
        </Flex>
    )
}

/** Non-interactive input lookalike (used where typing is NOT the current
 *  action - e.g. the auto-assigned shirt number). */
function FakeInput({ value, placeholder, w }: { value?: string; placeholder?: string; w?: string }) {
    return (
        <Box
            borderWidth="1px"
            borderColor="border"
            bg="bg.panel"
            rounded="md"
            px="2.5"
            py="1.5"
            fontSize="sm"
            minH="8"
            w={w}
            flex={w ? undefined : "1"}
            minW={w ? undefined : "0"}
            color={value ? "fg" : "fg.muted"}
            truncate
        >
            {value || placeholder}
        </Box>
    )
}

function Eyebrow({ children }: { children: ReactNode }) {
    return (
        <Text
            fontSize="2xs"
            fontWeight={800}
            textTransform="uppercase"
            letterSpacing="wider"
            color="fg.muted"
            mb="1.5"
        >
            {children}
        </Text>
    )
}

/** Team chip (⠿ handle + name). Clickable + selectable during the manual
 *  pairing task, otherwise inert. Also drag-and-droppable during the task
 *  (pointer events, same approach as the real bracket draw - works with
 *  mouse and touch) - click-to-place stays as-is, drag just layers on top. */
function TeamChip({
    name,
    selected,
    dragging,
    onClick,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
}: {
    name: string
    selected?: boolean
    dragging?: boolean
    onClick?: () => void
    onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void
    onPointerMove?: (e: ReactPointerEvent<HTMLDivElement>) => void
    onPointerUp?: (e: ReactPointerEvent<HTMLDivElement>) => void
    onPointerCancel?: (e: ReactPointerEvent<HTMLDivElement>) => void
}) {
    return (
        <HStack
            borderWidth={selected ? "2px" : "1px"}
            borderColor={selected ? SELECTED_GREEN : "border"}
            bg="bg.panel"
            css={selected ? selectedTintCss(SELECTED_GREEN) : undefined}
            rounded="xl"
            px="2"
            py="1"
            gap="1.5"
            flexShrink={0}
            opacity={dragging ? 0.35 : 1}
            cursor={onClick ? "grab" : undefined}
            style={onPointerDown ? { touchAction: "none", userSelect: "none" } : undefined}
            onClick={onClick}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
        >
            <Text as="span" fontSize="xs" color="fg.muted" aria-hidden>
                ⠿
            </Text>
            <Text as="span" fontSize="xs" fontWeight={600}>
                {name}
            </Text>
        </HStack>
    )
}

function selectedTintCss(hex: string) {
    return { background: `color-mix(in srgb, ${hex} 12%, var(--chakra-colors-bg-panel))` }
}

/** Drop-target highlight for the manual pairing board - mirrors the real
 *  bracket draw's hover overlay (BracketTab.tsx). */
function DropOverlay() {
    return (
        <Box
            position="absolute"
            inset="0"
            rounded="lg"
            borderWidth="2px"
            borderColor="pitch.500"
            pointerEvents="none"
            css={{ background: "color-mix(in srgb, var(--chakra-colors-pitch-500) 9%, transparent)" }}
        />
    )
}

function LivePill({ label }: { label: string }) {
    return (
        <HStack
            px="2.5"
            py="1"
            rounded="full"
            bg="accent.red"
            color="white"
            fontSize="10px"
            fontWeight={700}
            letterSpacing="0.04em"
            gap="1.5"
            css={{ animation: "livePillPulse 1.6s ease-out infinite" }}
        >
            <PulseDot color="#fff" size={6} />
            <Text as="span" textTransform="uppercase">
                {label}
            </Text>
        </HStack>
    )
}

/* ── Miniature step screens ────────────────────────────────────────────── */

type InputCtx = { draft: string; setDraft: (v: string) => void; confirm: () => void; placeholder?: string }
type BoardCtx = {
    pool: string[]
    pairs: PairSlots[]
    selected: string | null
    taskPending: boolean
    onChipClick: (name: string) => void
    onSlotClick: (pi: number, si: number) => void
    /** Same outcome as click-to-place, driven by a drop zone id ("pool" or
     *  "{pairIndex}-{slotIndex}") instead of a specific pi/si pair. */
    onDropTeam: (name: string, zone: string) => void
}
type MiniProps = { s: DemoState; t: Dictionary; hl?: string; onTarget: (id: string) => void; input: InputCtx }

function TeamsMini({ s, t, hl, onTarget, input }: MiniProps) {
    return (
        <VStack align="stretch" gap="2">
            {s.teams.map((name) => (
                <HStack
                    key={name}
                    borderWidth="1px"
                    borderColor="border"
                    bg="bg.panel"
                    rounded="xl"
                    px="3"
                    py="2"
                    gap="2.5"
                >
                    <MiniAvatar name={name} />
                    <Box minW="0">
                        <Text fontSize="sm" fontWeight={500} truncate>
                            {name}
                        </Text>
                        <Text fontSize="2xs" color="fg.muted">
                            {t.teams.playersWord(0)}
                        </Text>
                    </Box>
                </HStack>
            ))}

            {s.teamFormOpen && (
                <HL on={hl === "teamName"} rounded="xl" w="100%">
                    <Box borderWidth="1px" borderColor="brand.emphasized" bg="brand.subtle" rounded="xl" p="3" w="full">
                        <HStack gap="2">
                            <Input
                                size="sm"
                                bg="bg.panel"
                                autoFocus
                                value={input.draft}
                                placeholder={input.placeholder ?? t.autocomplete.teamNamePlaceholder}
                                onChange={(e) => input.setDraft(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") input.confirm()
                                }}
                            />
                            <Button
                                size="xs"
                                variant="solid"
                                colorPalette="brand"
                                flexShrink={0}
                                disabled={!input.draft.trim()}
                                onClick={input.confirm}
                            >
                                <FiCheck /> {t.common.add}
                            </Button>
                        </HStack>
                    </Box>
                </HL>
            )}

            <HStack justify="flex-end" pt="1">
                <HL on={hl === "addTeam"} onClick={() => onTarget("addTeam")}>
                    <Button size="xs" variant="solid" colorPalette="brand" pointerEvents="none" tabIndex={-1}>
                        <FiPlus /> {t.teams.addTeam}
                    </Button>
                </HL>
            </HStack>
            <Text fontSize="13px" color="fg.muted" textAlign="right">
                {t.teams.teamsCountPlain(s.teams.length)}
            </Text>
        </VStack>
    )
}

function PlayersMini({ s, t, hl, onTarget, input }: MiniProps) {
    return (
        <VStack align="stretch" gap="2.5">
            <HStack gap="2.5" align="center">
                <MiniAvatar name={TEAM1} />
                <Box minW="0">
                    <Text fontSize="sm" fontWeight={600}>
                        {TEAM1}
                    </Text>
                    <Text fontSize="xs" color="fg.muted">
                        {t.teams.rosterHeading(s.players.length)}
                    </Text>
                </Box>
                <Box flex="1" />
                <HL on={hl === "addPlayer"} onClick={() => onTarget("addPlayer")}>
                    <Button size="xs" variant="solid" colorPalette="brand" pointerEvents="none" tabIndex={-1}>
                        <FiPlus /> {t.teams.addPlayer}
                    </Button>
                </HL>
            </HStack>

            {s.playerFormOpen && (
                <HL on={hl === "playerName"} rounded="xl" w="100%">
                    <Box borderWidth="1px" borderColor="brand.emphasized" bg="brand.subtle" rounded="xl" p="3" w="full">
                        <VStack align="stretch" gap="2">
                            <HStack gap="2">
                                <Input
                                    size="sm"
                                    bg="bg.panel"
                                    autoFocus
                                    value={input.draft}
                                    placeholder={input.placeholder ?? t.teams.playerNamePlaceholder}
                                    onChange={(e) => input.setDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") input.confirm()
                                    }}
                                />
                                <FakeInput value={s.playerFormNumber} placeholder={t.teams.numberPlaceholder} w="64px" />
                            </HStack>
                            <HStack gap="2" justify="flex-end">
                                <Button size="xs" variant="ghost" pointerEvents="none" tabIndex={-1}>
                                    {t.common.cancel}
                                </Button>
                                <Button
                                    size="xs"
                                    variant="solid"
                                    colorPalette="brand"
                                    disabled={!input.draft.trim()}
                                    onClick={input.confirm}
                                >
                                    <FiCheck /> {t.common.add}
                                </Button>
                            </HStack>
                        </VStack>
                    </Box>
                </HL>
            )}

            {s.players.map((p) => (
                <HStack
                    key={p.name + p.number}
                    borderWidth="1px"
                    borderColor={p.captain ? "brand.emphasized" : "border"}
                    bg={p.captain ? "brand.subtle" : "bg.panel"}
                    rounded="xl"
                    px="3"
                    py="2"
                    gap="3"
                >
                    <Flex
                        boxSize="8"
                        rounded="lg"
                        bg="bg.muted"
                        color="fg.muted"
                        align="center"
                        justify="center"
                        fontWeight="bold"
                        fontSize="sm"
                        flexShrink={0}
                    >
                        {p.number}
                    </Flex>
                    <Text fontSize="sm" fontWeight={500} flex="1" minW="0" truncate>
                        {p.name}
                    </Text>
                    {p.captain && (
                        <Flex
                            px="1.5"
                            py="0.5"
                            rounded="sm"
                            bg="brand.solid"
                            color="brand.contrast"
                            fontSize="2xs"
                            fontWeight={700}
                            title={t.teams.captain}
                        >
                            {t.teams.captainBadge}
                        </Flex>
                    )}
                </HStack>
            ))}
        </VStack>
    )
}

/** Step 3 - manual knockout pairing: drag a chip from the pool onto a
 *  semifinal slot (pointer events - mouse and touch, same approach as the
 *  real bracket draw in BracketTab.tsx), or fall back to click-to-place:
 *  click a chip, then an empty slot (clicking a placed chip returns it). */
function DrawMini({ t, hl, onTarget, board }: MiniProps & { board: BoardCtx }) {
    const bd = t.components.bracketTab.draw
    const roundHeading = bd.roundHeadingSuffix(t.components.bracketTab.stageShort.SEMIFINAL)
    const { pool, pairs, selected, taskPending, onChipClick, onSlotClick, onDropTeam } = board

    // `dragRef` is the hot-path source of truth (updated every pointermove
    // without a re-render); `dragName`/`dragOverZone` only exist to drive the
    // visual feedback (opacity, drop-target ring). A drag that never crosses
    // the movement threshold just falls through to the plain onClick below -
    // click-to-place keeps working unchanged.
    const dragRef = useRef<{ name: string; x: number; y: number; dragging: boolean } | null>(null)
    const suppressClickRef = useRef(false)
    const ghostRef = useRef<HTMLDivElement | null>(null)
    const [dragName, setDragName] = useState<string | null>(null)
    const [dragOverZone, setDragOverZone] = useState<string | null>(null)

    const moveGhost = (x: number, y: number) => {
        const el = ghostRef.current
        if (el) el.style.transform = `translate(${x + 12}px, ${y - 14}px)`
    }
    const zoneAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]")?.dataset.drop ?? null

    const dragHandlers = (name: string) => ({
        onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
            if (!taskPending) return
            e.currentTarget.setPointerCapture(e.pointerId)
            dragRef.current = { name, x: e.clientX, y: e.clientY, dragging: false }
        },
        onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
            const d = dragRef.current
            if (!d || d.name !== name) return
            if (!d.dragging && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) {
                d.dragging = true
                setDragName(name)
            }
            if (d.dragging) {
                moveGhost(e.clientX, e.clientY)
                setDragOverZone(zoneAt(e.clientX, e.clientY))
            }
        },
        onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => {
            const d = dragRef.current
            dragRef.current = null
            if (!d || d.name !== name) return
            if (d.dragging) {
                const zone = zoneAt(e.clientX, e.clientY)
                setDragName(null)
                setDragOverZone(null)
                suppressClickRef.current = true
                window.setTimeout(() => {
                    suppressClickRef.current = false
                }, 0)
                if (zone) onDropTeam(name, zone)
            }
        },
        onPointerCancel: () => {
            dragRef.current = null
            setDragName(null)
            setDragOverZone(null)
        },
    })
    /** A drag that actually moved must not also fire the trailing click. */
    const clickIfNotDragged = (fn: () => void) => () => {
        if (suppressClickRef.current) return
        fn()
    }

    return (
        <VStack align="stretch" gap="3">
            <Text fontSize="sm" fontWeight={700}>
                {bd.manualHeading}
            </Text>
            <Grid templateColumns={{ base: "1fr", sm: "1fr 1.2fr" }} gap="3" alignItems="start">
                <HL on={taskPending && selected == null && pool.length > 0} rounded="xl" w="100%">
                    <Box w="full">
                        <HStack gap="2" mb="1.5">
                            <Text
                                fontSize="2xs"
                                fontWeight={800}
                                textTransform="uppercase"
                                letterSpacing="wider"
                                color="fg.muted"
                            >
                                {bd.poolHeadingTeam}
                            </Text>
                            <Flex
                                px="1.5"
                                minW="5"
                                h="5"
                                align="center"
                                justify="center"
                                rounded="full"
                                bg="pitch.500"
                                color="white"
                                fontSize="2xs"
                                fontWeight={700}
                            >
                                {pool.length}
                            </Flex>
                        </HStack>
                        <Box position="relative">
                            <VStack align="stretch" gap="1.5" minH="10" data-drop="pool">
                                {pool.map((n) => (
                                    <TeamChip
                                        key={n}
                                        name={n}
                                        selected={selected === n}
                                        dragging={dragName === n}
                                        onClick={taskPending ? clickIfNotDragged(() => onChipClick(n)) : undefined}
                                        {...(taskPending ? dragHandlers(n) : {})}
                                    />
                                ))}
                                {pool.length === 0 && (
                                    <Text fontSize="xs" color="fg.muted">
                                        {bd.allocatedAllTeam}
                                    </Text>
                                )}
                            </VStack>
                            {dragOverZone === "pool" && <DropOverlay />}
                        </Box>
                    </Box>
                </HL>
                <HL on={taskPending && selected != null} rounded="xl" w="100%">
                    <Box w="full">
                        <Eyebrow>{roundHeading}</Eyebrow>
                        <VStack align="stretch" gap="2">
                            {pairs.map((pair, pi) => (
                                <Box key={pi} borderWidth="1px" borderColor="border" rounded="xl" p="2" bg="bg.panel">
                                    <VStack align="stretch" gap="1.5">
                                        {pair.map((slot, si) => {
                                            const zone = `${pi}-${si}`
                                            return (
                                                <Box key={si} position="relative" data-drop={zone}>
                                                    {slot ? (
                                                        <TeamChip
                                                            name={slot}
                                                            dragging={dragName === slot}
                                                            onClick={
                                                                taskPending
                                                                    ? clickIfNotDragged(() => onSlotClick(pi, si))
                                                                    : undefined
                                                            }
                                                            {...(taskPending ? dragHandlers(slot) : {})}
                                                        />
                                                    ) : (
                                                        <Flex
                                                            borderWidth="1px"
                                                            borderStyle="dashed"
                                                            borderColor="border.emphasized"
                                                            rounded="lg"
                                                            py="1.5"
                                                            align="center"
                                                            justify="center"
                                                            cursor={taskPending && selected ? "pointer" : undefined}
                                                            onClick={
                                                                taskPending && selected
                                                                    ? () => onSlotClick(pi, si)
                                                                    : undefined
                                                            }
                                                        >
                                                            <Text fontSize="2xs" color="fg.muted">
                                                                —
                                                            </Text>
                                                        </Flex>
                                                    )}
                                                    {dragOverZone === zone && <DropOverlay />}
                                                </Box>
                                            )
                                        })}
                                    </VStack>
                                </Box>
                            ))}
                        </VStack>
                    </Box>
                </HL>
            </Grid>
            <HStack justify="flex-end" gap="2" wrap="wrap">
                <HL on={hl === "confirmDraw"} onClick={() => onTarget("confirmDraw")}>
                    <Button size="xs" variant="solid" colorPalette="brand" pointerEvents="none" tabIndex={-1}>
                        <FiCheck /> {bd.confirmDrawButton}
                    </Button>
                </HL>
            </HStack>
            {dragName && (
                <Box
                    ref={ghostRef}
                    position="fixed"
                    top="0"
                    left="0"
                    zIndex={1500}
                    pointerEvents="none"
                    bg="pitch.500"
                    color="white"
                    rounded="lg"
                    px="2.5"
                    py="1.5"
                    fontSize="xs"
                    fontWeight={700}
                    boxShadow="lg"
                    style={{ transform: "translate(-9999px, -9999px)" }}
                >
                    {dragName}
                </Box>
            )}
        </VStack>
    )
}

function ScheduleMini({ s, t, hl, onTarget }: MiniProps) {
    const fe = t.components.scheduleTab.formatEditor
    const d = t.pages.tournamentDetailsPage.demoTab
    const vs = t.components.liveMatch.timeline.vsLabel
    return (
        <VStack align="stretch" gap="2.5">
            <HStack justify="center" pt="1">
                <HL on={hl === "generate"} onClick={() => onTarget("generate")}>
                    <Box pointerEvents="none">
                        <PrimaryButton icon={<LuCalendarClock size={15} />} px="4" py="2" fontSize="13px">
                            {s.generating ? fe.generatingButton : fe.generateButton}
                        </PrimaryButton>
                    </Box>
                </HL>
            </HStack>

            {s.matches.length > 0 && (
                <HStack gap="2.5" pt="1">
                    <Box flex="1" h="1px" bg="border" />
                    <Text fontSize="2xs" fontWeight={700} color="fg.muted" whiteSpace="nowrap">
                        {d.dayDivider}
                    </Text>
                    <Box flex="1" h="1px" bg="border" />
                </HStack>
            )}

            {s.matches.map((m) => (
                <Box
                    key={`${m.time}-${m.a}`}
                    borderWidth="1px"
                    borderColor="border"
                    bg="bg.panel"
                    rounded="xl"
                    px="3"
                    py="2"
                >
                    <Grid templateColumns="1fr auto 1fr" alignItems="center" mb="1">
                        <Box justifySelf="start">
                            <Box
                                px="1.5"
                                py="0.5"
                                rounded="md"
                                bg="bg.muted"
                                fontSize="2xs"
                                fontWeight={700}
                                color="fg.muted"
                            >
                                {m.badge}
                            </Box>
                        </Box>
                        <HStack gap="1" color="fg.muted" fontFamily="mono" fontSize="xs">
                            <FiClock size={11} />
                            <Text as="span">{m.time}</Text>
                        </HStack>
                        <Box />
                    </Grid>
                    <Grid templateColumns="1fr auto 1fr" gap="2" alignItems="center">
                        <Text fontSize="sm" fontWeight={600} textAlign="right" truncate>
                            {m.a}
                        </Text>
                        <Text fontSize="xs" color="fg.muted">
                            {vs}
                        </Text>
                        <Text fontSize="sm" fontWeight={600} truncate>
                            {m.b}
                        </Text>
                    </Grid>
                </Box>
            ))}
        </VStack>
    )
}

/** Step 5 - the zapisnik in miniature. Match 0 (SF1) is user-run: kick-off,
 *  first goal, accumulated fouls, full time. The remaining bracket matches
 *  then run themselves in the same console (the cascade). */
function ZapisnikMini({ s, t, hl, onTarget }: MiniProps) {
    const lp = t.components.liveMatchPanel
    const lm = t.components.liveMatch
    const sched = t.components.scheduleTab
    const [home, away] = matchTeams(s, s.matchIdx)
    const homeRoster = rosterFor(s, home)
    const awayRoster = rosterFor(s, away)
    const interactive = s.matchIdx === 0
    const stageBadge =
        s.matchIdx <= 1
            ? sched.stageLabels.SEMIFINAL
            : s.matchIdx === 2
              ? sched.stageLabels.THIRD_PLACE
              : sched.stageLabels.FINAL

    function rosterRow(color: string, r: DemoPlayer, targetId?: string) {
        const selected = targetId != null && s.pickedPlayer
        const row = (
            <HStack
                key={r.name}
                gap="2"
                px="1.5"
                py="1"
                rounded="lg"
                borderWidth={selected ? "2px" : "1px"}
                borderColor={selected ? SELECTED_GREEN : "transparent"}
                css={selected ? selectedTintCss(SELECTED_GREEN) : undefined}
                w="full"
            >
                <Flex
                    boxSize="24px"
                    rounded="md"
                    align="center"
                    justify="center"
                    fontSize="xs"
                    fontWeight={800}
                    flexShrink={0}
                    color={color}
                    css={selectedTintCss(color)}
                >
                    {r.number}
                </Flex>
                <Text fontSize="sm" fontWeight={700} truncate>
                    {r.name}
                </Text>
            </HStack>
        )
        return targetId ? (
            <HL key={r.name} on={hl === targetId} onClick={() => onTarget(targetId)} w="100%">
                {row}
            </HL>
        ) : (
            row
        )
    }

    const actionTiles: { key: string; glyph: ReactNode; label: string; id?: string }[] = [
        { key: "goal", glyph: <Text as="span">⚽</Text>, label: lp.actions.goal, id: "actionGoal" },
        { key: "ownGoal", glyph: <Text as="span">⚽</Text>, label: lp.actions.ownGoal },
        {
            key: "yellow",
            glyph: <Box w="15px" h="19px" rounded="2px" bg="#e8a01f" />,
            label: lp.actions.yellow,
        },
        {
            key: "red",
            glyph: <Box w="15px" h="19px" rounded="2px" bg="#c0392b" />,
            label: lp.actions.red,
        },
        { key: "exclusion", glyph: <Text as="span">🕑</Text>, label: lp.actions.exclusion },
    ]

    const eventRows = (
        <VStack align="stretch" gap="1">
            {s.events.map((e, i) => (
                <HStack key={i} gap="2" borderWidth="1px" borderColor="border" rounded="lg" px="2.5" py="1.5" bg="bg.subtle">
                    <Text fontSize="xs" fontWeight={600}>
                        {e}
                    </Text>
                </HStack>
            ))}
        </VStack>
    )

    return (
        <VStack align="stretch" gap="3">
            {/* Scoreboard header */}
            <VStack gap="2">
                <HStack gap="2">
                    <Box px="1.5" py="0.5" rounded="md" bg="bg.muted" fontSize="2xs" fontWeight={700} color="fg.muted">
                        {stageBadge}
                    </Box>
                    {s.live && <LivePill label={t.common.live} />}
                </HStack>
                <Grid templateColumns="1fr auto 1fr" gap="3" alignItems="center" w="full">
                    <VStack gap="1" justifySelf="end">
                        <Box
                            boxSize="10px"
                            rounded="full"
                            bg={KIT1}
                            borderWidth="1px"
                            borderColor="border.emphasized"
                        />
                        <Text fontSize="sm" fontWeight={800} color={KIT1} textAlign="center">
                            {home}
                        </Text>
                    </VStack>
                    {s.live ? (
                        <VStack gap="0.5">
                            <Text fontFamily="mono" fontSize="22px" fontWeight={800} color="red.fg" lineHeight="1">
                                {s.clock}
                            </Text>
                            <Text
                                fontFamily="mono"
                                fontSize="9px"
                                fontWeight={700}
                                letterSpacing="0.1em"
                                color="fg.muted"
                            >
                                {lm.phaseLabels.firstHalf}
                            </Text>
                            <Text fontFamily="mono" fontSize="lg" fontWeight={800}>
                                {s.score[0]} : {s.score[1]}
                            </Text>
                        </VStack>
                    ) : s.matchEnded ? (
                        <VStack gap="0.5">
                            <Text
                                fontFamily="mono"
                                fontSize="9px"
                                fontWeight={700}
                                letterSpacing="0.1em"
                                color="fg.muted"
                            >
                                {lm.phaseLabels.fullTime}
                            </Text>
                            <Box
                                px="3"
                                py="1"
                                rounded="lg"
                                borderWidth="1px"
                                borderColor="border.emphasized"
                                bg="bg.panel"
                            >
                                <Text fontFamily="mono" fontSize="lg" fontWeight={800}>
                                    {s.score[0]} : {s.score[1]}
                                </Text>
                            </Box>
                        </VStack>
                    ) : (
                        <Text fontFamily="mono" fontSize="xl" fontWeight={800} color="fg.muted">
                            – : –
                        </Text>
                    )}
                    <VStack gap="1" justifySelf="start">
                        <Box
                            boxSize="10px"
                            rounded="full"
                            bg={KIT2}
                            borderWidth="1px"
                            borderColor="border.emphasized"
                        />
                        <Text fontSize="sm" fontWeight={800} color={KIT2} textAlign="center">
                            {away}
                        </Text>
                    </VStack>
                </Grid>
            </VStack>

            {/* Pre-start: the two kick-off options (user-run SF1 only) */}
            {interactive && !s.live && !s.matchEnded && (
                <VStack gap="2" w="full" maxW="320px" pt="1" mx="auto">
                    <HL on={hl === "startTimer"} onClick={() => onTarget("startTimer")} w="100%">
                        <chakra.button
                            type="button"
                            tabIndex={-1}
                            pointerEvents="none"
                            display="inline-flex"
                            alignItems="center"
                            justifyContent="center"
                            gap="2"
                            w="full"
                            bg={KIT1}
                            color="white"
                            border="none"
                            rounded="lg"
                            px="4"
                            py="2.5"
                            fontWeight={700}
                            fontSize="13px"
                        >
                            <LuTimer size={15} /> {lm.start.timerOption}
                        </chakra.button>
                    </HL>
                    <chakra.button
                        type="button"
                        tabIndex={-1}
                        pointerEvents="none"
                        display="inline-flex"
                        alignItems="center"
                        justifyContent="center"
                        gap="2"
                        w="full"
                        bg="bg.panel"
                        color="fg.ink"
                        borderWidth="1px"
                        borderColor="border"
                        rounded="lg"
                        px="4"
                        py="2.5"
                        fontWeight={600}
                        fontSize="13px"
                    >
                        <LuTimerOff size={15} /> {lm.start.simpleOption}
                    </chakra.button>
                </VStack>
            )}

            {/* Live console - full controls only for the user-run SF1 */}
            {s.live && interactive && (
                <Box borderWidth="1px" borderColor="border" rounded="2xl" p="3" bg="bg.panel">
                    <VStack align="stretch" gap="3">
                        <Box>
                            <Eyebrow>{lp.eyebrow.pickPlayer}</Eyebrow>
                            <Grid templateColumns="1fr 1fr" gap="2">
                                <VStack
                                    align="stretch"
                                    gap="1"
                                    borderWidth="1px"
                                    borderColor="border"
                                    borderTopWidth="5px"
                                    borderTopColor={KIT1}
                                    rounded="lg"
                                    p="1.5"
                                >
                                    {homeRoster.map((r, i) => rosterRow(KIT1, r, i === 0 ? "pickScorer" : undefined))}
                                </VStack>
                                <VStack
                                    align="stretch"
                                    gap="1"
                                    borderWidth="1px"
                                    borderColor="border"
                                    borderTopWidth="5px"
                                    borderTopColor={KIT2}
                                    rounded="lg"
                                    p="1.5"
                                >
                                    {awayRoster.map((r) => rosterRow(KIT2, r))}
                                </VStack>
                            </Grid>
                        </Box>

                        <Box>
                            <Eyebrow>{lp.eyebrow.minute}</Eyebrow>
                            <HStack gap="2">
                                <Box
                                    fontFamily="mono"
                                    borderWidth="1px"
                                    borderColor="border"
                                    rounded="md"
                                    px="3"
                                    py="1.5"
                                    fontSize="sm"
                                    fontWeight={700}
                                    minW="52px"
                                    minH="8"
                                    textAlign="center"
                                >
                                    {s.minute}
                                </Box>
                                <Button
                                    size="xs"
                                    variant="outline"
                                    colorPalette="brand"
                                    pointerEvents="none"
                                    tabIndex={-1}
                                >
                                    {lm.goalEntry.nowButton}
                                </Button>
                            </HStack>
                        </Box>

                        <Box>
                            <Eyebrow>{lp.eyebrow.pickAction}</Eyebrow>
                            <Grid templateColumns="repeat(5, 1fr)" gap="1.5">
                                {actionTiles.map((tile) => {
                                    const selected = tile.id === "actionGoal" && s.pickedAction
                                    const box = (
                                        <VStack
                                            w="full"
                                            gap="1"
                                            borderWidth={selected ? "2px" : "1px"}
                                            borderColor={selected ? SELECTED_GREEN : "border"}
                                            rounded="xl"
                                            py="2"
                                            px="1"
                                            css={selected ? selectedTintCss(SELECTED_GREEN) : undefined}
                                        >
                                            <Flex h="20px" align="center">
                                                {tile.glyph}
                                            </Flex>
                                            <Text
                                                fontSize="xs"
                                                fontWeight={800}
                                                textAlign="center"
                                                lineHeight="1.1"
                                            >
                                                {tile.label}
                                            </Text>
                                        </VStack>
                                    )
                                    return tile.id ? (
                                        <HL
                                            key={tile.key}
                                            on={hl === tile.id}
                                            onClick={() => onTarget(tile.id!)}
                                            rounded="xl"
                                            w="100%"
                                        >
                                            {box}
                                        </HL>
                                    ) : (
                                        <Box key={tile.key}>{box}</Box>
                                    )
                                })}
                            </Grid>
                        </Box>

                        {/* Accumulated fouls strip - mini replica of the real
                            console strip: − / mono counter / +, counter turns
                            red at 5. */}
                        <Flex align="center" justify="space-between" rounded="lg" px="3" py="1.5" bg="pitch.subtle">
                            <Text fontSize="2xs" fontWeight={800} letterSpacing="wide" color="pitch.fg">
                                {lm.foulControls.label.toUpperCase()} · {home}
                            </Text>
                            <HStack gap="2.5">
                                <Flex
                                    boxSize="6"
                                    align="center"
                                    justify="center"
                                    rounded="md"
                                    borderWidth="1px"
                                    borderColor="border"
                                    color="fg.muted"
                                >
                                    <FiMinus size={12} />
                                </Flex>
                                <Text
                                    fontFamily="mono"
                                    fontSize="md"
                                    fontWeight={800}
                                    minW="18px"
                                    textAlign="center"
                                    lineHeight="1"
                                    color={s.fouls >= 5 ? "accent.red" : "pitch.fg"}
                                >
                                    {s.fouls}
                                </Text>
                                <HL on={hl === "foulPlus"} onClick={() => onTarget("foulPlus")} rounded="md">
                                    <Flex
                                        boxSize="6"
                                        align="center"
                                        justify="center"
                                        rounded="md"
                                        borderWidth="1px"
                                        borderColor="border"
                                        color="fg.muted"
                                        pointerEvents="none"
                                    >
                                        <FiPlus size={12} />
                                    </Flex>
                                </HL>
                            </HStack>
                        </Flex>

                        {s.events.length > 0 && eventRows}

                        <HL on={hl === "finishMatch"} onClick={() => onTarget("finishMatch")} w="100%">
                            <Button
                                size="sm"
                                variant="solid"
                                colorPalette="red"
                                w="full"
                                pointerEvents="none"
                                tabIndex={-1}
                            >
                                {lp.primaryAction.finishMatch}
                            </Button>
                        </HL>
                    </VStack>
                </Box>
            )}

            {/* Cascade matches and finished states: just the timeline rows. */}
            {s.events.length > 0 && (s.matchEnded || (s.live && !interactive)) && eventRows}
        </VStack>
    )
}

/** Step 6 - mini results panel: the podium fills itself from the played
 *  bracket, then the user hands out the three awards. */
function ResultsMini({ s, t, hl, onTarget }: MiniProps) {
    const trr = t.components.tournamentResults
    const d = t.pages.tournamentDetailsPage.demoTab
    const podium = [
        { label: trr.podiumWinner, medal: "🥇", name: s.podium[0] },
        { label: trr.podiumSecond, medal: "🥈", name: s.podium[1] },
        { label: trr.podiumThird, medal: "🥉", name: s.podium[2] },
    ]
    const awards = [
        { id: "awardScorer", icon: <FaFutbol size={13} />, label: trr.awardScorer, name: s.awardScorer },
        { id: "awardMvp", icon: <FaStar size={13} />, label: trr.awardMvp, name: s.awardMvp },
        { id: "awardGk", icon: <FaShieldAlt size={13} />, label: trr.awardGoalkeeper, name: s.awardGk },
    ]
    return (
        <VStack align="stretch" gap="3">
            <Box>
                <Eyebrow>{trr.resultsFull}</Eyebrow>
                <VStack align="stretch" gap="1.5">
                    {podium.map((p, i) => (
                        <HStack
                            key={p.label}
                            borderWidth="1px"
                            borderColor={i === 0 && p.name ? "brand.emphasized" : "border"}
                            bg={i === 0 && p.name ? "brand.subtle" : "bg.panel"}
                            rounded="xl"
                            px="3"
                            py="2"
                            gap="2.5"
                        >
                            <Text as="span" fontSize="md" aria-hidden>
                                {p.medal}
                            </Text>
                            <Text
                                fontSize="2xs"
                                fontWeight={700}
                                color="fg.muted"
                                textTransform="uppercase"
                                letterSpacing="wider"
                                minW="72px"
                            >
                                {p.label}
                            </Text>
                            {p.name ? (
                                <Text fontSize="sm" fontWeight={700} truncate>
                                    {p.name}
                                </Text>
                            ) : (
                                <Box flex="1" borderBottomWidth="1px" borderStyle="dashed" borderColor="border.emphasized" />
                            )}
                        </HStack>
                    ))}
                </VStack>
            </Box>
            <Box>
                <Eyebrow>{trr.assignAwards}</Eyebrow>
                <VStack align="stretch" gap="1.5">
                    {awards.map((a) => (
                        <HStack
                            key={a.id}
                            borderWidth="1px"
                            borderColor="border"
                            bg="bg.panel"
                            rounded="xl"
                            px="3"
                            py="2"
                            gap="2.5"
                        >
                            <Box color="pitch.500" flexShrink={0}>
                                {a.icon}
                            </Box>
                            <Text fontSize="xs" fontWeight={600} color="fg.muted" flex="1" minW="0" truncate>
                                {a.label}
                            </Text>
                            {a.name ? (
                                <Text fontSize="sm" fontWeight={700} truncate>
                                    {a.name}
                                </Text>
                            ) : (
                                <HL on={hl === a.id} onClick={() => onTarget(a.id)}>
                                    <Button
                                        size="xs"
                                        variant="outline"
                                        colorPalette="brand"
                                        pointerEvents="none"
                                        tabIndex={-1}
                                    >
                                        {d.chooseButton}
                                    </Button>
                                </HL>
                            )}
                        </HStack>
                    ))}
                </VStack>
            </Box>
        </VStack>
    )
}

/* ── The section itself ────────────────────────────────────────────────── */

type Board = { pool: string[]; pairs: PairSlots[]; selected: string | null }

export default function DemoSection({
    format,
    tournamentId,
    onStateChange,
}: {
    format?: TournamentFormat | null
    tournamentId: string
    onStateChange?: (s: { active: boolean; highlightTab: SectionKey | null }) => void
}) {
    // v3: the draw step is always the knockout pairing board, regardless of
    // the tournament's format (4 demo teams → semifinals).
    void format
    const t = useTranslation()
    const d = t.pages.tournamentDetailsPage.demoTab

    const steps = useMemo(() => buildScript(t), [t])
    const { flat, bounds } = useMemo(() => {
        const flatActions: Action[] = []
        const startIdx: number[] = []
        for (const step of steps) {
            startIdx.push(flatActions.length)
            flatActions.push(...step.actions)
        }
        return { flat: flatActions, bounds: startIdx }
    }, [steps])

    // phase: "intro" (gate screen, nothing applied) → "running" → "done"
    // (user explicitly clicked "Završi" on the last step).
    // ptr = number of actions applied so far; flat[ptr] is the PENDING action.
    // stepFocus = the step the user is looking at; the engine never runs
    // actions past the focused step's boundary (no auto-advance to the next
    // step - the user clicks "Dalje"). maxStep = furthest step ever reached
    // (stepper pills are clickable only up to it). maxPtr = furthest ACTION
    // ever reached: revisiting an already-finished step must show it
    // finished (the team you typed is still there, the schedule is still
    // generated), not rewound to its start, so every jump clamps maxPtr into
    // the target step's range.
    //
    // None of this is persisted on purpose: the Demo tab unmounts when the
    // organizer switches to another section, and leaving the demo is meant
    // to start it over. Moving between the demo's own steps never unmounts,
    // so this state survives exactly as long as it should.
    const [phase, setPhase] = useState<"intro" | "running" | "done">("intro")
    const [ptr, setPtr] = useState(0)
    const [maxPtr, setMaxPtr] = useState(0)
    const [stepFocus, setStepFocus] = useState(0)
    const [maxStep, setMaxStep] = useState(0)
    // The one durable fact - "this organizer finished the demo for this
    // tournament before" - shown even after Replay/restart.
    const [completed, setCompleted] = useState(() => readDemoCompleted(tournamentId))
    // Typed input values + manual-pairing outcomes, keyed by global action
    // index - replays reproduce what the user actually entered/arranged.
    const inputValues = useRef(new Map<number, string>())
    const taskRecords = useRef(new Map<number, (number | null)[][]>())
    const [inputDraft, setInputDraft] = useState("")
    // Live overlay for the in-progress pairing task (null when untouched).
    const [taskLive, setTaskLive] = useState<Board | null>(null)

    // Every advance (click, typed input, finished pairing, auto timer) moves
    // the high-water mark - that's what makes a revisit show the step as it
    // was left rather than replayed from its start.
    useEffect(() => {
        setMaxPtr((m) => Math.max(m, ptr))
    }, [ptr])

    /** Index one past the last action of step `i`. */
    const endOfStep = (i: number) => (i + 1 < bounds.length ? bounds[i + 1] : flat.length)
    const stepEnd = stepFocus + 1 < bounds.length ? bounds[stepFocus + 1] : flat.length
    const applied = Math.min(ptr, flat.length)
    const pending = phase === "running" && ptr < stepEnd ? flat[ptr] : undefined
    const stepComplete = phase === "running" && ptr >= stepEnd
    const isLastStep = stepFocus === steps.length - 1
    const finishedAll = stepComplete && isLastStep

    // Run pending "auto" actions on their own timer; click/input/task wait
    // for the user. Timer cleaned up on unmount/jump/restart via the effect.
    useEffect(() => {
        if (!pending || pending.kind !== "auto") return
        const at = ptr
        const id = window.setTimeout(() => setPtr((p) => (p === at ? p + 1 : p)), pending.delay)
        return () => window.clearTimeout(id)
    }, [pending, ptr])

    // Fresh draft whenever an input action becomes pending.
    useEffect(() => {
        if (pending?.kind === "input") setInputDraft("")
    }, [pending])

    // Fold the script into the current miniature state - tiny and pure, so
    // replaying from scratch on every pointer move is cheap. Inputs use the
    // recorded value (or the default); the task uses the recorded pairing
    // (as team indices, so renamed teams stay correct) or `autoResolve`.
    const state = useMemo(() => {
        let s = INITIAL
        for (let i = 0; i < applied; i++) {
            const a = flat[i]
            if (a.kind === "input") s = a.apply(s, inputValues.current.get(i) ?? a.defaultValue)
            else if (a.kind === "task") {
                const rec = taskRecords.current.get(i)
                s = rec ? a.restore(s, rec) : a.autoResolve(s)
            } else s = a.apply(s)
        }
        return s
    }, [applied, flat])

    // Narration: a pending click/input/task shows its instruction; otherwise
    // the most recently applied caption holds.
    let cap: Caption | undefined
    if (pending && pending.kind !== "auto") {
        cap = pending.caption
    } else {
        for (let i = applied - 1; i >= 0; i--) {
            const cc = flat[i].caption
            if (cc) {
                cap = cc
                break
            }
        }
    }
    const caption = cap == null ? undefined : typeof cap === "function" ? cap(state) : cap
    const highlight = pending && (pending.kind === "click" || pending.kind === "input") ? pending.targetId : undefined

    /** The user clicked a highlighted mini control - advance if it is the one
     *  the script is waiting for. Clicks anywhere else do nothing. */
    const handleTarget = (id: string) => {
        if (phase !== "running") return
        // Validate inside the updater: a rapid double-click queues two updates,
        // and the second must see the already-advanced pointer and no-op.
        setPtr((p) => {
            const a = p < stepEnd ? flat[p] : undefined
            if (!a || a.kind !== "click" || a.targetId !== id) return p
            return p + 1
        })
    }

    /** Confirm the pending input action with the trimmed typed value. */
    const confirmInput = () => {
        if (pending?.kind !== "input") return
        const v = inputDraft.trim()
        if (!v) return
        inputValues.current.set(ptr, v)
        const at = ptr
        setPtr((p) => (p === at ? p + 1 : p))
    }

    // ── Manual pairing task ──────────────────────────────────────────────
    const taskPending = pending?.kind === "task"
    const board: Board = taskLive ?? { pool: state.pool, pairs: state.pairs, selected: null }

    const onChipClick = (name: string) => {
        if (!taskPending) return
        setTaskLive({ ...board, selected: board.selected === name ? null : name })
    }

    /** Commits a pool/pairs arrangement - advances the engine once every
     *  slot is filled, otherwise just updates the live overlay. Shared by
     *  click-to-place (onSlotClick) and drag-and-drop (onDropTeam). */
    const commitTask = (pool: string[], pairs: PairSlots[]) => {
        if (pending?.kind !== "task") return
        const merged: DemoState = { ...state, pool, pairs }
        if (pending.isDone(merged)) {
            taskRecords.current.set(ptr, pending.capture(merged))
            setTaskLive(null)
            const at = ptr
            setPtr((p) => (p === at ? p + 1 : p))
        } else {
            setTaskLive({ pool, pairs, selected: null })
        }
    }

    const onSlotClick = (pi: number, si: number) => {
        if (pending?.kind !== "task") return
        const slot = board.pairs[pi][si]
        if (slot != null) {
            // Clicking a placed chip returns it to the pool.
            const pairs = board.pairs.map((p, i) =>
                i === pi ? (p.map((x, j) => (j === si ? null : x)) as PairSlots) : p,
            )
            setTaskLive({ pool: [...board.pool, slot], pairs, selected: board.selected })
            return
        }
        if (board.selected == null) return
        const pairs = board.pairs.map((p, i) =>
            i === pi ? (p.map((x, j) => (j === si ? board.selected : x)) as PairSlots) : p,
        )
        commitTask(board.pool.filter((n) => n !== board.selected), pairs)
    }

    /** Dragged `name` dropped onto `zone` ("pool" or "{pi}-{si}"). Removes
     *  the team from wherever it currently sits first, so this also covers
     *  slot-to-slot moves and bumps a swapped-out occupant back to the pool. */
    const onDropTeam = (name: string, zone: string) => {
        if (pending?.kind !== "task") return
        // Where `name` is dragged FROM - a slot-to-slot drag onto an occupied
        // target does a true swap (occupant takes the vacated source slot),
        // matching the real bracket draw; a pool-to-slot drag just bumps the
        // displaced occupant back to the pool (it has no slot to return to).
        const sourcePi = board.pairs.findIndex((p) => p.includes(name))
        const sourceSi = sourcePi >= 0 ? board.pairs[sourcePi].indexOf(name) : -1

        if (zone === "pool") {
            if (board.pool.includes(name)) return
            const pairs = board.pairs.map((p) => p.map((x) => (x === name ? null : x)) as PairSlots)
            commitTask([...board.pool, name], pairs)
            return
        }
        const [piStr, siStr] = zone.split("-")
        const pi = Number(piStr)
        const si = Number(siStr)
        if (!Number.isInteger(pi) || !Number.isInteger(si) || !board.pairs[pi]) return
        if (board.pairs[pi][si] === name) return

        const occupant = board.pairs[pi][si]
        let pool = board.pool.filter((n) => n !== name)
        let pairs = board.pairs.map((p) => p.map((x) => (x === name ? null : x)) as PairSlots)
        pairs = pairs.map((p, i) => (i === pi ? (p.map((x, j) => (j === si ? name : x)) as PairSlots) : p))
        if (occupant && occupant !== name) {
            if (sourcePi >= 0) {
                pairs = pairs.map((p, i) =>
                    i === sourcePi ? (p.map((x, j) => (j === sourceSi ? occupant : x)) as PairSlots) : p,
                )
            } else {
                pool = [...pool, occupant]
            }
        }
        commitTask(pool, pairs)
    }

    // ── Navigation ───────────────────────────────────────────────────────
    /** Focus step `i`, restoring how far the engine had already got inside
     *  it: an already-finished step lands on its END (fully applied - the
     *  typed team, the generated schedule are all still there), a step still
     *  in progress resumes at the exact pending action. Replays stay
     *  deterministic because the fold uses the recorded inputs/pairings. */
    const jumpToStep = (i: number) => {
        setStepFocus(i)
        setPtr(Math.min(Math.max(maxPtr, bounds[i]), endOfStep(i)))
        setTaskLive(null)
    }
    const goNext = () => {
        if (!stepComplete || isLastStep) return
        const n = stepFocus + 1
        setMaxStep((m) => Math.max(m, n))
        jumpToStep(n)
    }
    const goBack = () => {
        if (stepFocus > 0) jumpToStep(stepFocus - 1)
    }
    const startDemo = () => {
        inputValues.current.clear()
        taskRecords.current.clear()
        setPtr(0)
        setMaxPtr(0)
        setStepFocus(0)
        setMaxStep(0)
        setTaskLive(null)
        setInputDraft("")
        setPhase("running")
    }
    const restartToIntro = () => {
        inputValues.current.clear()
        taskRecords.current.clear()
        setPtr(0)
        setMaxPtr(0)
        setStepFocus(0)
        setMaxStep(0)
        setTaskLive(null)
        setInputDraft("")
        setPhase("intro")
    }
    /** User explicitly ends the demo on the last step - marks it completed
     *  (sticky, survives a later Replay) and shows the completion box. */
    const finishDemo = () => {
        setCompleted(true)
        writeDemoCompleted(tournamentId)
        setPhase("done")
    }

    // Report activity + which real tab mirrors the current step, but only
    // when the values actually change.
    const active = phase === "running" && !finishedAll
    const highlightTab: SectionKey | null = active ? TAB_FOR_STEP[steps[stepFocus].key] : null
    const lastSent = useRef<{ active: boolean; highlightTab: SectionKey | null } | null>(null)
    useEffect(() => {
        if (!onStateChange) return
        const prev = lastSent.current
        if (prev && prev.active === active && prev.highlightTab === highlightTab) return
        lastSent.current = { active, highlightTab }
        onStateChange({ active, highlightTab })
    }, [active, highlightTab, onStateChange])

    const inputCtx: InputCtx = {
        draft: inputDraft,
        setDraft: setInputDraft,
        confirm: confirmInput,
        placeholder: pending?.kind === "input" ? pending.placeholder : undefined,
    }
    const boardCtx: BoardCtx = { ...board, taskPending, onChipClick, onSlotClick, onDropTeam }
    const miniProps: MiniProps = { s: state, t, hl: highlight, onTarget: handleTarget, input: inputCtx }
    const stepKey = steps[stepFocus].key
    const stage =
        phase === "intro" ? (
            <VStack gap="4" py="10" px="3" textAlign="center" justify="center" minH="240px">
                <Text fontSize="sm" color="fg.muted" maxW="420px">
                    {d.intro}
                </Text>
                <PrimaryButton onClick={startDemo} px="5" py="2.5" fontSize="14px">
                    {d.startButton}
                </PrimaryButton>
                {completed && (
                    <HStack gap="1.5" color="pitch.fg" fontSize="xs" fontWeight={700}>
                        <FiCheck size={13} /> <Text as="span">{d.completed.title}</Text>
                    </HStack>
                )}
            </VStack>
        ) : phase === "done" ? (
            <VStack gap="3" py="10" px="3" textAlign="center" justify="center" minH="240px">
                <Flex boxSize="14" rounded="full" bg="pitch.subtle" color="pitch.fg" align="center" justify="center">
                    <FiCheck size={28} />
                </Flex>
                <Heading size="sm">{d.completed.title}</Heading>
                <Text fontSize="sm" color="fg.muted" maxW="380px">
                    {d.completed.description}
                </Text>
            </VStack>
        ) : stepKey === "teams" ? (
            <TeamsMini {...miniProps} />
        ) : stepKey === "players" ? (
            <PlayersMini {...miniProps} />
        ) : stepKey === "draw" ? (
            <DrawMini {...miniProps} board={boardCtx} />
        ) : stepKey === "schedule" ? (
            <ScheduleMini {...miniProps} />
        ) : stepKey === "zapisnik" ? (
            <ZapisnikMini {...miniProps} />
        ) : (
            <ResultsMini {...miniProps} />
        )

    return (
        <Panel p={{ base: "4", md: "5" }}>
            <VStack align="stretch" gap="4">
                <Box>
                    <Heading size="md" lineHeight="1.25" letterSpacing="-0.01em">
                        {d.title}
                    </Heading>
                    <Text fontSize="sm" color="fg.muted" mt="0.5">
                        {d.subtitle}
                    </Text>
                </Box>

                <HStack
                    gap="2"
                    bg="brand.subtle"
                    color="brand.fg"
                    rounded="lg"
                    px="3"
                    py="2"
                    align="flex-start"
                >
                    <Box mt="0.5" flexShrink={0}>
                        <FiInfo size={13} />
                    </Box>
                    <Text fontSize="xs" fontWeight={600}>
                        {d.notSavedBanner}
                    </Text>
                </HStack>

                {/* Stepper - pills flow one into the next through chevrons.
                    Only already-visited steps are clickable (the walkthrough
                    is forced forward); future pills are inert. */}
                <Flex wrap="wrap" gap="1.5" align="center">
                    {steps.map((step, i) => {
                        const isActive = phase === "running" && i === stepFocus
                        const done =
                            phase === "done" ||
                            (phase === "running" && (i < stepFocus || (finishedAll && i === stepFocus)))
                        const clickable = phase === "running" && i <= maxStep && i !== stepFocus
                        return (
                            <Fragment key={step.key}>
                                {i > 0 && (
                                    <Box color="fg.muted" display="inline-flex" flexShrink={0} aria-hidden>
                                        <FiChevronRight size={14} />
                                    </Box>
                                )}
                                <chakra.button
                                    type="button"
                                    onClick={clickable ? () => jumpToStep(i) : undefined}
                                    display="inline-flex"
                                    alignItems="center"
                                    gap="1.5"
                                    px="3"
                                    py="1.5"
                                    rounded="full"
                                    border="none"
                                    cursor={clickable ? "pointer" : "default"}
                                    fontSize="12px"
                                    fontWeight={600}
                                    bg={isActive ? "pitch.solid" : done ? "brand.subtle" : "bg.panel"}
                                    color={isActive ? "pitch.contrast" : done ? "brand.fg" : "fg.soft"}
                                    opacity={!isActive && !done && !clickable ? 0.6 : undefined}
                                    boxShadow={
                                        isActive ? "none" : "inset 0 0 0 1px var(--chakra-colors-border)"
                                    }
                                    transition="background 150ms, color 150ms"
                                    _hover={clickable ? { bg: "bg.surfaceTint" } : undefined}
                                >
                                    <Box as="span" display="inline-flex" fontWeight={800}>
                                        {done && !isActive ? <FiCheck size={12} /> : i + 1}
                                    </Box>
                                    {step.name}
                                </chakra.button>
                            </Fragment>
                        )
                    })}
                    {phase !== "intro" && (
                        <IconButton
                            aria-label={d.restartAria}
                            size="xs"
                            variant="ghost"
                            ml="1"
                            onClick={restartToIntro}
                        >
                            <FiRotateCcw />
                        </IconButton>
                    )}
                </Flex>

                {/* Stage left, instructions + navigation right (stacked on
                    mobile: stage first, panel below). */}
                <Flex direction={{ base: "column", md: "row" }} gap="4" align="stretch">
                    <Box
                        flex="1"
                        minW="0"
                        borderWidth="1px"
                        borderColor="border"
                        rounded="2xl"
                        bg="bg.subtle"
                        p={{ base: "3", md: "4" }}
                        minH="280px"
                    >
                        {stage}
                    </Box>

                    {phase === "running" && (
                        <VStack w={{ base: "full", md: "260px" }} flexShrink={0} align="stretch" gap="3">
                            <Box
                                borderWidth="1px"
                                borderColor="border"
                                rounded="xl"
                                bg="bg.panel"
                                p="3"
                                flex={{ md: "1" }}
                            >
                                <Text fontSize="15px" fontWeight={700} color="fg" minH="1.5em">
                                    {caption}
                                </Text>
                                {stepComplete && (
                                    <Text fontSize="xs" fontWeight={700} color="brand.fg" mt="2">
                                        {isLastStep ? d.captions.stepDoneFinish : d.captions.stepDone}
                                    </Text>
                                )}
                            </Box>
                            <HStack gap="2">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    flex="1"
                                    onClick={goBack}
                                    disabled={stepFocus === 0}
                                >
                                    <FiChevronLeft /> {t.common.back}
                                </Button>
                                <Box position="relative" flex="1" display="flex">
                                    {finishedAll ? (
                                        <Button
                                            size="sm"
                                            variant="solid"
                                            colorPalette="brand"
                                            w="full"
                                            onClick={finishDemo}
                                        >
                                            {d.finishButton} <FiCheck />
                                        </Button>
                                    ) : (
                                        <Button
                                            size="sm"
                                            variant="solid"
                                            colorPalette="brand"
                                            w="full"
                                            onClick={goNext}
                                            disabled={!stepComplete}
                                        >
                                            {d.nextButton} <FiChevronRight />
                                        </Button>
                                    )}
                                    {stepComplete && (
                                        <Box
                                            position="absolute"
                                            inset="-4px"
                                            rounded="lg"
                                            borderWidth="2px"
                                            borderColor="pitch.500"
                                            pointerEvents="none"
                                            css={{ animation: "pitchPulse 1.2s ease-in-out infinite" }}
                                        />
                                    )}
                                </Box>
                            </HStack>
                        </VStack>
                    )}

                    {phase === "done" && (
                        <VStack w={{ base: "full", md: "260px" }} flexShrink={0} align="stretch" gap="3">
                            <Box borderWidth="1px" borderColor="border" rounded="xl" bg="bg.panel" p="3" flex={{ md: "1" }}>
                                <Text fontSize="15px" fontWeight={700} color="fg">
                                    {d.completed.description}
                                </Text>
                            </Box>
                            <Button size="sm" variant="solid" colorPalette="brand" onClick={startDemo}>
                                <FiRotateCcw /> {d.replay}
                            </Button>
                        </VStack>
                    )}
                </Flex>
            </VStack>
        </Panel>
    )
}
