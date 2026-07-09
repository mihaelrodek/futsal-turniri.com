import { Meta } from "frontend"
import { FiCalendar, FiMapPin, FiUsers, FiClock } from "react-icons/fi"

const card: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    padding: "18px",
    width: 260,
    background: "#fff",
    border: "1px solid #dde5d8",
    borderRadius: 14,
}

/** The metadata rows as they stack under a tournament card title: date,
 *  location and team count, each with its Feather icon. */
export function TournamentRows() {
    return (
        <div style={card}>
            <Meta icon={FiCalendar}>22. svibnja 2026.</Meta>
            <Meta icon={FiMapPin}>Zagreb, Trešnjevka</Meta>
            <Meta icon={FiUsers}>12 ekipa</Meta>
        </div>
    )
}

/** Inline on one row — how the listing card packs date + time together. */
export function Inline() {
    return (
        <div style={{ ...card, flexDirection: "row", gap: "16px", width: "auto" }}>
            <Meta icon={FiCalendar}>22. svibnja</Meta>
            <Meta icon={FiClock}>19:15</Meta>
            <Meta icon={FiMapPin}>Split</Meta>
        </div>
    )
}

/** Without an icon — just the muted metadata text. */
export function TextOnly() {
    return (
        <div style={card}>
            <Meta>Organizator: NK Trešnjevka</Meta>
            <Meta>Format: mali nogomet 5+1</Meta>
        </div>
    )
}
