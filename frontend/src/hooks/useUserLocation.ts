import { useEffect, useState } from "react"

export type LocationStatus =
    | "idle"          // browser supports it, no decision yet
    | "asking"        // permission prompt is open
    | "granted"       // we have a position
    | "denied"        // user said no
    | "unsupported"   // no Geolocation API
    | "hidden"        // user has explicitly hidden their position from the UI

export type UserLocation = {
    pos: [number, number] | null
    status: LocationStatus
    /** Ask the browser for the user's position (or re-show after hide). */
    request: () => void
    /** Hide the user's position from UI without revoking browser permission. */
    hide: () => void
}

const HIDE_KEY = "user-loc-hidden-v1"

/**
 * Resilient geolocation hook with a few quality-of-life behaviors:
 *
 * - On mount, if the browser already has the permission granted, fetches
 *   the position silently — no extra "Allow?" prompt for return visitors.
 * - Persists a "hidden" preference in localStorage so a user who clicked
 *   Sakrij stays hidden across reloads, even if the browser permission
 *   is still granted.
 * - Never throws; errors collapse to one of the explicit status values.
 *
 * Browser permission state is owned by the browser (out of our reach).
 * Our `hidden` state is purely a UI preference — the browser still has
 * permission; we just don't render the marker until the user re-enables.
 */
export function useUserLocation(): UserLocation {
    const [pos, setPos] = useState<[number, number] | null>(null)
    const [status, setStatus] = useState<LocationStatus>("idle")

    /**
     * Translate a GeolocationPositionError into one of our status values.
     * Only the explicit PERMISSION_DENIED code becomes "denied" — timeouts
     * and unavailable-position faults revert to "idle" so the user can
     * retry without seeing a misleading "permission denied" message.
     */
    function classifyError(err: GeolocationPositionError | undefined): LocationStatus {
        if (err && err.code === 1 /* PERMISSION_DENIED */) return "denied"
        return "idle"
    }

    useEffect(() => {
        if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
            setStatus("unsupported")
            return
        }

        // Honor a previously-set "hidden" preference
        if (typeof localStorage !== "undefined" && localStorage.getItem(HIDE_KEY) === "1") {
            setStatus("hidden")
            return
        }

        // Try Permissions API for silent grant — falls back to idle if not supported
        if ("permissions" in navigator) {
            navigator.permissions
                .query({ name: "geolocation" as PermissionName })
                .then((res) => {
                    if (res.state === "granted") {
                        navigator.geolocation.getCurrentPosition(
                            (p) => {
                                setPos([p.coords.latitude, p.coords.longitude])
                                setStatus("granted")
                            },
                            (err) => setStatus(classifyError(err)),
                            { enableHighAccuracy: false, timeout: 10000, maximumAge: 60_000 },
                        )
                    } else if (res.state === "denied") {
                        setStatus("denied")
                    } else {
                        setStatus("idle")
                    }
                })
                .catch(() => setStatus("idle"))
        } else {
            setStatus("idle")
        }
    }, [])

    function request() {
        if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
            setStatus("unsupported")
            return
        }
        // Re-showing after hide: clear the persisted preference
        if (typeof localStorage !== "undefined") localStorage.removeItem(HIDE_KEY)
        setStatus("asking")
        navigator.geolocation.getCurrentPosition(
            (p) => {
                setPos([p.coords.latitude, p.coords.longitude])
                setStatus("granted")
            },
            (err) => setStatus(classifyError(err)),
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 60_000 },
        )
    }

    function hide() {
        setPos(null)
        setStatus("hidden")
        if (typeof localStorage !== "undefined") localStorage.setItem(HIDE_KEY, "1")
    }

    return { pos, status, request, hide }
}
