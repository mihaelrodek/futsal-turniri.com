import { StatusChip } from "frontend"

const row: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "10px",
    padding: "4px",
}

/** Every status kind, with the Croatian label each one carries in the app. */
export function Statuses() {
    return (
        <div style={row}>
            <StatusChip status="live" label="UŽIVO" />
            <StatusChip status="upcoming" label="Nadolazeći" />
            <StatusChip status="soon" label="Za 6 dana" />
            <StatusChip status="full" label="Mjesta puna" />
            <StatusChip status="draft" label="Nacrt" />
            <StatusChip status="active" label="U tijeku" />
            <StatusChip status="finished" label="Završeno" />
        </div>
    )
}

/** The three sizes. `lg` is what PageTitle renders next to a tournament name. */
export function Sizes() {
    return (
        <div style={row}>
            <StatusChip status="live" label="UŽIVO" size="sm" />
            <StatusChip status="live" label="UŽIVO" size="md" />
            <StatusChip status="live" label="UŽIVO" size="lg" />
        </div>
    )
}

/** `live` is the only kind whose dot pulses; the rest hold a static marker. */
export function LiveVsUpcoming() {
    return (
        <div style={row}>
            <StatusChip status="live" label="UŽIVO" size="lg" />
            <StatusChip status="upcoming" label="Nadolazeći" size="lg" />
        </div>
    )
}
