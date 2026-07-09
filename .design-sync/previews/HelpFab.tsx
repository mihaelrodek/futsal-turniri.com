import { HelpFab } from "frontend"

/* HelpFab is `position: fixed` (bottom-right of the viewport). A `transform` on the
   wrapper creates a containing block so the fixed FAB is pinned to this framed box
   instead of escaping the card. The first-run coach-mark bubble pops in above it. */
const frame: React.CSSProperties = {
    position: "relative",
    transform: "translateZ(0)",
    width: 320,
    height: 320,
    overflow: "hidden",
    borderRadius: 16,
    border: "1px solid #dde5d8",
    background: "#f4f7f2",
}

/** The floating "?" help button that opens the /vodic guide, with its first-visit coach mark. */
export function Default() {
    return (
        <div style={frame}>
            <HelpFab />
        </div>
    )
}
