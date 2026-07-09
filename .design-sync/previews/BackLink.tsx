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

/* NB: no cell sweeps `to`. It only writes a `data-href` attribute and does not
   change the render, so a cell for it would be visually identical to the one
   above — see .design-sync/NOTES.md, "Traps found while authoring". */
