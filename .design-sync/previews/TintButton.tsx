import { TintButton } from "frontend"
import { FiArrowRight, FiEdit2 } from "react-icons/fi"

const row: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "12px",
    padding: "4px",
}

/** The soft pitch-tinted "Detalji →" pill - the card's inline navigation action. */
export function Default() {
    return (
        <div style={row}>
            <TintButton onClick={() => {}}>Detalji</TintButton>
        </div>
    )
}

/** With a trailing icon - the arrow renders after the label. */
export function WithIcon() {
    return (
        <div style={row}>
            <TintButton icon={<FiArrowRight size={14} />} onClick={() => {}}>
                Detalji
            </TintButton>
            <TintButton icon={<FiEdit2 size={14} />} onClick={() => {}}>
                Uredi
            </TintButton>
        </div>
    )
}

/** Several tint pills together, as they appear along a card footer. */
export function Row() {
    return (
        <div style={row}>
            <TintButton icon={<FiArrowRight size={14} />} onClick={() => {}}>
                Raspored
            </TintButton>
            <TintButton icon={<FiArrowRight size={14} />} onClick={() => {}}>
                Statistika
            </TintButton>
            <TintButton icon={<FiArrowRight size={14} />} onClick={() => {}}>
                Ždrijeb
            </TintButton>
        </div>
    )
}
