import { Box, chakra } from "@chakra-ui/react"
import { useQuery } from "@tanstack/react-query"

import { qk } from "../queryClient"
import { fetchTeamJerseyColors, type TeamKit } from "../api/tournaments"
import { useTranslation } from "../i18n"

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
    const t = useTranslation()
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
            borderColor="blackAlpha.800"
            // Same double outline as KitSwatch, done with a ring shadow rather
            // than a second stroke: dark border for light dots, light ring
            // outside it for dark ones.
            boxShadow="0 0 0 1px rgba(255,255,255,0.8)"
            flexShrink={0}
            title={t.components.jersey.jerseyColorTitle}
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

function kitStroke(token: string): string {
    return /^(#|rgb|hsl|var\(|transparent|currentcolor)/i.test(token)
        ? token
        : `var(--chakra-colors-${token.replace(/\./g, "-")})`
}

/* DOUBLE OUTLINE. A single dark outline solves the white kit on a white card
   and does nothing for the opposite case - a black or navy kit on the dark
   canvas (#0B1522) - which is just as common. So each path is stroked twice:

     halo   light, 3px, drawn UNDER everything
     border dark,  1px, drawn with the fill

   Whichever background the chip lands on, one of the two reads. The halo is
   only ever visible as the outer ~1px ring: its inner half is painted over by
   the fills, which are drawn afterwards in the same order.

   Both widths are `vectorEffect="non-scaling-stroke"`, so they are exact CSS
   pixels at every `size` these chips render at - 9px in the stream fixture
   list up to 15px in the live panel - instead of scaling into a blob on the
   small ones. */
const KIT_STROKE_WIDTH = 1
const KIT_HALO_WIDTH = 3

/* Neutral kit for a team that has no colours saved. Semantic tokens, not the
   light greys the bracket used to hardcode: a light-grey silhouette on a dark
   canvas is indistinguishable from a real WHITE kit, which is a lie about the
   team rather than a missing value. Rendered at reduced opacity so "unknown"
   never reads as "this team plays in grey".

   This is why KitSwatch no longer returns null: an empty slot next to one team
   name and a kit next to the other made the two rows sit differently, and the
   caller could not tell "no colours" from "component decided not to render". */
const KIT_NEUTRAL_FILL = "var(--chakra-colors-bg-muted)"
const KIT_NEUTRAL_OPACITY = 0.5

export function KitSwatch({
    jersey,
    shorts,
    size = 12,
    borderColor = "blackAlpha.800",
    haloColor = "whiteAlpha.800",
    rounded = "2px",
}: {
    jersey?: string | null
    shorts?: string | null
    size?: number
    borderColor?: string
    /** Outer ring, meant to CONTRAST with `borderColor`. A caller that flips
     *  the border to a light colour for a dark surface must flip this too,
     *  or the kit gets two light outlines and no contrast (see LiveScoreBug). */
    haloColor?: string
    rounded?: string
}) {
    const t = useTranslation()
    const h = Math.round(size * 1.3)
    const known = !!jersey || !!shorts
    // Mirror the old single-colour fallback: when only one colour is set the
    // whole kit takes that colour (shirt and shorts alike).
    const shirtColor = jersey ?? shorts ?? KIT_NEUTRAL_FILL
    const shortsColor = shorts ?? jersey ?? KIT_NEUTRAL_FILL
    const stroke = kitStroke(borderColor)
    const halo = kitStroke(haloColor)
    return (
        <Box
            as="span"
            display="inline-block"
            verticalAlign="middle"
            w={`${size}px`}
            h={`${h}px`}
            borderRadius={rounded}
            flexShrink={0}
            opacity={known ? 1 : KIT_NEUTRAL_OPACITY}
            title={known
                ? t.components.jersey.kitColorTitle
                : t.components.jersey.kitUnknownTitle}
            aria-hidden
        >
            <chakra.svg
                viewBox="0 0 20 26"
                width="100%"
                height="100%"
                display="block"
                overflow="visible"
            >
                {/* Halos first, unfilled: everything below paints over their
                    inner half, leaving the outer ring. */}
                <path
                    d={KIT_SHORTS_PATH}
                    fill="none"
                    stroke={halo}
                    strokeWidth={KIT_HALO_WIDTH}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                />
                <path
                    d={KIT_SHIRT_PATH}
                    fill="none"
                    stroke={halo}
                    strokeWidth={KIT_HALO_WIDTH}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                />
                {/* Shorts before the shirt so the shirt's hem overlaps the
                    waistband cleanly. */}
                <path
                    d={KIT_SHORTS_PATH}
                    fill={shortsColor}
                    stroke={stroke}
                    strokeWidth={KIT_STROKE_WIDTH}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                />
                <path
                    d={KIT_SHIRT_PATH}
                    fill={shirtColor}
                    stroke={stroke}
                    strokeWidth={KIT_STROKE_WIDTH}
                    strokeLinejoin="round"
                    vectorEffect="non-scaling-stroke"
                />
            </chakra.svg>
        </Box>
    )
}
