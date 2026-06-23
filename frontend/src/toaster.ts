import { createToaster } from "@chakra-ui/react"

/**
 * Single shared toaster instance. Components and the axios interceptor
 * (api/http.ts) push notifications onto this; the actual rendering happens
 * via the <Toaster toaster={toaster} /> mounted near the root in main.tsx.
 *
 * Why one shared instance: notifications need to outlive route changes —
 * if you POST a tournament create and then we navigate away to the
 * detail page, the success toast must keep ticking down on the new page.
 * A per-component toaster would be torn down and miss that.
 */
export const toaster = createToaster({
    placement: "top",
    pauseOnPageIdle: true,
    overlap: true,
    max: 5,
})

/**
 * Croatian copy for common HTTP errors. Keys are the HTTP status; the
 * fallback at the end covers anything not enumerated. The axios interceptor
 * uses these only when the backend hasn't returned a useful body message.
 */
const STATUS_FALLBACKS_HR: Record<number, string> = {
    400: "Neispravan zahtjev.",
    401: "Niste prijavljeni.",
    403: "Nemate ovlasti za ovu akciju.",
    404: "Resurs nije pronađen.",
    409: "Konflikt — pokušajte osvježiti stranicu.",
    413: "Datoteka je prevelika.",
    422: "Neispravni podaci.",
    429: "Previše zahtjeva — pokušajte za nekoliko sekundi.",
    500: "Greška na poslužitelju.",
    502: "Poslužitelj nedostupan.",
    503: "Servis privremeno nedostupan.",
}

export function statusFallback(status?: number): string {
    if (!status) return "Greška u mreži."
    return STATUS_FALLBACKS_HR[status] ?? `Greška (HTTP ${status}).`
}

export function showSuccess(title: string, description?: string) {
    toaster.create({
        type: "success",
        title,
        description,
        duration: 3500,
    })
}

export function showError(title: string, description?: string) {
    toaster.create({
        type: "error",
        title,
        description,
        duration: 5500,
    })
}
