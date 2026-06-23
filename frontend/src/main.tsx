import React from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { ChakraProvider, defaultSystem } from "@chakra-ui/react"
import { ColorModeProvider } from "./color-mode"
import { system } from "./system"
import { AuthProvider } from "./auth/AuthContext"
import AppToaster from "./components/AppToaster"
import FirstRunInstallPrompt from "./components/FirstRunInstallPrompt"
import App from "./App"

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <ChakraProvider value={system ?? defaultSystem}>
            <ColorModeProvider>
                <AuthProvider>
                    <BrowserRouter>
                        <App />
                    </BrowserRouter>
                </AuthProvider>
            </ColorModeProvider>
            {/* Toast viewport. Mounted at root so toasts survive route
                changes. The shared toaster instance lives in src/toaster.ts
                and is imported by both AppToaster (rendering) and
                api/http.ts (the axios interceptor that creates toasts). */}
            <AppToaster />
            {/* First-launch install nudge. Self-gates on localStorage so it
                only ever appears once per device, and on the install-prompt
                hook so it stays hidden when the app is already installed
                (or the browser doesn't support installation). */}
            <FirstRunInstallPrompt />
        </ChakraProvider>
    </React.StrictMode>
)

// Register the service worker. Only runs in production builds — the dev
// server doesn't ship the SW and registering it during HMR would pin stale
// asset URLs. Without an active SW Chrome / Edge refuse to fire the
// `beforeinstallprompt` event, so the custom install button never appears.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch((err) => {
            // Non-fatal — the app still works; only the install prompt and
            // offline shell are unavailable.
            console.warn("[sw] registration failed:", err)
        })
    })
}
