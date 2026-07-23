import { useQuery } from "@tanstack/react-query"

import { fetchSpectoPublic } from "../api/spectoStream"

/**
 * The tournament's SpectoStream id, or null when it isn't linked (or no
 * tournament is in play). Public endpoint - viewers, not just organizers,
 * need it to mount the platform player.
 *
 * Long staleTime on purpose: linking/unlinking is a once-per-tournament
 * organizer action, so this must not add polling traffic to pages that
 * already poll live data every few seconds.
 */
export function useSpectoStreamId(uuid: string | null | undefined): string | null {
    const { data } = useQuery({
        queryKey: ["spectoPublic", uuid ?? "none"],
        queryFn: () => fetchSpectoPublic(uuid!),
        enabled: !!uuid,
        staleTime: 5 * 60_000,
    })
    return data?.streamId ?? null
}
