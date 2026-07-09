import { BallIcon } from "frontend"

const card: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "20px",
    padding: "20px",
    background: "#fff",
    border: "1px solid #dde5d8",
    borderRadius: 14,
    width: "auto",
}

/** The size ramp — small inline glyph (16) up to the card-placeholder size
 *  (96) where the panels thicken proportionally. */
export function SizeRamp() {
    return (
        <div style={card}>
            <BallIcon size={16} color="#0b6b3a" />
            <BallIcon size={32} color="#0b6b3a" />
            <BallIcon size={64} color="#0b6b3a" />
            <BallIcon size={96} color="#0b6b3a" />
        </div>
    )
}

/** The mark in the palette's accent colours: pitch green, alert red, goal
 *  amber. */
export function Colors() {
    return (
        <div style={card}>
            <BallIcon size={64} color="#0b6b3a" />
            <BallIcon size={64} color="#dc2626" />
            <BallIcon size={64} color="#f5b921" />
        </div>
    )
}

/** `strokeWidth` overrides the auto-scaled panel line weight. */
export function StrokeWidth() {
    return (
        <div style={card}>
            <BallIcon size={64} color="#0b6b3a" strokeWidth={1} />
            <BallIcon size={64} color="#0b6b3a" strokeWidth={1.6} />
            <BallIcon size={64} color="#0b6b3a" strokeWidth={2.4} />
        </div>
    )
}
