import { Logo } from "frontend"

const row: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "24px",
    padding: "8px",
}

const darkTile: React.CSSProperties = {
    display: "inline-flex",
    padding: "16px 20px",
    borderRadius: "16px",
    background: "linear-gradient(135deg, #0b6b3a, #084a28)",
}

/** The default light lockup — dark "Futsal", pitch-green "Turniri", mono domain line. */
export function Light() {
    return (
        <div style={row}>
            <Logo variant="light" />
        </div>
    )
}

/** The `dark` variant sits on the pitch-green ground (footer / hero) — white wordmark, light-green accent. */
export function Dark() {
    return (
        <div style={row}>
            <div style={darkTile}>
                <Logo variant="dark" />
            </div>
        </div>
    )
}

/** The `size` axis — the whole lockup (mark + type + domain) scales from one number. */
export function Sizes() {
    return (
        <div style={row}>
            <Logo size={28} />
            <Logo size={44} />
        </div>
    )
}

/** `showDomain={false}` drops the domain line — the compact form used inside the footer. */
export function NoDomain() {
    return (
        <div style={row}>
            <Logo size={32} showDomain={false} />
        </div>
    )
}
