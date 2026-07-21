import { useEffect, useState } from "react"
import { Box, IconButton } from "@chakra-ui/react"
import { FiBell, FiBellOff } from "react-icons/fi"
import {
    fetchTournamentSubscription,
    subscribeToTournament,
    unsubscribeFromTournament,
} from "../api/tournamentSubscriptions"
import {
    ensureBrowserPushSubscription,
    getExistingPushEndpoint,
    pushSupported,
} from "../api/push"
import { useAuth } from "../auth/AuthContext"
import { showError } from "../toaster"

/* ──────────────────────────────────────────────────────────────────────────
   Bell icon on a tournament page. Click → subscribe to push notifications
   for that tournament (goals, half-time, full-time). Click again →
   unsubscribe.

   Visible to EVERYONE - logged-in and anonymous viewers alike:

   • Logged-in: the subscription is tied to their account, so pushes reach
     all their devices. Server keys on the Firebase uid.

   • Anonymous: the subscription is tied to THIS browser's push endpoint.
     Clicking requests notification permission, creates/reads the browser's
     push subscription, and registers the anon follow keyed by that endpoint.
     Subscribed-state is answered by the backend (queried by endpoint), with a
     small localStorage cache for instant paint on the next visit.

   Notification permission is requested lazily on first click. If the user
   denies, we surface an explanation toast and DO NOT call the backend -
   pushes wouldn't reach them anyway.
   ────────────────────────────────────────────────────────────────────── */

const ANON_CACHE_PREFIX = "anon-tsub:"

function readAnonCache(uuid: string): boolean | null {
    try {
        const v = localStorage.getItem(ANON_CACHE_PREFIX + uuid)
        return v === null ? null : v === "1"
    } catch {
        return null
    }
}

function writeAnonCache(uuid: string, subscribed: boolean) {
    try {
        localStorage.setItem(ANON_CACHE_PREFIX + uuid, subscribed ? "1" : "0")
    } catch {
        /* private mode / storage disabled - non-fatal, we just lose the cache */
    }
}

export default function TournamentNotificationBell({
    uuid,
}: {
    uuid: string
}) {
    const { user, loading: authLoading } = useAuth()
    const [subscribed, setSubscribed] = useState<boolean | null>(null)
    const [busy, setBusy] = useState(false)
    // For anonymous viewers only: this browser's push endpoint (the anon
    // identity). Null until resolved / created.
    const [anonEndpoint, setAnonEndpoint] = useState<string | null>(null)

    // Initial check - is this viewer already subscribed?
    useEffect(() => {
        if (authLoading) return
        let cancelled = false

        // Logged-in: the server (keyed by uid) is the source of truth.
        if (user) {
            fetchTournamentSubscription(uuid).then((r) => {
                if (!cancelled) setSubscribed(r.subscribed)
            })
            return () => {
                cancelled = true
            }
        }

        // Anonymous. Unsupported browsers can never subscribe - show "off".
        if (!pushSupported()) {
            setSubscribed(false)
            return
        }
        // Instant paint from the last-known state, then reconcile with the
        // server once we know this browser's endpoint.
        const cached = readAnonCache(uuid)
        if (cached !== null) setSubscribed(cached)

        getExistingPushEndpoint().then((ep) => {
            if (cancelled) return
            if (!ep) {
                // This browser has never created a push subscription, so it
                // can't have an anon follow yet.
                setAnonEndpoint(null)
                setSubscribed(false)
                writeAnonCache(uuid, false)
                return
            }
            setAnonEndpoint(ep)
            fetchTournamentSubscription(uuid, ep).then((r) => {
                if (cancelled) return
                setSubscribed(r.subscribed)
                writeAnonCache(uuid, r.subscribed)
            })
        })
        return () => {
            cancelled = true
        }
    }, [uuid, user, authLoading])

    // Shared permission gate. Returns true when we may proceed to subscribe.
    // MUST be called synchronously first in the click gesture (before any
    // other await) so iOS keeps the prompt.
    async function ensurePermission(): Promise<boolean> {
        if (typeof Notification === "undefined") return true
        if (Notification.permission === "default") {
            const result = await Notification.requestPermission()
            if (result !== "granted") {
                showError(
                    "Obavijesti su blokirane",
                    "Dozvoli obavijesti u postavkama preglednika i pokušaj ponovno.",
                )
                return false
            }
            return true
        }
        if (Notification.permission === "denied") {
            showError(
                "Obavijesti su blokirane",
                "Otvori postavke preglednika i dozvoli obavijesti za ovu stranicu.",
            )
            return false
        }
        return true
    }

    async function toggleLoggedIn() {
        if (subscribed) {
            await unsubscribeFromTournament(uuid)
            setSubscribed(false)
            return
        }
        if (!(await ensurePermission())) return
        await subscribeToTournament(uuid)
        setSubscribed(true)
    }

    async function toggleAnon() {
        if (!pushSupported()) {
            showError(
                "Obavijesti nisu podržane",
                "Tvoj preglednik ne podržava web obavijesti.",
            )
            return
        }
        if (subscribed) {
            const ep = anonEndpoint ?? (await getExistingPushEndpoint())
            if (ep) await unsubscribeFromTournament(uuid, ep)
            setSubscribed(false)
            writeAnonCache(uuid, false)
            return
        }
        if (!(await ensurePermission())) return
        const json = await ensureBrowserPushSubscription()
        if (!json) {
            showError(
                "Ne mogu uključiti obavijesti",
                "Pokušaj ponovno za koji trenutak.",
            )
            return
        }
        setAnonEndpoint(json.endpoint)
        await subscribeToTournament(uuid, json.endpoint)
        setSubscribed(true)
        writeAnonCache(uuid, true)
    }

    async function toggle() {
        if (busy || subscribed == null) return
        try {
            setBusy(true)
            if (user) {
                await toggleLoggedIn()
            } else {
                await toggleAnon()
            }
        } catch {
            /* toast surfaced by the http interceptor */
        } finally {
            setBusy(false)
        }
    }

    const Icon = subscribed ? FiBell : FiBellOff
    const label = subscribed
        ? "Primaš obavijesti o turniru - klikni za isključi"
        : "Primaj obavijesti o turniru (golovi, kraj utakmice)"

    return (
        <Box position="relative">
            <IconButton
                aria-label={label}
                title={label}
                onClick={toggle}
                loading={busy}
                size="sm"
                variant="outline"
                colorPalette={subscribed ? "pitch" : "gray"}
                rounded="full"
            >
                <Icon size={16} />
            </IconButton>
            {subscribed && (
                <Box
                    position="absolute"
                    top="-2px"
                    right="-2px"
                    w="10px"
                    h="10px"
                    rounded="full"
                    bg="pitch.500"
                    borderWidth="2px"
                    borderColor="bg.panel"
                    css={{
                        animation: "pitchPulse 1.8s infinite",
                    }}
                />
            )}
        </Box>
    )
}
