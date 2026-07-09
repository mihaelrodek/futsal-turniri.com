import { MonoLabel } from "frontend"

const row: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "20px",
    padding: "8px",
}

const kicker: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    padding: "8px",
}

const value: React.CSSProperties = {
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: "22px",
    fontWeight: 800,
    color: "#0f172a",
    letterSpacing: "-0.02em",
}

/** The mono caption used as scoreboard/field labels across the detail screens. */
export function Labels() {
    return (
        <div style={row}>
            <MonoLabel>Datum</MonoLabel>
            <MonoLabel>Organizator</MonoLabel>
            <MonoLabel>Kotizacija</MonoLabel>
            <MonoLabel>Ekipe</MonoLabel>
        </div>
    )
}

/** As a kicker above a value - the pattern used inside every AccentStat tile. */
export function KickerOverValue() {
    return (
        <div style={kicker}>
            <MonoLabel>Prijavljene ekipe</MonoLabel>
            <span style={value}>16 / 24</span>
        </div>
    )
}

/** The `color` prop tints the label - pitch green for the highlighted kicker. */
export function Colored() {
    return (
        <div style={row}>
            <MonoLabel color="pitch.500">Uživo</MonoLabel>
            <MonoLabel color="fg.ink">Raspored</MonoLabel>
            <MonoLabel color="fg.muted">Završeno</MonoLabel>
        </div>
    )
}
