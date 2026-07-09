import { TournamentPoster } from "frontend"

/* A tiny inline poster so the image branch renders offline. The placeholder
   branch (no bannerUrl) is the one users see most — it draws the futsal-court
   backdrop, the ball mark and the tournament name. */
const POSTER =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="560">
           <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
             <stop offset="0" stop-color="#0b6b3a"/><stop offset="1" stop-color="#084a28"/>
           </linearGradient></defs>
           <rect width="400" height="560" fill="url(#g)"/>
           <text x="200" y="250" fill="#f5b921" font-family="sans-serif" font-size="34"
                 font-weight="800" text-anchor="middle">KUP GRADA</text>
           <text x="200" y="300" fill="#ffffff" font-family="sans-serif" font-size="26"
                 font-weight="700" text-anchor="middle">ZAGREBA 2026</text>
           <text x="200" y="360" fill="rgba(255,255,255,0.7)" font-family="monospace"
                 font-size="15" letter-spacing="3" text-anchor="middle">22. SVIBNJA</text>
         </svg>`,
    )

const card: React.CSSProperties = {
    width: 320,
    border: "1px solid #dde5d8",
    borderRadius: 16,
    overflow: "hidden",
    background: "#fff",
}

/** The placeholder every tournament gets until an organiser uploads a poster:
 *  concrete-grey hard-court gradient, futsal markings, ball, and the name. */
export function Placeholder() {
    return (
        <div style={card}>
            <TournamentPoster name="Kup Grada Zagreba" />
        </div>
    )
}

/** `big` scales the ball and name for the tournament detail hero. */
export function BigPlaceholder() {
    return (
        <div style={{ ...card, width: 380 }}>
            <TournamentPoster name="Zimska Liga Splita" height={300} big />
        </div>
    )
}

/** A long name clamps to two lines instead of growing the card. */
export function LongName() {
    return (
        <div style={{ ...card, width: 240 }}>
            <TournamentPoster
                name="Međunarodni Zimski Turnir Malog Nogometa Dalmacija"
                height={180}
            />
        </div>
    )
}

/** With an uploaded poster the component renders the real image instead.
 *  `downloadable` adds the round download affordance over the top-right. */
export function WithPoster() {
    return (
        <div style={card}>
            <TournamentPoster name="Kup Grada Zagreba" bannerUrl={POSTER} height={260} downloadable />
        </div>
    )
}
