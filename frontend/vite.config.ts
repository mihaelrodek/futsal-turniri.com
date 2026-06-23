import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
    plugins: [react()],
    server: {
        port: 5181,
        strictPort: true,
        proxy: {
            "/api": {
                target: "http://localhost:8087",
                changeOrigin: true,
            },
        },
    },
    build: {
        rollupOptions: {
            output: {
                // Split big vendor libraries into their own long-cached
                // chunks instead of one ~1 MB index bundle. Each library
                // changes on its own cadence, so a Chakra bump doesn't bust
                // the React chunk in the browser cache, and first paint only
                // downloads what the landing route actually needs.
                manualChunks(id) {
                    if (!id.includes("node_modules")) return
                    if (id.includes("react-leaflet") || id.includes("/leaflet/")) return "leaflet"
                    if (id.includes("react-tournament-brackets")) return "brackets"
                    if (id.includes("/firebase/") || id.includes("@firebase")) return "firebase"
                    if (id.includes("@chakra-ui") || id.includes("@ark-ui") || id.includes("@emotion")) return "chakra"
                    if (
                        id.includes("/react/") ||
                        id.includes("/react-dom/") ||
                        id.includes("react-router") ||
                        id.includes("/scheduler/")
                    ) return "react"
                    // Everything else third-party → one shared vendor chunk.
                    return "vendor"
                },
            },
        },
        // Vendor chunks legitimately exceed the default 500 kB warning; bump
        // the threshold so the build log isn't noisy about expected sizes.
        chunkSizeWarningLimit: 900,
    },
})