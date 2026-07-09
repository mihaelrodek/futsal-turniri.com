import { PrimaryButton } from "frontend"
import { FiPlus, FiSave } from "react-icons/fi"

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

/** The default solid pitch-green CTA - the primary action on every screen. */
export function Default() {
    return (
        <div style={row}>
            <PrimaryButton onClick={() => {}}>Spremi promjene</PrimaryButton>
        </div>
    )
}

/** With a leading icon - the "Kreiraj turnir" call to action. */
export function WithIcon() {
    return (
        <div style={row}>
            <PrimaryButton icon={<FiPlus size={16} />} onClick={() => {}}>
                Kreiraj turnir
            </PrimaryButton>
            <PrimaryButton icon={<FiSave size={16} />} onClick={() => {}}>
                Spremi promjene
            </PrimaryButton>
        </div>
    )
}

/** `full` stretches the button to fill its container - used at the bottom of forms. */
export function FullWidth() {
    return (
        <div style={stack}>
            <PrimaryButton full icon={<FiPlus size={16} />} onClick={() => {}}>
                Prijavi ekipu
            </PrimaryButton>
        </div>
    )
}

/** `disabled` dims to 50% and blocks the pointer - e.g. an incomplete form. */
export function Disabled() {
    return (
        <div style={row}>
            <PrimaryButton disabled onClick={() => {}}>
                Spremi promjene
            </PrimaryButton>
        </div>
    )
}
