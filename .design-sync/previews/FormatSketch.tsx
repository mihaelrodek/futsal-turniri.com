import { FormatSketch } from "frontend"

/* FormatSketch draws an SVG diagram of the tournament format. The two
   TournamentFormat values render genuinely different pictures, so each is
   its own cell. */

const wrap: React.CSSProperties = { width: 460, padding: "4px" }

/** GROUPS_KNOCKOUT: two group boxes feeding an arrow into a semis → final
 *  bracket. The "Grupe + eliminacija" format most tournaments use. */
export function GrupeEliminacija() {
    return (
        <div style={wrap}>
            <FormatSketch format="GROUPS_KNOCKOUT" />
        </div>
    )
}

/** KNOCKOUT_ONLY: a single elimination ladder, no groups — every loss knocks
 *  a team out. The "Samo eliminacija" format. */
export function SamoEliminacija() {
    return (
        <div style={wrap}>
            <FormatSketch format="KNOCKOUT_ONLY" />
        </div>
    )
}
