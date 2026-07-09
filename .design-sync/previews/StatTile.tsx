import { StatTile } from "frontend"

const grid: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "10px",
    padding: "4px",
    width: 560,
}

const pair: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "10px",
    padding: "4px",
    width: 320,
}

/** Every `tone` — the colorPalette that recolours the value: gray (neutral),
 *  brand (pitch green), green and red for status metrics. */
export function Tones() {
    return (
        <div style={grid}>
            <StatTile label="EKIPE" value="12 / 16" tone="gray" />
            <StatTile label="PRIJAVLJENE" value="12" tone="brand" />
            <StatTile label="POPUNJENO" value="75%" tone="green" />
            <StatTile label="SLOBODNO" value="4" tone="red" />
        </div>
    )
}

/** With the muted `hint` caption below the value. */
export function WithHint() {
    return (
        <div style={pair}>
            <StatTile label="GOLOVA" value="38" hint="u 9 utakmica" tone="brand" />
            <StatTile label="KOTIZACIJA" value="50 €" hint="po ekipi" tone="gray" />
        </div>
    )
}

/** A single tile at its natural width — the compact bordered metric card. */
export function Single() {
    return (
        <div style={{ padding: "4px", width: 200 }}>
            <StatTile label="UTAKMICA" value="15" hint="raspoređeno" tone="green" />
        </div>
    )
}
