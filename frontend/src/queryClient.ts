import { QueryClient } from "@tanstack/react-query"

/**
 * Shared react-query client for the whole app.
 *
 * Tuning notes:
 *  - `staleTime: 30s` - navigating back to a page you saw in the last 30 s
 *    shows the cached data INSTANTLY with no network call. After 30 s the
 *    cache still renders immediately, then revalidates in the background
 *    (stale-while-revalidate). This is what kills the "every navigation
 *    reloads long and re-fires requests" problem.
 *  - `gcTime: 1h` - unused cache entries linger for an hour after the last
 *    component using them unmounts. Kept >= the persist `maxAge` (main.tsx) so
 *    a query isn't garbage-collected out of the cache before it can be written
 *    to localStorage for the next cold load.
 *  - `refetchOnWindowFocus: false` - live data already stays fresh through
 *    the websocket (`useLiveSocket`) + polling; refetching every tab focus
 *    would just be noise and extra load.
 *  - `retry: 1` - one silent retry smooths over a transient blip without
 *    hammering the backend; the axios interceptor still surfaces real errors.
 *
 * Individual queries override these where they need to (e.g. a live match
 * view can pass a shorter staleTime or a refetchInterval).
 */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            gcTime: 60 * 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
        },
    },
})

/**
 * Cache version for the localStorage persister (main.tsx). Bump this whenever a
 * cached payload's SHAPE changes in a breaking way (backend DTO change, key
 * restructure) so old persisted snapshots are discarded instead of rendered.
 */
export const CACHE_BUSTER = "v1"

/** localStorage key the persister writes to (main.tsx). Cleared on logout. */
export const PERSIST_KEY = "futsal-rq-cache"

/** Centralised query keys so cache reads/writes/prefetch stay consistent. */
export const qk = {
    tournamentsUpcoming: ["tournaments", "upcoming"] as const,
    tournamentsFinishedFirst: ["tournaments", "finishedFirst"] as const,
    tournamentsFinishedCount: ["tournaments", "finishedCount"] as const,
    tournamentDetails: (uuid: string) => ["tournamentDetails", uuid] as const,
    groups: (uuid: string) => ["groups", uuid] as const,
    // Shared by GroupsTab, ScheduleTab AND BracketTab (all read the schedule for
    // the clock config / fixtures) - one cache entry dedupes across all three.
    schedule: (uuid: string) => ["schedule", uuid] as const,
    bracket: (uuid: string) => ["bracket", uuid] as const,
    scorers: (uuid: string) => ["scorers", uuid] as const,
    teamColors: (uuid: string) => ["teamColors", uuid] as const,
    liveMatches: ["liveMatches"] as const,
}
