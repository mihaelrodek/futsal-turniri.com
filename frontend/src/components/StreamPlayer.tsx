import { useEffect, useMemo, useRef, useState } from "react"
import { Box, Flex, HStack, Text, VStack, chakra } from "@chakra-ui/react"
import { FiMaximize, FiMinimize, FiEye, FiRefreshCw } from "react-icons/fi"

import { PulseDot } from "../ui/pitch"

/* ──────────────────────────────────────────────────────────────────────────
   StreamPlayer - the site-wide live-camera player (Veo & co.) shown in the
   HOME hero slot while the admin's "camera on" switch is set.

   The admin pastes ONE url; we work out how to play it:
     • YouTube link (watch / live / youtu.be / shorts) → privacy iframe embed
     • HLS playlist (.m3u8)  → <video> via hls.js (native on iOS/Safari)
     • direct media file (.mp4/.webm/…) → plain <video>
     • anything else → embedded iframe (Veo share/embed pages, etc.)

   Built to run unattended for hours ("stalno mora biti live"):
     • hls.js fatal errors first go through the documented in-place
       recoveries; if the pipeline still dies, the whole player re-creates
       itself automatically every few seconds ("Ponovno spajanje…") until
       the stream is back - no dead banner, no manual reload.
     • a WATCHDOG catches the freezes that never raise a fatal error
       (stalled buffer, suspended background tab, drifting off the live
       window): no playback progress for STALL_LIMIT_MS → first jump back
       to the live edge, still frozen → rebuild the whole pipeline.
     • buffers are hard-capped (backBufferLength) so an hours-long live
       stream can't slowly eat the tab's memory and wedge the page.
     • returning to a suspended tab re-syncs to the live edge instead of
       resuming minutes behind (iOS/Safari suspend background tabs).
     • a manual "Osvježi prijenos" button rebuilds the player in place -
       the escape hatch that makes reloading the page unnecessary.
     • direct-file errors re-create the same way.
     • nothing about the stream url is ever cached here - the media element
       / hls.js always fetch live.

   Fullscreen: one overlay button that fullscreens the whole player box
   (falls back to the iOS video-only fullscreen where element fullscreen
   isn't available; embedded players also keep their own button).
   ────────────────────────────────────────────────────────────────────────── */

type StreamKind = "youtube" | "hls" | "file" | "iframe"

/** How long to wait before automatically re-creating a dead pipeline. */
const RECONNECT_MS = 8000

/** Watchdog tick - how often playback progress is checked. */
const WATCHDOG_MS = 3000

/** No forward progress for this long while "playing" → the pipeline is
 *  wedged (frozen picture, no error event) and gets healed. */
const STALL_LIMIT_MS = 12000

/** A re-stall within this window after a soft heal means the pipeline (not
 *  the network) is wedged → go straight to the hard rebuild. */
const SOFT_HEAL_GRACE_MS = 45000

