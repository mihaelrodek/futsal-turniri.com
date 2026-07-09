import type { Group, GroupStandingRow, ThirdPlacedRow, ThirdPlacedTable } from "../types/groups"

/* ──────────────────────────────────────────────────────────────────────────
   Live standings overlay.

   The backend computes group standings from FINISHED matches only
   (GroupStageService.standings). While a group match is LIVE its current
   score should already show in the table - provisionally - so spectators see
   points / goal difference move in real time. This module overlays the LIVE
   scores from `group.matches` (the payload already carries them) onto the
   backend rows, re-ranks with a faithful port of the backend's tie-break
   rules, and tracks exactly which fields each live match modified so the UI
   can paint those cells red. When the match finishes, its status flips to
   FINISHED, the refetched backend standings absorb the result, the overlay
   no-ops and the red highlighting disappears - no extra state to clear.

   Ranking port (GroupStageService.rankRows/breakTie/headToHead):
     1. points desc;
     2. teams level on points → head-to-head POINTS among the tied "circle",
        re-computed recursively for each proper sub-circle;
     3. a circle level on H2H points → OVERALL goal difference desc;
     4. then OVERALL goals scored desc.
   Third-place table (thirdPlacedTable): the row at index `advancePerGroup`
   of each group, sorted points desc → goal diff desc → goals-for desc; the
   top `bestThirdCount` qualify.
   ────────────────────────────────────────────────────────────────────── */

/** Standings fields a live match can provisionally modify. */
export type LiveField = "played" | "won" | "drawn" | "lost" | "goals" | "goalDiff" | "points"

export type LiveStandingRow = GroupStandingRow & {
    /** Fields whose value differs from the persisted (FINISHED-only) row -
     *  i.e. provisionally modified by an in-progress match. Render red. */
    liveChanged: ReadonlySet<LiveField>
    /** Provisional result letter ("W"|"D"|"L") of the team's LIVE match, or
     *  null when the team isn't playing right now. Appended to the form strip
     *  as a red outlined badge. */
    liveForm: "W" | "D" | "L" | null
}

type H2HMatch = { team1Id: number; team2Id: number; score1: number; score2: number }

/** Head-to-head points among the given ids (win 3 / draw 1), circle-scoped. */
function headToHead(ids: ReadonlySet<number>, matches: H2HMatch[]): Map<number, number> {
    const pts = new Map<number, number>()
    ids.forEach((id) => pts.set(id, 0))
    for (const m of matches) {
        if (!ids.has(m.team1Id) || !ids.has(m.team2Id)) continue
        if (m.score1 > m.score2) pts.set(m.team1Id, pts.get(m.team1Id)! + 3)
        else if (m.score1 < m.score2) pts.set(m.team2Id, pts.get(m.team2Id)! + 3)
        else {
            pts.set(m.team1Id, pts.get(m.team1Id)! + 1)
            pts.set(m.team2Id, pts.get(m.team2Id)! + 1)
        }
    }
    return pts
}

/** Order a points-level circle: H2H points, recursing into proper
 *  sub-circles; a circle level on H2H points falls back to overall GD → GF. */
function breakTie(tied: LiveStandingRow[], matches: H2HMatch[]): LiveStandingRow[] {
    if (tied.length <= 1) return tied
    const ids = new Set(tied.map((r) => r.teamId))
    const h2h = headToHead(ids, matches)
    const sorted = [...tied].sort((a, b) => h2h.get(b.teamId)! - h2h.get(a.teamId)!)

    const result: LiveStandingRow[] = []
    let k = 0
    while (k < sorted.length) {
        let l = k + 1
        const pk = h2h.get(sorted[k].teamId)!
        while (l < sorted.length && h2h.get(sorted[l].teamId)! === pk) l++
        const block = sorted.slice(k, l)
        if (block.length === 1) result.push(block[0])
        else if (block.length === sorted.length) {
            // H2H points couldn't split this circle → overall GD then GF.
            block.sort((a, b) => b.goalDiff - a.goalDiff || b.goalsFor - a.goalsFor)
            result.push(...block)
        } else result.push(...breakTie(block, matches))
        k = l
    }
    return result
}

function rankRows(rows: LiveStandingRow[], matches: H2HMatch[]): void {
    rows.sort((a, b) => b.points - a.points)
    let i = 0
    while (i < rows.length) {
        let j = i + 1
        while (j < rows.length && rows[j].points === rows[i].points) j++
        if (j - i > 1) {
            const ordered = breakTie(rows.slice(i, j), matches)
            for (let k = 0; k < ordered.length; k++) rows[i + k] = ordered[k]
        }
        i = j
    }
}

export type LiveGroupStandings = {
    rows: LiveStandingRow[]
    /** True when at least one of the group's matches is LIVE. */
    hasLive: boolean
}

