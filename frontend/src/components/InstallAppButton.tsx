import { useState } from "react"
import {
    Button,
    Dialog,
    HStack,
    IconButton,
    Image,
    Portal,
    Text,
    VStack,
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
 * Tapping it always opens an explanatory dialog (one source of truth for the
 * install copy + the app icon preview): iOS shows the shared IosInstallSteps
 * Share-menu walkthrough; Android/Chrome shows a short note plus an
 * "Instaliraj" button that fires the browser's native install prompt.
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
    const [dialogOpen, setDialogOpen] = useState(false)

    if (!canInstall && !isIos) return null

    // One label for both platforms keeps the button width consistent and
    // doesn't wrap on narrow phones. The iOS-vs-Android distinction is
    // spelled out inside the dialog that opens after the tap.
    const label = "Instaliraj aplikaciju"

    // Always open the explanatory dialog (not the bare native prompt) so the
    // user sees what they're installing — the app icon + how-to steps.
    function handleClick() {
        setDialogOpen(true)
    }

    function handleNativeInstall() {
        install()
            .catch(() => {
                /* user dismissed or browser refused — no-op */
            })
            .finally(() => setDialogOpen(false))
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
                open={dialogOpen}
                onOpenChange={(e) => {
                    if (!e.open) setDialogOpen(false)
                }}
                placement="center"
                motionPreset="slide-in-bottom"
            >
                <Portal>
                    <Dialog.Backdrop />
                    <Dialog.Positioner>
                        <Dialog.Content maxW={{ base: "92%", md: "md" }}>
                            <Dialog.Header>
                                <HStack gap="3" align="center">
                                    <Image
                                        src="/icon-192.png"
                                        alt="Futsal Turniri"
                                        h="40px"
                                        w="40px"
                                        rounded="xl"
                                        flexShrink={0}
                                    />
                                    <Dialog.Title>Instaliraj Futsal Turniri</Dialog.Title>
                                </HStack>
                            </Dialog.Header>
                            <Dialog.Body>
                                <VStack align="stretch" gap="3">
                                    <Text fontSize="sm" color="fg.muted">
                                        {isIos
                                            ? "Dodaj aplikaciju na svoj iPhone u 3 koraka:"
                                            : "Spremi Futsal Turniri kao aplikaciju i otvori je jednim klikom s početnog zaslona."}
                                    </Text>
                                    {/* iOS has no JS install API — show the manual
                                        Share → Add to Home Screen walkthrough. */}
                                    {isIos && <IosInstallSteps />}
                                </VStack>
                            </Dialog.Body>
                            <Dialog.Footer>
                                <Button variant="ghost" onClick={() => setDialogOpen(false)}>
                                    Zatvori
                                </Button>
                                {canInstall && (
                                    <Button
                                        variant="solid"
                                        colorPalette="pitch"
                                        onClick={handleNativeInstall}
                                    >
                                        <FiDownload /> Instaliraj
                                    </Button>
                                )}
                            </Dialog.Footer>
                        </Dialog.Content>
                    </Dialog.Positioner>
                </Portal>
            </Dialog.Root>
        </>
    )
}
