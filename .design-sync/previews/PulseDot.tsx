import { PulseDot } from "frontend"

const card: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "16px",
    width: 260,
    background: "#fff",
    border: "1px solid #dde5d8",
    borderRadius: 14,
}

const rowLabel: React.CSSProperties = {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#5d6671",
    minWidth: 96,
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={rowLabel}>{label}</span>
            {children}
        </div>
    )
}

/** The dot in each of its four semantic colours — the status markers the
 *  StatusChip and FilterChip build on. */
export function Colors() {
    return (
        <div style={card}>
            <Row label="Uživo"><PulseDot color="accent.red" size={9} /></Row>
            <Row label="Nadolazeći"><PulseDot color="pitch.400" size={9} /></Row>
            <Row label="Uskoro"><PulseDot color="accent.amber" size={9} /></Row>
            <Row label="Nacrt"><PulseDot color="accent.goal" size={9} /></Row>
        </div>
    )
}

/** A size ramp from the 6px chip marker up to a 16px standalone indicator. */
export function SizeRamp() {
    return (
        <div style={{ ...card, flexDirection: "row", alignItems: "center", gap: "16px", width: "auto" }}>
            <PulseDot color="accent.red" size={6} />
            <PulseDot color="accent.red" size={9} />
            <PulseDot color="accent.red" size={12} />
            <PulseDot color="accent.red" size={16} />
        </div>
    )
}

/** The `glow` prop adds a coloured halo — the emphasis used on the live dot. */
export function Glow() {
    return (
        <div style={card}>
            <Row label="Bez sjaja"><PulseDot color="accent.red" size={12} /></Row>
            <Row label="Sa sjajem"><PulseDot color="accent.red" size={12} glow /></Row>
        </div>
    )
}
