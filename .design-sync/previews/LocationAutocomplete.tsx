import { LocationAutocomplete } from "frontend"

/* LocationAutocomplete queries the Nominatim geocoding API as the user types.
   There is no network in the capture and the dropdown only opens on focus with
   ≥3 typed chars AND results, so we preview the two resting states the field
   shows offline: empty (placeholder) and pre-filled with a chosen address. */

const noop = () => {}
const wrap: React.CSSProperties = { width: 420, padding: "4px" }

/** The empty resting field an organiser first sees on the create form. */
export function Prazno() {
    return (
        <div style={wrap}>
            <LocationAutocomplete
                value=""
                onChange={noop}
                placeholder="Unesi lokaciju turnira…"
            />
        </div>
    )
}

/** A field carrying an already-picked location (the value the parent stores
 *  after a suggestion is selected). */
export function Popunjeno() {
    return (
        <div style={wrap}>
            <LocationAutocomplete
                value="Sportska dvorana, Zagreb"
                onChange={noop}
                placeholder="Unesi lokaciju turnira…"
            />
        </div>
    )
}

/** The disabled state — non-editable while the form is submitting. */
export function Onemoguceno() {
    return (
        <div style={wrap}>
            <LocationAutocomplete
                value="Gradski stadion, Split"
                onChange={noop}
                disabled
            />
        </div>
    )
}
