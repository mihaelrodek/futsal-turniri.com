import React from "react"
import ReactDOM from "react-dom/client"
import { BrowserRouter } from "react-router-dom"
import { ChakraProvider, defaultSystem } from "@chakra-ui/react"
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client"
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister"
import { queryClient, CACHE_BUSTER, PERSIST_KEY } from "./queryClient"
import { ColorModeProvider } from "./color-mode"
import { system } from "./system"
import { AuthProvider } from "./auth/AuthContext"
import AppToaster from "./components/AppToaster"
import FirstRunInstallPrompt from "./components/FirstRunInstallPrompt"
import ErrorBoundary from "./components/ErrorBoundary"
import App from "./App"

// Persist the react-query cache to localStorage so a cold load (hard reload /
// reopening the installed PWA) paints the last-seen tournaments, lists and
// tournament detail INSTANTLY from disk, then revalidates in the background.
// The volatile global live-match list is deliberately NOT persisted - it must
// never restore an hour-old "live" card; it just refetches fresh on load.
const persister = createSyncStoragePersister({
    storage: window.localStorage,
    key: PERSIST_KEY,
})

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <ChakraProvider value={system ?? defaultSystem}>
            <ColorModeProvider>
                <PersistQueryClientProvider
                    client={queryClient}
                    persistOptions={{
                        persister,
                        // How old a persisted snapshot may be and still be
                        // restored on a cold load (older → discarded).
                        maxAge: 60 * 60_000,
                        buster: CACHE_BUSTER,
                        dehydrateOptions: {
                            // Persist only successful reads, and never the
                            // volatile live-match list (see note above).
                            shouldDehydrateQuery: (q) =>
                                q.state.status === "success" && q.queryKey[0] !== "liveMatches",
                        },
                    }}
                >
                    <AuthProvider>
                        <BrowserRouter>
                            <ErrorBoundary>
                                <App />
                            </ErrorBoundary>
                        </BrowserRouter>
                    </AuthProvider>
                </PersistQueryClientProvider>
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

// Register the service worker. Only runs in production builds - the dev
// server doesn't ship the SW and registering it during HMR would pin stale
// asset URLs. Without an active SW Chrome / Edge refuse to fire the
// `beforeinstallprompt` event, so the custom install button never appears.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
    window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch((err) => {
            // Non-fatal - the app still works; only the install prompt and
            // offline shell are unavailable.
            console.warn("[sw] registration failed:", err)
        })
    })
}
