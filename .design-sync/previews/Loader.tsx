import { Loader } from "frontend"

const wrap: React.CSSProperties = { maxWidth: 560, border: "1px solid #dde5d8", borderRadius: 16, background: "#fff" }

/** The default section loader: pitch-green spinner + "Učitavanje…". */
export function Default() {
    return (
        <div style={wrap}>
            <Loader />
        </div>
    )
}

/** A custom label for a specific section that's fetching. */
export function CustomLabel() {
    return (
        <div style={wrap}>
            <Loader label="Učitavanje rasporeda…" />
        </div>
    )
}
