import { Box, chakra } from "@chakra-ui/react"
import { useQuery } from "@tanstack/react-query"

import { qk } from "../queryClient"
import { fetchTeamJerseyColors, type TeamKit } from "../api/tournaments"

/* ──────────────────────────────────────────────────────────────────────────
   Kit (dres + hlače) colour helpers, shared by every "tijek utakmice" surface.

   useTeamColors fetches the tournament's {teamId: {jersey, shorts}} map ONCE
   (cached by react-query, keyed on the tournament) so the stream ticker, the
   live match page, the timeline modal and the Zapisnik console all reuse the
   same fetch. KitSwatch renders a small two-tone chip (jersey over shorts) next
   to a team name so viewers can tell the sides apart at a glance.
   ────────────────────────────────────────────────────────────────────────── */

/** Team kit colours for a tournament ({@code teamId → {jersey, shorts}}). Empty
 *  until loaded / when no team has a colour. Accepts a uuid or slug. */
export function useTeamColors(uuid: string | null | undefined): Record<string, TeamKit> {
    const { data } = useQuery({
        queryKey: qk.teamColors(uuid ?? "none"),
        queryFn: () => fetchTeamJerseyColors(uuid!),
        enabled: !!uuid,
        // Colours change rarely; a long stale time avoids refetching on every
        // live poll while the timeline views mount/unmount.
        staleTime: 5 * 60_000,
    })
    return data ?? {}
}

/** A team's full kit (both colours) from the map (null-safe on the id). */
export function teamKit(
    colors: Record<string, TeamKit>,
    teamId: number | null | undefined,
): TeamKit {
    if (teamId == null) return { jersey: null, shorts: null }
    return colors[String(teamId)] ?? { jersey: null, shorts: null }
}

/** A team's jersey (dres) colour - the primary colour used by single-colour
 *  surfaces (e.g. the scorebug's accent bar). */
export function teamColor(
    colors: Record<string, TeamKit>,
    teamId: number | null | undefined,
): string | null {
    return teamKit(colors, teamId).jersey
}

/** A team's shorts (hlače) colour. */
export function teamShorts(
    colors: Record<string, TeamKit>,
    teamId: number | null | undefined,
): string | null {
    return teamKit(colors, teamId).shorts
}

/** Small single-colour dot (kept for surfaces that show one colour). Renders
 *  nothing when there's no colour. Bordered so white/light kits stay visible. */
export function JerseyDot({ color, size = 10 }: { color?: string | null; size?: number }) {
    if (!color) return null
    return (
        <Box
            as="span"
            display="inline-block"
            w={`${size}px`}
            h={`${size}px`}
            rounded="full"
            bg={color}
            borderWidth="1px"
            borderColor="blackAlpha.400"
            flexShrink={0}
            title="Boja dresa"
            aria-hidden
        />
    )
}

/** KitSwatch that looks the team's colours up from the map itself - the usual
 *  inline call next to a team name. */
export function TeamKitChip({
    colors,
    teamId,
    size,
}: {
    colors: Record<string, TeamKit>
    teamId: number | null | undefined
    size?: number
}) {
    const kit = teamKit(colors, teamId)
    return <KitSwatch jersey={kit.jersey} shorts={kit.shorts} size={size} />
}

/* Kit silhouette geometry (viewBox 0 0 20 26 → the 1 : 1.3 footprint every
   caller already sizes for). One flat shirt path (torso + stubby short sleeves
   with a soft V-neck) sits over a simple two-leg shorts path; both carry a thin
   non-scaling stroke so a white kit stays outlined on a white card. */
const KIT_SHIRT_PATH =
    "M7 3 Q10 5.2 13 3 L16.5 4.2 L18.6 8.2 L15.4 9.6 L14 8 L14 15.2 L6 15.2 L6 8 L4.6 9.6 L1.4 8.2 L3.5 4.2 Z"
const KIT_SHORTS_PATH =
    "M6.2 14.5 L13.8 14.5 L14.8 24.4 L10.9 24.4 L10 18.6 L9.1 24.4 L5.2 24.4 Z"

/** Resolve a KitSwatch border token to something usable as an SVG `stroke`.
 *  Chakra v3 doesn't resolve colour *tokens* on raw <path> elements (unlike a
 *  Box `borderColor`), so map a dotted token (`blackAlpha.400`,
 *  `border.emphasized`, `whiteAlpha.500`, …) to its generated CSS custom
 *  property and pass raw colours (hex/rgb/hsl/var/keyword) straight through. */
function kitStroke(token: string): string {
    return /^(#|rgb|hsl|var\(|transparent|currentcolor)/i.test(token)
        ? token
        : `var(--chakra-colors-${token.replace(/\./g, "-")})`
}

/** Kit silhouette: a flat "shirt over shorts" icon in the team's colours - the
 *  shirt filled with the jersey (dres) colour, the shorts with the shorts
 *  (hlače) colour. Falls back to a single colour when only one is set (the whole
 *  kit takes it) and renders nothing when the team has no colour. `size` is the
 *  width; height stays ~1.3× so the footprint matches the old two-tone chip. */
export function KitSwatch({
    jersey,
    shorts,
    size = 12,
    borderColor = "blackAlpha.400",
    rounded = "2px",
}: {
    jersey?: string | null
    shorts?: string | null
    size?: number
    /** Border/outline colour token/value. Defaults to `blackAlpha.400` so every
     *  existing caller renders identically; pass a theme token like
     *  `border.emphasized` (or a `whiteAlpha.*` on dark surfaces) when the
     *  outline must stay visible on both light and dark panels (a white kit on a
     *  light card, a black kit on a dark one). */
    borderColor?: string
    /** Corner rounding of the bounding box. Kept for API compatibility; the
     *  silhouette itself is shaped by the SVG (rounded joins), so this now only
     *  rounds the invisible box. Defaults to `2px`. */
    rounded?: string
}) {
    if (!jersey && !shorts) return null
    const h = Math.round(size * 1.3)
    // Mirror the old single-colour fallback: when only one colour is set the
    // whole kit takes that colour (shirt and shorts alike).
    const shirtColor = jersey ?? shorts ?? undefined
    const shortsColor = shorts ?? jersey ?? undefined
    const stroke = kitStroke(borderColor)
    return (
        <Box
            as="span"
            display="inline-block"
            verticalAlign="middle"
            w={`${size}px`}
            h={`${h}px`}
            borderRadius={rounded}
            flexShrink={0}
            title="Boja dresa / hlača"
            aria-hidden
        >
            <chakra.svg
                viewBox="0 0 20 26"
                width="100%"
                height="100%"
                display="block"
                overflow="visible"
            >
                {/* Shorts first so the shirt's hem overlaps the waistband cleanly. */}
                <path
                    d={KIT_SHORTS_PATH}
                    fill={shortsColor}
                    stroke={stroke}
                    strokeWidth={0.75}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                />
                <path
                    d={KIT_SHIRT_PATH}
                    fill={shirtColor}
                    stroke={stroke}
                    strokeWidth={0.75}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                />
            </chakra.svg>
        </Box>
    )
}
