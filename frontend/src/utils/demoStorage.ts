/* Persistence for the organizer-only tournament "Demo" tab (DemoSection.tsx).
   Split out of that file because it mixes a default component export with
   named helper exports, which breaks Vite's fast-refresh boundary.

   Only ONE fact is durable: whether this organizer has already finished the
   demo for this tournament. The run itself (which step, typed names, the
   manual pairing) lives purely in React state - the Demo tab unmounts when
   the organizer switches to another section, and leaving the demo is
   explicitly meant to start it over next time. Navigating between the
   demo's own steps never unmounts anything, so that state survives on its
   own. */

const COMPLETED_KEY = (tournamentId: string) => `demo:completed:v1:${tournamentId}`

/** Sticky across replays: "this organizer finished the demo for this
 *  tournament before" - survives reloads, hence localStorage. */
export function readDemoCompleted(tournamentId: string): boolean {
    try {
        return window.localStorage.getItem(COMPLETED_KEY(tournamentId)) === "1"
    } catch {
        // private mode / storage disabled - just treat it as never completed
        return false
    }
}

export function writeDemoCompleted(tournamentId: string) {
    try {
        window.localStorage.setItem(COMPLETED_KEY(tournamentId), "1")
    } catch {
        /* private mode / quota - the demo still works, it just won't remember */
    }
}

const OFFERED_KEY = (tournamentId: string) => `demo:offered:v1:${tournamentId}`

/** The one-shot "want to see how this works first?" prompt an organizer gets
 *  when adding the very first team. Offered once per tournament, and never
 *  to someone who already went through the demo. */
export function shouldOfferDemo(tournamentId: string): boolean {
    if (readDemoCompleted(tournamentId)) return false
    try {
        return window.localStorage.getItem(OFFERED_KEY(tournamentId)) !== "1"
    } catch {
        // Storage unavailable - better to stay out of the way than to prompt
        // on every single click.
        return false
    }
}

export function markDemoOffered(tournamentId: string) {
    try {
        window.localStorage.setItem(OFFERED_KEY(tournamentId), "1")
    } catch {
        /* private mode / quota - the prompt just won't be remembered */
    }
}
