import { AvatarPreview } from "frontend"

/* AvatarPreview wraps an avatar trigger and, on hover/tap, opens a bounded
   zoom popup in a Portal. The popup is driven by internal state (no `open`
   prop), so it cannot be forced open in a static capture — these cells show
   the trigger states the component renders at rest:
     · with a `src` it adds the zoom affordance around the child image;
     · with a falsy `src` it is a pass-through (initials-only, no zoom).
   The 48 px circle is built from plain divs since the DS ships no Avatar. */

// A tiny inline portrait so the image branch renders offline (no network).
const PHOTO =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">
           <rect width="96" height="96" fill="#0b6b3a"/>
           <circle cx="48" cy="38" r="18" fill="#f5b921"/>
           <path d="M18 92 a30 30 0 0 1 60 0 z" fill="#e9f2ec"/>
         </svg>`,
    )

const circle: React.CSSProperties = {
    width: 48,
    height: 48,
    borderRadius: "9999px",
    overflow: "hidden",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "2px solid #0b6b3a",
    fontFamily: "Inter, sans-serif",
    fontWeight: 800,
    fontSize: 16,
    color: "#fff",
    background: "#0b6b3a",
}

const row: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: 8,
    fontFamily: "Inter, sans-serif",
}

/** A user with an uploaded photo — the wrapper adds the zoom-in affordance
 *  and, on interaction, a bounded preview of the full image. */
export function SaSlikom() {
    return (
        <div style={row}>
            <AvatarPreview src={PHOTO} alt="Ivan Horvat">
                <span style={circle}>
                    <img
                        src={PHOTO}
                        alt="Ivan Horvat"
                        width={48}
                        height={48}
                        style={{ display: "block", objectFit: "cover" }}
                    />
                </span>
            </AvatarPreview>
            <span style={{ fontWeight: 600, color: "#1a2b22" }}>Ivan Horvat</span>
        </div>
    )
}

/** No photo — a falsy `src` makes AvatarPreview a pass-through, so the
 *  initials circle renders as-is with no zoom cursor it could not deliver. */
export function BezSlike() {
    return (
        <div style={row}>
            <AvatarPreview src={null} alt="NK Dinamo">
                <span style={circle}>ND</span>
            </AvatarPreview>
            <span style={{ fontWeight: 600, color: "#1a2b22" }}>NK Dinamo</span>
        </div>
    )
}
