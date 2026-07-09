import { GhostButton } from "frontend"
import { FiTrash2, FiX } from "react-icons/fi"

const row: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "12px",
    padding: "4px",
}

const stack: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    padding: "4px",
    maxWidth: "280px",
}

/** The default outline secondary button - "Odustani" next to a primary CTA. */
export function Default() {
    return (
        <div style={row}>
            <GhostButton onClick={() => {}}>Odustani</GhostButton>
            <GhostButton icon={<FiX size={16} />} onClick={() => {}}>
                Odustani
            </GhostButton>
        </div>
    )
}

/** `danger` flips the text and border to red for destructive actions. */
export function Danger() {
    return (
        <div style={row}>
            <GhostButton danger icon={<FiTrash2 size={16} />} onClick={() => {}}>
                Obriši turnir
            </GhostButton>
        </div>
    )
}

/** `full` stretches to fill the container - the cancel action in a stacked form footer. */
export function FullWidth() {
    return (
        <div style={stack}>
            <GhostButton full onClick={() => {}}>
                Odustani
            </GhostButton>
        </div>
    )
}

/** `disabled` dims the button and blocks the pointer. */
export function Disabled() {
    return (
        <div style={row}>
            <GhostButton disabled onClick={() => {}}>
                Odustani
            </GhostButton>
        </div>
    )
}
