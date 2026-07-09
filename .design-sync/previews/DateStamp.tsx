import { DateStamp } from "frontend"

/* The stamp is a translucent white pill meant to sit on top of a poster, so
   render it over a green futsal-hero block where the blur/translucency reads. */
const poster: React.CSSProperties = {
    position: "relative",
    width: 300,
    height: 170,
    borderRadius: 16,
    overflow: "hidden",
    background: "linear-gradient(135deg, #3aa56b, #0b6b3a)",
    padding: 14,
}

const stampSlot: React.CSSProperties = {
    position: "absolute",
    top: 14,
    left: 14,
}

const strip: React.CSSProperties = {
    display: "flex",
    gap: "12px",
    padding: "4px",
    background: "linear-gradient(135deg, #5d6671, #2f353d)",
    borderRadius: 14,
    width: 320,
}

/** How it actually appears in the app: top-left overlay on a tournament
 *  poster, the day/date/month triplet in a frosted white pill. */
export function OnPoster() {
    return (
        <div style={poster}>
            <div style={stampSlot}>
                <DateStamp day="PET" dayNum={22} month="SVI" />
            </div>
        </div>
    )
}

/** Several match dates side by side over a hard-court grey backdrop. */
export function Dates() {
    return (
        <div style={strip}>
            <DateStamp day="PET" dayNum={22} month="SVI" />
            <DateStamp day="SUB" dayNum={23} month="SVI" />
            <DateStamp day="NED" dayNum={7} month="LIP" />
        </div>
    )
}
