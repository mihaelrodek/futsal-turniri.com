import { IosInstallSteps } from "frontend"

/* Presented inside its iOS dialog / first-run popup — framed like the real container. */
const dialog: React.CSSProperties = {
    maxWidth: 380,
    padding: "20px",
    borderRadius: 16,
    border: "1px solid #dde5d8",
    background: "#fff",
}

/** The three-step "Add to Home Screen" walkthrough — numbered blue badges, Safari share/plus glyphs. */
export function Default() {
    return (
        <div style={dialog}>
            <IosInstallSteps />
        </div>
    )
}
