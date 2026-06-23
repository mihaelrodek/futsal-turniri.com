import { useEffect, useState } from "react"
import { Box, IconButton } from "@chakra-ui/react"
import { FiBell, FiBellOff } from "react-icons/fi"
import {
    fetchTournamentSubscription,
    subscribeToTournament,
    unsubscribeFromTournament,
} from "../api/tournamentSubscriptions"
import { useAuth } from "../auth/AuthContext"
import { showError } from "../toaster"

/* ──────────────────────────────────────────────────────────────────────────
   Bell icon on a tournament page. Click → subscribe to push notifications
   for that tournament (goals, half-time, full-time). Click again →
   unsubscribe.

   Notification permission is requested lazily on first click. If the user
   denies, we surface an explanation toast and DO NOT call the backend —
   pushes wouldn't reach them anyway.

   Anonymous viewers see nothing — login first.
   ────────────────────────────────────────────────────────────────────── */

export default function TournamentNotificationBell({
    uuid,
}: {
    uuid: string
}) {
    const { user, loading: authLoading } = useAuth()
    const [subscribed, setSubscribed] = useState<boolean | null>(null)
    const [busy, setBusy] = useState(false)

    // Initial check — does this user already subscribe?
    useEffect(() => {
        if (authLoading) return
        if (!user) {
            setSubscribed(false)
            return
        }
        let cancelled = false
        fetchTournamentSubscription(uuid).then((r) => {
            if (!cancelled) setSubscribed(r.subscribed)
        })
        return () => {
            cancelled = true
        }
    }, [uuid, user, authLoading])

    // Anonymous — hide. Login flow handles the rest if they click in.
    if (!user) return null

    async function toggle() {
        if (busy || subscribed == null) return
        if (subscribed) {
            try {
                setBusy(true)
                await unsubscribeFromTournament(uuid)
                setSubscribed(false)
            } catch {
                /* toast surfaced */
            } finally {
                setBusy(false)
            }
            return
        }
        // Subscribing — request Notification permission first. If the
        // user blocks it, calling the backend is pointless.
        try {
            setBusy(true)
            if (
                typeof Notification !== "undefined" &&
                Notification.permission === "default"
            ) {
                const result = await Notification.requestPermission()
                if (result !== "granted") {
                    showError(
                        "Obavijesti su blokirane",
                        "Dozvoli obavijesti u postavkama preglednika i pokušaj ponovno.",
                    )
                    return
                }
            } else if (
                typeof Notification !== "undefined" &&
                Notification.permission === "denied"
            ) {
                showError(
                    "Obavijesti su blokirane",
                    "Otvori postavke preglednika i dozvoli obavijesti za ovu stranicu.",
                )
                return
            }
            await subscribeToTournament(uuid)
            setSubscribed(true)
        } catch {
            /* toast surfaced */
        } finally {
            setBusy(false)
        }
    }

    const Icon = subscribed ? FiBell : FiBellOff
    const label = subscribed
        ? "Primaš obavijesti o turniru — klikni za isključi"
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
