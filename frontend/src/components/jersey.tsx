import { Box } from "@chakra-ui/react"
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

/** Two-tone kit chip: a small "jersey" (top) over "shorts" (bottom). Falls back
 *  to a plain swatch when only one colour is set, and renders nothing when the
 *  team has no colour. `size` is the width; height is ~1.3× for the jersey look. */
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
    /** Border colour token/value. Defaults to `blackAlpha.400` so every
     *  existing caller renders identically; pass a theme token like
     *  `border.emphasized` when the chip must stay visible on both light and
     *  dark panels (e.g. a white kit on a light panel, black on dark). */
    borderColor?: string
    /** Corner rounding. Defaults to `2px` (unchanged for existing callers);
     *  larger header chips can pass e.g. `md` for a softer, more legible shape. */
    rounded?: string
}) {
    if (!jersey && !shorts) return null
    const h = Math.round(size * 1.3)
    const both = !!jersey && !!shorts
    const single = jersey ?? shorts ?? undefined
    return (
        <Box
            as="span"
            display="inline-flex"
            flexDirection="column"
            w={`${size}px`}
            h={`${h}px`}
            rounded={rounded}
            overflow="hidden"
            borderWidth="1px"
            borderColor={borderColor}
            flexShrink={0}
            title="Boja dresa / hlača"
            aria-hidden
        >
            {both ? (
                <>
                    <Box flex="1.15" bg={jersey!} />
                    <Box flex="0.85" bg={shorts!} />
                </>
            ) : (
                <Box flex="1" bg={single} />
            )}
        </Box>
    )
}
