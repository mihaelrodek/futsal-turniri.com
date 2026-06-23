import { Box, HStack, Text, chakra } from "@chakra-ui/react"
import { Link as RouterLink } from "react-router-dom"

/* ──────────────────────────────────────────────────────────────────────────
   Logo — brand lockup for the "Futsal Turniri" identity.

   Composes the SVG mark (net-frame + green futsal ball) with live web-font
   text rather than baking the wordmark into the SVG, so the type uses the
   real Bricolage Grotesque / JetBrains Mono fonts already loaded by the
   theme (sharper, responsive, accessible).

   Variants:
     - light (default): mark on a pale tile, dark "Futsal" + green "Turniri"
     - dark:            green-tiled mark, white "Futsal" + light-green "Turniri"

   Per the brand guide the whole lockup always links to "/" (home). Marks
   live in /public/logo and are referenced by absolute URL.
   ────────────────────────────────────────────────────────────────────── */

const MARK_LIGHT = "/logo/mark-light.svg"
const MARK_GREEN = "/logo/mark-green.svg"

export type LogoProps = {
    /** Height of the mark in px (default 40). Text scales relative to it. */
    size?: number
    variant?: "light" | "dark"
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
    variant = "light",
    showDomain = true,
    markOnly = false,
    to = "/",
    asStatic = false,
}: LogoProps) {
    const onDark = variant === "dark"

    const inner = (
        <>
            <chakra.img
                src={onDark ? MARK_GREEN : MARK_LIGHT}
                alt=""
                w={`${size}px`}
                h={`${size}px`}
                draggable={false}
                flexShrink={0}
            />
            {!markOnly && (
                <Box lineHeight="1">
                    <Text
                        fontFamily="heading"
                        fontWeight="800"
                        fontSize={`${size * 0.42}px`}
                        letterSpacing="-0.03em"
                        color={onDark ? "white" : "fg.ink"}
                        whiteSpace="nowrap"
                    >
                        Futsal{" "}
                        <chakra.span color={onDark ? "pitch.400" : "pitch.500"}>
                            Turniri
                        </chakra.span>
                    </Text>
                    {showDomain && (
                        <Text
                            fontFamily="mono"
                            fontWeight="700"
                            fontSize={`${Math.max(9, size * 0.24)}px`}
                            letterSpacing="0.05em"
                            color={onDark ? "pitch.400" : "pitch.500"}
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
            <RouterLink to={to} aria-label="Futsal Turniri — početna">
                {inner}
            </RouterLink>
        </HStack>
    )
}

export default Logo
