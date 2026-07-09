import { PageTitle, PrimaryButton, GhostButton } from "frontend"
import { FiPlus, FiShare2 } from "react-icons/fi"

const wrap: React.CSSProperties = { maxWidth: 560 }

/** The canonical page heading: kicker, title, subtitle and a right action. */
export function Default() {
    return (
        <div style={wrap}>
            <PageTitle
                kicker="Turniri"
                title="Kup Grada Zagreba"
                subtitle="Sortirano po datumu početka"
                action={<PrimaryButton icon={<FiPlus />}>Kreiraj turnir</PrimaryButton>}
            />
        </div>
    )
}

/** `status` + `statusLabel` render a StatusChip stacked above the actions. */
export function WithStatus() {
    return (
        <div style={wrap}>
            <PageTitle
                kicker="Detalji turnira"
                title="Zimska Liga Splita"
                status="live"
                statusLabel="UŽIVO"
                action={<GhostButton icon={<FiShare2 />}>Podijeli</GhostButton>}
            />
        </div>
    )
}

/** A long title auto-shrinks its font so the action stays pinned top-right. */
export function LongTitle() {
    return (
        <div style={wrap}>
            <PageTitle
                kicker="Detalji turnira"
                title="Međunarodni Zimski Turnir Malog Nogometa Dalmacija 2026"
                status="active"
                statusLabel="U tijeku"
                action={<GhostButton icon={<FiShare2 />}>Podijeli</GhostButton>}
            />
        </div>
    )
}
