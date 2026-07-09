import { IconChip } from "frontend"
import { FiCalendar, FiMapPin, FiTrash2, FiUsers } from "react-icons/fi"

const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: "12px", padding: "4px" }

/** The default brand-tinted chip: `pitch.subtle` fill, `pitch.fg` glyph. */
export function Default() {
    return (
        <div style={row}>
            <IconChip icon={FiCalendar} />
            <IconChip icon={FiUsers} />
            <IconChip icon={FiMapPin} />
        </div>
    )
}

/** `tone` selects any colorPalette; each resolves its own subtle/fg pair. */
export function Tones() {
    return (
        <div style={row}>
            <IconChip icon={FiCalendar} tone="brand" />
            <IconChip icon={FiTrash2} tone="red" />
            <IconChip icon={FiUsers} tone="gray" />
        </div>
    )
}

/** `size` and `iconSize` are Chakra scale tokens, not pixels. */
export function Sizes() {
    return (
        <div style={row}>
            <IconChip icon={FiUsers} size="8" iconSize="4" />
            <IconChip icon={FiUsers} size="10" iconSize="5" />
            <IconChip icon={FiUsers} size="14" iconSize="7" />
        </div>
    )
}
