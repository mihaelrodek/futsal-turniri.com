import { Box, HStack, Text, chakra } from "@chakra-ui/react"
import { Link as RouterLink } from "react-router-dom"

/* ──────────────────────────────────────────────────────────────────────────
   Logo - brand lockup for the "Futsal Turniri" identity.

   The mark ("net frame" goal + futsal ball) is drawn INLINE as SVG paths in
   `currentColor`, not loaded as an <img>, so a single `color` drives the whole
   lockup - mark + wordmark + domain - exactly like the delivered single-colour
   asset. That lets the colour follow the theme without shipping two files.

   Colour scheme (SPECTO teal `pitch.500` = #17A79D, the selected-nav-pill hue):
     - mark art:  pitch.500 teal
     - mark tile: `brand.logoTile` - a light #EDF0F3 badge in BOTH themes, so
       the mark reads as a small app-icon on the white light canvas AND on the
       dark navy canvas (the pale tile is the intended dark-theme backing).
     - "Futsal":  fg.ink (near-black on light, near-white on dark)
     - "Turniri" + futsal-turniri.com: pitch.500 teal

   The `variant` prop pins the "Futsal" contrast colour to a KNOWN surface
   (footer/fullscreen), overriding the theme: "dark" → white "Futsal", "light"
   → black "Futsal". "auto" (default) follows the app theme via tokens. The tile
   is the same light badge in every variant. The lockup always links to "/".
   ────────────────────────────────────────────────────────────────────── */

const TEAL = "pitch.500" // #17A79D - mark, "Turniri", domain

/** Colours that depend on the surface the lockup sits on. */
function paletteFor(variant: "light" | "dark" | "auto"): {
    /** "Futsal" word - the one high-contrast element. */
    futsal: string
    /** Tile behind the mark. */
    tile: string
} {
    if (variant === "dark") return { futsal: "white", tile: "#EDF0F3" }
    if (variant === "light") return { futsal: "#1B2836", tile: "#EDF0F3" }
    return { futsal: "fg.ink", tile: "brand.logoTile" }
}

/** The mark on its own - the original detailed net-frame goal (with net grid)
 *  + a white futsal ball with teal panels, over an optional tile. This is the
 *  production mark shape; only the tint is theme-driven: the teal art runs in
 *  `currentColor` (pitch.500), the ball stays white so it reads on both the
 *  light tile and the dark navy canvas. Ball fill is the one non-currentColor
 *  part on purpose. */
export function LogoMark({
    size = 40,
    color = TEAL,
    tile = "brand.logoTile",
    title = "Futsal Turniri",
}: {
    size?: number
    /** Any Chakra colour token or CSS colour; sets `currentColor` for the art. */
    color?: string
    /** Fill of the rounded tile behind the art; "transparent" for none. */
    tile?: string
    title?: string
}) {
    return (
        <chakra.svg
            viewBox="0 0 112 112"
            width={`${size}px`}
            height={`${size}px`}
            color={color}
            flexShrink={0}
            role="img"
            aria-label={title}
        >
            <chakra.rect x="4" y="4" width="104" height="104" rx="26" fill={tile} />

            {/* Goal net grid - teal, dimmed so the frame + ball read on top. */}
            <g stroke="currentColor" strokeWidth="1" opacity="0.6">
                <path d="M42 38 V82 M54 38 V82 M66 38 V82 M78 38 V82" />
                <path d="M30 50 H82 M30 62 H82 M30 74 H82" />
            </g>

            {/* Goal frame. */}
            <path
                d="M30 82 V38 H82 V82"
                fill="none"
                stroke="currentColor"
                strokeWidth="3.6"
                strokeLinejoin="round"
            />

            {/* Futsal ball - white body, teal outline + panels. */}
            <svg x="39" y="60" width="34" height="34" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="46" fill="#fff" stroke="currentColor" strokeWidth="2.6" />
                <g stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" fill="none">
                    <path d="M50,33 L50,7" />
                    <path d="M50,33 L50,7" transform="rotate(72 50 50)" />
                    <path d="M50,33 L50,7" transform="rotate(144 50 50)" />
                    <path d="M50,33 L50,7" transform="rotate(216 50 50)" />
                    <path d="M50,33 L50,7" transform="rotate(288 50 50)" />
                </g>
                <g fill="currentColor">
                    <path d="M50,34 L65.22,45.06 L59.41,62.94 L40.59,62.94 L34.78,45.06 Z" />
                    <path d="M61.41,85.71 L50,94 L38.59,85.71 L42.95,72.29 L57.05,72.29 Z" />
                    <path d="M61.41,85.71 L50,94 L38.59,85.71 L42.95,72.29 L57.05,72.29 Z" transform="rotate(72 50 50)" />
                    <path d="M61.41,85.71 L50,94 L38.59,85.71 L42.95,72.29 L57.05,72.29 Z" transform="rotate(144 50 50)" />
                    <path d="M61.41,85.71 L50,94 L38.59,85.71 L42.95,72.29 L57.05,72.29 Z" transform="rotate(216 50 50)" />
                    <path d="M61.41,85.71 L50,94 L38.59,85.71 L42.95,72.29 L57.05,72.29 Z" transform="rotate(288 50 50)" />
                </g>
            </svg>
        </chakra.svg>
    )
}

export type LogoProps = {
    /** Height of the mark in px (default 40). Text scales relative to it. */
    size?: number
    /** Which surface the logo sits on. "auto" (default) follows the theme. */
    variant?: "light" | "dark" | "auto"
    /** Show the futsal-turniri.com domain line under the wordmark. */
    showDomain?: boolean
    /** Render only the mark (e.g. cramped mobile header). */
    markOnly?: boolean
    /** Where the logo links. Defaults to "/" per brand guidance. */
    to?: string
    /** Skip the link wrapper (e.g. inside an already-clickable footer cell). */
    asStatic?: boolean
}

export function Logo({
    size = 40,
    variant = "auto",
    showDomain = true,
    markOnly = false,
    to = "/",
    asStatic = false,
}: LogoProps) {
    const { futsal, tile } = paletteFor(variant)

    const inner = (
        <>
            <LogoMark size={size} color={TEAL} tile={tile} />
            {!markOnly && (
                <Box lineHeight="1">
                    <Text
                        fontFamily="heading"
                        fontWeight="800"
                        fontSize={`${size * 0.42}px`}
                        letterSpacing="-0.03em"
                        color={futsal}
                        whiteSpace="nowrap"
                    >
                        Futsal{" "}
                        <chakra.span color={TEAL}>Turniri</chakra.span>
                    </Text>
                    {showDomain && (
                        <Text
                            fontFamily="mono"
                            fontWeight="700"
                            fontSize={`${Math.max(9, size * 0.24)}px`}
                            letterSpacing="0.05em"
                            color={TEAL}
                            mt="0.5"
                        >
                            futsal-turniri.com
                        </Text>
                    )}
                </Box>
            )}
        </>
    )

    if (asStatic) {
        return (
            <HStack gap="2.5" align="center">
                {inner}
            </HStack>
        )
    }

    return (
        <HStack
            asChild
            gap="2.5"
            align="center"
            _hover={{ textDecoration: "none" }}
        >
            <RouterLink to={to} aria-label="Futsal Turniri - početna">
                {inner}
            </RouterLink>
        </HStack>
    )
}

export default Logo
