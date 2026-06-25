import { useEffect, useState } from "react"
import { IconButton } from "@chakra-ui/react"
import { FiBell, FiBellOff } from "react-icons/fi"
import {
    fetchMatchSubscription,
    subscribeToMatch,
    unsubscribeFromMatch,
} from "../api/matchSubscriptions"
import { useAuth } from "../auth/AuthContext"
import { showError } from "../toaster"

/* ──────────────────────────────────────────────────────────────────────────
   Bell for a single match (e.g. an upcoming match on /uzivo). Click →
   subscribe to a push notification fired when that match kicks off; click
   again → unsubscribe. Notification permission is requested lazily on first
   click. Anonymous viewers see nothing.

   Designed to sit inside a clickable row — the click is stopped from
   bubbling so tapping the bell never also navigates the row.
   ────────────────────────────────────────────────────────────────────── */

export default function MatchNotificationBell({
    tournamentUuid,
    matchId,
}: {
    tournamentUuid: string
    matchId: number
}) {
    const { user, loading: authLoading } = useAuth()
    const [subscribed, setSubscribed] = useState<boolean | null>(null)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        if (authLoading) return
        if (!user) {
            setSubscribed(false)
            return
        }
        let cancelled = false
        fetchMatchSubscription(tournamentUuid, matchId).then((r) => {
            if (!cancelled) setSubscribed(r.subscribed)
        })
        return () => {
            cancelled = true
        }
    }, [tournamentUuid, matchId, user, authLoading])

    if (!user) return null

    async function toggle() {
        if (busy || subscribed == null) return
        if (subscribed) {
            try {
                setBusy(true)
                await unsubscribeFromMatch(tournamentUuid, matchId)
                setSubscribed(false)
            } catch {
                /* toast surfaced */
            } finally {
                setBusy(false)
            }
            return
        }
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
            await subscribeToMatch(tournamentUuid, matchId)
            setSubscribed(true)
        } catch {
            /* toast surfaced */
        } finally {
            setBusy(false)
        }
    }

    const Icon = subscribed ? FiBell : FiBellOff
    const label = subscribed
        ? "Primaš obavijest za ovu utakmicu — klikni za isključi"
        : "Primaj obavijest kad ova utakmica počne"

    return (
        <IconButton
            aria-label={label}
            title={label}
            onClick={(e) => {
                e.stopPropagation()
                void toggle()
            }}
            loading={busy}
            size="sm"
            variant={subscribed ? "solid" : "ghost"}
            colorPalette={subscribed ? "pitch" : "gray"}
            rounded="full"
            flexShrink={0}
        >
            <Icon size={15} />
        </IconButton>
    )
}
