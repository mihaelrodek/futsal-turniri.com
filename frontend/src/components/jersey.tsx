import { Box } from "@chakra-ui/react"
import { useQuery } from "@tanstack/react-query"

import { qk } from "../queryClient"
import { fetchTeamJerseyColors } from "../api/tournaments"

/* ──────────────────────────────────────────────────────────────────────────
   Jersey (kit) colour helpers, shared by every "tijek utakmice" surface.

   useTeamColors fetches the tournament's {teamId: "#hex"} map ONCE (cached by
   react-query, keyed on the tournament) so the stream ticker, the live match
   page, the timeline modal and the Zapisnik console all reuse the same fetch.
   JerseyDot renders a small chip next to a team name so viewers can tell the
   sides apart at a glance.
   ────────────────────────────────────────────────────────────────────────── */

/** Team jersey colours for a tournament ({@code teamId → "#hex"}). Empty until
 *  loaded / when no team has a colour. Accepts a uuid or slug. */
export function useTeamColors(uuid: string | null | undefined): Record<string, string> {
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

/** Look up a team's colour from the map (null-safe on the id). */
export function teamColor(
    colors: Record<string, string>,
    teamId: number | null | undefined,
): string | null {
    if (teamId == null) return null
    return colors[String(teamId)] ?? null
}

/** Small kit-colour chip next to a team name. Renders nothing when the team
 *  has no colour set. Bordered so white/light kits stay visible on any bg. */
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
