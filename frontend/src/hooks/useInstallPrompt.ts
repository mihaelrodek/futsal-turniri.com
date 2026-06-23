import { useEffect, useState } from "react"

/**
 * Chrome / Edge / Samsung Internet fire `beforeinstallprompt` exactly once
 * when the page is eligible for installation. The standard pattern is to
 * preventDefault() (so the browser doesn't show its own banner), stash the
 * event, and call .prompt() later from a user gesture (button click).
 *
 * iOS Safari does NOT support this API — install only works through the
 * Share -> "Add to Home Screen" menu. The hook detects that case so the UI
 * can show step-by-step instructions instead of a working button.
 *
 * The hook also tracks `installed` (true once the app is launched in
 * standalone display-mode, i.e. from the home-screen icon) so the calling
 * component can hide the install affordance entirely.
 */

/** Subset of the BeforeInstallPromptEvent we actually use. */
type BeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
}

export type InstallPromptState = {
    /** True if the browser supports the JS install prompt and the page is eligible. */
    canInstall: boolean
    /** True if running on iOS Safari (or another iOS browser using WebKit). */
    isIos: boolean
    /** True once the app is running standalone (installed). */
    installed: boolean
    /**
     * Trigger the browser install dialog. Resolves to true if the user
     * accepted, false otherwise. Throws if no prompt is currently available
     * — callers should gate on canInstall.
     */
    install: () => Promise<boolean>
}

/** UA-sniff for iOS — necessary because Safari has no API to detect installability. */
function detectIos(): boolean {
    if (typeof navigator === "undefined") return false
    const ua = navigator.userAgent
    const isIPhoneOrPad = /iPad|iPhone|iPod/.test(ua) && !(window as any).MSStream
    // iPadOS 13+ identifies as "Macintosh"; the touch-events check disambiguates.
    const isIPadOS =
        ua.includes("Macintosh") &&
        typeof navigator.maxTouchPoints === "number" &&
        navigator.maxTouchPoints > 1
    return isIPhoneOrPad || isIPadOS
}

/** Detect "Add to Home Screen" / installed standalone mode across browsers. */
function detectStandalone(): boolean {
    if (typeof window === "undefined") return false
    // iOS Safari uses the legacy navigator.standalone flag.
    const iosStandalone = (window.navigator as any).standalone === true
    // Chrome/Edge/etc.
    const matchMediaStandalone =
        window.matchMedia && window.matchMedia("(display-mode: standalone)").matches
    return iosStandalone || matchMediaStandalone
}

export function useInstallPrompt(): InstallPromptState {
    const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null)
    const [installed, setInstalled] = useState<boolean>(() => detectStandalone())
    const [isIos] = useState<boolean>(() => detectIos())

    useEffect(() => {
        function onBeforeInstall(e: Event) {
            e.preventDefault()
            setPrompt(e as BeforeInstallPromptEvent)
        }
        function onInstalled() {
            // Fired by the browser the moment the user accepts the prompt or
            // adds the app from the OS-level menu. Hide the button immediately.
            setInstalled(true)
            setPrompt(null)
        }
        window.addEventListener("beforeinstallprompt", onBeforeInstall as EventListener)
        window.addEventListener("appinstalled", onInstalled)

        // The standalone-mode check above runs only at mount; if the user
        // installs and re-enters the same tab, the matchMedia value flips.
        // Subscribe to the change so we react without a reload.
        const mql =
            typeof window.matchMedia === "function"
                ? window.matchMedia("(display-mode: standalone)")
                : null
        const onMqlChange = (e: MediaQueryListEvent) => setInstalled(e.matches)
        mql?.addEventListener?.("change", onMqlChange)

        return () => {
            window.removeEventListener("beforeinstallprompt", onBeforeInstall as EventListener)
            window.removeEventListener("appinstalled", onInstalled)
            mql?.removeEventListener?.("change", onMqlChange)
        }
    }, [])

    async function install(): Promise<boolean> {
        if (!prompt) return false
        await prompt.prompt()
        const { outcome } = await prompt.userChoice
        // The prompt can only be used once — clear it so the button hides.
        setPrompt(null)
        return outcome === "accepted"
    }

    return {
        canInstall: !!prompt && !installed,
        isIos: isIos && !installed,
        installed,
        install,
    }
}
