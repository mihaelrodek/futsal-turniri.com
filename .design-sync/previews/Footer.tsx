import { Footer } from "frontend"

/** The slim sticky brand bar — dark pitch-green ground, dark-variant logo, Privatnost link and © line.
 *  Note: the footer is web-only (`display:none` below the `md` breakpoint), so it needs a wide card. */
export function Default() {
    return (
        <div style={{ width: "100%", minWidth: 820 }}>
            <Footer />
        </div>
    )
}
