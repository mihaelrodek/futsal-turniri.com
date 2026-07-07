/**
 * gen-pwa-icons.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Renders every raster app icon from the canonical brand mark
 * (public/logo/mark-green.svg) so the PWA install prompt, home-screen icon,
 * push notifications and structured-data logo all show the SAME current logo.
 *
 * Run (sharp is the only dependency - install if missing):
 *   npm install --no-save sharp && node scripts/gen-pwa-icons.mjs
 *
 * Outputs (public/):
 *   icon-192.png            192  - manifest "any"      (transparent rounded)
 *   icon-512.png            512  - manifest "any"
 *   icon-512-maskable.png   512  - manifest "maskable"  (full-bleed green)
 *   apple-touch-icon.png    180  - iOS home screen      (opaque green)
 *   futsal-turniri-symbol.png 512 - push / structured-data logo (opaque green)
 */
import sharp from "sharp"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

const __dirname = dirname(fileURLToPath(import.meta.url))
const pub = resolve(__dirname, "..", "public")
const GREEN = { r: 11, g: 107, b: 58, alpha: 1 } // #0b6b3a brand green
const svg = readFileSync(resolve(pub, "logo", "mark-green.svg"))

// Rasterise the SVG at a high density, then resize down for a crisp result.
const render = (size) =>
    sharp(svg, { density: 512 })
        .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()

async function transparent(size, out) {
    await render(size).toFile(resolve(pub, out))
    console.log("wrote", out, `${size}x${size}`)
}

// The mark already carries the green rounded square; compositing it over a
// solid green canvas fills the transparent corners → a full-bleed opaque icon
// (correct for maskable, apple-touch and notification icons).
async function squareGreen(size, out) {
    const mark = await render(size).toBuffer()
    await sharp({ create: { width: size, height: size, channels: 4, background: GREEN } })
        .composite([{ input: mark }])
        .png()
        .toFile(resolve(pub, out))
    console.log("wrote", out, `${size}x${size}`, "(opaque green)")
}

await transparent(192, "icon-192.png")
await transparent(512, "icon-512.png")
await squareGreen(512, "icon-512-maskable.png")
await squareGreen(180, "apple-touch-icon.png")
await squareGreen(512, "futsal-turniri-symbol.png")
console.log("done")
