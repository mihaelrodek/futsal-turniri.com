import axios, { type AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from "axios"
import { getFirebase } from "../firebase"
import { showError, showSuccess, statusFallback } from "../toaster"

const baseURL = import.meta.env.VITE_API_URL ?? "/api"

/**
 * Per-request flag the call sites can set to opt out of automatic toasts.
 * Useful for high-frequency or background reads (profile sync, polling,
 * health checks) where a toast would just be noise.
 *
 * Usage:
 *   http.get("/foo", { silent: true } as any)
 *   http.post("/bar", body, { silent: true } as any)
 */
type ToastOpts = {
    /** When true, neither success nor error toasts are shown for this call. */
    silent?: boolean
    /** Override the success toast title (e.g. "Turnir je kreiran"). */
    successMessage?: string
    /** Override the error toast title (the body message becomes the description). */
    errorMessage?: string
    /**
     * Suppress the auto-generated error toast for certain failures without
     * suppressing success toasts on the happy path. Useful when the caller
     * already shows its own context-aware UI for specific status codes -
     * e.g. starting a tournament returns 409 INSUFFICIENT_TEAMS and the page
     * shows its own error UI; a generic red toast on top would be noise.
     *
     * Pass `true` to silence ALL error toasts for this call, or an array of
     * HTTP status codes to silence only specific ones.
     */
    silentErrorStatuses?: true | number[]
}

declare module "axios" {
    interface AxiosRequestConfig extends ToastOpts {}
    interface InternalAxiosRequestConfig extends ToastOpts {}
}

export const http = axios.create({
    baseURL,
    headers: { "Content-Type": "application/json" },
})

/**
 * Attach the current Firebase ID token (if any) to every outgoing request.
 * The Firebase SDK caches and auto-refreshes the token internally, so calling
 * `getIdToken()` is cheap and always returns a fresh, unexpired JWT.
 *
 * Anonymous traffic (no signed-in user) is left as-is - the backend's permission
 * policies allow GETs without auth and only require it on writes.
 */
http.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
    // Firebase is lazy-loaded (see firebase.ts) - awaiting here is a no-op
    // after the first call thanks to the cached promise.
    const { auth } = await getFirebase()
    // Wait for the persisted session to be restored before reading
    // currentUser. On a cold page load currentUser is null for a moment even
    // for a signed-in user - the very first requests then went out WITHOUT
    // the bearer, so auth-dependent reads (e.g. the tournaments list with an
    // admin-hidden row) intermittently returned the anonymous variant.
    // Resolves immediately once known; guests resolve to null just as fast.
    await auth.authStateReady()
    const u = auth.currentUser
    if (u) {
        try {
            const token = await u.getIdToken()
            config.headers = config.headers ?? {}
            ;(config.headers as Record<string, string>)["Authorization"] = `Bearer ${token}`
        } catch {
            // Token fetch failed - let the request go without auth header
            // (server will reject with 401 if the endpoint requires auth, which
            // the UI already handles).
        }
    }
    return config
})

/**
 * Mutation methods get success toasts; reads stay quiet to avoid noise.
 * The set is intentional - adding HEAD/OPTIONS would not be useful, and
 * GETs that fail still surface as error toasts via the response interceptor.
 */
const TOAST_ON_SUCCESS = new Set(["post", "put", "patch", "delete"])

/**
 * Pull a human-friendly message out of a backend error response. Quarkus's
 * default error mappers return JSON like {"message": "..."} for many of our
 * thrown exceptions; some (e.g. BadRequestException with a string body) come
 * back as plain text. Cover both shapes plus a generic fallback.
 */
function extractServerMessage(err: AxiosError): string | null {
    const data = err.response?.data as unknown
    if (typeof data === "string" && data.trim()) return data.trim()
    if (data && typeof data === "object") {
        const d = data as Record<string, unknown>
        if (typeof d.message === "string" && d.message.trim()) return d.message.trim()
        if (typeof d.error === "string" && d.error.trim()) return d.error.trim()
        if (typeof d.detail === "string" && d.detail.trim()) return d.detail.trim()
    }
    return null
}

