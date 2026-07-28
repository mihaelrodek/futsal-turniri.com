// Assembles ZapisnikData for one match from the existing public APIs plus the
// manual fields collected by the export dialog (officials, hall, goalkeepers).
// The renderers (xlsx.ts / pdf.ts) consume the result without touching the
// network; everything label-like comes from spec.ts so the two backends agree.

import { fetchSchedule } from "../../api/schedule"
import { fetchTournamentDetails } from "../../api/tournaments"
import { fetchMatchEvents } from "../../api/matchEvents"
import { fetchPlayers } from "../../api/players"
import type { Schedule, ScheduledMatch } from "../../types/schedule"
import type { MatchEventDto } from "../../types/matchEvents"
import type { PlayerDto } from "../../types/players"
import type { TournamentDetails } from "../../types/tournaments"
import type {
    ZapisnikData,
    ZapisnikGoal,
    ZapisnikLang,
    ZapisnikOfficials,
    ZapisnikPlayer,
    ZapisnikTeamBlock,
} from "./types"
import { zapisnikLabels } from "./spec"

/** Fields the data model does not carry - entered manually in the dialog. */
export interface ZapisnikManualFields {
    officials: ZapisnikOfficials
    hall: string
    /** Overrides the tournament location when non-empty. */
    venueTown: string
    /** Player ids marked as goalkeepers in the dialog. */
    goalkeeperIds: ReadonlySet<number>
}

/** Everything fetched once per match; the dialog shows the rosters from it
 *  (goalkeeper marking) and then builds the final data synchronously. */
export interface ZapisnikMatchContext {
    schedule: Schedule
    scheduled: ScheduledMatch
    tournament: TournamentDetails
    events: MatchEventDto[]
    hostPlayers: PlayerDto[]
    guestPlayers: PlayerDto[]
}

/** Knockout stage names per language (GROUP is handled via the group name). */
const STAGE_HR: Record<string, string> = {
    ROUND_OF_32: "1/16 finala",
    ROUND_OF_16: "Osmina finala",
    QUARTERFINAL: "Četvrtfinale",
    SEMIFINAL: "Polufinale",
    THIRD_PLACE: "Za 3. mjesto",
    FINAL: "Finale",
}
const STAGE_EN: Record<string, string> = {
    ROUND_OF_32: "Round of 32",
    ROUND_OF_16: "Round of 16",
    QUARTERFINAL: "Quarter-final",
    SEMIFINAL: "Semi-final",
    THIRD_PLACE: "Third place",
    FINAL: "Final",
}

/** "dd. MM. yyyy." in local time - Croatian date format for both languages. */
function formatDate(iso: string | null | undefined): string {
    if (!iso) return ""
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ""
    const p = (n: number) => String(n).padStart(2, "0")
    return `${p(d.getDate())}. ${p(d.getMonth() + 1)}. ${d.getFullYear()}.`
}

