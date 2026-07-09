import { ConfirmDialog } from "frontend"

/* ConfirmDialog renders through a Portal, so it escapes the card box. Its
   card is pinned to `cardMode: single` + a fixed viewport in
   .design-sync/config.json so the open state stays inside the frame. */

const noop = () => {}

/** The destructive confirmation — regenerating a draw, clearing a schedule.
 *  `danger` flips the confirm button to red. */
export function Danger() {
    return (
        <ConfirmDialog
            open
            danger
            title="Ponovno generiraj ždrijeb?"
            description="Postojeći ždrijeb i svi uneseni rezultati bit će trajno obrisani."
            confirmLabel="Ponovno generiraj"
            onClose={noop}
            onConfirm={noop}
        />
    )
}

/** The neutral confirmation: brand-green confirm button. */
export function Neutral() {
    return (
        <ConfirmDialog
            open
            title="Objavi turnir?"
            description="Turnir će postati vidljiv svima i ekipe se mogu početi prijavljivati."
            confirmLabel="Objavi"
            onClose={noop}
            onConfirm={noop}
        />
    )
}

/** `busy` disables Odustani and puts the confirm button into its loading state. */
export function Busy() {
    return (
        <ConfirmDialog
            open
            busy
            danger
            title="Brisanje turnira…"
            description="Ovo može potrajati nekoliko sekundi."
            confirmLabel="Obriši turnir"
            onClose={noop}
            onConfirm={noop}
        />
    )
}
