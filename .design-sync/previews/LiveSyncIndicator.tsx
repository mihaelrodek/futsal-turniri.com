import { LiveSyncIndicator } from "frontend"

const grid: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    padding: "8px",
}

const cell: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "12px",
}

const caption: React.CSSProperties = {
    fontFamily: "monospace",
    fontSize: "11px",
    letterSpacing: "0.04em",
    color: "#5d6671",
    minWidth: 150,
}

/** The reachable states side by side: disconnected with unsaved edits, disconnected, and draining after reconnect. */
export function States() {
    return (
        <div style={grid}>
            <div style={cell}>
                <span style={caption}>offline · unsaved</span>
                <LiveSyncIndicator online={false} pending={3} syncing={false} />
            </div>
            <div style={cell}>
                <span style={caption}>offline · clean</span>
                <LiveSyncIndicator online={false} pending={0} syncing={false} />
            </div>
            <div style={cell}>
                <span style={caption}>reconnected · syncing</span>
                <LiveSyncIndicator online={true} pending={2} syncing={true} />
            </div>
        </div>
    )
}
