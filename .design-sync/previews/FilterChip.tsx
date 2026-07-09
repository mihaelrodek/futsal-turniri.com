import { FilterChip } from "frontend"

const row: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "10px",
    padding: "4px",
}

/** The default (inactive) filter chip - a bordered white pill. */
export function Default() {
    return (
        <div style={row}>
            <FilterChip label="Svi turniri" onClick={() => {}} />
        </div>
    )
}

/** `active` flips the chip to a solid dark pill - the currently-applied filter. */
export function ActiveVsInactive() {
    return (
        <div style={row}>
            <FilterChip label="Svi turniri" active onClick={() => {}} />
            <FilterChip label="Nadolazeći" onClick={() => {}} />
            <FilterChip label="Završeni" onClick={() => {}} />
        </div>
    )
}

/** With a trailing count and a leading status dot. */
export function WithCountAndDot() {
    return (
        <div style={row}>
            <FilterChip label="Nadolazeći" count={12} dot="#0b6b3a" onClick={() => {}} />
            <FilterChip label="Završeni" count={38} dot="#94a3b8" onClick={() => {}} />
        </div>
    )
}

/** `pulse` animates the dot - used for the "UŽIVO" live filter. */
export function LivePulse() {
    return (
        <div style={row}>
            <FilterChip label="UŽIVO" count={3} dot="#dc2626" pulse active onClick={() => {}} />
        </div>
    )
}
