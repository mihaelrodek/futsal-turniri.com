import { Panel, SectionHeader, StatTile, PrimaryButton } from "frontend"
import { FiBarChart2 } from "react-icons/fi"

const wrap: React.CSSProperties = { maxWidth: 560 }
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "12px" }

/** The standard content surface: white rounded card on the soft canvas. */
export function Default() {
    return (
        <div style={wrap}>
            <Panel padding="20px">
                <SectionHeader
                    icon={FiBarChart2}
                    title="Statistika turnira"
                    subtitle="Sortirano po datumu početka"
                />
                <div style={{ ...grid, marginTop: 16 }}>
                    <StatTile label="Ekipe" value="16" />
                    <StatTile label="Utakmice" value="31" />
                    <StatTile label="Golovi" value="87" tone="brand" />
                </div>
            </Panel>
        </div>
    )
}

/** Panel forwards BoxProps — here a tighter padding for a compact CTA block. */
export function Compact() {
    return (
        <div style={wrap}>
            <Panel padding="16px">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div>
                        <div style={{ fontWeight: 800, fontSize: 16 }}>Nagradni fond</div>
                        <div style={{ color: "#5d6671", fontSize: 14 }}>Prijavi ekipu do 20. svibnja</div>
                    </div>
                    <PrimaryButton>Prijavi ekipu</PrimaryButton>
                </div>
            </Panel>
        </div>
    )
}
