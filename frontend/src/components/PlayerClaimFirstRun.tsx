import { useEffect, useRef, useState } from "react"
import { useAuth } from "../auth/AuthContext"
import {
    claimPlayerSuggestion,
    listMyTeams,
    type PlayerClaimSuggestion,
} from "../api/userMe"
import { getPlayerClaimState, setPlayerClaimOptOut } from "../api/playerClaims"
import { PlayerClaimConfirmDialog } from "./PlayerClaimDialogs"
import { useTranslation } from "../i18n"
import { showSuccess } from "../toaster"

/**
 * App-level half of the "which roster player am I" flow, mounted once inside
 * the router so it fires wherever the user lands after signing in - a fresh
 * registration redirects to /turniri, not to the profile, so this can't live
 * on the profile page.
 *
 * Two behaviours, decided by whether the account already has teams linked:
 *
 *   • Established account (has teams) - link every exact name match silently
 *     and say so with one toast. The backend re-verifies the match, so
 *     there's nothing for the user to decide.
 *   • Brand-new account (nothing linked) - ASK first. Two people can share a
 *     name, and silently inheriting a stranger's tournament history as your
 *     first experience after registering is not something to do unasked.
 *
 * Runs once per uid per page load; a decline is remembered per uid in
 * localStorage so it doesn't nag on every visit. The profile page picks up
 * the "nothing matched" case and offers the manual, admin-approved request
 * instead.
 */
export const PLAYER_CLAIMS_CHANGED_EVENT = "player-claims-changed"

function promptKey(uid: string) {
    return `playerClaimPrompt:${uid}`
}

export default function PlayerClaimFirstRun() {
    const t = useTranslation()
    const { user, loading } = useAuth()
    const uid = user?.uid

    const ranForUid = useRef<string | null>(null)
    const [suggestions, setSuggestions] = useState<PlayerClaimSuggestion[]>([])
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        if (loading || !uid || ranForUid.current === uid) return
        ranForUid.current = uid
        let cancelled = false
        ;(async () => {
            let rows: PlayerClaimSuggestion[]
            try {
                const state = await getPlayerClaimState()
                // "Nisam igrač" answered earlier (on any device) - the server
                // already returns no suggestions, this is just explicit.
                if (state.optedOut) return
                rows = state.suggestions
            } catch {
                return
            }
            if (cancelled || rows.length === 0) return

            let hasTeams = false
            try {
                hasTeams = (await listMyTeams()).length > 0
            } catch {
                // Couldn't tell - treat as a new account and ask, which is
                // the more conservative of the two branches.
            }
            if (cancelled) return

            if (hasTeams) {
                await claimAll(rows)
            } else if (localStorage.getItem(promptKey(uid)) !== "1") {
                setSuggestions(rows)
                setOpen(true)
            }
        })()
        return () => { cancelled = true }
    }, [uid, loading])

    async function claimAll(rows: PlayerClaimSuggestion[]) {
        const claimedTeams: string[] = []
        for (const s of rows) {
            try {
                const res = await claimPlayerSuggestion(s.playerId)
                if (res.claimed) claimedTeams.push(res.teamName ?? s.teamName)
            } catch {
                // Claimed by someone else meanwhile, or the name no longer
                // matches - skip it, nothing for the user to act on.
            }
        }
        if (claimedTeams.length === 0) return
        const strings = t.pages.publicProfilePage.playerSuggestions
        showSuccess(
            strings.claimSuccessTitle,
            claimedTeams.length === 1
                ? strings.claimSuccessDescription(claimedTeams[0])
                : strings.claimSuccessDescriptionMultiple(claimedTeams.length),
        )
        // The profile page holds its own copy of the profile - tell it to
        // refetch instead of letting a freshly linked team show up only
        // after a reload.
        window.dispatchEvent(new CustomEvent(PLAYER_CLAIMS_CHANGED_EVENT))
    }

    async function accept() {
        setBusy(true)
        try {
            await claimAll(suggestions)
            if (uid) localStorage.setItem(promptKey(uid), "1")
            setOpen(false)
        } finally {
            setBusy(false)
        }
    }

    function decline() {
        // "Nisam" = not this person. Remembered on this device only, because
        // a different roster row might genuinely be them next season.
        if (uid) localStorage.setItem(promptKey(uid), "1")
        setOpen(false)
    }

    /** "Nisam igrač" - stop asking for good, on every device. The manual
     *  request dialog on the profile stays available regardless. */
    async function notAPlayer() {
        setBusy(true)
        try {
            await setPlayerClaimOptOut(true)
        } catch {
            // Best-effort: fall back to the per-device flag so at least this
            // browser stops asking.
            if (uid) localStorage.setItem(promptKey(uid), "1")
        } finally {
            setBusy(false)
            setOpen(false)
        }
    }

    if (!open) return null
    return (
        <PlayerClaimConfirmDialog
            open={open}
            suggestions={suggestions}
            busy={busy}
            onConfirm={accept}
            onDecline={decline}
            onNotAPlayer={notAPlayer}
        />
    )
}
