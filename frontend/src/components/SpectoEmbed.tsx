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

/* What player.js builds inside our container:
 *
 *   .sps-wrap  { position:relative; width:100%; aspect-ratio:16/9;
 *                background:#000; overflow:hidden; border-radius:8px }
 *   .sps-video { width:100%; height:100%; object-fit:contain; background:#000 }
 *
 * Three consequences we have to correct from the outside, since the script
 * exposes no options:
 *
 *  • Corners. Its own 8px radius becomes the visible edge the moment the
 *    player mounts, so a container styled `rounded="2xl"` (16px) suddenly
 *    looks almost square once the stream starts. The radius also has to go
 *    on the <video> itself: it's a replaced element, and browsers routinely
 *    fail to clip one to an ancestor's border-radius (its own black
 *    background then paints square corners straight over the rounded box).
 *  • Height. The wrap derives its height from its WIDTH (16:9) and ignores
 *    ours. In the home hero the container has a fixed height (ROW_H), so a
 *    16:9 wrap comes out taller and our overflow:hidden chops off its bottom
 *    strip - which is exactly where specto puts the mute button and the
 *    viewers chip.
 *  • Letterboxing. Once the wrap fills a slot that is wider than 16:9,
 *    `object-fit:contain` pillarboxes the picture - black bars down the left
 *    and right edges. `cover` fills the slot instead, trimming a sliver of
 *    the frame rather than framing it in black.
 *
 * Fullscreen is deliberately excluded: there the player sets inset:0 /
 * border-radius:0 / aspect-ratio:auto itself and must keep them, and
 * `contain` is right when the viewport is the frame. */
const NOT_FS = ":not(.sps-fs):not(.sps-fake-fs)"

const WRAP_RADIUS_FIX = {
    [`& .sps-wrap${NOT_FS}`]: {
        borderRadius: "inherit",
    },
    [`& .sps-wrap${NOT_FS} .sps-video`]: {
        borderRadius: "inherit",
    },
} as const

/* `inset:0` rather than `height:100%`: the slot only has a fixed height from
 * `lg` up (StreamHero sets `h={{ lg: ROW_H }}`), and below that its height
 * comes from an aspect-ratio, which is a USED height - a percentage height
 * on the child still resolves against the parent's COMPUTED `auto` and
 * collapses. The wrap then overflowed the container, the video with it, and
 * the rounded corners were left outside the visible area (a `<video>` that
 * overflows is also exactly the case where browsers stop clipping it to an
 * ancestor's radius). Absolute inset resolves against the padding box in
 * both cases, so the wrap lands on the container exactly. */
const WRAP_FILL_FIX = {
    [`& .sps-wrap${NOT_FS}`]: {
        borderRadius: "inherit",
        position: "absolute",
        inset: 0,
        width: "auto",
        height: "auto",
        aspectRatio: "auto",
    },
    [`& .sps-wrap${NOT_FS} .sps-video`]: {
        borderRadius: "inherit",
        objectFit: "cover",
    },
} as const

export default function SpectoEmbed({
    streamId,
    fill = false,
    css,
    ...rest
}: {
    streamId: string
    /**
     * The container's own height is authoritative - make the injected player
     * fill it instead of computing 16:9 from its width. Pass this wherever
     * the container is height-constrained (the home hero row); leave it off
     * when the container has no height of its own (the admin preview), where
     * the player's 16:9 is what gives it any height at all.
     */
    fill?: boolean
} & BoxProps) {
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
            // Positioning context for the injected wrap in `fill` mode.
            position="relative"
            rounded="xl"
            overflow="hidden"
            bg="black"
            css={{
                ...(fill ? WRAP_FILL_FIX : WRAP_RADIUS_FIX),
                ...(css as object | undefined),
            }}
            {...rest}
        />
    )
}
