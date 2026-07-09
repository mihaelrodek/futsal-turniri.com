import { BulkImportDialog } from "frontend"

/* BulkImportDialog is a modal that renders through a Portal and escapes the
   card box. It needs `cardMode: single` + a fixed viewport in config (see
   .design-sync/learnings/batch-e.md — this agent cannot edit config). A single
   `open` story is used so only one backdrop fills the frame. */

const noop = () => {}
const noopSubmit = async () => {}

/** Pasting a team list to bulk-add ekipe — one name per line. The footer
 *  carries "Odustani" and the "Uvezi" submit; the live line counter sits
 *  under the textarea. */
export function UvozEkipa() {
    return (
        <BulkImportDialog
            open
            title="Uvoz ekipa"
            description="Zalijepi popis ekipa, jednu po retku. Prazni redovi se preskaču."
            placeholder={"NK Dinamo\nHajduk Split\nNK Rijeka\nNK Osijek"}
            submitLabel="Uvezi"
            onClose={noop}
            onSubmit={noopSubmit}
        />
    )
}
