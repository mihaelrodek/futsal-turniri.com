import { useEffect, useRef } from "react"
import { Box, type BoxProps } from "@chakra-ui/react"

import { SPECTO_BASE_URL } from "../api/spectoStream"

/* ──────────────────────────────────────────────────────────────────────────
   SpectoEmbed - mounts the SpectoStream platform's own player (video + its
   built-in scoreboard/goal/card overlay) in place of this app's player.

   The platform ships exactly this snippet:

       <div data-spectostream="{streamId}"></div>
       <script src="https://stream.safeflow.hr/player/player.js" async></script>

   Two constraints drive the implementation:

   1. `dangerouslySetInnerHTML` can NOT be used - the browser never executes
      <script> tags inserted that way, so the player would never boot.
   2. player.js exposes NO programmatic API (no window global). It scans
      `document.querySelectorAll('[data-spectostream]')` once, at execute time,
      and tags each container it has taken over with `dataset.spsInit`. In an
      SPA the container mounts long after that first scan, so the only way to
      pick it up is to APPEND THE SCRIPT AGAIN on mount: re-executing it
      re-runs the scan, and its own `spsInit` guard means already-running
      players are left alone.
   ────────────────────────────────────────────────────────────────────── */

const PLAYER_SRC = `${SPECTO_BASE_URL}/player/player.js`

export default function SpectoEmbed({
    streamId,
    ...rest
}: { streamId: string } & BoxProps) {
    const hostRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        // The container is already committed to the DOM here, so the scan the
        // script triggers on execute will find it.
        const script = document.createElement("script")
        script.src = PLAYER_SRC
        script.async = true
        document.body.appendChild(script)

        const host = hostRef.current
        return () => {
            script.remove()
            // Let a remount re-initialise cleanly: drop what the player built
            // and clear its "already taken" marker. Without this, navigating
            // away and back would leave an inert, empty container behind.
            if (host) {
                host.innerHTML = ""
                delete host.dataset.spsInit
            }
        }
    }, [streamId])

    return (
        <Box
            ref={hostRef}
            data-spectostream={streamId}
            w="full"
            rounded="xl"
            overflow="hidden"
            bg="black"
            {...rest}
        />
    )
}
