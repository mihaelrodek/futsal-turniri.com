import { useEffect, useState } from "react"
import {
    Box,
    Button,
    Dialog,
    HStack,
    Image,
    Portal,
    Text,
    VStack,
} from "@chakra-ui/react"
import { FiDownload, FiX } from "react-icons/fi"
import { useInstallPrompt } from "../hooks/useInstallPrompt"
import IosInstallSteps from "./IosInstallSteps"

/**
 * One-time coach mark that nudges first-time visitors toward the install
 * flow.
 *
 * Visibility rules — all must hold for the dialog to appear:
 *   1. App is not already installed (display-mode != standalone).
 *   2. The browser is install-capable (Chrome/Edge/Android fired
 *      beforeinstallprompt) OR we're on iOS Safari (instructions path).
 *   3. The user hasn't dismissed the hint before (localStorage flag).
 *
 * On Chrome/Android the dialog has a primary "Instaliraj" button that
 * fires the browser's install prompt directly. On iOS the steps are shown
 * INLINE in the same dialog (instead of routing the user to a separate
 * navbar dialog) — that's the whole point of the popup, and pointing at
 * a navbar icon as a follow-up is just an extra click for no reason.
 *
 * Auto-shows after a short delay so the SPA has time to paint and the
 * beforeinstallprompt event has time to fire — opening it instantly
 * risks the prompt not being captured yet.
 */

const STORAGE_KEY = "futsal:install-hint-dismissed"
const SHOW_AFTER_MS = 1500

/** localStorage helpers, defensive against SSR / private mode quirks. */
function readDismissed(): boolean {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === "1"
    } catch {
        return false
    }
}
function persistDismissed() {
    try {
        window.localStorage.setItem(STORAGE_KEY, "1")
    } catch {
        /* private mode / quota — non-fatal, hint just shows again next visit */
    }
}


export default function FirstRunInstallPrompt() {
    const { canInstall, isIos, installed, install } = useInstallPrompt()
    const [open, setOpen] = useState(false)
    const [dismissed, setDismissed] = useState<boolean>(() => readDismissed())

    // Open the dialog once the page settles and the install prompt is ready.
    // Re-runs whenever canInstall flips true (Chrome may fire the event a
    // few seconds after first paint), so the hint shows on the same visit
    // even if React mounted before the browser decided we're installable.
    useEffect(() => {
        if (dismissed) return
        if (installed) return
        if (!canInstall && !isIos) return
        const id = window.setTimeout(() => setOpen(true), SHOW_AFTER_MS)
        return () => window.clearTimeout(id)
    }, [dismissed, installed, canInstall, isIos])

    function dismiss() {
        setOpen(false)
        setDismissed(true)
        persistDismissed()
    }

    async function onInstallClick() {
        if (canInstall) {
            await install().catch(() => {
                /* user dismissed or browser refused — close anyway */
            })
            dismiss()
        }
        // For iOS there is no programmatic install — we don't reach here
        // because the iOS dialog has a different button (see render below).
    }

    if (dismissed || installed) return null
    if (!canInstall && !isIos) return null

    return (
        <Dialog.Root
            open={open}
            onOpenChange={(e) => {
                if (!e.open) dismiss()
            }}
            placement="center"
            motionPreset="slide-in-bottom"
        >
            <Portal>
                <Dialog.Backdrop />
                <Dialog.Positioner>
                    <Dialog.Content maxW={{ base: "92%", md: "md" }}>
                        <Dialog.Body py="5" px={{ base: "4", md: "6" }}>
                            <VStack align="stretch" gap="4">
                                <HStack gap="3" align="center">
                                    <Image
                                        src="/icon-192.png"
                                        alt="Futsal Turniri"
                                        h="56px"
                                        w="56px"
                                        rounded="2xl"
                                        flexShrink={0}
                                    />
                                    <Box flex="1">
                                        <Text fontWeight="semibold" fontSize="md">
                                            Instaliraj Futsal Turniri
                                        </Text>
                                        <Text fontSize="sm" color="fg.muted">
                                            {isIos
                                                ? "Dodaj aplikaciju na svoj iPhone u 3 koraka:"
                                                : "Spremi Futsal Turniri kao aplikaciju i otvori je jednim klikom s početnog zaslona."}
                                        </Text>
                                    </Box>
                                </HStack>

                                {/* iOS gets the inline three-step walkthrough.
                                    No "Instaliraj" button on iOS because Safari
                                    has no JS API for it — the user must do
                                    Share -> Add to Home Screen themselves. */}
                                {isIos && <IosInstallSteps />}

                                <HStack gap="2" justify="flex-end" wrap="wrap">
                                    <Button variant="ghost" size="sm" onClick={dismiss}>
                                        <FiX />
                                        {isIos ? " Razumijem" : " Možda kasnije"}
                                    </Button>
                                    {canInstall && (
                                        <Button
                                            variant="solid"
                                            colorPalette="pitch"
                                            size="sm"
                                            onClick={onInstallClick}
                                        >
                                            <FiDownload /> Instaliraj
                                        </Button>
                                    )}
                                </HStack>
                            </VStack>
                        </Dialog.Body>
                    </Dialog.Content>
                </Dialog.Positioner>
            </Portal>
        </Dialog.Root>
    )
}
