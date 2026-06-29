import { useState } from "react"
import {
    Button,
    Dialog,
    HStack,
    IconButton,
    Image,
    Portal,
} from "@chakra-ui/react"
import { FiDownload } from "react-icons/fi"
import { useInstallPrompt } from "../hooks/useInstallPrompt"
import IosInstallSteps from "./IosInstallSteps"

/**
 * Compact icon-only install affordance. Renders a circular IconButton with
 * just the download glyph — no text label — so it tucks neatly between the
 * auth area and the color-mode toggle without bloating the navbar.
 *
 * Visibility:
 *   - the app is not yet installed (display-mode != standalone), AND
 *   - either the browser fired beforeinstallprompt (Chrome / Edge / Android),
 *     OR we're on iOS Safari (no API available — show step instructions).
 *
 * On all other browsers (already installed, or Firefox desktop, etc.) it
 * renders nothing, so the parent layout is unaffected. The aria-label and
 * native `title` give the icon a name for screen readers and a hover
 * tooltip for sighted desktop users.
 *
 * iOS path opens a dialog with the shared IosInstallSteps walkthrough,
 * which is the same component the FirstRunInstallPrompt uses inline —
 * one source of truth for the Croatian Share-menu copy.
 */
export function InstallAppButton({
    size = "sm",
    variant = "icon",
}: {
    size?: "xs" | "sm" | "md"
    /**
     * "icon" — circular icon-only IconButton (desktop top bar).
     * "labeled" — full-width Button with text label + download glyph
     *             (mobile drawer / menu where it sits among other items).
     */
    variant?: "icon" | "labeled"
}) {
    const { canInstall, isIos, install } = useInstallPrompt()
    const [iosOpen, setIosOpen] = useState(false)

    if (!canInstall && !isIos) return null

    // One label for both platforms keeps the button width consistent and
    // doesn't wrap on narrow phones. The iOS-vs-Android distinction is
    // already visible in the dialog that opens after the tap (iOS shows
    // the Share-menu walkthrough; Android fires the native prompt), so
    // we don't need to spell it out on the button itself.
    const label = "Instaliraj aplikaciju"

    function handleClick() {
        if (canInstall) {
            install().catch(() => {
                /* user dismissed or browser refused — no-op */
            })
        } else {
            // iOS path. Open the steps dialog. We don't gate this on isIos
            // because the early-return above already guarantees that one of
            // the two conditions is true.
            setIosOpen(true)
        }
    }

    return (
        <>
            {variant === "labeled" ? (
                <Button
                    onClick={handleClick}
                    size={size}
                    variant="outline"
                    colorPalette="pitch"
                    w="full"
                    // Centre the icon + label so the button lines up
                    // visually with the rest of the mobile-drawer
                    // NavButton stack (Turniri / Kalendar / …). The
                    // previous flex-start alignment made the contents
                    // hug the left edge while every neighbour centred
                    // theirs, which read as broken alignment on a phone.
                    justifyContent="center"
                    // gap controls the spacing between the icon and the
                    // text — Chakra's default is fine, but pinning it
                    // makes the gap consistent across font-rendering
                    // platforms (iOS Safari tends to render the icon
                    // closer to the text than Chrome does).
                    gap="2"
                >
                    <FiDownload /> {label}
                </Button>
            ) : (
                <IconButton
                    aria-label={label}
                    title={label}
                    size={size}
                    variant="outline"
                    rounded="full"
                    colorPalette="pitch"
                    onClick={handleClick}
                >
                    <FiDownload />
                </IconButton>
            )}
            <Dialog.Root
                open={iosOpen}
                onOpenChange={(e) => {
                    if (!e.open) setIosOpen(false)
                }}
                placement="center"
                motionPreset="slide-in-bottom"
            >
                <Portal>
                    <Dialog.Backdrop />
                    <Dialog.Positioner>
                        <Dialog.Content maxW={{ base: "92%", md: "md" }}>
                            <Dialog.Header>
                                <HStack gap="2" align="center">
                                    <Image
                                        src="/logo/mark-green.svg"
                                        alt=""
                                        h="28px"
                                        w="auto"
                                    />
                                    <Dialog.Title>Instaliraj Futsal Turniri</Dialog.Title>
                                </HStack>
                            </Dialog.Header>
                            <Dialog.Body>
                                <IosInstallSteps />
                            </Dialog.Body>
                            <Dialog.Footer>
                                <Button variant="ghost" onClick={() => setIosOpen(false)}>
                                    Zatvori
                                </Button>
                            </Dialog.Footer>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog.Root>
        </>
    )
}
