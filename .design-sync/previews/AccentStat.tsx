import { AccentStat } from "frontend"
import { FiCalendar, FiClock, FiUsers, FiDollarSign } from "react-icons/fi"

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

/** The quick-stats strip from the tournament detail screen — one tile per
 *  accent, each carrying the real Croatian label/value it ships with. */
export function AccentColors() {
    return (
        <div style={grid}>
            <AccentStat label="DATUM" value="22. svibnja" accent="pitch.500" />
            <AccentStat label="VRIJEME" value="19:15" accent="accent.amber" />
            <AccentStat label="EKIPE" value="12 / 16" accent="accent.goal" />
            <AccentStat label="KOTIZACIJA" value="50 €" accent="accent.red" />
        </div>
    )
}

/** With a leading Feather icon next to the mono label — used on the
 *  statistika headline row. */
export function WithIcons() {
    return (
        <div style={grid}>
            <AccentStat label="DATUM" value="22. svibnja" accent="pitch.500" icon={<FiCalendar size={13} />} />
            <AccentStat label="VRIJEME" value="19:15" accent="accent.amber" icon={<FiClock size={13} />} />
            <AccentStat label="EKIPE" value="12 / 16" accent="accent.goal" icon={<FiUsers size={13} />} />
            <AccentStat label="KOTIZACIJA" value="50 €" accent="accent.red" icon={<FiDollarSign size={13} />} />
        </div>
    )
}

/** The optional `hint` line under the value — the muted secondary caption. */
export function WithHint() {
    return (
        <div style={pair}>
            <AccentStat label="GOLOVA" value="38" hint="prosjek 4.2 po utakmici" accent="pitch.500" />
            <AccentStat label="UTAKMICA" value="15" hint="9 odigrano" accent="accent.goal" />
        </div>
    )
}
