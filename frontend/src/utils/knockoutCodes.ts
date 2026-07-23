/**
 * Short knockout match codes ("Š1", "O2", "ČF1") shown on each knockout match.
 *
 * They make the backend's feeder labels resolvable: a quarter-final slot reads
 * "W O1" (winner of osmina match 1), and the round-of-16 match itself carries
 * the matching "O1" tag, so a viewer can trace who ends up where before the
 * teams are decided.
 *
 * <b>The numbering MUST mirror the backend.</b> KnockoutService builds its
 * feeder labels from `indexInStage` - the 1-based index among same-stage
 * matches ordered by id - so this sorts each stage's matches by `matchId` and
 * numbers them the same way. Any other order (bracket position, kickoff time)
 * would make "W O1" point at a differently-tagged match.
 *
 * Stages that never feed another slot (FINAL, THIRD_PLACE) and GROUP get no
 * code - nothing references them.
 */

/** Stage → short code, matching KnockoutService.stageAbbrev. */
export function koStageCode(stage: string): string | null {
    switch (stage) {
        case "ROUND_OF_32":
            return "Š" // šesnaestina finala
        case "ROUND_OF_16":
            return "O" // osmina finala
        case "QUARTERFINAL":
            return "ČF"
        case "SEMIFINAL":
            return "PF"
        default:
            return null
    }
}

/**
 * Map of `matchId` → code ("Š1", "O2", …) for every knockout match that can be
 * referenced by a later round. Pass ALL of a tournament's matches (group ones
 * are ignored); the map is empty when there is no knockout yet.
 */
export function buildKoMatchCodes(
    matches: readonly { matchId: number; stage: string }[],
): Map<number, string> {
    const byStage = new Map<string, { matchId: number }[]>()
    for (const m of matches) {
        if (koStageCode(m.stage) == null) continue
        const list = byStage.get(m.stage)
        if (list) list.push(m)
        else byStage.set(m.stage, [m])
    }
    const out = new Map<number, string>()
    for (const [stage, list] of byStage) {
        const code = koStageCode(stage) as string
        // Same ordering as the backend's indexInStage: by match id.
        list.sort((a, b) => a.matchId - b.matchId)
        list.forEach((m, i) => out.set(m.matchId, `${code}${i + 1}`))
    }
    return out
}
