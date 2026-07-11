import { useEffect, useMemo, useRef, useState } from "react"
import { Box, Flex, HStack, Text, VStack, chakra } from "@chakra-ui/react"
import { FiMaximize, FiMinimize, FiEye } from "react-icons/fi"

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
                hls = new Hls({ liveDurationInfinity: true })
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
                        scheduleReconnect()
                        return
                    }
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad()
                    else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError()
                    else {
                        try { hls.destroy() } catch { /* already gone */ }
                        scheduleReconnect()
                    }
                })
            })
            .catch(() => scheduleReconnect())
        return () => {
            cancelled = true
            try { hls?.destroy() } catch { /* already gone */ }
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