/** Work out how to play the pasted url. Exported for reuse/tests. */
export function classifyStreamUrl(url: string): { kind: StreamKind; src: string } {
    const yt = url.match(
        /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|live\/|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/i,
    )
    if (yt) {
        return {
            kind: "youtube",
            // nocookie host - no tracking cookies before the user hits play.
            src: `https://www.youtube-nocookie.com/embed/${yt[1]}?autoplay=1&mute=1&playsinline=1&rel=0`,
        }
    }
    const path = url.split(/[?#]/)[0].toLowerCase()
    if (path.endsWith(".m3u8")) return { kind: "hls", src: url }
    if (/\.(mp4|webm|ogg|ogv|mov|m4v)$/.test(path)) return { kind: "file", src: url }
    return { kind: "iframe", src: url }
}

export default function StreamPlayer({
    url,
    overlay,
    viewers,
}: {
    url: string
    /** Optional display-only overlay (e.g. a live scorebug) pinned to the top
     *  of the player. Rendered INSIDE the fullscreen element so it stays
     *  visible when the video goes fullscreen. */
    overlay?: React.ReactNode
    /** Live-viewer count for the "👁 N" badge; null/0 hides it. */
    viewers?: number | null
}) {
    const { kind, src } = useMemo(() => classifyStreamUrl(url), [url])

    const wrapRef = useRef<HTMLDivElement>(null)
    const videoRef = useRef<HTMLVideoElement>(null)
    // Live hls.js instance - the watchdog reads liveSyncPosition off it.
    const hlsRef = useRef<import("hls.js").default | null>(null)
    const [isFs, setIsFs] = useState(false)
    // "Reconnecting" overlay while a dead pipeline waits for its re-create.
    const [reconnecting, setReconnecting] = useState(false)
    // Bumping re-creates the media pipeline (the HLS effect depends on it).
    const [retryNonce, setRetryNonce] = useState(0)
    const reconnectTimer = useRef<number | null>(null)

    // One shared "pipeline died → auto re-create soon" path.
    function scheduleReconnect() {
        setReconnecting(true)
        if (reconnectTimer.current != null) return
        reconnectTimer.current = window.setTimeout(() => {
            reconnectTimer.current = null
            setReconnecting(false)
            setRetryNonce((n) => n + 1)
        }, RECONNECT_MS)
    }
    // Clear any pending timer on unmount / url change.
    useEffect(() => {
        return () => {
            if (reconnectTimer.current != null) {
                clearTimeout(reconnectTimer.current)
                reconnectTimer.current = null
            }
        }
    }, [src])

    /** Rebuild the player in place, right now - the manual escape hatch (and
     *  the watchdog's last resort). Never requires a page reload. */
    function forceReload() {
        if (reconnectTimer.current != null) {
            clearTimeout(reconnectTimer.current)
            reconnectTimer.current = null
        }
        setReconnecting(false)
        setRetryNonce((n) => n + 1)
    }

    // Watchdog (LIVE HLS only): the pipeline can freeze WITHOUT ever raising
    // a fatal error (stalled buffer, tab suspended by the OS, playhead
    // drifted out of the live window). Track playback progress; on a stall
    // first jump back to the live edge, and if it re-stalls soon after,
    // rebuild the whole pipeline. Direct files are deliberately excluded -
    // a slow download is legitimate buffering there, and a rebuild would
    // throw away the viewer's position in the clip.
    useEffect(() => {
        if (kind !== "hls") return
        let lastTime = -1
        let lastProgressAt = Date.now()
        // The soft heal's own seek changes currentTime, so a plain "made
        // progress" check would reset the escalation and loop soft heals
        // forever on a wedged-but-advancing stream. Escalate on TIME instead:
        // a re-stall within SOFT_HEAL_GRACE_MS of the last soft heal goes
        // straight to the hard rebuild.
        let lastSoftHealAt = 0

        const liveEdge = (video: HTMLVideoElement): number | null =>
            hlsRef.current?.liveSyncPosition ??
            (video.seekable.length > 0
                ? video.seekable.end(video.seekable.length - 1)
                : null)

        const toLiveEdge = () => {
            const video = videoRef.current
            if (!video) return
            const end = liveEdge(video)
            if (end != null && Number.isFinite(end)) {
                try { video.currentTime = Math.max(0, end - 3) } catch { /* not seekable yet */ }
            }
            video.play().catch(() => {})
        }

        const id = window.setInterval(() => {
            const video = videoRef.current
            if (!video || reconnecting) return
            // A deliberate pause / ended stream / hidden tab isn't a stall.
            if (video.paused || video.ended || document.hidden) {
                lastTime = video.currentTime
                lastProgressAt = Date.now()
                return
            }
            if (video.currentTime !== lastTime) {
                lastTime = video.currentTime
                lastProgressAt = Date.now()
                return
            }
            if (Date.now() - lastProgressAt < STALL_LIMIT_MS) return
            if (Date.now() - lastSoftHealAt > SOFT_HEAL_GRACE_MS) {
                // First stall in a while → soft heal: back to the live edge.
                lastSoftHealAt = Date.now()
                lastProgressAt = Date.now()
                toLiveEdge()
            } else {
                // Re-stalled right after a soft heal → pipeline is wedged;
                // rebuild it. (retryNonce re-runs this effect with fresh state.)
                forceReload()
            }
        }, WATCHDOG_MS)

        // Waking a suspended tab: resume at the live edge instead of minutes
        // behind (or frozen). The seekable fallback matters on iOS/Safari
        // native HLS, where there is no hls.js instance.
        const onVisible = () => {
            if (document.hidden) return
            const video = videoRef.current
            if (!video || video.ended) return
            const edge = liveEdge(video)
            if (edge != null && edge - video.currentTime > 10) toLiveEdge()
            else video.play().catch(() => {})
        }
        document.addEventListener("visibilitychange", onVisible)
        return () => {
            clearInterval(id)
            document.removeEventListener("visibilitychange", onVisible)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kind, src, retryNonce, reconnecting])

    // Track fullscreen so the button flips maximize ↔ minimize.
    useEffect(() => {
        const onChange = () => setIsFs(document.fullscreenElement === wrapRef.current)
        document.addEventListener("fullscreenchange", onChange)
        return () => document.removeEventListener("fullscreenchange", onChange)
    }, [])

    // HLS pipeline: native where supported (iOS/macOS Safari), hls.js
    // elsewhere. Lazy import keeps hls.js out of the main bundle.
    useEffect(() => {
        if (kind !== "hls") return
        const video = videoRef.current
        if (!video) return
        setReconnecting(false)

        if (video.canPlayType("application/vnd.apple.mpegurl")) {
            video.src = src
            video.play().catch(() => {})
            return () => {
                video.removeAttribute("src")
                video.load()
            }
        }

        let cancelled = false
        let hls: import("hls.js").default | null = null
        import("hls.js")
            .then(({ default: Hls }) => {
                if (cancelled || !videoRef.current) return
                if (!Hls.isSupported()) {
                    scheduleReconnect()
                    return
                }
                hls = new Hls({
                    liveDurationInfinity: true,
                    // A live stream runs for hours - hard-cap the buffers so
                    // memory stays flat. The default back buffer would keep
                    // the whole broadcast in RAM and slowly wedge the tab
                    // (the "frozen until I reload the page" failure).
                    backBufferLength: 30,
                    maxBufferLength: 30,
                    maxMaxBufferLength: 120,
                    // Be patient with a flaky court connection before
                    // declaring a fatal error (the auto-reconnect still
                    // catches anything beyond these).
                    manifestLoadingMaxRetry: 6,
                    levelLoadingMaxRetry: 6,
                    fragLoadingMaxRetry: 6,
                })
                hlsRef.current = hls
                hls.loadSource(src)
                hls.attachMedia(videoRef.current)
                hls.on(Hls.Events.MANIFEST_PARSED, () => {
                    videoRef.current?.play().catch(() => {})
                })
                // A live stream hiccups: try the documented in-place
                // recoveries a few times, then tear down and let the
                // auto-reconnect loop rebuild the whole pipeline.
                let recoveries = 0
                hls.on(Hls.Events.ERROR, (_evt, data) => {
                    if (!data.fatal || !hls) return
                    recoveries += 1
                    if (recoveries > 3) {
                        try { hls.destroy() } catch { /* already gone */ }
                        hlsRef.current = null
                        scheduleReconnect()
                        return
                    }
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad()
                    else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError()
                    else {
                        try { hls.destroy() } catch { /* already gone */ }
                        hlsRef.current = null
                        scheduleReconnect()
                    }
                })
            })
            .catch(() => scheduleReconnect())
        return () => {
            cancelled = true
            try { hls?.destroy() } catch { /* already gone */ }
            hlsRef.current = null
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [kind, src, retryNonce])

    function toggleFullscreen() {
        const el = wrapRef.current
        if (!el) return
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {})
            return
        }
        const enter = el.requestFullscreen?.bind(el)
        if (enter) {
            enter().catch(() => iosVideoFullscreen())
        } else {
            iosVideoFullscreen()
        }
        function iosVideoFullscreen() {
            // iOS Safari: only <video> can go fullscreen, via this
            // vendor-prefixed call. Iframe embeds keep their own button.
            const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
            v?.webkitEnterFullscreen?.()
        }
    }

    const isVideoTag = kind === "hls" || kind === "file"

    return (
        <Box
            ref={wrapRef}
            position="relative"
            bg="black"
            rounded={isFs ? undefined : "2xl"}
            overflow="hidden"
            // 16:9 when the parent doesn't constrain the height (mobile /
            // standalone); with a fixed-height parent (the desktop hero row)
            // h=100% wins and the video letterboxes via object-fit.
            css={{ aspectRatio: "16 / 9" }}
            w="full"
            h="full"
        >
            {isVideoTag ? (
                <chakra.video
                    key={`${src}-${retryNonce}`}
                    ref={videoRef}
                    // Direct files get the src attribute; HLS is wired up
                    // by the effect above (hls.js attaches MediaSource).
                    src={kind === "file" ? src : undefined}
                    controls
                    // Hide the NATIVE fullscreen button: it fullscreens only the
                    // <video>, so our sibling scorebug overlay would vanish. The
                    // top-right custom button fullscreens the whole box (overlay
                    // stays visible), so steer everyone there.
                    controlsList="nofullscreen"
                    autoPlay
                    muted
                    playsInline
                    onError={kind === "file" ? () => scheduleReconnect() : undefined}
                    w="100%"
                    h="100%"
                    css={{ objectFit: "contain" }}
                />
            ) : (
                <chakra.iframe
                    key={`${src}-${retryNonce}`}
                    src={src}
                    title="Prijenos uživo"
                    allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
                    allowFullScreen
                    w="100%"
                    h="100%"
                    border="0"
                />
            )}

            {/* Reconnect overlay - the player rebuilds itself automatically. */}
            {reconnecting && (
                <Flex
                    position="absolute"
                    inset="0"
                    align="center"
                    justify="center"
                    direction="column"
                    gap="2"
                    bg="blackAlpha.700"
                    pointerEvents="none"
                >
                    <Text fontSize="sm" color="white" fontWeight={700}>
                        Prekid prijenosa
                    </Text>
                    <Text fontSize="xs" color="whiteAlpha.800" fontWeight={600}>
                        Ponovno spajanje…
                    </Text>
                </Flex>
            )}

            {/* Live scorebug overlay - pinned to the top, centered, and clicks
                pass through to the video controls. Sits inside the fullscreen
                element so it stays visible when the video goes fullscreen; it
                scales up there so it reads like a broadcast bug on a big screen. */}
            {overlay && (
                <Flex
                    position="absolute"
                    top={isFs ? "4" : "2"}
                    left="0"
                    right="0"
                    justify="center"
                    px="12"
                    pointerEvents="none"
                >
                    <Box css={{ transform: isFs ? "scale(1.6)" : "none", transformOrigin: "top center", transition: "transform 150ms" }}>
                        {overlay}
                    </Box>
                </Flex>
            )}

            {/* Top-left stack: "UŽIVO PRIJENOS" pill + live-viewer count. */}
            <VStack position="absolute" top="2" left="2" align="flex-start" gap="1" pointerEvents="none">
                <HStack
                    gap="1"
                    px="2"
                    py="0.5"
                    rounded="full"
                    bg="accent.red"
                    color="white"
                    fontFamily="mono"
                    fontSize="9px"
                    fontWeight={800}
                    letterSpacing="0.1em"
                >
                    <PulseDot color="white" size={5} />
                    UŽIVO
                </HStack>
                {viewers != null && viewers > 0 && (
                    <HStack
                        gap="1"
                        px="2"
                        py="0.5"
                        rounded="full"
                        bg="rgba(0,0,0,0.62)"
                        color="white"
                        fontFamily="mono"
                        fontSize="9px"
                        fontWeight={800}
                        css={{ backdropFilter: "blur(6px)" }}
                        title="Gledatelja uživo na stranici"
                    >
                        <Box display="inline-flex"><FiEye size={11} /></Box>
                        {viewers}
                    </HStack>
                )}
            </VStack>

            {/* Manual refresh - rebuilds the player IN PLACE (new pipeline /
                fresh iframe embed), so a wedged stream never needs a full
                page reload. */}
            <chakra.button
                type="button"
                onClick={forceReload}
                aria-label="Osvježi prijenos"
                title="Osvježi prijenos"
                position="absolute"
                top="2"
                right="12"
                display="inline-flex"
                alignItems="center"
                justifyContent="center"
                w="8"
                h="8"
                rounded="full"
                bg="blackAlpha.600"
                color="white"
                cursor="pointer"
                _hover={{ bg: "blackAlpha.800" }}
                transition="background 150ms"
            >
                <FiRefreshCw size={14} />
            </chakra.button>

            {/* Fullscreen toggle - kept custom so iframe embeds get one too. */}
            <chakra.button
                type="button"
                onClick={toggleFullscreen}
                aria-label={isFs ? "Izađi iz cijelog zaslona" : "Cijeli zaslon"}
                title={isFs ? "Izađi iz cijelog zaslona" : "Cijeli zaslon"}
                position="absolute"
                top="2"
                right="2"
                display="inline-flex"
                alignItems="center"
                justifyContent="center"
                w="8"
                h="8"
                rounded="full"
                bg="blackAlpha.600"
                color="white"
                cursor="pointer"
                _hover={{ bg: "blackAlpha.800" }}
                transition="background 150ms"
            >
                {isFs ? <FiMinimize size={15} /> : <FiMaximize size={15} />}
            </chakra.button>
        </Box>
    )
}
