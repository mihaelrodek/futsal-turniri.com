import { PillTabBar } from "frontend"

const wrap: React.CSSProperties = {
    padding: "4px",
    maxWidth: "560px",
}

/** The tournament detail tab bar - active tab fills with pitch green. */
export function Detalji() {
    return (
        <div style={wrap}>
            <PillTabBar
                tabs={["Detalji", "Ekipe", "Ždrijeb", "Raspored", "Statistika"]}
                active="Detalji"
                onChange={() => {}}
            />
        </div>
    )
}

/** A different tab selected - "Raspored" now carries the green fill. */
export function Raspored() {
    return (
        <div style={wrap}>
            <PillTabBar
                tabs={["Detalji", "Ekipe", "Ždrijeb", "Raspored", "Statistika"]}
                active="Raspored"
                onChange={() => {}}
            />
        </div>
    )
}

/** A short two-tab bar - the tabs share the width evenly. */
export function TwoTabs() {
    return (
        <div style={wrap}>
            <PillTabBar tabs={["Ekipe", "Statistika"]} active="Statistika" onChange={() => {}} />
        </div>
    )
}