/** "HH:mm" in local time. */
function formatTime(iso: string | null | undefined): string {
    if (!iso) return ""
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ""
    const p = (n: number) => String(n).padStart(2, "0")
    return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Fetch everything the zapisnik needs for one match. Throws when the match
 *  is not part of the tournament's schedule. */
export async function loadZapisnikContext(
    tournamentUuid: string,
    matchId: number,
): Promise<ZapisnikMatchContext> {
    const schedule = await fetchSchedule(tournamentUuid)
    const scheduled = schedule.matches.find((m) => m.matchId === matchId)
    if (!scheduled) throw new Error(`Match ${matchId} not found in schedule`)
    const [tournament, events, hostPlayers, guestPlayers] = await Promise.all([
        fetchTournamentDetails(tournamentUuid),
        fetchMatchEvents(tournamentUuid, matchId),
        scheduled.team1Id != null
            ? fetchPlayers(tournamentUuid, scheduled.team1Id).catch(() => [])
            : Promise.resolve<PlayerDto[]>([]),
        scheduled.team2Id != null
            ? fetchPlayers(tournamentUuid, scheduled.team2Id).catch(() => [])
            : Promise.resolve<PlayerDto[]>([]),
    ])
    return { schedule, scheduled, tournament, events, hostPlayers, guestPlayers }
}

/** Build the final ZapisnikData from a loaded context + the manual fields.
 *  Pure - no network - so the dialog can call it at download time. */
export function buildZapisnikData(
    ctx: ZapisnikMatchContext,
    lang: ZapisnikLang,
    manual: ZapisnikManualFields,
): ZapisnikData {
    const labels = zapisnikLabels(lang)
    const m = ctx.scheduled

    // Competition label: „Skupina X" / "Group X" for group matches, the stage
    // name for knockout ones. Round = the group round number when known.
    const competition =
        m.stage === "GROUP"
            ? m.groupName
                ? lang === "en"
                    ? `Group ${m.groupName}`
                    : `Skupina ${m.groupName}`
                : ""
            : (lang === "en" ? STAGE_EN[m.stage] : STAGE_HR[m.stage]) ?? ""
    const round = m.roundNumber != null ? String(m.roundNumber) : ""

    // Half length: knockout stages use koHalfLengthMin when set (null/0 = the
    // knockout plays like the group stage), otherwise the group half length.
    const koLen = ctx.schedule.koHalfLengthMin ?? 0
    const groupLen = ctx.schedule.halfLengthMin ?? 0
    const halfLength = m.stage !== "GROUP" && koLen > 0 ? koLen : groupLen

    // Jersey numbers by player id, for scorer lookup across both rosters.
    const numberById = new Map<number, number | null>()
    for (const p of [...ctx.hostPlayers, ...ctx.guestPlayers]) numberById.set(p.id, p.number)

    // Goals in chronological order (minute, then id - the insertion order for
    // same-minute events). Running score recomputed cumulatively; OWN_GOAL's
    // teamId is the BENEFICIARY, so it counts for that side directly.
    const goalEvents = ctx.events
        .filter((e) => e.type === "GOAL" || e.type === "OWN_GOAL")
        .sort((a, b) => a.minute - b.minute || a.id - b.id)
    let hostGoals = 0
    let guestGoals = 0
    let htHost = 0
    let htGuest = 0
    const goals: ZapisnikGoal[] = goalEvents.map((e) => {
        const forHost = e.teamId === m.team1Id
        if (forHost) hostGoals++
        else guestGoals++
        if (halfLength > 0 && e.minute < halfLength) {
            if (forHost) htHost++
            else htGuest++
        }
        let scorerNumber = ""
        if (e.type === "OWN_GOAL") {
            scorerNumber = labels.ownGoalMark
        } else if (e.playerId != null) {
            const num = numberById.get(e.playerId)
            scorerNumber = num != null ? String(num) : ""
        }
        return {
            runningScore: `${hostGoals}:${guestGoals}`,
            scorerNumber,
            minute: String(e.minute),
            penalty: false,
        }
    })

    // Card marks per player (any yellow / red event attributed to them).
    const yellowIds = new Set<number>()
    const redIds = new Set<number>()
    for (const e of ctx.events) {
        if (e.playerId == null) continue
        if (e.type === "YELLOW_CARD") yellowIds.add(e.playerId)
        else if (e.type === "RED_CARD") redIds.add(e.playerId)
    }

    const toPlayers = (roster: PlayerDto[]): ZapisnikPlayer[] =>
        roster.map((p) => ({
            number: p.number != null ? String(p.number) : "",
            name: p.name,
            captain: p.captain,
            goalkeeper: manual.goalkeeperIds.has(p.id),
            yellow: yellowIds.has(p.id),
            red: redIds.has(p.id),
        }))

    // Per-half team fouls come from the schedule DTO - the only foul source
    // once a match is FINISHED (the live overlay no longer carries it).
    const host: ZapisnikTeamBlock = {
        name: m.team1Name ?? "",
        players: toPlayers(ctx.hostPlayers),
        foulsFirst: m.fouls1First ?? 0,
        foulsSecond: m.fouls1Second ?? 0,
        timeoutFirst: false,
        timeoutSecond: false,
    }
    const guest: ZapisnikTeamBlock = {
        name: m.team2Name ?? "",
        players: toPlayers(ctx.guestPlayers),
        foulsFirst: m.fouls2First ?? 0,
        foulsSecond: m.fouls2Second ?? 0,
        timeoutFirst: false,
        timeoutSecond: false,
    }

    return {
        lang,
        tournamentName: ctx.tournament.name,
        competition,
        round,
        date: formatDate(m.kickoffAt),
        startTime: formatTime(m.kickoffAt),
        venueTown: manual.venueTown.trim() || (ctx.tournament.location ?? ""),
        hall: manual.hall.trim(),
        surface: labels.surfaceDefault,
        matchType: "",
        host,
        guest,
        finalScore: m.score1 != null && m.score2 != null ? `${m.score1} : ${m.score2}` : "",
        halftimeScore: halfLength > 0 ? `${htHost} : ${htGuest}` : "",
        goals,
        officials: {
            referee1: manual.officials.referee1.trim(),
            referee2: manual.officials.referee2.trim(),
            referee3: manual.officials.referee3.trim(),
            delegate: manual.officials.delegate.trim(),
            timekeeper: manual.officials.timekeeper.trim(),
        },
    }
}

/** One-shot assembly: fetch + build. The dialog uses the two-step variant
 *  (loadZapisnikContext for the roster UI, then buildZapisnikData). */
export async function assembleZapisnikData(args: {
    uuid: string
    matchId: number
    lang: ZapisnikLang
    manual: ZapisnikManualFields
}): Promise<ZapisnikData> {
    const ctx = await loadZapisnikContext(args.uuid, args.matchId)
    return buildZapisnikData(ctx, args.lang, args.manual)
}
