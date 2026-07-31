import { chakra } from "@chakra-ui/react"

/**
 * Generic football-player silhouette - avatar placeholder for the player
 * spotlight card when no profile photo is set. Monochrome, `currentColor`
 * fill (same convention as Logo.tsx's mark), so it inherits whatever color
 * is set on it and needs no separate light/dark variant.
 */
export default function PlayerSilhouette({
    size = 96,
    color = "fg.subtle",
}: {
    size?: number | string
    color?: string
}) {
    const dim = typeof size === "number" ? `${size}px` : size
    return (
        <chakra.svg viewBox="0 0 100 130" width={dim} height={dim} color={color} aria-hidden="true">
            <chakra.circle cx="50" cy="17" r="13" fill="currentColor" />
            <chakra.rect x="33" y="32" width="34" height="46" rx="15" fill="currentColor" />
            <chakra.rect x="17" y="36" width="13" height="34" rx="6.5" fill="currentColor" transform="rotate(-18 23.5 36)" />
            <chakra.rect x="70" y="36" width="13" height="34" rx="6.5" fill="currentColor" transform="rotate(18 76.5 36)" />
            <chakra.rect x="33" y="74" width="15" height="44" rx="7.5" fill="currentColor" transform="rotate(-6 40.5 74)" />
            <chakra.rect x="52" y="74" width="15" height="44" rx="7.5" fill="currentColor" transform="rotate(10 59.5 74)" />
            <chakra.circle cx="78" cy="122" r="9" fill="currentColor" />
        </chakra.svg>
    )
}
