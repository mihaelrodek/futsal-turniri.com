import { FormSectionCard } from "frontend"
import { FiInfo, FiSliders } from "react-icons/fi"

const wrap: React.CSSProperties = { maxWidth: 560 }
const field: React.CSSProperties = {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    padding: "10px 12px",
    border: "1px solid #dbe0d8",
    borderRadius: 10,
    fontSize: 14,
    color: "#2a2f2b",
    background: "#fff",
}
const label: React.CSSProperties = { display: "block", fontSize: 13, fontWeight: 600, marginBottom: 6, color: "#3a413a" }

/** The create/edit form section: blue inline icon node, title, description. */
export function BasicInfo() {
    return (
        <div style={wrap}>
            <FormSectionCard
                icon={<FiInfo />}
                title="Osnovne informacije"
                description="Naziv i lokacija prikazuju se na kartici turnira."
            >
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    <div>
                        <span style={label}>Naziv turnira</span>
                        <input style={field} value="Kup Grada Zagreba" readOnly />
                    </div>
                    <div>
                        <span style={label}>Lokacija</span>
                        <input style={field} value="Sportska dvorana Trešnjevka" readOnly />
                    </div>
                </div>
            </FormSectionCard>
        </div>
    )
}

/** Another section on the same form — different icon and denser controls. */
export function Format() {
    return (
        <div style={wrap}>
            <FormSectionCard
                icon={<FiSliders />}
                title="Format natjecanja"
                description="Odaberite broj ekipa i sustav natjecanja."
            >
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                    <div>
                        <span style={label}>Broj ekipa</span>
                        <input style={field} value="16" readOnly />
                    </div>
                    <div>
                        <span style={label}>Sustav</span>
                        <input style={field} value="Skupine + eliminacije" readOnly />
                    </div>
                </div>
            </FormSectionCard>
        </div>
    )
}
