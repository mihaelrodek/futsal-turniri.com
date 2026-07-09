import { PitchBackdrop } from "frontend"

/* PitchBackdrop is position:absolute and paints nothing without a sized,
   position:relative parent — so every cell wraps it in a framed panel. */
function Panel({
    from,
    to,
    children,
}: {
    from: string
    to: string
    children: React.ReactNode
}) {
    return (
        <div
            style={{
                position: "relative",
                width: 300,
                height: 168,
                overflow: "hidden",
                borderRadius: 16,
                background: `linear-gradient(135deg, ${from}, ${to})`,
            }}
        >
            {children}
        </div>
    )
}

const wrap: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: "16px",
    padding: "4px",
}

/** The two tones: `court` (concrete-grey hard court, the default placeholder)
 *  vs `pitch` (green branded hero). The futsal markings read on both. */
export function Tones() {
    return (
        <div style={wrap}>
            <Panel from="#9aa3ad" to="#5d6671">
                <PitchBackdrop tone="court" opacity={0.5} />
            </Panel>
            <Panel from="#3aa56b" to="#0b6b3a">
                <PitchBackdrop tone="pitch" opacity={0.6} />
            </Panel>
        </div>
    )
}

/** The `opacity` axis — how strongly the court markings wash over the panel. */
export function Opacity() {
    return (
        <div style={wrap}>
            <Panel from="#9aa3ad" to="#5d6671">
                <PitchBackdrop tone="court" opacity={0.16} />
            </Panel>
            <Panel from="#9aa3ad" to="#5d6671">
                <PitchBackdrop tone="court" opacity={0.4} />
            </Panel>
            <Panel from="#9aa3ad" to="#5d6671">
                <PitchBackdrop tone="court" opacity={0.7} />
            </Panel>
        </div>
    )
}
