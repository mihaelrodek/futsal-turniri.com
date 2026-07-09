import { SectionCard, GhostButton, TintButton, StatTile, Meta } from "frontend"
import { FiCalendar, FiUsers, FiMapPin, FiEdit2, FiClock } from "react-icons/fi"

const wrap: React.CSSProperties = { maxWidth: 560 }
const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }

/** The canonical card: tinted icon tile, title + subtitle header, bodied. */
export function Canonical() {
    return (
        <div style={wrap}>
            <SectionCard
                icon={FiCalendar}
                title="Detalji turnira"
                subtitle="Osnovne informacije"
            >
                <div style={grid}>
                    <StatTile label="Datum" value="22. svibnja" hint="subota" />
                    <StatTile label="Ekipe" value="16" hint="Mjesta puna" />
                </div>
            </SectionCard>
        </div>
    )
}

/** The `action` slot holds a right-aligned button next to the header. */
export function WithAction() {
    return (
        <div style={wrap}>
            <SectionCard
                icon={FiUsers}
                title="Ekipe"
                subtitle="Sortirano po datumu prijave"
                action={<GhostButton icon={<FiEdit2 />}>Uredi</GhostButton>}
            >
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <Meta icon={FiUsers}>NK Dinamo — prijavljeno</Meta>
                    <Meta icon={FiUsers}>NK Hajduk — prijavljeno</Meta>
                    <Meta icon={FiMapPin}>Sportska dvorana, Zagreb</Meta>
                </div>
            </SectionCard>
        </div>
    )
}

/** Body-only: no title or icon, the header row collapses entirely. */
export function BodyOnly() {
    return (
        <div style={wrap}>
            <SectionCard>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                    <TintButton icon={<FiClock />}>Raspored utakmica</TintButton>
                    <Meta icon={FiClock}>Prva utakmica u 09:00</Meta>
                </div>
            </SectionCard>
        </div>
    )
}

/** `padding="0"` paints the body edge-to-edge (embedded maps, images). */
export function EdgeToEdge() {
    return (
        <div style={wrap}>
            <SectionCard icon={FiMapPin} title="Lokacija" subtitle="Sportska dvorana Trešnjevka" padding="0">
                <div style={{ height: 120, background: "linear-gradient(135deg,#9aa3ad,#5d6671)", display: "grid", placeItems: "center", color: "#fff", fontWeight: 700 }}>
                    Karta lokacije
                </div>
            </SectionCard>
        </div>
    )
}