/**
 * Overlay the group's LIVE match scores onto its persisted standings.
 * Without a live match this returns the backend rows verbatim (same order -
 * which also preserves an organizer's manual re-rank), just wrapped with
 * empty change-sets.
 */
export function liveGroupStandings(g: Group): LiveGroupStandings {
    const base = g.standings.map<LiveStandingRow>((r) => ({
        ...r,
        liveChanged: new Set<LiveField>(),
        liveForm: null,
    }))

    const live = g.matches.filter(
        (m) => m.status === "LIVE" && m.team1Id != null && m.team2Id != null,
    )
    if (live.length === 0) return { rows: base, hasLive: false }

    const byTeam = new Map(base.map((r) => [r.teamId, r]))
    for (const m of live) {
        const s1 = m.score1 ?? 0
        const s2 = m.score2 ?? 0
        const apply = (teamId: number, gf: number, ga: number) => {
            const row = byTeam.get(teamId)
            if (!row) return
            row.played += 1
            row.goalsFor += gf
            row.goalsAgainst += ga
            row.goalDiff = row.goalsFor - row.goalsAgainst
            if (gf > ga) row.won += 1
            else if (gf < ga) row.lost += 1
            else row.drawn += 1
            row.points = row.won * 3 + row.drawn
            row.liveForm = gf > ga ? "W" : gf < ga ? "L" : "D"
        }
        apply(m.team1Id!, s1, s2)
        apply(m.team2Id!, s2, s1)
    }

    // Mark exactly the fields whose value moved vs the persisted row, so the
    // UI paints only genuinely modified cells red (a live 0:0 changes played /
    // drawn / points but not goals or goal difference).
    const baseByTeam = new Map(g.standings.map((r) => [r.teamId, r]))
    for (const row of base) {
        const orig = baseByTeam.get(row.teamId)!
        const changed = row.liveChanged as Set<LiveField>
        if (row.played !== orig.played) changed.add("played")
        if (row.won !== orig.won) changed.add("won")
        if (row.drawn !== orig.drawn) changed.add("drawn")
        if (row.lost !== orig.lost) changed.add("lost")
        if (row.goalsFor !== orig.goalsFor || row.goalsAgainst !== orig.goalsAgainst)
            changed.add("goals")
        if (row.goalDiff !== orig.goalDiff) changed.add("goalDiff")
        if (row.points !== orig.points) changed.add("points")
    }

    // Re-rank provisionally: the live scores count in the head-to-head circle
    // exactly as they will once the match is FINISHED.
    const h2hMatches: H2HMatch[] = g.matches
        .filter(
            (m) =>
                (m.status === "FINISHED" || m.status === "LIVE") &&
                m.team1Id != null &&
                m.team2Id != null &&
                (m.status === "LIVE" || (m.score1 != null && m.score2 != null)),
        )
        .map((m) => ({
            team1Id: m.team1Id!,
            team2Id: m.team2Id!,
            score1: m.score1 ?? 0,
            score2: m.score2 ?? 0,
        }))
    rankRows(base, h2hMatches)

    return { rows: base, hasLive: true }
}

export type LiveThirdRow = Omit<ThirdPlacedRow, "standing"> & { standing: LiveStandingRow }

/**
 * Re-derive the "best third-placed" table from the live-overlaid groups.
 * Mirrors GroupStageService.thirdPlacedTable: take the row at index
 * `advancePerGroup` of each (re-ranked) group, sort points → GD → GF, flag
 * the top `bestThirdCount`. Group labels are looked up from the backend
 * table so they match its naming; a group's label survives even when the
 * live re-rank swaps WHICH team currently sits third.
 */
export function liveThirdTable(
    baseTable: ThirdPlacedTable,
    groups: Group[],
    overlays: Map<number, LiveGroupStandings>,
): LiveThirdRow[] {
    // group.id → backend label, resolved by matching the backend row's team
    // to the group that contains it (rows don't carry group ids).
    const labelByGroup = new Map<number, string>()
    for (const tr of baseTable.rows) {
        const g = groups.find((gr) =>
            gr.standings.some((s) => s.teamId === tr.standing.teamId),
        )
        if (g) labelByGroup.set(g.id, tr.groupName)
    }

    const candidates: { groupName: string; standing: LiveStandingRow }[] = []
    for (const g of groups) {
        const rows = overlays.get(g.id)?.rows
        if (!rows || rows.length <= baseTable.advancePerGroup) continue
        candidates.push({
            groupName: labelByGroup.get(g.id) ?? g.name,
            standing: rows[baseTable.advancePerGroup],
        })
    }
    candidates.sort(
        (a, b) =>
            b.standing.points - a.standing.points ||
            b.standing.goalDiff - a.standing.goalDiff ||
            b.standing.goalsFor - a.standing.goalsFor,
    )
    return candidates.map((c, idx) => ({
        rank: idx + 1,
        qualifies: idx < baseTable.bestThirdCount,
        groupName: c.groupName,
        standing: c.standing,
    }))
}
