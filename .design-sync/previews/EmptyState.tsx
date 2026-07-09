import { EmptyState, PrimaryButton } from "frontend"
import { FiAward, FiTarget, FiPlus } from "react-icons/fi"

const wrap: React.CSSProperties = { maxWidth: 560, border: "1px solid #dde5d8", borderRadius: 16, background: "#fff" }

/** The app's real empty state for the finished-tournaments listing. */
export function Finished() {
    return (
        <div style={wrap}>
            <EmptyState
                icon={FiAward}
                title="Još nema završenih turnira"
                description="Čim turnir završi, pojavit će se ovdje s konačnim poretkom."
            />
        </div>
    )
}

/** With an `action` — the stat page before the first goal is scored. */
export function WithAction() {
    return (
        <div style={wrap}>
            <EmptyState
                icon={FiTarget}
                title="Nema statistike strijelaca"
                description="Statistika strijelaca prikazat će se čim padne prvi gol na turniru."
                action={<PrimaryButton icon={<FiPlus />}>Kreiraj turnir</PrimaryButton>}
            />
        </div>
    )
}