/**
 * True when a response body is an HTML *document* rather than our JSON API.
 *
 * During a production deploy the host serves a static "Nadogradnja u tijeku"
 * page for EVERY route - including `/api/*`. The already-loaded SPA then fires
 * an XHR and gets that HTML back instead of JSON. Without this guard the error
 * interceptor would dump the raw HTML source straight into a red toast.
 */
function isHtmlDocument(data: unknown, headers: unknown): boolean {
    const ct = String((headers as Record<string, unknown> | undefined)?.["content-type"] ?? "").toLowerCase()
    if (ct.includes("text/html")) return true
    if (typeof data === "string") return /^\s*<(!doctype\s+html|html[\s>])/i.test(data)
    return false
}

/** Specifically the deploy "Nadogradnja u tijeku" maintenance page. */
function isMaintenanceHtml(data: unknown): boolean {
    return typeof data === "string" && /nadogradnja u tijeku/i.test(data)
}

/**
 * Reload the tab so the browser navigates to the host's maintenance page (a
 * full document that auto-refreshes every 20 s and boots the fresh app once
 * the deploy finishes). Guarded so several in-flight requests failing at once
 * can't trigger a reload loop.
 */
let maintenanceReloadStarted = false
function goToMaintenancePage() {
    if (maintenanceReloadStarted) return
    maintenanceReloadStarted = true
    if (typeof window !== "undefined") window.location.reload()
}

http.interceptors.response.use(
    (resp: AxiosResponse) => {
        // A 2xx whose body is an HTML document means the host served the
        // maintenance/upgrade page in place of our JSON (deploy in progress).
        // Reload so the browser lands on that page instead of the SPA trying
        // to render an HTML string as data.
        if (isHtmlDocument(resp.data, resp.headers)) {
            goToMaintenancePage()
            return resp
        }
        const cfg = (resp.config ?? {}) as InternalAxiosRequestConfig
        if (cfg.silent) return resp
        const method = (cfg.method ?? "get").toLowerCase()
        if (TOAST_ON_SUCCESS.has(method)) {
            showSuccess(cfg.successMessage ?? "Spremljeno.")
        }
        return resp
    },
    (err: AxiosError) => {
        const cfg = (err.config ?? {}) as InternalAxiosRequestConfig
        const status = err.response?.status
        const suppress =
            cfg.silent === true
            || cfg.silentErrorStatuses === true
            || (Array.isArray(cfg.silentErrorStatuses)
                && typeof status === "number"
                && cfg.silentErrorStatuses.includes(status))

        // The response is an HTML page, not our JSON API - almost always the
        // deploy maintenance page (served for every route mid-release) or a
        // proxy/CDN error page. NEVER show the raw HTML source in a toast.
        // Reload onto the maintenance page when we recognise it; otherwise show
        // a short, friendly "temporarily unavailable" message.
        if (isHtmlDocument(err.response?.data, err.response?.headers)) {
            if (isMaintenanceHtml(err.response?.data)) {
                goToMaintenancePage()
            } else if (!suppress) {
                showError(
                    "Trenutno nedostupno",
                    "Usluga se ažurira ili je privremeno nedostupna. Pokušaj ponovno za koji trenutak.",
                )
            }
            return Promise.reject(err)
        }

        if (!suppress) {
            const serverMsg = extractServerMessage(err)
            const fallback = statusFallback(status)
            // Prefer the explicit per-call title when set; else the server's
            // own message; else a status-derived fallback. Description is the
            // server message when we used a per-call title (so both show).
            if (cfg.errorMessage) {
                showError(cfg.errorMessage, serverMsg ?? fallback)
            } else {
                showError(serverMsg ?? fallback)
            }
        }
        return Promise.reject(err)
    },
)
