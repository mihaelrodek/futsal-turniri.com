#!/usr/bin/env node
/**
 * One-shot helper to set/remove the `role: "admin"` custom claim on a
 * Firebase user. Run after a user has registered through the app.
 *
 * Setup (once):
 *   1. cd scripts && npm install firebase-admin
 *   2. Firebase Console → Project Settings → Service accounts →
 *      "Generate new private key" → save the JSON as
 *      `scripts/service-account.json` (gitignored).
 *
 * Usage:
 *   node set-admin.mjs <email> [--remove]
 *
 *   # Promote
 *   node set-admin.mjs admin@example.com
 *
 *   # Demote
 *   node set-admin.mjs admin@example.com --remove
 *
 * The user must sign out and back in (or call `getIdToken(true)` in the
 * frontend) for the new claim to appear in their token.
 */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"

import admin from "firebase-admin"

const __dirname = dirname(fileURLToPath(import.meta.url))
const serviceAccountPath = resolve(__dirname, "service-account.json")

let serviceAccount
try {
    serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"))
} catch (e) {
    console.error(
        "Could not read scripts/service-account.json.\n" +
        "Download it from Firebase Console → Project Settings → Service accounts.",
    )
    process.exit(1)
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
})

const args = process.argv.slice(2)
const email = args.find((a) => !a.startsWith("--"))
const remove = args.includes("--remove")

if (!email) {
    console.error("Usage: node set-admin.mjs <email> [--remove]")
    process.exit(1)
}

try {
    const user = await admin.auth().getUserByEmail(email)
    const existingClaims = user.customClaims ?? {}
    const nextClaims = { ...existingClaims }

    if (remove) {
        delete nextClaims.role
    } else {
        nextClaims.role = "admin"
    }

    await admin.auth().setCustomUserClaims(user.uid, nextClaims)

    console.log(
        `${remove ? "Removed admin from" : "Promoted to admin"}: ${email} (uid=${user.uid})`,
    )
    console.log(
        "User must sign out and back in (or refresh their token) to see the new role.",
    )
} catch (e) {
    console.error("Failed:", e?.message ?? e)
    process.exit(1)
}
