import { SectionHeader, GhostButton, PrimaryButton, TintButton } from "frontend"
import { FiUsers, FiCalendar, FiPlus, FiDownload } from "react-icons/fi"

const wrap: React.CSSProperties = { maxWidth: 560 }

/** Icon (an ElementType) + title + subtitle. The icon renders as an IconChip. */
export function Default() {
    return (
        <div style={wrap}>
            <SectionHeader
                icon={FiUsers}
                title="Ekipe"
                subtitle="Sortirano po datumu prijave"
            />
        </div>
    )
}

/** The `actions` slot pins buttons to the right of the header row. */
export function WithActions() {
    return (
        <div style={wrap}>
            <SectionHeader
                icon={FiCalendar}
                title="Raspored utakmica"
                subtitle="Prva utakmica u 09:00"
                actions={
                    <>
                        <TintButton icon={<FiDownload />}>Preuzmi</TintButton>
                        <PrimaryButton icon={<FiPlus />}>Dodaj termin</PrimaryButton>
                    </>
                }
            />
        </div>
    )
}

/** No icon — a lean title-only header for nested sub-sections. */
export function TitleOnly() {
    return (
        <div style={wrap}>
            <SectionHeader
                title="Statistika strijelaca"
                actions={<GhostButton>Vidi sve</GhostButton>}
            />
        </div>
    )
}
