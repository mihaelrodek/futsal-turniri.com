import { createLogger, defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// Custom logger that drops the benign WebSocket-proxy churn. When the page
// reloads (HMR) or a tab closes, the browser aborts the proxied WS mid-write
// and Vite logs `ws proxy (socket) error … ECONNABORTED/ECONNRESET`. The socket
// works fine; this is just noise, so we filter exactly those lines and let
// every other error through.
const logger = createLogger()
const baseError = logger.error
logger.error = (msg, options) => {
    if (
        typeof msg === "string" &&
        /ws proxy (socket )?error|ECONNABORTED|ECONNRESET/.test(msg)
    ) {
        return
    }
    baseError(msg, options)
}

export default defineConfig({
    customLogger: logger,
    plugins: [react()],
    server: {
        port: 5181,
        strictPort: true,
        proxy: {
            "/api": {
                target: "http://localhost:8087",
                changeOrigin: true,
            },
            // Realtime live channel (WebSocket). `ws: true` makes Vite proxy the
            // HTTP→WS upgrade through to the backend in dev. The error handler
            // swallows proxy errors so a not-yet-started backend (the WS endpoint
            // only exists after the backend is restarted with quarkus-websockets-next)
            // doesn't spam the console — the app just falls back to polling.
            //
            // rewrite: quarkus-websockets-next registers the endpoint UNDER
            // quarkus.http.root-path (/api) → the backend serves /api/ws/live.
            // Same mapping Caddy does in prod; the client keeps using /ws/live.
            "/ws": {
                target: "ws://localhost:8087",
                ws: true,
                rewrite: (path) => `/api${path}`,
                configure: (proxy) => {
                    proxy.on("error", () => {
                        /* backend WS not available — ignore; polling covers it */
                    })
                },
            },
        },
    },
    build: {
        rollupOptions: {
            output: {
                // ALL third-party code goes into ONE vendor chunk. App code
                // stays out of it, so the cache benefit remains (a code
                // change only busts the small entry bundle; the browser keeps
                // the cached vendor chunk across deploys).
                //
                // Why a single chunk and not per-library: splitting React,
                // Chakra and react-leaflet into separate chunks created a
                // cross-chunk initialization cycle, so react-leaflet ran its
                // top-level `createContext()` before the React chunk had
                // initialized → "Cannot read properties of undefined (reading
                // 'createContext')". Keeping everything that touches React in
                // one chunk makes that impossible.
                manualChunks(id) {
                    if (!id.includes("node_modules")) return undefined
                    // Heavy libs used ONLY by lazy routes get their own chunks
                    // so the first paint of /turniri doesn't pay for them:
                    //  - leaflet + react-leaflet  → /karta (MapPage)
                    //  - @g-loot bracket library  → TournamentDetailsPage
                    // React itself stays in the main vendor chunk together
                    // with everything else React-touching (see note below) —
                    // these two only *import* React across chunks, which is
                    // safe; the historical createContext crash came from
                    // splitting React away from other React-consuming libs
                    // in the SAME initial graph.
                    if (id.includes("node_modules/leaflet") || id.includes("node_modules/react-leaflet")) {
                        return "vendor-map"
                    }
                    if (id.includes("@g-loot")) {
                        return "vendor-bracket"
                    }
                    return "vendor"
                },
            },
        },
        // The single vendor chunk legitimately exceeds the default 500 kB
        // warning; raise the threshold so the build log isn't noisy.
        chunkSizeWarningLimit: 1600,
    },
})