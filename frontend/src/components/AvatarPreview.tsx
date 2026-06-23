import { useEffect, useRef, useState } from "react"
import { Box, IconButton, Image, Portal } from "@chakra-ui/react"
import { FiX } from "react-icons/fi"

/**
 * Wraps any avatar trigger element to add a hover / tap preview of the
 * underlying image. The preview is a self-contained bounded card that
 * sits centered above the page on a light dim — bigger than the 48 px
 * trigger circle and easy to glance at, but explicitly NOT a fullscreen
 * lightbox (the previous fullscreen version felt heavy for an avatar).
 *
 * <p>Activation matrix:
 *   - mouse hover (desktop) — opens after a short delay so brushing
 *     past the avatar doesn't accidentally launch the preview;
 *   - tap / click — opens immediately (and re-clicks the backdrop /
 *     X button to close);
 *   - Escape — closes.
 *
 * <p>Why a Portal instead of inline absolute-positioned: the avatar
 * lives inside Chakra's {@code Card.Root}, which has
 * {@code overflow: hidden} on its rounded corners. An inline popup
 * was getting clipped at the card boundary and looked like a thin
 * vertical slice when the image extended past the card. Mounting in
 * a Portal at the document root sidesteps every ancestor's overflow
 * and lets the popup sit wherever we tell it to.
 *
 * <p>No-op when {@code src} is falsy — the trigger renders as-is, with
 * no pointer-cursor change, so initials-only avatars don't pick up a
 * "zoom-in" affordance they can't deliver.
 */
export default function AvatarPreview({
    src,
    alt,
    maxPx = 360,
    hoverOpenDelayMs = 200,
    children,
}: {
    /** Image URL to show in the preview. Falsy → no preview behavior at all. */
    src: string | null | undefined
    /** Alt text on the preview image. */
    alt?: string
    /**
     * Upper bound on the image's longer side, in pixels. The image
     * keeps its natural aspect ratio inside this box, so portrait
     * photos render as a portrait card and landscape ones as landscape.
     * Default 360 px is roughly 7.5× the 48 px trigger — visibly
     * "bigger" without crowding the page on a desktop card.
     */
    maxPx?: number
    /**
     * Milliseconds the mouse must remain over the trigger before the
     * preview opens. Prevents accidental triggers when the user is just
     * passing the cursor over the avatar. Tap activation is immediate
     * regardless of this value.
     */
    hoverOpenDelayMs?: number
    /** The trigger node — usually the avatar circle the user sees. */
    children: React.ReactNode
}) {
    const [open, setOpen] = useState(false)
    const openTimerRef = useRef<number | null>(null)

    function cancelOpenTimer() {
        if (openTimerRef.current != null) {
            window.clearTimeout(openTimerRef.current)
            openTimerRef.current = null
        }
    }

    function handleMouseEnter() {
        if (open) return
        cancelOpenTimer()
        openTimerRef.current = window.setTimeout(() => {
            setOpen(true)
        }, hoverOpenDelayMs)
    }
    function handleMouseLeave() {
        // Only cancels the *pending* open. Once the popup is up the
        // cursor will move off the small trigger area to interact
        // with the popup — closing on mouse-leave there would make
        // the popup chase the cursor.
        cancelOpenTimer()
    }
    function handleClick() {
        cancelOpenTimer()
        setOpen(true)
    }

    // Escape-to-close. Attached only while the popup is mounted; no
    // need for a global listener otherwise.
    useEffect(() => {
        if (!open) return
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") setOpen(false)
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [open])

    useEffect(() => () => cancelOpenTimer(), [])

    if (!src) {
        return <>{children}</>
    }

    return (
        <>
            <Box
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onClick={handleClick}
                cursor="zoom-in"
                // Inline-block keeps the wrapper sized to its child
                // (the avatar circle) instead of stretching to fill
                // the parent — which would extend the hover hitbox
                // into empty space and pop the preview from far away.
                display="inline-block"
            >
                {children}
            </Box>

            {open && (
                <Portal>
                    {/* Dim backdrop + centered card. Click backdrop to
                        close; click the card itself is a no-op (its
                        own onClick stops propagation) so users can
                        right-click → "save image" without dismissing
                        the popup. */}
                    <Box
                        position="fixed"
                        inset="0"
                        bg="blackAlpha.500"
                        // Above the navbar (1000) and Joyride overlay
                        // (2000). The preview is the topmost surface
                        // while it's up.
                        zIndex={3000}
                        display="flex"
                        alignItems="center"
                        justifyContent="center"
                        p="4"
                        onClick={() => setOpen(false)}
                        cursor="zoom-out"
                    >
                        <Box
                            position="relative"
                            bg="bg"
                            rounded="lg"
                            shadow="2xl"
                            p="2"
                            // Card grows to fit the image but never
                            // exceeds maxPx on either axis (or the
                            // viewport with a small margin, whichever
                            // is smaller — protects against landscape
                            // images on narrow phones).
                            maxW={{ base: "calc(100vw - 32px)", md: `${maxPx + 16}px` }}
                            maxH={{ base: "calc(100vh - 32px)", md: `${maxPx + 16}px` }}
                            onClick={(e) => e.stopPropagation()}
                            cursor="default"
                        >
                            <Image
                                src={src}
                                alt={alt}
                                // Auto width + height with bounded max
                                // keeps the natural aspect of whatever
                                // the user uploaded. objectFit:contain
                                // on a no-explicit-size Image is a
                                // no-op, so we just rely on the auto
                                // sizing with the max constraints.
                                maxW={{ base: "calc(100vw - 48px)", md: `${maxPx}px` }}
                                maxH={{ base: "calc(100vh - 48px)", md: `${maxPx}px` }}
                                w="auto"
                                h="auto"
                                rounded="md"
                                draggable={false}
                                display="block"
                            />
                            <IconButton
                                aria-label="Zatvori"
                                size="xs"
                                variant="solid"
                                colorPalette="gray"
                                rounded="full"
                                position="absolute"
                                top="-10px"
                                right="-10px"
                                shadow="md"
                                onClick={(e) => {
                                    e.stopPropagation()
                                    setOpen(false)
                                }}
                            >
                                <FiX />
                            </IconButton>
                        </Box>
                    </Box>
                </Portal>
            )}
        </>
    )
}
