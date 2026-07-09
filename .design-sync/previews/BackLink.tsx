import { BackLink } from "frontend"

const wrap: React.CSSProperties = {
    padding: "8px",
}

/** The default back link - a left-arrow glyph next to the "Natrag" label. */
export function Default() {
    return (
        <div style={wrap}>
            <BackLink onClick={() => {}} />
        </div>
    )
}

/** A custom label - the full "back to the listing" wording used above a detail page. */
export function CustomLabel() {
    return (
        <div style={wrap}>
            <BackLink label="Natrag na popis" onClick={() => {}} />
        </div>
    )
}

/** With a `to` target - renders as an anchor-style link to another route. */
export function WithTarget() {
    return (
        <div style={wrap}>
            <BackLink to="/turniri" label="Natrag na turnire" onClick={() => {}} />
        </div>
    )
}
